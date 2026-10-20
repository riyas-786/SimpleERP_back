const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

function sign(user) {
  const payload = { id: String(user._id), username: user.username, name: user.name, role: user.role };
  return { token: jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '12h' }), user: payload };
}

// Does the shop still need its first (owner) account?
router.get('/needs-setup', async (req, res) => {
  res.send({ needsSetup: (await User.countDocuments()) === 0 });
});

// Creates the owner account. Only works while there are no users at all.
router.post('/setup', async (req, res) => {
  try {
    if ((await User.countDocuments()) > 0) return res.status(403).send('Already set up');
    const { name, username, password } = req.body;
    if (!name || !username || !password || password.length < 6)
      return res.status(400).send('Name, username and a password of 6+ characters are required');
    const user = await User.create({
      name, username, role: 'admin', passwordHash: await bcrypt.hash(password, 10),
    });
    res.status(201).send(sign(user));
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username: String(username || '').toLowerCase().trim() });
    if (!user || !(await bcrypt.compare(String(password || ''), user.passwordHash)))
      return res.status(401).send('Wrong username or password');
    res.send(sign(user));
  } catch (err) {
    res.status(400).send('Error: ' + err.message);
  }
});

router.get('/me', verifyToken, (req, res) => res.send(req.user));

module.exports = router;
