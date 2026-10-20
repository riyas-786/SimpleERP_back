const express = require('express');
const Product = require('../models/Product');
const StockMovement = require('../models/StockMovement');
const { verifyToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

const FIELDS = ['name', 'sku', 'category', 'unit', 'costPrice', 'sellPrice', 'stock', 'reorderLevel', 'expiryDate'];
const pick = body => Object.fromEntries(FIELDS.filter(f => body[f] !== undefined).map(f => [f, body[f]]));

// List with optional ?q=search&category=&low=1
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.q) {
      const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { sku: rx }, { category: rx }];
    }
    if (req.query.category) filter.category = req.query.category;
    if (req.query.low === '1') filter.$expr = { $lte: ['$stock', '$reorderLevel'] };
    res.send(await Product.find(filter).sort('name'));
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

// Dashboard numbers
router.get('/summary', async (req, res) => {
  try {
    const soon = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const [agg] = await Product.aggregate([{
      $group: {
        _id: null,
        products: { $sum: 1 },
        stockCost: { $sum: { $multiply: ['$stock', '$costPrice'] } },
        stockRetail: { $sum: { $multiply: ['$stock', '$sellPrice'] } },
        low: { $sum: { $cond: [{ $lte: ['$stock', '$reorderLevel'] }, 1, 0] } },
        out: { $sum: { $cond: [{ $eq: ['$stock', 0] }, 1, 0] } },
        expiring: { $sum: { $cond: [{ $and: [{ $ne: [{ $type: '$expiryDate' }, 'missing'] }, { $lte: ['$expiryDate', soon] }] }, 1, 0] } },
      },
    }]);
    res.send({ products: 0, stockCost: 0, stockRetail: 0, low: 0, out: 0, expiring: 0, ...(agg || {}), _id: undefined });
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

router.get('/categories', async (req, res) => {
  res.send((await Product.distinct('category')).sort());
});

router.post('/', requireAdmin, async (req, res) => {
  try {
    const product = await Product.create(pick(req.body));
    if (product.stock > 0) {
      await StockMovement.create({
        product: product._id, type: 'in', qty: product.stock, stockAfter: product.stock,
        note: 'Opening stock', by: req.user.username,
      });
    }
    res.status(201).send(product);
  } catch (err) {
    res.status(400).send(err.code === 11000 ? 'That SKU / barcode already exists' : 'Error: ' + err.message);
  }
});

// Edit details. Stock is changed only through /:id/stock so history stays correct.
router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const data = pick(req.body);
    delete data.stock;
    const product = await Product.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true });
    if (!product) return res.status(404).send('Product not found');
    res.send(product);
  } catch (err) {
    res.status(400).send(err.code === 11000 ? 'That SKU / barcode already exists' : 'Error: ' + err.message);
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    await StockMovement.deleteMany({ product: req.params.id });
    res.send({ ok: true });
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

// Stock in / out / set exact count. Body: { type: 'in'|'out'|'adjust', qty, note }
// 'adjust' means "the counted stock is qty" (stock take).
router.post('/:id/stock', async (req, res) => {
  try {
    const { type, note } = req.body;
    const qty = Number(req.body.qty);
    if (!['in', 'out', 'adjust'].includes(type)) return res.status(400).send('Invalid type');
    if (!Number.isFinite(qty) || qty < 0 || (type !== 'adjust' && qty === 0))
      return res.status(400).send('Enter a valid quantity');

    let product;
    let change;
    if (type === 'adjust') {
      const current = await Product.findById(req.params.id);
      if (!current) return res.status(404).send('Product not found');
      change = qty - current.stock;
      product = await Product.findOneAndUpdate(
        { _id: current._id, stock: current.stock }, { $set: { stock: qty } }, { new: true });
      if (!product) return res.status(409).send('Stock changed meanwhile, try again');
    } else {
      change = type === 'in' ? qty : -qty;
      // Atomic: "out" only succeeds if enough stock is left, so stock never goes negative.
      product = await Product.findOneAndUpdate(
        type === 'out' ? { _id: req.params.id, stock: { $gte: qty } } : { _id: req.params.id },
        { $inc: { stock: change } }, { new: true });
      if (!product) {
        const exists = await Product.exists({ _id: req.params.id });
        return res.status(exists ? 400 : 404).send(exists ? 'Not enough stock' : 'Product not found');
      }
    }

    await StockMovement.create({
      product: product._id, type, qty: change, stockAfter: product.stock,
      note: note || '', by: req.user.username,
    });
    res.send(product);
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

router.get('/:id/movements', async (req, res) => {
  try {
    res.send(await StockMovement.find({ product: req.params.id }).sort('-createdAt').limit(50));
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

module.exports = router;
