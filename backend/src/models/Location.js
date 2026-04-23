const mongoose = require('mongoose');

const LocationSchema = new mongoose.Schema({
  name: { type: String, default: 'Unnamed Location' },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Location', LocationSchema);
