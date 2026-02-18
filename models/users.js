const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    fullName: { type: String, required: true },
    password: { type: String, required: true },
    phoneNumber: { type: String, required: true, unique: true },
    nationalId: { type: String, required: true, unique: true },
    isPhoneVerified: { type: Boolean, default: false },
    isNationalIdVerified: { type: Boolean, default: false },
    verificationCode: { type: String },
    forgotPasswordOtp: {
        type: String,
        default: null
    },
    forgotPasswordOtpExpires: {
        type: Date,
        default: null
    },
    loginOtp: {
        type: String,
        default: null
    },
    otpExpires: {
        type: Date,
        default: null
    },
    role: { 
        type: String, 
        enum: ['user', 'admin'], 
        default: 'user' 
    },
    lastActivity: {
        type: Date,
        default: Date.now
    },
    isActive: {
        type: Boolean,
        default: true
    },
    contracts: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Contract'
    }]
}, { timestamps: true });

userSchema.methods.updateActivity = function() {
    this.lastActivity = Date.now();
    return this.save();
};

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
