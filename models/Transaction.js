const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    contractId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Contract',
        required: true
    },
    sellerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    buyerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    fees: {
        type: Number,
        default: 300
    },
    totalAmount: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'paid', 'completed', 'cancelled'],
        default: 'pending'
    },
    paymentMethod: {
        type: String,
        enum: ['bank_transfer', 'cash'],
        required: true
    },
    paymentDetails: {
        cardHolderName: String,
        cardNumber: String,
        bankName: String,
        accountNumber: String,
        securityCode: String,
        expiryDate: String
    },
    paidAt: Date,
    completedAt: Date,
    notes: String
}, { timestamps: true });

module.exports = mongoose.model('Transaction', transactionSchema);