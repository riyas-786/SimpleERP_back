const express = require('express');
const Product = require('../models/Product');
const Sale = require('../models/Sale');
const Counter = require('../models/Counter');
const Customer = require('../models/Customer');
const StockMovement = require('../models/StockMovement');
const { verifyToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

async function giveBack(taken) {
  for (const t of taken) await Product.updateOne({ _id: t.id }, { $inc: { stock: t.qty } });
}

// Create a sale. Body: { items: [{ productId, qty }], discount, paymentMethod, customerName }
// Prices come from the product record on the server, never from the browser.
router.post('/', async (req, res) => {
  const taken = [];
  try {
    const { items, paymentMethod, customerName, customerId } = req.body;
    const method = ['card', 'credit'].includes(paymentMethod) ? paymentMethod : 'cash';
    if (method === 'credit' && !customerId) return res.status(400).send('Choose a customer for a credit sale');
    const discount = Number(req.body.discount) || 0;
    if (!Array.isArray(items) || !items.length) return res.status(400).send('Add at least one item');

    const wanted = new Map();
    for (const it of items) {
      const qty = Number(it.qty);
      if (!it.productId || !(qty > 0)) return res.status(400).send('Every item needs a valid quantity');
      wanted.set(String(it.productId), (wanted.get(String(it.productId)) || 0) + qty);
    }

    const products = await Product.find({ _id: { $in: [...wanted.keys()] } });
    if (products.length !== wanted.size) return res.status(400).send('A product in the cart no longer exists');
    const byId = new Map(products.map(p => [String(p._id), p]));

    const lines = [...wanted].map(([id, qty]) => {
      const p = byId.get(id);
      return { product: p._id, name: p.name, unit: p.unit, qty, price: p.sellPrice, cost: p.costPrice };
    });
    const subtotal = round2(lines.reduce((s, l) => s + l.qty * l.price, 0));
    if (discount < 0 || discount > subtotal) return res.status(400).send('Discount must be between 0 and the bill amount');

    // Take stock atomically. "stock >= qty" in the filter means two cashiers can never oversell.
    for (const [id, qty] of wanted) {
      const updated = await Product.findOneAndUpdate(
        { _id: id, stock: { $gte: qty } }, { $inc: { stock: -qty } }, { new: true });
      if (!updated) {
        await giveBack(taken);
        return res.status(400).send(`Not enough stock for ${byId.get(id).name}`);
      }
      taken.push({ id, qty, after: updated.stock });
    }

    // Credit sale: add the bill to the customer's balance, but only if it stays within their limit.
    const total = round2(subtotal - discount);
    let customer = null;
    if (method === 'credit') {
      try {
        customer = await Customer.findOneAndUpdate(
          { _id: customerId, $expr: { $or: [{ $eq: ['$creditLimit', 0] }, { $lte: [{ $add: ['$balance', total] }, '$creditLimit'] }] } },
          { $inc: { balance: total } }, { new: true });
      } catch (err) {
        await giveBack(taken);
        return res.status(400).send('Customer not found');
      }
      if (!customer) {
        await giveBack(taken);
        return res.status(400).send('Customer not found or the credit limit would be exceeded');
      }
    }

    let sale;
    try {
      const counter = await Counter.findOneAndUpdate(
        { _id: 'invoice' }, { $inc: { seq: 1 } }, { new: true, upsert: true });
      sale = await Sale.create({
        invoiceNo: counter.seq, items: lines, subtotal, discount,
        total, paymentMethod: method, customer: customer ? customer._id : undefined,
        customerName: customer ? customer.name : (customerName || ''), soldBy: req.user.username,
      });
    } catch (err) {
      await giveBack(taken);
      if (customer) await Customer.updateOne({ _id: customer._id }, { $inc: { balance: -total } });
      throw err;
    }

    const afterById = new Map(taken.map(t => [t.id, t.after]));
    await StockMovement.insertMany(lines.map(l => ({
      product: l.product, type: 'out', qty: -l.qty,
      stockAfter: afterById.get(String(l.product)), note: `Sale #${sale.invoiceNo}`, by: req.user.username,
    })));

    res.status(201).send(sale);
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

// List sales between ?from and ?to (ISO dates). Defaults to the last 24 hours.
router.get('/', async (req, res) => {
  try {
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 24 * 3600 * 1000);
    if (isNaN(from) || isNaN(to)) return res.status(400).send('Invalid dates');
    res.send(await Sale.find({ createdAt: { $gte: from, $lte: to } }).sort('-createdAt').limit(500));
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

// Cancel a sale and put the stock back. Admin only; the sale stays in history marked as voided.
router.post('/:id/void', requireAdmin, async (req, res) => {
  try {
    const sale = await Sale.findOneAndUpdate(
      { _id: req.params.id, voided: false }, { voided: true, voidedBy: req.user.username }, { new: true });
    if (!sale) return res.status(400).send('Sale not found or already voided');

    // A voided credit sale no longer counts against the customer.
    if (sale.paymentMethod === 'credit' && sale.customer) {
      await Customer.updateOne({ _id: sale.customer }, { $inc: { balance: -sale.total } });
    }

    for (const it of sale.items) {
      const p = await Product.findByIdAndUpdate(it.product, { $inc: { stock: it.qty } }, { new: true });
      if (p) {
        await StockMovement.create({
          product: p._id, type: 'in', qty: it.qty, stockAfter: p.stock,
          note: `Void sale #${sale.invoiceNo}`, by: req.user.username,
        });
      }
    }
    res.send(sale);
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

module.exports = router;
