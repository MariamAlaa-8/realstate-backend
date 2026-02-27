const express = require('express');
const router = express.Router();
const Transaction = require('../models/Transaction');
const Contract = require('../models/Contract');
const User = require('../models/users');
const Notification = require('../models/Notification');
const { authenticateToken } = require('../middleware/auth');

router.get('/my-transactions', authenticateToken, async (req, res) => {
    try {
        const transactions = await Transaction.find({
            $or: [
                { sellerId: req.user.id },
                { buyerId: req.user.id }
            ]
        })
        .populate('contractId')
        .populate('sellerId', 'fullName phoneNumber')
        .populate('buyerId', 'fullName phoneNumber')
        .sort('-createdAt');
        
        res.json({ transactions });
    } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.post('/:transactionId/pay', authenticateToken, async (req, res) => {
    try {
        const { transactionId } = req.params;
        const { paymentMethod, paymentDetails } = req.body;
        
        const transaction = await Transaction.findById(transactionId)
            .populate('contractId')
            .populate('sellerId')
            .populate('buyerId');
        
        if (!transaction) {
            return res.status(404).json({ message: 'Transaction not found' });
        }
        
        if (transaction.buyerId._id.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Unauthorized' });
        }
        
        transaction.status = 'paid';
        transaction.paymentMethod = paymentMethod;
        transaction.paymentDetails = paymentDetails;
        transaction.paidAt = Date.now();
        await transaction.save();
        
        const contract = await Contract.findById(transaction.contractId._id);
        if (contract) {
            contract.paymentStatus = 'paid';
            await contract.save();
        }
        
        // إشعار للبائع
        const notification = new Notification({
            userId: transaction.sellerId._id,
            type: 'general',
            title: 'تم الدفع',
            message: `قام المشتري ${transaction.buyerId.fullName} بدفع مبلغ ${transaction.totalAmount.toLocaleString()} جنيه`,
            contractId: transaction.contractId._id,
            data: { transactionId: transaction._id }
        });
        await notification.save();
        
        res.json({
            message: 'Payment completed successfully',
            transaction
        });
        
    } catch (error) {
        console.error('Error processing payment:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.put('/:transactionId/confirm', authenticateToken, async (req, res) => {
    try {
        const { transactionId } = req.params;
        
        const transaction = await Transaction.findById(transactionId)
            .populate('contractId')
            .populate('sellerId')
            .populate('buyerId');
        
        if (!transaction) {
            return res.status(404).json({ message: 'Transaction not found' });
        }
        
        if (transaction.sellerId._id.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Unauthorized' });
        }
        
        if (transaction.status !== 'paid') {
            return res.status(400).json({ message: 'Payment not completed yet' });
        }
        
        transaction.status = 'completed';
        transaction.completedAt = Date.now();
        await transaction.save();
        
        const buyerContract = await Contract.findById(transaction.contractId._id);
        if (buyerContract) {
            buyerContract.status = 'completed';
            buyerContract.paymentStatus = 'confirmed';
            buyerContract.sellerId = transaction.sellerId._id;
            await buyerContract.save();
            console.log('✅ Buyer contract updated:', buyerContract.contractNumber);
        }
        
        const sellerContract = await Contract.findOne({
            propertyNumber: buyerContract.propertyNumber,
            userId: transaction.sellerId._id,
            status: { $in: ['approved', 'for_sale', 'sold'] }
        });
        
        if (sellerContract) {
            sellerContract.status = 'sold';
            sellerContract.soldAt = Date.now();
            sellerContract.buyerId = transaction.buyerId._id;
            sellerContract.pendingSale = false;
            sellerContract.pendingBuyerId = null;
            sellerContract.pendingTransactionId = null;
            await sellerContract.save();
            console.log('✅ Seller contract updated to sold:', sellerContract.contractNumber);
        } else {
            console.log('⚠️ Seller contract not found, trying with pendingTransactionId');
            
            const sellerContractByTransaction = await Contract.findOne({
                pendingTransactionId: transactionId,
                userId: transaction.sellerId._id
            });
            
            if (sellerContractByTransaction) {
                sellerContractByTransaction.status = 'sold';
                sellerContractByTransaction.soldAt = Date.now();
                sellerContractByTransaction.buyerId = transaction.buyerId._id;
                sellerContractByTransaction.pendingSale = false;
                sellerContractByTransaction.pendingBuyerId = null;
                sellerContractByTransaction.pendingTransactionId = null;
                await sellerContractByTransaction.save();
                console.log('✅ Seller contract found by transactionId:', sellerContractByTransaction.contractNumber);
            }
        }
        
        // إشعار للمشتري
        const notification = new Notification({
            userId: transaction.buyerId._id,
            type: 'contract_approved',
            title: 'تم اكتمال عملية الشراء',
            message: `تم تأكيد استلام الفلوس وأصبح العقار ملكك الآن`,
            contractId: buyerContract._id,
            data: { transactionId: transaction._id }
        });
        await notification.save();
        
        res.json({
            message: 'Transaction completed successfully',
            transaction
        });
        
    } catch (error) {
        console.error('Error confirming transaction:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.put('/:transactionId/reject', authenticateToken, async (req, res) => {
    try {
        const { transactionId } = req.params;
        const { reason } = req.body;
        
        const transaction = await Transaction.findById(transactionId)
            .populate('contractId')
            .populate('sellerId')
            .populate('buyerId');
        
        if (!transaction) {
            return res.status(404).json({ message: 'Transaction not found' });
        }
        
        if (transaction.sellerId._id.toString() !== req.user.id) {
            return res.status(403).json({ message: 'Unauthorized' });
        }
        
        transaction.status = 'cancelled';
        transaction.notes = reason;
        await transaction.save();
        
        await Contract.findByIdAndDelete(transaction.contractId._id);
        
        // إشعار للمشتري
        const notification = new Notification({
            userId: transaction.buyerId._id,
            type: 'contract_rejected',
            title: 'تم رفض الدفع',
            message: `تم رفض عملية الدفع. ${reason ? 'السبب: ' + reason : ''}`,
            contractId: transaction.contractId._id
        });
        await notification.save();
        
        res.json({
            message: 'Payment rejected successfully',
            transaction
        });
        
    } catch (error) {
        console.error('Error rejecting payment:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get('/:transactionId', authenticateToken, async (req, res) => {
    try {
        const { transactionId } = req.params;
        
        const transaction = await Transaction.findById(transactionId)
            .populate('contractId')
            .populate('sellerId', 'fullName phoneNumber')
            .populate('buyerId', 'fullName phoneNumber');
        
        if (!transaction) {
            return res.status(404).json({ message: 'Transaction not found' });
        }
        
        res.json({ transaction });
    } catch (error) {
        console.error('Error fetching transaction:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;