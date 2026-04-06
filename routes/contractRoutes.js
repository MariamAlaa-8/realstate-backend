const express = require('express');
const router = express.Router();
const Contract = require('../models/Contract');
const User = require('../models/users');
const Notification = require('../models/Notification');
const { authenticateToken } = require('../middleware/auth');
const Transaction = require('../models/Transaction'); 
const Zamam = require('../models/Zamam');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'uploads/contracts';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'contract-' + uniqueSuffix + ext);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error('فقط الصور (jpeg, jpg, png, gif) وملفات PDF مسموح بها'));
    }
};

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, 
    fileFilter: fileFilter
});

router.post('/create', authenticateToken, upload.single('contractImage'), async (req, res) => {
    try {
        console.log('📝 Creating new contract...');
        console.log('User ID:', req.user.id);
        console.log('Request body:', req.body);
        console.log('Uploaded file:', req.file); 

        const {
            fullName, nationalId, phoneNumber, propertyNumber,
            ownershipPercentage, address, governorate, propertyType,
            propertyCategory, floor, price, area, notes,
            zamamNumber,    
            zamamShare       
        } = req.body;

        if (!fullName || !nationalId || !phoneNumber || !propertyNumber || 
            !ownershipPercentage || !address || !governorate || !propertyType || 
            !propertyCategory || !price || !area) {
            console.log('❌ Missing fields');
            return res.status(400).json({ 
                message: "جميع الحقول المطلوبة يجب ملؤها" 
            });
        }

        if (!req.file) {
            console.log('❌ No image uploaded');
            return res.status(400).json({ 
                message: "صورة العقد مطلوبة" 
            });
        }

        const contractData = {
            userId: req.user.id,
            fullName, nationalId, phoneNumber, propertyNumber,
            ownershipPercentage, address, governorate, propertyType,
            propertyCategory, floor, price, area, notes,
            zamamNumber, zamamShare,
            status: 'pending',
            contractImage: `http://localhost:5000/${req.file.path.replace(/\\/g, '/')}`,
            imageType: req.file.mimetype,
            imageName: req.file.originalname
        };

        if (propertyType === 'أرض زراعية') {
            if (!zamamNumber || !zamamShare) {
                return res.status(400).json({ message: 'رقم الزمام والمساحة المملوكة مطلوبان للأراضي الزراعية' });
            }

            const zamam = await Zamam.findOne({ zamamNumber });
            if (!zamam) return res.status(400).json({ message: 'رقم الزمام غير معروف' });

            const zamamShareNum = parseFloat(zamamShare);
            if (isNaN(zamamShareNum) || zamamShareNum <= 0) {
                return res.status(400).json({ message: 'المساحة المملوكة يجب أن تكون رقماً موجباً' });
            }
            if (zamam.ownedArea == 100) {
                return res.status(400).json({ message: 'هذا الزمام مملوك بالكامل بالفعل، لا يمكن إضافة ملكية جديدة' });
            }

            contractData.zamamId = zamam._id;
            contractData.zamamShare = zamamShareNum; 
            contractData.ownershipPercentage = ownershipPercentage; 
            contractData.isZamamContract = true;
        }

        const contract = new Contract(contractData);
        await contract.save();
        
        try {
            const admin = await User.findOne({ role: 'admin' });
            if (admin) {
                const notification = new Notification({
                    userId: admin._id,
                    type: 'general',
                    title: 'طلب إثبات ملكية جديد',
                    message: `تم تقديم طلب جديد من ${fullName} - نوع العقار: ${propertyType}`,
                    contractId: contract._id,
                    data: { 
                        userName: fullName, 
                        propertyType,
                        propertyNumber 
                    }
                });
                await notification.save();
                console.log('✅ Admin notification created');
            }
        } catch (notifError) {
            console.error('❌ Error creating admin notification:', notifError);
        }
        
        await User.findByIdAndUpdate(req.user.id, {
            $push: { contracts: contract._id },
            lastActivity: Date.now()
        });

        console.log('✅ Contract saved with ID:', contract._id);

        res.status(201).json({
            message: "تم إنشاء العقد بنجاح",
            contract: {
                ...contract.toObject(),
                formattedPrice: contract.formattedPrice,
                formattedArea: contract.formattedArea
            }
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ message: error.message });
    }
});

