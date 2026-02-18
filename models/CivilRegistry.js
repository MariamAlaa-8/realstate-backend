const mongoose = require('mongoose');

const civilRegistrySchema = new mongoose.Schema({
    fullName: String,
    nationalId: String
}, { collection: 'civilregistry' }); 
module.exports = mongoose.model('CivilRegistry', civilRegistrySchema);
