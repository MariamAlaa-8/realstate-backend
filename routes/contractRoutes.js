const express = require('express');
const router = express.Router();
const Contract = require('../models/Contract');
const User = require('../models/users');
const { authenticateToken } = require('../middleware/auth');
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
            fullName,
            nationalId,
            phoneNumber,
            propertyNumber,
            ownershipPercentage,
            address,
            governorate,
            propertyType,
            propertyCategory,
            floor,
            price,
            area,
            notes
        } = req.body;

        if (!fullName || !nationalId || !phoneNumber || !propertyNumber || 
            !ownershipPercentage || !address || !governorate || !propertyType || 
            !propertyCategory || !price || !area) {
            console.log('❌ Missing fields');
            return res.status(400).json({ 
                message: "جميع الحقول المطلوبة يجب ملؤها" 
            });
        }

        const contractData = {
            userId: req.user.id,
            fullName,
            nationalId,
            phoneNumber,
            propertyNumber,
            ownershipPercentage,
            address,
            governorate,
            propertyType,
            propertyCategory,
            floor: floor || undefined,
            price,
            area,
            notes: notes || '',
            status: 'pending'
        };

        if (req.file) {
            contractData.imagePath = req.file.path.replace(/\\/g, '/');
            contractData.imageUrl = `http://localhost:5000/${req.file.path.replace(/\\/g, '/')}`;
            contractData.imageName = req.file.originalname;

            
            console.log('✅ Image saved:', contractData.imagePath);
        }

        const contract = new Contract(contractData);
        await contract.save();

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

module.exports = router;