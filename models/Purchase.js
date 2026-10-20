const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  name: String,
  unit: String,
  qty: { type: Number, required: true, min: 0 },
  cost: { type: Number, required: true, min: 0 },   // cost price per unit on this delivery
}, { _id: false });

const purchaseSchema = new mongoose.Schema({
  purchaseNo: { type: Number, required: true, unique: true },
  supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
  supplierName: { type: String, default: '' },
  invoiceRef: { type: String, default: '', trim: true },   // the supplier's own invoice number
  items: { type: [itemSchema], required: true },
  total: { type: Number, required: true, min: 0 },
  paidAmount: { type: Number, default: 0, min: 0 },
  note: { type: String, default: '' },
  receivedBy: { type: String, default: '' },
  voided: { type: Boolean, default: false },
  voidedBy: { type: String, default: '' },
}, { timestamps: true });

purchaseSchema.index({ createdAt: -1 });

module.exports = mongoose.models.Purchase || mongoose.model('Purchase', purchaseSchema);