router.get('/my-contracts', authenticateToken, async (req, res) => {
    try {
        const contracts = await Contract.find({ userId: req.user.id })
            .populate('zamamId')   
            .sort('-createdAt');
        
        await User.findByIdAndUpdate(req.user.id, {
            lastActivity: Date.now()
        });

    res.json({
            contracts: contracts.map(contract => ({
                ...contract.toObject(),
                formattedPrice: contract.formattedPrice,
                formattedArea: contract.formattedArea,
                imageUrl: contract.contractImage,
                zamamDetails: contract.zamamId ? {
                    zamamNumber: contract.zamamId.zamamNumber,
                    totalArea: contract.zamamId.totalArea,
                    zamamShare: contract.zamamShare,
                    percentageOfZamam: ((contract.zamamShare / contract.zamamId.totalArea) * 100).toFixed(2) + '%'
                } : null
            }))
        });
    } catch (error) {
        console.error('❌ Get contracts error:', error);
        res.status(500).json({ message: 'حدث خطأ في الخادم' });
    }
});
router.get('/check-zamam/:zamamNumber', authenticateToken, async (req, res) => {
    try {
        const zamam = await Zamam.findOne({ zamamNumber: req.params.zamamNumber });
        if (!zamam) return res.status(404).json({ message: 'رقم الزمام غير موجود' });

        const remainingPercentage = 100 - zamam.ownedArea; 
        const remainingArea = (remainingPercentage / 100) * zamam.totalArea;

        res.json({
            zamamNumber: zamam.zamamNumber,
            totalArea: zamam.totalArea,
            ownedArea: zamam.ownedArea,           
            remainingArea: remainingArea,         
            governorate: zamam.governorate,
            description: zamam.description
        });
    } catch (error) {
        res.status(500).json({ message: 'خطأ في الخادم' });
    }
});

