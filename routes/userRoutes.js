const express = require('express');
const router = express.Router();
const User = require('../models/users');
const CivilRegistry = require('../models/CivilRegistry');
const FamilyMember = require('../models/FamilyMember');
const Notification = require('../models/Notification'); 
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticateToken } = require('../middleware/auth'); 

router.post('/register', async (req, res) => {
    try {
        const {
            fullName, password, confirmPassword, nationalId,
            phoneNumber, gender, nationality, religion,
            region, familyMembers
        } = req.body;

        if (!fullName || !password || !confirmPassword || !nationalId || !phoneNumber) {
            return res.status(400).json({ message: "جميع الحقول المطلوبة يجب ملؤها" });
        }

        if (!religion) {
            return res.status(400).json({ message: "يرجى تحديد الديانة" });
        }

        if (password !== confirmPassword) {
            return res.status(400).json({ message: "كلمات المرور غير متطابقة" });
        }

        const existingPhone = await User.findOne({ phoneNumber, isTempUser: false });
        if (existingPhone) {
            return res.status(400).json({ message: "رقم الهاتف مستخدم بالفعل" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

        const user = new User({
            fullName, password: hashedPassword, phoneNumber, nationalId,
            gender, nationality, religion, region,   
            verificationCode, isAlive: true, isTempUser: false
        });

        await user.save();

        const familyResults = [];
        const familyErrors = [];

        if (familyMembers && Array.isArray(familyMembers) && familyMembers.length > 0) {
            const addedNationalIds = new Set();

            for (const member of familyMembers) {
                if (!member.fullName || !member.nationalId || !member.gender || !member.relationType) {
                    familyErrors.push({ member, error: 'بيانات غير مكتملة' });
                    continue;
                }
                if (addedNationalIds.has(member.nationalId)) {
                    familyErrors.push({ member, error: 'رقم قومي مكرر في نفس الطلب' });
                    continue;
                }
                addedNationalIds.add(member.nationalId);

                try {
                    let memberUser = await User.findOne({ nationalId: member.nationalId });
                    if (!memberUser) {
                        const hashedMemberPassword = await bcrypt.hash(member.nationalId, 10);
                        const newUserData = {
                            fullName: member.fullName, password: hashedMemberPassword,
                            nationalId: member.nationalId, gender: member.gender, religion: member.religion,
                            region: member.region,
                            isTempUser: true, isAlive: true
                        };
                        if (member.phoneNumber) newUserData.phoneNumber = member.phoneNumber;
                        memberUser = new User(newUserData);
                        await memberUser.save();
                    }
                    const existingRelation = await FamilyMember.findOne({ userId: user._id, memberUserId: memberUser._id });
                    if (!existingRelation) {
                        const memberReligion = member.religion || religion;
                        const memberNationality = member.nationality || nationality;
                        const memberRegion = member.region || region;

                        const familyMember = new FamilyMember({
                            userId: user._id,
                            memberUserId: memberUser._id,
                            fullName: member.fullName,
                            nationalId: member.nationalId,
                            gender: member.gender,
                            relationType: member.relationType,
                            isAlive: true,
                            religion: memberReligion,
                            nationality: memberNationality,
                            region: memberRegion,
                            phoneNumber: member.phoneNumber || null,
                        });
                        await familyMember.save();
                        familyResults.push({ member, status: 'success' });
                    } else {
                        familyResults.push({ member, status: 'already_exists' });
                    }
                } catch (innerError) {
                    console.error("Error processing family member:", innerError);
                    familyErrors.push({ member, error: innerError.message });
                }
            }
        }

        res.status(201).json({
            message: "تم إنشاء الحساب بنجاح",
            user: { id: user._id, fullName: user.fullName, phoneNumber: user.phoneNumber, nationalId: user.nationalId, religion: user.religion },
            familyResults, familyErrors
        });

    } catch (error) {
        console.error("Registration error:", error);
        if (error.code === 11000) {
            const field = error.keyPattern ? Object.keys(error.keyPattern)[0] : null;
            if (field === 'phoneNumber') return res.status(400).json({ message: "رقم الهاتف مستخدم بالفعل" });
            if (field === 'nationalId') return res.status(400).json({ message: "الرقم القومي مسجل بالفعل" });
        }
        res.status(500).json({ message: "حدث خطأ أثناء التسجيل، يرجى المحاولة مرة أخرى" });
    }
});

router.post('/check-civil-registry', async (req, res) => {
    try {
        const { fullName, nationalId, gender, religion, nationality, region } = req.body;

        if (!nationalId) {
            return res.status(400).json({ message: "الرقم القومي مطلوب" });
        }

        const civilRecord = await CivilRegistry.findOne({ nationalId });
        if (!civilRecord) {
            return res.status(400).json({ message: "الرقم القومي غير موجود في السجل المدني" });
        }

        const normalize = (str) => str?.trim().normalize('NFKC') || '';

        if (fullName && normalize(civilRecord.fullName) !== normalize(fullName)) {
            console.log(`❌ FullName mismatch: DB="${civilRecord.fullName}" vs input="${fullName}"`);
            return res.status(400).json({ message: "الاسم لا يتطابق مع بيانات السجل المدني" });
        }

        if (gender && normalize(civilRecord.gender) !== normalize(gender)) {
            console.log(`❌ Gender mismatch: DB="${civilRecord.gender}" vs input="${gender}"`);
            return res.status(400).json({ message: "الجنس لا يتطابق مع بيانات السجل المدني" });
        }

        if (religion && normalize(civilRecord.religion) !== normalize(religion)) {
            console.log(`❌ Religion mismatch: DB="${civilRecord.religion}" vs input="${religion}"`);
            return res.status(400).json({ message: "الديانة لا تتطابق مع بيانات السجل المدني" });
        }

        if (nationality && normalize(civilRecord.nationality) !== normalize(nationality)) {
            console.log(`❌ Nationality mismatch: DB="${civilRecord.nationality}" vs input="${nationality}"`);
            return res.status(400).json({ message: "الجنسية لا تتطابق مع بيانات السجل المدني" });
        }

        if (region && normalize(civilRecord.region) !== normalize(region)) {
            console.log(`❌ Region mismatch: DB="${civilRecord.region}" vs input="${region}"`);
            return res.status(400).json({ message: "المنطقة لا تتطابق مع بيانات السجل المدني" });
        }

        const existingUser = await User.findOne({ nationalId, isTempUser: false });
        if (existingUser) {
            return res.status(400).json({ message: "الرقم القومي مسجل بالفعل، يرجى تسجيل الدخول" });
        }

        return res.status(200).json({ message: "البيانات صحيحة" });
    } catch (error) {
        console.error("❌ Civil registry check error:", error);
        res.status(500).json({ message: "حدث خطأ أثناء التحقق، يرجى المحاولة مرة أخرى" });
    }
});

router.get('/family-members', authenticateToken, async (req, res) => {
    try {
        const familyMembers = await FamilyMember.find({ userId: req.user.id })
            .sort('-isAlive');
        
        res.json({ familyMembers });
    } catch (error) {
        console.error('Error fetching family members:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/family-members', authenticateToken, async (req, res) => {
    try {
        const { fullName, nationalId, gender, relationType, phoneNumber, dateOfBirth } = req.body;
        
        if (!fullName || !nationalId || !gender || !relationType) {
            return res.status(400).json({ message: 'البيانات غير مكتملة' });
        }
        
        const existing = await FamilyMember.findOne({ nationalId });
        if (existing) {
            return res.status(400).json({ message: 'الرقم القومي مسجل مسبقاً' });
        }
        
        const familyMember = new FamilyMember({
            userId: req.user.id,
            fullName,
            nationalId,
            gender,
            relationType,
            phoneNumber,
            dateOfBirth,
            isAlive: true
        });
        
        await familyMember.save();
        
        res.status(201).json({ 
            message: 'تم إضافة فرد العائلة بنجاح',
            familyMember 
        });
    } catch (error) {
        console.error('Error adding family member:', error);
        res.status(500).json({ message: 'Server error' });
    }
});


router.post('/login', async (req, res) => {
    const { phoneNumber, password } = req.body;

    const user = await User.findOne({ phoneNumber });
    if (!user) return res.status(400).json({ message: "User not found" });

    if (!user.isActive || !user.isALive) {
        return res.status(403).json({ message: "This account has been deactivated. Please contact support." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Incorrect password" });


    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    user.loginOtp = otp;
    user.otpExpires = Date.now() + 5 * 60 * 1000; 
    await user.save();

    console.log(`🔐 Login OTP for ${user.phoneNumber}: ${otp}`);

    res.json({
        message: "OTP sent (Check server console)",
        userId: user._id,
        otp: otp, 
        phoneNumber: user.phoneNumber
    });
});

router.post('/verify-login-otp', async (req, res) => {
    const { userId, otp } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(400).json({ message: "User not found" });

    console.log("📦 Saved OTP:", user.loginOtp);
    console.log("📩 Received OTP:", otp);

    const savedOtp = user.loginOtp?.toString().trim();
    const receivedOtp = otp?.toString().trim();

    if (!savedOtp || savedOtp !== receivedOtp) {
        return res.status(400).json({ message: "Invalid OTP" });
    }

    if (user.otpExpires < Date.now()) {
        return res.status(400).json({ message: "OTP expired" });
    }

    user.loginOtp = null;
    user.otpExpires = null;
    await user.save();

    const token = jwt.sign({ 
        id: user._id,
        phoneNumber: user.phoneNumber,
        nationalId: user.nationalId
    }, process.env.JWT_SECRET, {
        expiresIn: '1d'
    });

    res.json({
        token,
        user: {
            id: user._id,
            fullName: user.fullName,
            phoneNumber: user.phoneNumber,
            nationalId: user.nationalId
        },
        message: "Login successful"
    });
});
router.post('/forgot-password', async (req, res) => {
    const { phoneNumber, nationalId } = req.body;

    if (!phoneNumber || !nationalId) {
        return res.status(400).json({ 
            message: "الرقم القومي ورقم الهاتف مطلوبان" 
        });
    }

    const user = await User.findOne({ 
        phoneNumber, 
        nationalId 
    });
    
    if (!user) {
        return res.status(404).json({ 
            success: false,
            message: "لم يتم العثور على حساب مرتبط بهذه البيانات" 
        });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    user.forgotPasswordOtp = otp;
    user.forgotPasswordOtpExpires = Date.now() + 5 * 60 * 1000; 
    await user.save();

    console.log(`🔐 Forgot Password OTP for ${user.phoneNumber}: ${otp}`);

    res.json({
        success: true,
        message: "تم إرسال رمز التحقق لإعادة تعيين كلمة المرور",
        userId: user._id,
        phoneNumber: user.phoneNumber,
        otp: otp, 
    });
});

router.post('/verify-forgot-password-otp', async (req, res) => {
    const { userId, otp } = req.body;

    if (!userId || !otp) {
        return res.status(400).json({ 
            success: false,
            message: "معرف المستخدم ورمز التحقق مطلوبان" 
        });
    }

    const user = await User.findById(userId);
    if (!user) {
        return res.status(404).json({ 
            success: false,
            message: "المستخدم غير موجود" 
        });
    }

    console.log("📦 Saved Forgot Password OTP:", user.forgotPasswordOtp);
    console.log("📩 Received OTP:", otp);

    const savedOtp = user.forgotPasswordOtp?.toString().trim();
    const receivedOtp = otp?.toString().trim();

    if (!savedOtp || savedOtp !== receivedOtp) {
        return res.status(400).json({ 
            success: false,
            message: "رمز التحقق غير صحيح" 
        });
    }

    if (user.forgotPasswordOtpExpires < Date.now()) {
        return res.status(400).json({ 
            success: false,
            message: "انتهت صلاحية رمز التحقق" 
        });
    }

    const resetToken = jwt.sign(
        { 
            userId: user._id,
            purpose: 'password_reset',
            verified: true 
        }, 
        process.env.JWT_SECRET + user.password, 
        { expiresIn: '10m' }
    );


    res.json({
        success: true,
        message: "تم التحقق من رمز التحقق بنجاح",
        resetToken, 
        userId: user._id
    });
});

router.post('/reset-password/:userId', async (req, res) => {
    const { userId } = req.params;  
    const { newPassword, confirmPassword } = req.body;

    if (!newPassword || !confirmPassword) {
        return res.status(400).json({ 
            success: false,
            message: "جميع الحقول مطلوبة" 
        });
    }

    if (newPassword !== confirmPassword) {
        return res.status(400).json({ 
            success: false,
            message: "كلمات المرور غير متطابقة" 
        });
    }

    const user = await User.findById(userId);
    if (!user) {
        return res.status(404).json({ 
            success: false,
            message: "المستخدم غير موجود" 
        });
    }

    user.forgotPasswordOtp = null;
    user.forgotPasswordOtpExpires = null;
    user.isOtpVerified = false;
    
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    
    await user.save();

    res.json({
        success: true,
        message: "تم إعادة تعيين كلمة المرور بنجاح"
    });
});

router.get('/get-user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await User.findById(userId).select('loginOtp phoneNumber');
        
        if (!user) {
        return res.status(404).json({ message: "User not found" });
        }
        
        res.json({
        user: {
            loginOtp: user.loginOtp,
            phoneNumber: user.phoneNumber
        }
        });
    } catch (error) {
        res.status(500).json({ message: "Server error" });
    }
});

router.get('/profile', authenticateToken, async (req, res) => {
    try {

        const user = await User.findById(req.user.id)
            .select('-password -loginOtp');

        const familyMembers = await FamilyMember.find({
            userId: req.user.id
        });

        res.json({
            user,
            familyMembers
        });

    } catch (error) {

        res.status(500).json({
            message: 'Server error'
        });

    }
});
router.put('/update-profile', authenticateToken, async (req, res) => {
    try {
        const { fullName, phoneNumber } = req.body;
        const user = await User.findById(req.user.id);
        
        if (phoneNumber && phoneNumber !== user.phoneNumber) {
            const phoneRegex = /^[0-9]{10,15}$/;
            if (!phoneRegex.test(phoneNumber)) {
                return res.status(400).json({ 
                    message: 'رقم الهاتف غير صحيح. يجب أن يحتوي على أرقام فقط (10-15 رقم)' 
                });
            }
            
            const existingUser = await User.findOne({ 
                phoneNumber: phoneNumber,
                _id: { $ne: req.user.id } 
            });
            
            if (existingUser) {
                return res.status(400).json({ 
                    message: 'رقم الهاتف هذا مستخدم بالفعل' 
                });
            }
            
            user.phoneNumber = phoneNumber;
        }
        
        if (fullName) user.fullName = fullName;
        await user.save();
        
        res.json({ 
            message: 'تم تحديث البيانات بنجاح',
            user: {
                fullName: user.fullName,
                phoneNumber: user.phoneNumber,
                nationalId: user.nationalId
            }
        });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ message: 'حدث خطأ في الخادم' });
    }
});
router.get('/notifications', authenticateToken, async (req, res) => {
    try {
        const notifications = await Notification.find({ userId: req.user.id })
            .populate('contractId', 'contractNumber propertyType')
            .sort('-createdAt');
        
        const unreadCount = await Notification.countDocuments({ 
            userId: req.user.id, 
            isRead: false 
        });
        
        res.json({
            notifications,
            unreadCount
        });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.put('/notifications/:notificationId/read', authenticateToken, async (req, res) => {
    try {
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.notificationId, userId: req.user.id },
            { isRead: true, readAt: Date.now() },
            { new: true }
        );
        
        if (!notification) {
            return res.status(404).json({ message: 'Notification not found' });
        }
        
        res.json({ notification });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.put('/notifications/read-all', authenticateToken, async (req, res) => {
    try {
        await Notification.updateMany(
            { userId: req.user.id, isRead: false },
            { isRead: true, readAt: Date.now() }
        );
        
        res.json({ message: 'All notifications marked as read' });
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        res.status(500).json({ message: 'Server error' });
    }
});
router.delete('/notifications/:notificationId', authenticateToken, async (req, res) => {
    console.log('DELETE notification route hit!');
    console.log('Notification ID:', req.params.notificationId);
    console.log('User ID:', req.user.id);
    
    try {
        const notification = await Notification.findOneAndDelete({
            _id: req.params.notificationId,
            userId: req.user.id
        });
        
        if (!notification) {
            return res.status(404).json({ message: 'Notification not found' });
        }
        
        res.json({ message: 'Notification deleted successfully' });
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({ message: 'Server error' });
    }
});
module.exports = router;
