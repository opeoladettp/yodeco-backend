const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { Category, Award, Nominee } = require('../models');
const Vote = require('../models/Vote');

/**
 * GET /api/presentation/data
 * Returns all categories, awards, nominees and vote counts for presentation generation.
 * Requires System_Admin or Panelist role.
 */
router.get('/data', authenticate, async (req, res) => {
  try {
    const { role } = req.user;
    if (!['System_Admin', 'Panelist'].includes(role)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }

    // Fetch all active categories with their awards and approved nominees
    const categories = await Category.find({ isActive: true }).sort({ createdAt: 1 }).lean();

    const awards = await Award.find({ isActive: true })
      .populate({ path: 'nominees', match: { isActive: true, approvalStatus: 'approved' }, select: 'name bio imageUrl' })
      .sort({ createdAt: 1 })
      .lean();

    // Get vote counts per nominee
    const voteCounts = await Vote.aggregate([
      { $group: { _id: '$nomineeId', count: { $sum: 1 } } }
    ]);
    const voteMap = {};
    voteCounts.forEach(v => { voteMap[v._id.toString()] = v.count; });

    // Build structured data: categories → awards → nominees with vote counts
    const apiBase = process.env.FRONTEND_URL
      ? process.env.FRONTEND_URL.replace(':3000', ':5000') + '/api'
      : 'http://localhost:5000/api';

    const data = categories.map(cat => {
      const catAwards = awards
        .filter(a => a.categoryId?.toString() === cat._id.toString())
        .map(award => {
          const nominees = (award.nominees || []).map(n => {
            const votes = voteMap[n._id.toString()] || 0;
            const imageUrl = n.imageUrl
              ? (n.imageUrl.startsWith('http') ? n.imageUrl : `${apiBase}/media/download/${n.imageUrl}`)
              : null;
            return { id: n._id, name: n.name, bio: n.bio || '', imageUrl, votes };
          }).sort((a, b) => b.votes - a.votes);

          const winner = nominees[0] || null;
          return { id: award._id, title: award.title, criteria: award.criteria || '', nominees, winner };
        });

      return { id: cat._id, name: cat.name, description: cat.description || '', awards: catAwards };
    }).filter(c => c.awards.length > 0);

    res.json({ success: true, data });
  } catch (err) {
    console.error('Presentation data error:', err);
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Failed to fetch presentation data' } });
  }
});

module.exports = router;
