const express = require('express');
const router = express.Router();
const User = require('../models/users');
const CivilRegistry = require('../models/CivilRegistry');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticateToken } = require('../middleware/auth'); 

router.post('/register', async (req, res) => {
    const { fullName, password, confirmPassword, nationalId, phoneNumber } = req.body;
    
    if (!fullName || !password || !confirmPassword || !nationalId || !phoneNumber) {
        return res.status(400).json({ 
            message: "جميع الحقول مطلوبة" 
        });
    }

    if (password !== confirmPassword) return res.status(400).json({ message: "كلمات المرور غير متطابقة" });

    const existingUser = await User.findOne({ $or: [{ nationalId }] });
    if (existingUser) return res.status(400).json({ message: "الرقم القومي مسجل بالفعل" });
    
    const idExists = await CivilRegistry.findOne({ nationalId: nationalId });
    if (!idExists) {
        return res.status(404).json({ 
            error: "فشل التسجيل. الرقم القومي غير صحيح." 
        });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

    const user = new User({
        fullName,
        password: hashedPassword,
        phoneNumber,
        nationalId,
        verificationCode
    });

    await user.save();
    res.status(201).json({ message: "تم إنشاء الحساب بنجاح" });
});

router.post('/login', async (req, res) => {
    const { phoneNumber, password } = req.body;

    const user = await User.findOne({ $or: [{ phoneNumber }] });
    if (!user) return res.status(400).json({ message: "User not found" });

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
        const user = await User.findById(req.user.id).select('-password -loginOtp');
        res.json({ user });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
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

module.exports = router;
