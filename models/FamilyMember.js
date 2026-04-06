const mongoose = require('mongoose');

const familyMemberSchema = new mongoose.Schema({
    fullName: { type: String, required: true },
    nationalId: { type: String, required: true },
    gender: { type: String, enum: ['male', 'female'], required: true },
    religion: { type: String, required: true },
    nationality: { type: String, required: true },   
    region: { type: String, required: true },

    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    memberUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    relationType: { type: String, enum: ['father', 'mother', 'wife', 'husband', 'son', 'daughter', 'brother', 'sister', 'uncle'], required: true },
    isAlive: { type: Boolean, default: true },
    phoneNumber: { type: String },
}, { timestamps: true });

familyMemberSchema.index({ userId: 1, nationalId: 1 }, { unique: true });
familyMemberSchema.index({ userId: 1 });

module.exports = mongoose.model('FamilyMember', familyMemberSchema);