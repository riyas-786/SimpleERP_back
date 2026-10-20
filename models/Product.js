const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  sku: { type: String, trim: true, default: '' },            // barcode or own code
  category: { type: String, trim: true, default: 'General' },
  unit: { type: String, enum: ['pcs', 'kg', 'g', 'l', 'ml', 'pack', 'box'], default: 'pcs' },
  costPrice: { type: Number, default: 0, min: 0 },
  sellPrice: { type: Number, default: 0, min: 0 },
  stock: { type: Number, default: 0, min: 0 },
  reorderLevel: { type: Number, default: 5, min: 0 },        // low-stock alert threshold
  expiryDate: { type: Date },
}, { timestamps: true });

productSchema.index({ name: 'text', sku: 'text', category: 'text' });
productSchema.index({ sku: 1 }, { unique: true, partialFilterExpression: { sku: { $gt: '' } } });

module.exports = mongoose.models.Product || mongoose.model('Product', productSchema);
