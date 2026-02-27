const express = require('express');
const router = express.Router();
const User = require('../models/users');
const Contract = require('../models/Contract');
const Notification = require('../models/Notification');
const { authenticateToken } = require('../middleware/auth');

const authenticateAdmin = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ message: 'Admin access required' });
        }
        next();
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
};


router.get('/dashboard' ,authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const pendingContracts = await Contract.countDocuments({ status: 'pending' });
        const approvedContracts = await Contract.countDocuments({ status: 'approved' });
        const rejectedContracts = await Contract.countDocuments({ status: 'rejected' });
        const completedContracts = await Contract.countDocuments({ status: 'completed' });
        
        const totalUsers = await User.countDocuments({ role: 'user' });
        const activeUsers = await User.countDocuments({ 
            role: 'user', 
            lastActivity: { $gte: thirtyDaysAgo } 
        });
        const inactiveUsers = totalUsers - activeUsers;
        
        const users = await User.find({ role: 'user' })
            .select('fullName phoneNumber nationalId lastActivity createdAt contracts isActive')
            .lean();
        
        const usersWithContracts = await Promise.all(users.map(async (user) => {
            const contracts = await Contract.find({ userId: user._id })
                .select('contractNumber propertyType price status createdAt')
                .sort('-createdAt');
            
            return {
                ...user,
                contracts,
                contractCount: contracts.length,
                inactive: user.lastActivity < thirtyDaysAgo
            };
        }));
        
        const recentContracts = await Contract.find()
            .populate('userId', 'fullName phoneNumber')
            .sort('-createdAt')
            .limit(10);
        
        const pendingContractsList = await Contract.find({ status: 'pending' })
            .populate('userId', 'fullName phoneNumber')
            .sort('-createdAt')
            .limit(20);
        
        res.json({
            statistics: {
                totalUsers,
                activeUsers,
                inactiveUsers,
                totalContracts: pendingContracts + approvedContracts + rejectedContracts + completedContracts,
                pendingContracts,
                approvedContracts,
                rejectedContracts,
                completedContracts,
                activePercentage: totalUsers > 0 ? ((activeUsers / totalUsers) * 100).toFixed(1) : 0,
                inactivePercentage: totalUsers > 0 ? ((inactiveUsers / totalUsers) * 100).toFixed(1) : 0
            },
            users: usersWithContracts,
            recentContracts,
            pendingContracts: pendingContractsList
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});


router.get('/contracts/pending', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const contracts = await Contract.find({ status: 'pending' })
            .populate('userId', 'fullName phoneNumber nationalId')
            .sort('-createdAt');
        
        res.json({
            count: contracts.length,
            contracts
        });
    } catch (error) {
        console.error('Error fetching pending contracts:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/contracts', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { status, userId, fromDate, toDate } = req.query;
        let query = {};
        
        if (status) query.status = status;
        if (userId) query.userId = userId;
        
        if (fromDate || toDate) {
            query.createdAt = {};
            if (fromDate) query.createdAt.$gte = new Date(fromDate);
            if (toDate) query.createdAt.$lte = new Date(toDate);
        }
        
        const contracts = await Contract.find(query)
            .populate('userId', 'fullName phoneNumber nationalId')
            .sort('-createdAt');
        
        res.json({
            count: contracts.length,
            contracts
        });
    } catch (error) {
        console.error('Error fetching contracts:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.put('/contracts/:contractId/accept', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { contractId } = req.params;
        const { notes } = req.body;
        
        const contract = await Contract.findById(contractId).populate('userId');
        
        if (!contract) {
            return res.status(404).json({ message: 'Contract not found' });
        }
        
        if (contract.status !== 'pending') {
            return res.status(400).json({ message: 'Contract is not in pending state' });
        }
        
        contract.status = 'approved';
        contract.adminNotes = notes || 'تم الموافقة على العقد';
        contract.approvedAt = Date.now();
        contract.approvedBy = req.user.id;
        await contract.save();
        
        const notification = new Notification({
            userId: contract.userId._id,
            type: 'contract_approved',
            title: 'تم الموافقة على العقد',
            message: `تمت الموافقة على العقد رقم ${contract.contractNumber} بنجاح`,
            contractId: contract._id,
            isRead: false
        });
        await notification.save();
        
        await User.findByIdAndUpdate(contract.userId._id, {
            lastActivity: Date.now()
        });
        
        res.json({
            message: 'Contract approved successfully',
            contract,
            notification: {
                sent: true,
                to: contract.userId.phoneNumber
            }
        });
        
    } catch (error) {
        console.error('Error accepting contract:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.put('/contracts/:contractId/reject', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { contractId } = req.params;
        const { reason } = req.body;
        
        if (!reason) {
            return res.status(400).json({ message: 'Rejection reason is required' });
        }
        
        const contract = await Contract.findById(contractId).populate('userId');
        
        if (!contract) {
            return res.status(404).json({ message: 'Contract not found' });
        }
        
        if (contract.status !== 'pending') {
            return res.status(400).json({ message: 'Contract is not in pending state' });
        }
        
        contract.status = 'rejected';
        contract.adminNotes = reason;
        contract.rejectedAt = Date.now();
        contract.rejectedBy = req.user.id;
        await contract.save();
        
        const notification = new Notification({
            userId: contract.userId._id,
            type: 'contract_rejected',
            title: 'تم رفض العقد',
            message: `تم رفض العقد رقم ${contract.contractNumber} - سبب الرفض: ${reason}`,
            contractId: contract._id,
            isRead: false
        });
        await notification.save();
        
        await User.findByIdAndUpdate(contract.userId._id, {
            lastActivity: Date.now()
        });
        
        res.json({
            message: 'Contract rejected successfully',
            contract,
            notification: {
                sent: true,
                to: contract.userId.phoneNumber
            }
        });
        
    } catch (error) {
        console.error('Error rejecting contract:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/contracts/:contractId', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { contractId } = req.params;
        
        const contract = await Contract.findById(contractId)
            .populate('userId', 'fullName phoneNumber nationalId email createdAt lastActivity');
        
        if (!contract) {
            return res.status(404).json({ message: 'Contract not found' });
        }
        
        const userContracts = await Contract.find({ 
            userId: contract.userId._id,
            _id: { $ne: contractId }
        }).select('contractNumber propertyType status createdAt').limit(5);
        
        res.json({
            contract,
            userContracts
        });
        
    } catch (error) {
        console.error('Error fetching contract:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/notifications', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { userId, isRead, limit = 50 } = req.query;
        let query = {};
        
        if (userId) query.userId = userId;
        if (isRead !== undefined) query.isRead = isRead === 'true';
        
        const notifications = await Notification.find(query)
            .populate('userId', 'fullName phoneNumber')
            .sort('-createdAt')
            .limit(parseInt(limit));
        
        const unreadCount = await Notification.countDocuments({ isRead: false });
        
        res.json({
            count: notifications.length,
            unreadCount,
            notifications
        });
        
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/notifications/send', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { userId, title, message, type = 'general' } = req.body;
        
        if (!userId || !title || !message) {
            return res.status(400).json({ message: 'User ID, title and message are required' });
        }
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        const notification = new Notification({
            userId,
            type,
            title,
            message,
            isRead: false
        });
        
        await notification.save();
        
        res.json({
            message: 'Notification sent successfully',
            notification
        });
        
    } catch (error) {
        console.error('Error sending notification:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.put('/notifications/:notificationId/read', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { notificationId } = req.params;
        
        const notification = await Notification.findByIdAndUpdate(
            notificationId,
            { isRead: true },
            { new: true }
        );
        
        if (!notification) {
            return res.status(404).json({ message: 'Notification not found' });
        }
        
        res.json({
            message: 'Notification marked as read',
            notification
        });
        
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.put('/notifications/read-all/:userId', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        
        await Notification.updateMany(
            { userId, isRead: false },
            { isRead: true }
        );
        
        res.json({
            message: 'All notifications marked as read'
        });
        
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.delete('/notifications/:notificationId', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { notificationId } = req.params;
        
        const notification = await Notification.findByIdAndDelete(notificationId);
        
        if (!notification) {
            return res.status(404).json({ message: 'Notification not found' });
        }
        
        res.json({
            message: 'Notification deleted successfully'
        });
        
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({ message: 'Server error' });
    }
});


router.get('/users', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { search, status } = req.query;
        let query = { role: 'user' };
        
        if (search) {
            query.$or = [
                { fullName: { $regex: search, $options: 'i' } },
                { phoneNumber: { $regex: search, $options: 'i' } },
                { nationalId: { $regex: search, $options: 'i' } }
            ];
        }
        
        const users = await User.find(query)
            .select('-password -loginOtp -forgotPasswordOtp -verificationCode')
            .sort('-createdAt');
        
        const usersWithStats = await Promise.all(users.map(async (user) => {
            const contracts = await Contract.find({ userId: user._id })
                .select('status createdAt');
            
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            
            return {
                ...user.toObject(),
                contractCount: contracts.length,
                pendingCount: contracts.filter(c => c.status === 'pending').length,
                approvedCount: contracts.filter(c => c.status === 'approved').length,
                rejectedCount: contracts.filter(c => c.status === 'rejected').length,
                completedCount: contracts.filter(c => c.status === 'completed').length,
                isInactive: user.lastActivity < thirtyDaysAgo,
                daysSinceLastActivity: Math.floor((Date.now() - user.lastActivity) / (1000 * 60 * 60 * 24))
            };
        }));
        
        res.json({
            count: usersWithStats.length,
            users: usersWithStats
        });
        
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/users/:userId', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await User.findById(userId)
            .select('-password -loginOtp -forgotPasswordOtp -verificationCode');
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        const contracts = await Contract.find({ userId: user._id })
            .sort('-createdAt');
        
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const notifications = await Notification.find({ userId: user._id })
            .sort('-createdAt')
            .limit(20);
        
        res.json({
            user: {
                ...user.toObject(),
                isInactive: user.lastActivity < thirtyDaysAgo,
                daysSinceLastActivity: Math.floor((Date.now() - user.lastActivity) / (1000 * 60 * 60 * 24))
            },
            contracts,
            contractCount: contracts.length,
            notifications,
            unreadNotifications: notifications.filter(n => !n.isRead).length
        });
        
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.delete('/delete-inactive-users', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const inactiveUsers = await User.find({
            role: 'user',
            lastActivity: { $lt: thirtyDaysAgo },
            isActive: true
        });
        
        if (inactiveUsers.length === 0) {
            return res.json({ 
                message: 'No inactive users found',
                deletedCount: 0 
            });
        }
        
        for (const user of inactiveUsers) {
            await Notification.deleteMany({ userId: user._id });
        }
        
        for (const user of inactiveUsers) {
            await Contract.deleteMany({ userId: user._id });
        }
        
        const result = await User.deleteMany({
            _id: { $in: inactiveUsers.map(u => u._id) }
        });
        
        res.json({
            message: `Successfully deleted ${result.deletedCount} inactive users and their contracts`,
            deletedCount: result.deletedCount,
            deletedUsers: inactiveUsers.map(u => ({
                id: u._id,
                fullName: u.fullName,
                lastActivity: u.lastActivity
            }))
        });
    } catch (error) {
        console.error('Delete inactive users error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.delete('/user/:userId', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        if (user.role === 'admin') {
            return res.status(403).json({ message: 'Cannot delete admin users' });
        }
        
        await Notification.deleteMany({ userId: user._id });
        
        await Contract.deleteMany({ userId: user._id });
        
        await User.findByIdAndDelete(user._id);
        
        res.json({ 
            message: 'User and all associated data deleted successfully',
            deletedUser: {
                id: user._id,
                fullName: user.fullName,
                phoneNumber: user.phoneNumber
            }
        });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/user-activity/:userId', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.userId)
            .select('fullName phoneNumber nationalId lastActivity createdAt contracts isActive');
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        const contracts = await Contract.find({ userId: user._id })
            .sort('-createdAt');
        
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        res.json({
            user: {
                ...user.toObject(),
                isInactive: user.lastActivity < thirtyDaysAgo,
                daysSinceLastActivity: Math.floor((Date.now() - user.lastActivity) / (1000 * 60 * 60 * 24))
            },
            contracts,
            contractCount: contracts.length
        });
    } catch (error) {
        console.error('User activity error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});


router.get('/print-contract/:contractId', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const contract = await Contract.findById(req.params.contractId)
            .populate('userId', 'fullName phoneNumber nationalId');
        
        if (!contract) {
            return res.status(404).json({ message: 'Contract not found' });
        }
        
        res.json({
            contract: {
                ...contract.toObject(),
                printDate: new Date().toLocaleDateString('ar-EG'),
                printTime: new Date().toLocaleTimeString('ar-EG')
            }
        });
    } catch (error) {
        console.error('Print contract error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/print-contracts', authenticateToken, authenticateAdmin, async (req, res) => {
    try {
        const { contractIds } = req.body;
        
        if (!contractIds || !contractIds.length) {
            return res.status(400).json({ message: 'No contracts selected' });
        }
        
        const contracts = await Contract.find({
            _id: { $in: contractIds }
        }).populate('userId', 'fullName phoneNumber nationalId');
        
        res.json({
            contracts: contracts.map(contract => ({
                ...contract.toObject(),
                printDate: new Date().toLocaleDateString('ar-EG'),
                printTime: new Date().toLocaleTimeString('ar-EG')
            })),
            printCount: contracts.length
        });
    } catch (error) {
        console.error('Bulk print error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/update-activity/:userId', async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (user) {
            user.lastActivity = Date.now();
            await user.save();
            res.json({ success: true });
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch (error) {
        console.error('Update activity error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;