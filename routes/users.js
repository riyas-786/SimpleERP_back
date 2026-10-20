const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { verifyToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(verifyToken, requireAdmin);

router.get('/', async (req, res) => {
  res.send(await User.find().select('-passwordHash').sort('name'));
});

router.post('/', async (req, res) => {
  try {
    const { name, username, password, role } = req.body;
    if (!name || !username || !password || password.length < 6)
      return res.status(400).send('Name, username and a password of 6+ characters are required');
    const user = await User.create({
      name, username, role: role === 'admin' ? 'admin' : 'staff',
      passwordHash: await bcrypt.hash(password, 10),
    });
    res.status(201).send({ _id: user._id, name: user.name, username: user.username, role: user.role });
  } catch (err) {
    res.status(400).send(err.code === 11000 ? 'That username is taken' : 'Error: ' + err.message);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).send('You cannot delete yourself');
    await User.findByIdAndDelete(req.params.id);
    res.send({ ok: true });
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

module.exports = router;
