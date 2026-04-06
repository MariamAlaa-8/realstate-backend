const mongoose = require('mongoose');

const willSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    religion: {
        type: String,
        enum: ['muslim', 'non-muslim'],
        required: true
    },
    status: {
        type: String,
        enum: ['active', 'executed', 'cancelled'],
        default: 'active'
    },
    distributionMethod: {
        type: String,
        enum: ['automatic', 'manual'],
        required: true
    },
    selectedProperties: [{
        contractId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Contract',
            required: true
        },
        propertyNumber: String,
        propertyType: String,
        ownershipPercentage: Number,
        includeInWill: {
            type: Boolean,
            default: true
        }
    }],
    heirs: [{
        familyMemberId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FamilyMember'
        },
        fullName: String,
        nationalId: String,
        relationType: {
            type: String,
            enum: ['father', 'mother', 'wife', 'husband', 'son', 'daughter', 'brother', 'sister', 'uncle', 'other']
        },
        share: Number,
        shareType: {
            type: String,
            enum: ['percentage', 'fixed'],
            default: 'percentage'
        }
    }],
    notes: {
        type: String,
        default: ''
    },
    executedAt: {
        type: Date,
        default: null
    }
}, { 
    timestamps: true,
    collection: 'wills'
});

willSchema.index({ userId: 1, status: 1 });
willSchema.index({ 'selectedProperties.contractId': 1 });

module.exports = mongoose.model('Will', willSchema);