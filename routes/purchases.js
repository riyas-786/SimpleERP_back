const express = require('express');
const Product = require('../models/Product');
const Supplier = require('../models/Supplier');
const Purchase = require('../models/Purchase');
const Counter = require('../models/Counter');
const StockMovement = require('../models/StockMovement');
const { verifyToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken, requireAdmin);

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

// Undo stock increases (newest first), restoring the old cost price too.
async function undoReceive(done) {
  for (const d of [...done].reverse()) {
    await Product.updateOne({ _id: d.id }, { $inc: { stock: -d.qty }, $set: { costPrice: d.oldCost } });
  }
}

// Receive goods. Body: { supplierId, invoiceRef, items: [{ productId, qty, cost }], paidAmount, note }
// Adds stock, sets each product's cost price to the new cost, and logs a stock movement per line.
router.post('/', async (req, res) => {
  const done = [];
  try {
    const { supplierId, invoiceRef, items, note } = req.body;
    const supplier = supplierId ? await Supplier.findById(supplierId) : null;
    if (!supplier) return res.status(400).send('Choose a supplier');
    if (!Array.isArray(items) || !items.length) return res.status(400).send('Add at least one item');

    const lines = [];
    for (const it of items) {
      const qty = Number(it.qty);
      const cost = Number(it.cost);
      if (!it.productId || !(qty > 0) || !(cost >= 0)) return res.status(400).send('Every item needs a quantity and a cost');
      lines.push({ productId: String(it.productId), qty, cost });
    }
    const ids = [...new Set(lines.map(l => l.productId))];
    const products = await Product.find({ _id: { $in: ids } }).select('name unit');
    if (products.length !== ids.length) return res.status(400).send('A product in the list no longer exists');
    const byId = new Map(products.map(p => [String(p._id), p]));

    const total = round2(lines.reduce((s, l) => s + l.qty * l.cost, 0));
    const paidAmount = round2(Number(req.body.paidAmount) || 0);
    if (paidAmount < 0 || paidAmount > total) return res.status(400).send('Paid amount must be between 0 and the total');

    const movements = [];
    for (const l of lines) {
      const old = await Product.findOneAndUpdate(
        { _id: l.productId }, { $inc: { stock: l.qty }, $set: { costPrice: l.cost } }, { new: false });
      if (!old) { await undoReceive(done); return res.status(400).send('A product in the list no longer exists'); }
      done.push({ id: l.productId, qty: l.qty, oldCost: old.costPrice });
      movements.push({ product: l.productId, qty: l.qty, stockAfter: old.stock + l.qty });
    }

    let purchase;
    try {
      const counter = await Counter.findOneAndUpdate({ _id: 'purchase' }, { $inc: { seq: 1 } }, { new: true, upsert: true });
      purchase = await Purchase.create({
        purchaseNo: counter.seq, supplier: supplier._id, supplierName: supplier.name,
        invoiceRef: invoiceRef || '', total, paidAmount, note: note || '', receivedBy: req.user.username,
        items: lines.map(l => ({
          product: l.productId, name: byId.get(l.productId).name, unit: byId.get(l.productId).unit, qty: l.qty, cost: l.cost,
        })),
      });
    } catch (err) {
      await undoReceive(done);
      throw err;
    }

    await StockMovement.insertMany(movements.map(m => ({
      product: m.product, type: 'in', qty: m.qty, stockAfter: m.stockAfter,
      note: `Purchase #${purchase.purchaseNo} from ${supplier.name}`, by: req.user.username,
    })));
    res.status(201).send(purchase);
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

// List purchases in ?from..?to, optional ?supplier=
router.get('/', async (req, res) => {
  try {
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 30 * 24 * 3600 * 1000);
    if (isNaN(from) || isNaN(to)) return res.status(400).send('Invalid dates');
    const filter = { createdAt: { $gte: from, $lte: to } };
    if (req.query.supplier) filter.supplier = req.query.supplier;
    res.send(await Purchase.find(filter).sort('-createdAt').limit(500));
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

// Record a payment to the supplier against one purchase. Body: { amount }
router.post('/:id/pay', async (req, res) => {
  try {
    const amount = round2(Number(req.body.amount));
    if (!(amount > 0)) return res.status(400).send('Enter a valid amount');
    const purchase = await Purchase.findOneAndUpdate(
      { _id: req.params.id, voided: false, $expr: { $lte: [{ $add: ['$paidAmount', amount] }, { $add: ['$total', 0.001] }] } },
      { $inc: { paidAmount: amount } }, { new: true });
    if (!purchase) return res.status(400).send('Payment is more than the amount owed, or the purchase is voided');
    res.send(purchase);
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

// Cancel a purchase and remove its stock again. Fails if some of that stock has already been sold.
router.post('/:id/void', async (req, res) => {
  const taken = [];
  try {
    const purchase = await Purchase.findOne({ _id: req.params.id, voided: false });
    if (!purchase) return res.status(400).send('Purchase not found or already voided');

    const rollback = async () => { for (const t of taken) await Product.updateOne({ _id: t.product }, { $inc: { stock: t.qty } }); };

    for (const it of purchase.items) {
      const p = await Product.findOneAndUpdate(
        { _id: it.product, stock: { $gte: it.qty } }, { $inc: { stock: -it.qty } }, { new: true });
      if (!p) {
        await rollback();
        return res.status(400).send(`Cannot void: not enough ${it.name} left in stock (some was already sold)`);
      }
      taken.push({ product: it.product, qty: it.qty, after: p.stock, name: it.name });
    }

    const marked = await Purchase.findOneAndUpdate(
      { _id: purchase._id, voided: false }, { voided: true, voidedBy: req.user.username }, { new: true });
    if (!marked) { await rollback(); return res.status(400).send('Already voided'); }

    await StockMovement.insertMany(taken.map(t => ({
      product: t.product, type: 'out', qty: -t.qty, stockAfter: t.after,
      note: `Void purchase #${purchase.purchaseNo}`, by: req.user.username,
    })));
    res.send(marked);
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

module.exports = router;
