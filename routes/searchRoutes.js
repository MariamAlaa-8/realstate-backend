const express = require('express');
const router = express.Router();
const Contract = require('../models/Contract');
const User = require('../models/users');
const { authenticateToken } = require('../middleware/auth');

router.get('/search', async (req, res) => {
    try {
        const { q } = req.query; // q = search query
        
        if (!q) {
            return res.status(400).json({ 
                message: 'يرجى إدخال رقم الكارت أو رقم العقار' 
            });
        }

        const contracts = await Contract.find({
            $or: [
                { contractNumber: { $regex: q, $options: 'i' } },
                { propertyNumber: { $regex: q, $options: 'i' } }
            ]
        }).populate('userId', 'fullName phoneNumber');

        if (contracts.length === 0) {
            return res.status(404).json({ 
                message: 'لا توجد نتائج للبحث',
                results: []
            });
        }

        const results = contracts.map(contract => ({
            cardNumber: contract.contractNumber,
            propertyNumber: contract.propertyNumber,
            ownerName: contract.fullName,
            ownerNationalId: contract.nationalId,
            ownerPhone: contract.phoneNumber,
            propertyAddress: contract.address,
            propertyGovernorate: contract.governorate,
            propertyType: contract.propertyType,
            propertyPrice: contract.formattedPrice,
            propertyArea: contract.formattedArea,
            ownershipPercentage: contract.ownershipPercentage,
            floor: contract.floor,
            status: contract.status,
            contractDate: contract.contractDate,
            lastUpdated: contract.updatedAt
        }));

        res.json({
            message: 'تم البحث بنجاح',
            count: results.length,
            results: results
        });

    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ message: 'حدث خطأ في الخادم' });
    }
});

router.get('/owner', async (req, res) => {
    try {
        const { name, nationalId } = req.query;
        
        let query = {};
        
        if (name) {
            query.fullName = { $regex: name, $options: 'i' };
        }
        
        if (nationalId) {
            query.nationalId = nationalId;
        }

        const contracts = await Contract.find(query)
            .populate('userId', 'fullName phoneNumber')
            .sort('-createdAt');

        res.json({
            message: 'تم البحث بنجاح',
            count: contracts.length,
            results: contracts.map(contract => ({
                cardNumber: contract.contractNumber,
                propertyNumber: contract.propertyNumber,
                ownerName: contract.fullName,
                ownerNationalId: contract.nationalId,
                propertyAddress: contract.address,
                propertyPrice: contract.formattedPrice,
                propertyType: contract.propertyType,
                contractDate: contract.contractDate,
                status: contract.status
            }))
        });

    } catch (error) {
        console.error('Owner search error:', error);
        res.status(500).json({ message: 'حدث خطأ في الخادم' });
    }
});

router.get('/card/:cardNumber', async (req, res) => {
    try {
        const { cardNumber } = req.params;
        
        const contract = await Contract.findOne({ 
            contractNumber: cardNumber 
        }).populate('userId', 'fullName phoneNumber');

        if (!contract) {
            return res.status(404).json({ 
                message: 'لا يوجد كارت بهذا الرقم' 
            });
        }

        res.json({
            message: 'تم العثور على الكارت',
            cardDetails: {
                cardNumber: contract.contractNumber,
                propertyNumber: contract.propertyNumber,
                ownerName: contract.fullName,
                ownerNationalId: contract.nationalId,
                ownerPhone: contract.phoneNumber,
                propertyAddress: contract.address,
                propertyGovernorate: contract.governorate,
                propertyType: contract.propertyType,
                propertyPrice: contract.formattedPrice,
                propertyArea: contract.formattedArea,
                ownershipPercentage: contract.ownershipPercentage,
                floor: contract.floor,
                status: contract.status,
                issueDate: contract.contractDate,
                lastUpdate: contract.updatedAt
            }
        });

    } catch (error) {
        console.error('Get card details error:', error);
        res.status(500).json({ message: 'حدث خطأ في الخادم' });
    }
});

