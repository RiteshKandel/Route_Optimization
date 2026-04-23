require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const logger = require('./utils/logger');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
mongoose.connect(process.env.MONGODB_URI).then(() => {
  logger.info('Connected to MongoDB successfully');
}).catch((err) => {
  logger.error(`MongoDB connection error: ${err.message}`);
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Route Optimization API is running' });
});

// API Routes
app.use('/api/locations', require('./routes/locations'));

// The optimize endpoint is nested inside locations router
// POST /api/locations/optimize

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).json({ error: 'Server Error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
