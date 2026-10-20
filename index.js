const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

if (!process.env.MONGO_URI || !process.env.JWT_SECRET) {
  console.error('Set MONGO_URI and JWT_SECRET in .env (see .env.example)');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

app.use('/auth', require('./routes/auth'));
app.use('/users', require('./routes/users'));
app.use('/products', require('./routes/products'));
app.use('/sales', require('./routes/sales'));
app.use('/suppliers', require('./routes/suppliers'));
app.use('/purchases', require('./routes/purchases'));
app.use('/reports', require('./routes/reports'));
app.use('/customers', require('./routes/customers'));

app.get('/', (req, res) => res.send('Grocery ERP API running'));

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log('API on http://localhost:' + port));
  })
  .catch(err => { console.error('MongoDB connection failed:', err.message); process.exit(1); });
