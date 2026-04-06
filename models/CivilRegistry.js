const mongoose = require('mongoose');

const civilRegistrySchema = new mongoose.Schema({
    fullName: String,
    nationalId: String,
    gender: String,
    religion: String,
    nationality: String,
    region: String,
}, { collection: 'civilregistry' });

module.exports = mongoose.model('CivilRegistry', civilRegistrySchema);
