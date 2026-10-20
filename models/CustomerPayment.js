const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
  amount: { type: Number, required: true, min: 0 },
  method: { type: String, enum: ['cash', 'card'], default: 'cash' },
  note: { type: String, default: '' },
  receivedBy: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.models.CustomerPayment || mongoose.model('CustomerPayment', paymentSchema);
