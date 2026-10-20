const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
  name: String,
  unit: String,
  qty: { type: Number, required: true, min: 0 },
  price: { type: Number, required: true, min: 0 },   // selling price at the time of sale
  cost: { type: Number, default: 0, min: 0 },        // cost price at the time of sale (for profit)
}, { _id: false });

const saleSchema = new mongoose.Schema({
  invoiceNo: { type: Number, required: true, unique: true },
  items: { type: [itemSchema], required: true },
  subtotal: { type: Number, required: true },
  discount: { type: Number, default: 0 },
  total: { type: Number, required: true },
  paymentMethod: { type: String, enum: ['cash', 'card', 'credit'], default: 'cash' },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', index: true },   // set for credit sales
  customerName: { type: String, default: '', trim: true },
  soldBy: { type: String, default: '' },
  voided: { type: Boolean, default: false },
  voidedBy: { type: String, default: '' },
}, { timestamps: true });

saleSchema.index({ createdAt: -1 });

module.exports = mongoose.models.Sale || mongoose.model('Sale', saleSchema);