router.get('/for-sale', authenticateToken, async (req, res) => {
    try {
        const contracts = await Contract.find({ 
            status: 'for_sale',
            userId: { $ne: req.user.id }  
        }).populate('userId', 'fullName phoneNumber');
        
        res.json({
            count: contracts.length,
            contracts: contracts.map(c => ({
                ...c.toObject(),
                formattedPrice: c.formattedPrice,
                formattedArea: c.formattedArea
            }))
        });
    } catch (error) {
        console.error('Error fetching for sale contracts:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/my-for-sale', authenticateToken, async (req, res) => {
    try {
        const contracts = await Contract.find({ 
            userId: req.user.id,
            status: { $in: ['approved', 'for_sale'] }
        }).sort('-createdAt');
        
        res.json({
            count: contracts.length,
            contracts: contracts.map(c => ({
                ...c.toObject(),
                formattedPrice: c.formattedPrice,
                formattedArea: c.formattedArea
            }))
        });
    } catch (error) {
        console.error('Error fetching my for sale contracts:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/check/:contractNumber', authenticateToken, async (req, res) => {
    try {
        const { contractNumber } = req.params;
        
        const contract = await Contract.findOne({ contractNumber })
            .populate('userId', 'fullName phoneNumber');
        
        if (!contract) {
            return res.status(404).json({ 
                exists: false,
                message: 'Contract not found' 
            });
        }
        
        res.json({
            exists: true,
            contract: {
                ...contract.toObject(),
                formattedPrice: contract.formattedPrice,
                formattedArea: contract.formattedArea
            }
        });
    } catch (error) {
        console.error('Error checking contract:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/:contractId/initiate-sale', authenticateToken, async (req, res) => {
    try {
        const { contractId } = req.params;
        const { buyerName, buyerPhone, amount } = req.body;
        
        const contract = await Contract.findOne({
            _id: contractId,
            userId: req.user.id,
            status: { $in: ['approved', 'for_sale'] }
        });
        
        if (!contract) {
            return res.status(404).json({ message: 'Contract not found or not available for sale' });
        }
        
        let buyer = await User.findOne({ phoneNumber: buyerPhone });
        
        if (!buyer) {
            const tempPassword = Math.random().toString(36).slice(-8);
            const hashedPassword = await bcrypt.hash(tempPassword, 10);
            
            buyer = new User({
                fullName: buyerName,
                phoneNumber: buyerPhone,
                nationalId: 'TEMP-' + Date.now(),
                password: hashedPassword,
                role: 'user',
                isTempUser: true
            });
            await buyer.save();
            
            console.log(`🔐 Temporary password for ${buyerPhone}: ${tempPassword}`);
        }
        
        const buyerContract = new Contract({
            userId: buyer._id,
            sellerId: req.user.id,
            fullName: buyerName,
            nationalId: buyer.nationalId || 'TEMP-' + Date.now(),
            phoneNumber: buyerPhone,
            propertyNumber: contract.propertyNumber,
            ownershipPercentage: contract.ownershipPercentage,
            address: contract.address,
            governorate: contract.governorate,
            propertyType: contract.propertyType,
            propertyCategory: contract.propertyCategory,
            floor: contract.floor,
            price: amount || contract.price,
            area: contract.area,
            status: 'sale_pending',
            contractImage: contract.contractImage,
            imageType: contract.imageType,
            imageName: contract.imageName,
            salePrice: amount || contract.price,
            buyerId: buyer._id
        });
        
        await buyerContract.save(); 
        
        const transaction = new Transaction({
            contractId: buyerContract._id,
            sellerId: req.user.id,
            buyerId: buyer._id,
            amount: amount || contract.price,
            fees: 300,
            totalAmount: (amount || contract.price) + 300,
            status: 'pending',
            paymentMethod: 'bank_transfer'
        });
        await transaction.save();
        
        const notification = new Notification({
            userId: buyer._id,
            type: 'general',
            title: 'طلب شراء عقار',
            message: `قام البائع ${contract.fullName} بإرسال طلب شراء عقار ${contract.propertyType} إليك. يرجى إتمام الدفع`,
            contractId: buyerContract._id,
            data: { 
                transactionId: transaction._id,
                amount: transaction.totalAmount,
                paymentLink: `/paymentPage?transactionId=${transaction._id}`,
                sellerName: contract.fullName
            }
        });
        await notification.save();
        
        contract.pendingSale = true;
        contract.pendingBuyerId = buyer._id;
        contract.pendingTransactionId = transaction._id;
        await contract.save();
        
        res.json({
            message: 'Sale initiated successfully',
            transaction,
            buyerContract,
            isNewUser: !buyer.isTempUser ? false : true
        });
        
    } catch (error) {
        console.error('Error initiating sale:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.put('/:contractId/for-sale', authenticateToken, async (req, res) => {
    try {
        const { contractId } = req.params;
        const { salePrice } = req.body;
        
        console.log('📤 Updating contract to for-sale:', contractId);
        
        const contract = await Contract.findOne({
            _id: contractId,
            userId: req.user.id
        });
        
        if (!contract) {
            console.log('❌ Contract not found for user');
            return res.status(404).json({ message: 'Contract not found or not owned by you' });
        }
        
        if (contract.status !== 'approved' && contract.status !== 'completed') {
            console.log('❌ Invalid contract status:', contract.status);
            return res.status(400).json({ 
                message: 'Contract must be approved or completed first',
                currentStatus: contract.status 
            });
        }
        
        contract.status = 'for_sale';
        contract.salePrice = salePrice || contract.price;
        await contract.save();
        
        console.log('✅ Contract updated to for_sale:', contract.contractNumber);
        
        const admin = await User.findOne({ role: 'admin' });
        if (admin) {
            const notification = new Notification({
                userId: admin._id,
                type: 'general',
                title: 'عرض جديد للبيع',
                message: `تم عرض عقار ${contract.propertyType} للبيع بسعر ${(salePrice || contract.price).toLocaleString()} جنيه`,
                contractId: contract._id,
                data: { sellerName: contract.fullName }
            });
            await notification.save();
        }
        
        res.json({
            message: 'Contract updated to for sale successfully',
            contract: {
                ...contract.toObject(),
                formattedPrice: contract.formattedPrice,
                formattedArea: contract.formattedArea
            }
        });
    } catch (error) {
        console.error('Error updating contract to for sale:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.put('/:contractNumber/update-for-sale', authenticateToken, async (req, res) => {
    try {
        const { contractNumber } = req.params;
        const { salePrice } = req.body;
        
        const contract = await Contract.findOne({ 
            contractNumber,
            userId: req.user.id
        });
        
        if (!contract) {
            return res.status(404).json({ message: 'Contract not found or not owned by you' });
        }
        
        if (contract.status !== 'approved') {
            return res.status(400).json({ message: 'Contract must be approved first' });
        }
        
        contract.status = 'for_sale';
        contract.salePrice = salePrice || contract.price;
        await contract.save();
        
        const admin = await User.findOne({ role: 'admin' });
        if (admin) {
            const notification = new Notification({
                userId: admin._id,
                type: 'general',
                title: 'عرض جديد للبيع',
                message: `تم عرض عقار ${contract.propertyType} للبيع بسعر ${(salePrice || contract.price).toLocaleString()} جنيه`,
                contractId: contract._id,
                data: { sellerName: contract.fullName }
            });
            await notification.save();
        }
        
        res.json({
            message: 'Contract updated to for sale successfully',
            contract: {
                ...contract.toObject(),
                formattedPrice: contract.formattedPrice,
                formattedArea: contract.formattedArea
            }
        });
    } catch (error) {
        console.error('Error updating contract to for sale:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.put('/:contractId/cancel-payment', authenticateToken, async (req, res) => {
    try {
        const { contractId } = req.params;
        
        const contract = await Contract.findOne({
            _id: contractId,
            userId: req.user.id,
            status: 'sale_pending'
        });
        
        if (!contract) {
            return res.status(404).json({ message: 'Contract not found or not in pending payment' });
        }
        
        await Contract.findByIdAndDelete(contractId);
        
        const seller = await User.findById(contract.sellerId);
        if (seller) {
            const notification = new Notification({
                userId: seller._id,
                type: 'alert',
                title: 'تم إلغاء عملية الدفع',
                message: `قام المشتري بإلغاء عملية دفع العقار ${contract.propertyType}`,
                contractId: contractId
            });
            await notification.save();
        }
        
        res.json({ message: 'Payment cancelled successfully' });
        
    } catch (error) {
        console.error('Error cancelling payment:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
