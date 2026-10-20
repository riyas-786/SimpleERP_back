const mongoose = require('mongoose');

const movementSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  type: { type: String, enum: ['in', 'out', 'adjust'], required: true },
  qty: { type: Number, required: true },           // signed change applied to stock
  stockAfter: { type: Number, required: true },
  note: { type: String, default: '' },
  by: { type: String, default: '' },               // username
}, { timestamps: true });

module.exports = mongoose.models.StockMovement || mongoose.model('StockMovement', movementSchema);
