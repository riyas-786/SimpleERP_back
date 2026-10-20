const express = require('express');
const Supplier = require('../models/Supplier');
const Purchase = require('../models/Purchase');
const { verifyToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken, requireAdmin);

const FIELDS = ['name', 'phone', 'address', 'notes'];
const pick = body => Object.fromEntries(FIELDS.filter(f => body[f] !== undefined).map(f => [f, body[f]]));

// Suppliers with how much we still owe each one.
router.get('/', async (req, res) => {
  try {
    const [suppliers, owed] = await Promise.all([
      Supplier.find().sort('name').lean(),
      Purchase.aggregate([
        { $match: { voided: false } },
        { $group: { _id: '$supplier', owed: { $sum: { $subtract: ['$total', '$paidAmount'] } }, purchases: { $sum: 1 } } },
      ]),
    ]);
    const byId = new Map(owed.map(o => [String(o._id), o]));
    res.send(suppliers.map(s => ({
      ...s,
      owed: Math.round(((byId.get(String(s._id))?.owed) || 0) * 100) / 100,
      purchases: byId.get(String(s._id))?.purchases || 0,
    })));
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

router.post('/', async (req, res) => {
  try {
    res.status(201).send(await Supplier.create(pick(req.body)));
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const s = await Supplier.findByIdAndUpdate(req.params.id, pick(req.body), { new: true, runValidators: true });
    if (!s) return res.status(404).send('Supplier not found');
    res.send(s);
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (await Purchase.exists({ supplier: req.params.id }))
      return res.status(400).send('This supplier has purchases and cannot be deleted');
    await Supplier.findByIdAndDelete(req.params.id);
    res.send({ ok: true });
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

module.exports = router;
