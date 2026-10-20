const express = require('express');
const Sale = require('../models/Sale');
const { verifyToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken, requireAdmin);

const round2 = n => Math.round(((n || 0) + Number.EPSILON) * 100) / 100;

// Shared: ?from & ?to (ISO) -> match stage for live (not voided) sales.
function matchStage(req) {
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const from = req.query.from ? new Date(req.query.from) : new Date(to.getTime() - 30 * 24 * 3600 * 1000);
  if (isNaN(from) || isNaN(to)) throw new Error('Invalid dates');
  return { $match: { voided: false, createdAt: { $gte: from, $lte: to } } };
}

// Sales, cost of goods and profit for each day. ?tz=Asia/Dubai makes "day" match the shop's local day.
router.get('/daily', async (req, res) => {
  try {
    const tz = req.query.tz || 'UTC';
    const rows = await Sale.aggregate([
      matchStage(req),
      { $addFields: { cost: { $reduce: {
        input: '$items', initialValue: 0,
        in: { $add: ['$$value', { $multiply: ['$$this.qty', '$$this.cost'] }] },
      } } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: tz } },
        bills: { $sum: 1 }, sales: { $sum: '$total' }, discount: { $sum: '$discount' }, cost: { $sum: '$cost' },
      } },
      { $sort: { _id: 1 } },
    ]);
    res.send(rows.map(r => ({
      date: r._id, bills: r.bills, sales: round2(r.sales), discount: round2(r.discount),
      cost: round2(r.cost), profit: round2(r.sales - r.cost),
    })));
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

// Best sellers. Revenue is before the bill-level discount, so it can be slightly above daily sales.
router.get('/top-items', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const rows = await Sale.aggregate([
      matchStage(req),
      { $unwind: '$items' },
      { $group: {
        _id: { $ifNull: ['$items.product', '$items.name'] },
        name: { $first: '$items.name' }, unit: { $first: '$items.unit' },
        qty: { $sum: '$items.qty' },
        revenue: { $sum: { $multiply: ['$items.qty', '$items.price'] } },
        cost: { $sum: { $multiply: ['$items.qty', '$items.cost'] } },
      } },
      { $sort: { revenue: -1 } },
      { $limit: limit },
    ]);
    res.send(rows.map(r => ({
      name: r.name, unit: r.unit, qty: round2(r.qty),
      revenue: round2(r.revenue), cost: round2(r.cost), profit: round2(r.revenue - r.cost),
    })));
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

module.exports = router;