router.get('/by-governorate/:governorate', async (req, res) => {
    try {
        const { governorate } = req.params;
        
        const contracts = await Contract.find({ 
            governorate: governorate,
            status: { $in: ['approved', 'completed'] } //
        }).populate('userId', 'fullName')
        .select('contractNumber propertyNumber fullName address propertyType price area');

        res.json({
            governorate: governorate,
            count: contracts.length,
            properties: contracts.map(contract => ({
                cardNumber: contract.contractNumber,
                propertyNumber: contract.propertyNumber,
                ownerName: contract.fullName,
                address: contract.address,
                type: contract.propertyType,
                price: contract.formattedPrice,
                area: contract.formattedArea
            }))
        });

    } catch (error) {
        console.error('Governorate search error:', error);
        res.status(500).json({ message: 'حدث خطأ في الخادم' });
    }
});

router.get('/recent', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        
        const recentContracts = await Contract.find()
            .sort('-createdAt')
            .limit(limit)
            .populate('userId', 'fullName')
            .select('contractNumber propertyNumber fullName propertyType price createdAt');

        res.json({
            recent: recentContracts.map(contract => ({
                cardNumber: contract.contractNumber,
                propertyNumber: contract.propertyNumber,
                ownerName: contract.fullName,
                propertyType: contract.propertyType,
                price: contract.formattedPrice,
                date: contract.createdAt
            }))
        });

    } catch (error) {
        console.error('Recent contracts error:', error);
        res.status(500).json({ message: 'حدث خطأ في الخادم' });
    }
});

router.post('/advanced-search', async (req, res) => {
    try {
        const {
            governorate,
            propertyType,
            minPrice,
            maxPrice,
            minArea,
            maxArea,
            status
        } = req.body;

        let query = {};

        if (governorate) query.governorate = governorate;
        if (propertyType) query.propertyType = propertyType;
        if (status) query.status = status;
        
        if (minPrice || maxPrice) {
            query.price = {};
            if (minPrice) query.price.$gte = minPrice;
            if (maxPrice) query.price.$lte = maxPrice;
        }
        
        if (minArea || maxArea) {
            query.area = {};
            if (minArea) query.area.$gte = minArea;
            if (maxArea) query.area.$lte = maxArea;
        }

        const contracts = await Contract.find(query)
            .populate('userId', 'fullName phoneNumber')
            .sort('-price');

        res.json({
            message: 'تم البحث المتقدم بنجاح',
            filters: req.body,
            count: contracts.length,
            results: contracts.map(contract => ({
                cardNumber: contract.contractNumber,
                propertyNumber: contract.propertyNumber,
                ownerName: contract.fullName,
                governorate: contract.governorate,
                propertyType: contract.propertyType,
                price: contract.formattedPrice,
                area: contract.formattedArea,
                status: contract.status
            }))
        });

    } catch (error) {
        console.error('Advanced search error:', error);
        res.status(500).json({ message: 'حدث خطأ في الخادم' });
    }
});

router.get('/statistics', async (req, res) => {
    try {
        const totalContracts = await Contract.countDocuments();
        const totalApproved = await Contract.countDocuments({ status: 'approved' });
        const totalPending = await Contract.countDocuments({ status: 'pending' });
        const totalCompleted = await Contract.countDocuments({ status: 'completed' });
        
        const governorateStats = await Contract.aggregate([
            { $group: { _id: "$governorate", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 }
        ]);

        const propertyTypeStats = await Contract.aggregate([
            { $group: { _id: "$propertyType", count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        res.json({
            statistics: {
                total: totalContracts,
                approved: totalApproved,
                pending: totalPending,
                completed: totalCompleted
            },
            topGovernorates: governorateStats,
            propertyTypes: propertyTypeStats
        });

    } catch (error) {
        console.error('Statistics error:', error);
        res.status(500).json({ message: 'حدث خطأ في الخادم' });
    }
});

module.exports = router;