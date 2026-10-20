const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  phone: { type: String, default: '', trim: true },
  address: { type: String, default: '', trim: true },
  creditLimit: { type: Number, default: 0, min: 0 },   // 0 = no limit
  balance: { type: Number, default: 0 },               // amount the customer owes us right now
}, { timestamps: true });

module.exports = mongoose.models.Customer || mongoose.model('Customer', customerSchema);
