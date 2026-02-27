const mongoose = require('mongoose');

const contractSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    contractNumber: {
        type: String,
        unique: true,
    },
    fullName: {
        type: String,
        required: true
    },
    nationalId: {
        type: String,
        required: true
    },
    phoneNumber: {
        type: String,
        required: true
    },
    
    propertyNumber: {
        type: String,
        required: true
    },
    ownershipPercentage: {
        type: Number,
        required: true,
        min: 0,
        max: 100
    },
    address: {
        type: String,
        required: true
    },
    governorate: {
        type: String,
        required: true,
        enum: [
            'القاهرة', 'الجيزة', 'الإسكندرية', 'الدقهلية', 'البحر الأحمر',
            'البحيرة', 'الفيوم', 'الغربية', 'الإسماعيلية', 'المنوفية',
            'المنيا', 'القليوبية', 'الوادي الجديد', 'السويس', 'اسوان',
            'اسيوط', 'بني سويف', 'بورسعيد', 'دمياط', 'الشرقية',
            'جنوب سيناء', 'كفر الشيخ', 'مطروح', 'الأقصر', 'قنا',
            'شمال سيناء', 'سوهاج'
        ]
    },
    propertyType: {
        type: String,
        required: true
    },
    propertyCategory: {
        type: String,
        enum: ['سكني', 'تجاري / إداري', 'أراضي', 'صناعي'],
        required: true
    },
    floor: {
        type: String,
        required: function() {
            return ['شقة', 'دوبلكس', 'ستوديو', 'بنتهاوس', 'مكتب إداري', 'عيادة'].includes(this.propertyType);
        }
    },
    price: {
        type: Number,
        required: true,
        min: 0
    },
    area: {
        type: Number,
        required: true,
        min: 0
    },
    
    status: {
        type: String,
        enum: [
            'pending',     
            'approved',     
            'rejected',    
            'for_sale',     
            'sale_pending', 
            'sold',          
            'completed'     
        ],
        default: 'pending'
    },
    notes: {
        type: String
    },
    
    contractDate: {
        type: Date,
        default: Date.now
    },
    expiryDate: {
        type: Date
    },

    contractImage: {
        type: String, 
        required: false
    },
    imageType: {
        type: String,
        required: false
    },
    imageName: {
        type: String, 
        required: false
    }
    ,

        //  للبيع
    buyerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    salePrice: {
        type: Number
    },
    saleDate: {
        type: Date
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'confirmed'],
        default: 'pending'
    },
    paymentMethod: {
        type: String,
        enum: ['bank_transfer', 'cash'],
        required: false
    },
    pendingSale: {
        type: Boolean,
        default: false
    },
    pendingBuyerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    pendingTransactionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Transaction'
    },

}, { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

contractSchema.pre('save', async function() {
    if (this.contractNumber) return;

    console.log('📝 Generating contract number...');
    
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const random = Math.floor(Math.random() * 1000000).toString().padStart(6, '0');
    
    this.contractNumber = `CON-${year}${month}-${random}`;
    
    console.log('✅ Generated:', this.contractNumber);
});

contractSchema.virtual('formattedPrice').get(function() {
    return this.price ? this.price.toLocaleString('ar-EG') + ' جنيه' : 'غير محدد';
});

contractSchema.virtual('formattedArea').get(function() {
    return this.area ? this.area.toLocaleString('ar-EG') + ' م²' : 'غير محدد';
});

module.exports = mongoose.model('Contract', contractSchema);
