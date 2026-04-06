const mongoose = require('mongoose');

const zamamSchema = new mongoose.Schema({
    zamamNumber: {
        type: String,
        required: true,
        unique: true
    },
    governorate: {
        type: String,
        required: true
    },
    totalArea: {
        type: Number,
        required: true,
        min: 0
    },
    ownedArea: {
        type: Number,
        default: 0,
        min: 0
    },
    description: {
        type: String,
        default: ''
    }
}, { timestamps: true });
module.exports = mongoose.model('Zamam', zamamSchema);