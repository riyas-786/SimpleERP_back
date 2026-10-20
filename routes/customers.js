const express = require('express');
const Customer = require('../models/Customer');
const CustomerPayment = require('../models/CustomerPayment');
const Sale = require('../models/Sale');
const { verifyToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken);

const round2 = n => Math.round(((n || 0) + Number.EPSILON) * 100) / 100;
const pick = b => Object.fromEntries(['name', 'phone', 'address', 'creditLimit'].filter(f => b[f] !== undefined).map(f => [f, b[f]]));

router.get('/', async (req, res) => {
  try {
    res.send(await Customer.find().sort('name'));
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

// Only admins create/edit/delete customers, because they set the credit limit.
router.post('/', requireAdmin, async (req, res) => {
  try {
    res.status(201).send(await Customer.create(pick(req.body)));
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

router.patch('/:id', requireAdmin, async (req, res) => {
  try {
    const c = await Customer.findByIdAndUpdate(req.params.id, pick(req.body), { new: true, runValidators: true });
    if (!c) return res.status(404).send('Customer not found');
    res.send(c);
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const c = await Customer.findById(req.params.id);
    if (!c) return res.status(404).send('Customer not found');
    if (Math.abs(c.balance) > 0.001) return res.status(400).send('This customer still has a balance and cannot be deleted');
    if (await Sale.exists({ customer: c._id })) return res.status(400).send('This customer has credit sales and cannot be deleted');
    await Customer.findByIdAndDelete(c._id);
    await CustomerPayment.deleteMany({ customer: c._id });
    res.send({ ok: true });
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

// Receive a payment from a customer. Body: { amount, method, note }. Cannot exceed what they owe.
router.post('/:id/payment', async (req, res) => {
  try {
    const amount = round2(Number(req.body.amount));
    if (!(amount > 0)) return res.status(400).send('Enter a valid amount');
    const customer = await Customer.findOneAndUpdate(
      { _id: req.params.id, $expr: { $gte: [{ $add: ['$balance', 0.001] }, amount] } },
      { $inc: { balance: -amount } }, { new: true });
    if (!customer) return res.status(400).send('Payment is more than the customer owes');
    try {
      await CustomerPayment.create({
        customer: customer._id, amount, method: req.body.method === 'card' ? 'card' : 'cash',
        note: req.body.note || '', receivedBy: req.user.username,
      });
    } catch (err) {
      await Customer.updateOne({ _id: customer._id }, { $inc: { balance: amount } });
      throw err;
    }
    res.send(customer);
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

// Statement: credit sales (+) and payments (-), newest first.
router.get('/:id/ledger', async (req, res) => {
  try {
    const [sales, payments] = await Promise.all([
      Sale.find({ customer: req.params.id, paymentMethod: 'credit' }).sort('-createdAt').limit(100),
      CustomerPayment.find({ customer: req.params.id }).sort('-createdAt').limit(100),
    ]);
    const entries = [
      ...sales.map(s => ({
        date: s.createdAt, type: 'sale', ref: `Bill #${s.invoiceNo}`, amount: s.total, voided: s.voided, note: '',
      })),
      ...payments.map(p => ({
        date: p.createdAt, type: 'payment', ref: `Payment (${p.method})`, amount: -p.amount, voided: false, note: p.note,
      })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));
    res.send(entries.slice(0, 100));
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

module.exports = router;
