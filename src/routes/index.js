const express = require('express');
const router = express.Router();

// Route imports
const authRoutes = require('./auth');
// const userRoutes = require('./users');
const voteRoutes = require('./votes');
const contentRoutes = require('./content');
const adminRoutes = require('./admin');
const mediaRoutes = require('./media');
const webauthnRoutes = require('./webauthn');
const healthRoutes = require('./health');
const memberRoutes = require('./members');

// Route mounting
router.use('/auth', authRoutes);
// router.use('/users', userRoutes);
router.use('/votes', voteRoutes);
router.use('/content', contentRoutes);
router.use('/admin', adminRoutes);
router.use('/media', mediaRoutes);
router.use('/webauthn', webauthnRoutes);
router.use('/health', healthRoutes);
router.use('/members', memberRoutes);

// Placeholder route
router.get('/', (req, res) => {
  res.json({
    message: 'Biometric Voting Portal API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      api: '/api'
    }
  });
});

module.exports = router;