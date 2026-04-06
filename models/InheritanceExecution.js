const mongoose = require('mongoose');

const inheritanceExecutionSchema = new mongoose.Schema({
    deceasedId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true 
    },
    willId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Will'
    },
    executionDate: {
        type: Date,
        default: Date.now
    },
    heirs: [{
        familyMemberId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'FamilyMember'
        },
        nationalId: String,
        fullName: String,
        relationType: String,
        share: Number,
        transferredProperties: [{
            contractId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Contract'
            },
            propertyNumber: String,
            percentage: Number
        }]
    }],
    status: {
        type: String,
        enum: ['pending', 'completed', 'disputed','processing'],
        default: 'completed'
    }
}, { timestamps: true });
module.exports = mongoose.model('InheritanceExecution', inheritanceExecutionSchema);