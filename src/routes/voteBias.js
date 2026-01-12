const express = require('express');
const router = express.Router();
const VoteBias = require('../models/VoteBias');
const Award = require('../models/Award');
const Nominee = require('../models/Nominee');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate, schemas } = require('../middleware/validation');
const securityLogger = require('../utils/securityLogger');
const auditService = require('../services/auditService');
const voteService = require('../services/voteService');

/**
 * GET /api/admin/vote-bias - Get all vote bias entries
 * Requires System_Admin role
 */
router.get('/', authenticate, requirePermission('system:admin'), async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      awardId = '', 
      nomineeId = '',
      isActive = 'true',
      sortBy = 'appliedAt',
      sortOrder = 'desc'
    } = req.query;
    
    const skip = (page - 1) * limit;
    
    // Build filter
    const filter = {};
    if (awardId) filter.awardId = awardId;
    if (nomineeId) filter.nomineeId = nomineeId;
    if (isActive !== 'all') filter.isActive = isActive === 'true';
    
    // Build sort object
    const sortObj = {};
    const validSortFields = ['appliedAt', 'biasAmount', 'awardId', 'nomineeId'];
    if (validSortFields.includes(sortBy)) {
      sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;
    } else {
      sortObj.appliedAt = -1; // Default sort
    }
    
    const biasEntries = await VoteBias.find(filter)
      .populate('award', 'title')
      .populate('nominee', 'name')
      .populate('appliedBy', 'name email role')
      .sort(sortObj)
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await VoteBias.countDocuments(filter);
    
    res.json({
      biasEntries,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching vote bias entries:', error);
    res.status(500).json({
      error: {
        code: 'BIAS_FETCH_ERROR',
        message: 'Failed to fetch vote bias entries',
        retryable: true
      }
    });
  }
});

/**
 * GET /api/admin/vote-bias/award/:awardId - Get bias entries for specific award
 * Requires System_Admin role
 */
router.get('/award/:awardId', authenticate, requirePermission('system:admin'), async (req, res) => {
  try {
    const { awardId } = req.params;
    const { isActive = 'true' } = req.query;
    
    // Validate awardId format
    if (!/^[0-9a-fA-F]{24}$/.test(awardId)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_AWARD_ID',
          message: 'Invalid award ID format',
          retryable: false
        }
      });
    }
    
    // Check if award exists
    const award = await Award.findById(awardId);
    if (!award) {
      return res.status(404).json({
        error: {
          code: 'AWARD_NOT_FOUND',
          message: 'Award not found',
          retryable: false
        }
      });
    }
    
    const filter = { awardId };
    if (isActive !== 'all') filter.isActive = isActive === 'true';
    
    const biasEntries = await VoteBias.find(filter)
      .populate('nominee', 'name')
      .populate('appliedBy', 'name email role')
      .sort({ appliedAt: -1 });
    
    res.json({
      award: {
        id: award._id,
        title: award.title
      },
      biasEntries
    });
  } catch (error) {
    console.error('Error fetching award bias entries:', error);
    res.status(500).json({
      error: {
        code: 'AWARD_BIAS_FETCH_ERROR',
        message: 'Failed to fetch award bias entries',
        retryable: true
      }
    });
  }
});

/**
 * POST /api/admin/vote-bias - Create new vote bias
 * Requires System_Admin role
 */
router.post('/', authenticate, requirePermission('system:admin'), async (req, res) => {
  try {
    const { awardId, nomineeId, biasAmount, reason } = req.body;
    const securityContext = securityLogger.createSecurityContext(req);
    
    // Validate required fields
    if (!awardId || !nomineeId || biasAmount === undefined || !reason) {
      return res.status(400).json({
        error: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'awardId, nomineeId, biasAmount, and reason are required',
          retryable: false
        }
      });
    }
    
    // Validate bias amount
    if (typeof biasAmount !== 'number' || biasAmount < 0 || biasAmount > 10000) {
      return res.status(400).json({
        error: {
          code: 'INVALID_BIAS_AMOUNT',
          message: 'Bias amount must be a number between 0 and 10,000',
          retryable: false
        }
      });
    }
    
    // Validate IDs format
    if (!/^[0-9a-fA-F]{24}$/.test(awardId) || !/^[0-9a-fA-F]{24}$/.test(nomineeId)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_ID_FORMAT',
          message: 'Invalid award ID or nominee ID format',
          retryable: false
        }
      });
    }
    
    // Check if award and nominee exist
    const [award, nominee] = await Promise.all([
      Award.findById(awardId),
      Nominee.findById(nomineeId)
    ]);
    
    if (!award) {
      return res.status(404).json({
        error: {
          code: 'AWARD_NOT_FOUND',
          message: 'Award not found',
          retryable: false
        }
      });
    }
    
    if (!nominee) {
      return res.status(404).json({
        error: {
          code: 'NOMINEE_NOT_FOUND',
          message: 'Nominee not found',
          retryable: false
        }
      });
    }
    
    // Check if nominee belongs to award
    if (!nominee.awardId.equals(awardId)) {
      return res.status(400).json({
        error: {
          code: 'NOMINEE_AWARD_MISMATCH',
          message: 'Nominee does not belong to the specified award',
          retryable: false
        }
      });
    }
    
    // Check if active bias already exists
    const existingActiveBias = await VoteBias.findOne({ awardId, nomineeId, isActive: true });
    
    if (existingActiveBias) {
      return res.status(409).json({
        error: {
          code: 'ACTIVE_BIAS_EXISTS',
          message: `Active vote bias already exists for this nominee. Use PUT /api/admin/vote-bias/${existingActiveBias._id} to update it.`,
          details: {
            existingBiasId: existingActiveBias._id,
            currentAmount: existingActiveBias.biasAmount
          },
          retryable: false
        }
      });
    }
    
    // Create new bias entry
    const biasEntry = new VoteBias({
      awardId,
      nomineeId,
      biasAmount,
      reason,
      appliedBy: req.user._id,
      metadata: {
        ipAddress: securityContext.ipAddress,
        userAgent: securityContext.userAgent,
        sessionId: securityContext.sessionId
      }
    });
    
    await biasEntry.save();
    
    // Log the creation
    await auditService.createAuditEntry({
      adminUserId: req.user._id.toString(),
      targetUserId: null,
      action: 'VOTE_BIAS_CREATED',
      details: {
        awardId,
        awardTitle: award.title,
        nomineeId,
        nomineeName: nominee.name,
        biasAmount,
        reason
      },
      ipAddress: securityContext.ipAddress,
      userAgent: securityContext.userAgent,
      success: true
    });
    
    // Populate the response
    await biasEntry.populate([
      { path: 'award', select: 'title' },
      { path: 'nominee', select: 'name' },
      { path: 'appliedBy', select: 'name email role' }
    ]);
    
    // Clear vote counts cache to ensure fresh data is returned
    try {
      await voteService.clearVoteCountsCache(awardId);
      console.log(`Vote counts cache cleared for award ${awardId} after bias creation`);
    } catch (cacheError) {
      console.warn('Failed to clear vote counts cache:', cacheError.message);
      // Don't fail the operation if cache clearing fails
    }
    
    res.status(201).json({
      message: 'Vote bias created successfully',
      biasEntry
    });
    
  } catch (error) {
    console.error('Error creating vote bias:', error);
    
    if (error.code === 11000) {
      return res.status(409).json({
        error: {
          code: 'DUPLICATE_BIAS_ENTRY',
          message: 'Bias entry already exists for this nominee and award',
          retryable: false
        }
      });
    }
    
    res.status(500).json({
      error: {
        code: 'BIAS_CREATION_ERROR',
        message: 'Failed to create vote bias',
        retryable: true
      }
    });
  }
});

/**
 * PUT /api/admin/vote-bias/:id - Update existing vote bias
 * Requires System_Admin role
 */
router.put('/:id', authenticate, requirePermission('system:admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { biasAmount, reason } = req.body;
    const securityContext = securityLogger.createSecurityContext(req);
    
    // Validate required fields
    if (biasAmount === undefined || !reason) {
      return res.status(400).json({
        error: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'biasAmount and reason are required',
          retryable: false
        }
      });
    }
    
    // Validate bias amount
    if (typeof biasAmount !== 'number' || biasAmount < 0 || biasAmount > 10000) {
      return res.status(400).json({
        error: {
          code: 'INVALID_BIAS_AMOUNT',
          message: 'Bias amount must be a number between 0 and 10,000',
          retryable: false
        }
      });
    }
    
    // Validate ID format
    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_BIAS_ID',
          message: 'Invalid bias ID format',
          retryable: false
        }
      });
    }
    
    // Find the existing bias entry
    const existingBias = await VoteBias.findById(id)
      .populate('award', 'title')
      .populate('nominee', 'name');
    
    if (!existingBias) {
      return res.status(404).json({
        error: {
          code: 'BIAS_NOT_FOUND',
          message: 'Vote bias entry not found',
          retryable: false
        }
      });
    }
    
    // Store old values for audit
    const oldBiasAmount = existingBias.biasAmount;
    const wasInactive = !existingBias.isActive;
    
    // Update the bias entry
    existingBias.biasAmount = biasAmount;
    existingBias.reason = reason;
    existingBias.appliedBy = req.user._id;
    existingBias.appliedAt = new Date();
    existingBias.isActive = true; // Reactivate if it was inactive
    existingBias.metadata = {
      ipAddress: securityContext.ipAddress,
      userAgent: securityContext.userAgent,
      sessionId: securityContext.sessionId
    };
    
    // Clear deactivation fields if reactivating
    if (wasInactive) {
      existingBias.deactivatedBy = undefined;
      existingBias.deactivatedAt = undefined;
      existingBias.deactivationReason = undefined;
    }
    
    await existingBias.save();
    
    // Log the update
    await auditService.createAuditEntry({
      adminUserId: req.user._id.toString(),
      targetUserId: null,
      action: 'VOTE_BIAS_UPDATED',
      details: {
        biasId: existingBias._id,
        awardId: existingBias.awardId,
        awardTitle: existingBias.award?.title,
        nomineeId: existingBias.nomineeId,
        nomineeName: existingBias.nominee?.name,
        oldBiasAmount,
        newBiasAmount: biasAmount,
        reason,
        wasReactivated: wasInactive
      },
      ipAddress: securityContext.ipAddress,
      userAgent: securityContext.userAgent,
      success: true
    });
    
    // Populate the response
    await existingBias.populate([
      { path: 'award', select: 'title' },
      { path: 'nominee', select: 'name' },
      { path: 'appliedBy', select: 'name email role' }
    ]);
    
    // Clear vote counts cache to ensure fresh data is returned
    try {
      await voteService.clearVoteCountsCache(existingBias.awardId.toString());
      console.log(`Vote counts cache cleared for award ${existingBias.awardId} after bias update`);
    } catch (cacheError) {
      console.warn('Failed to clear vote counts cache:', cacheError.message);
      // Don't fail the operation if cache clearing fails
    }
    
    res.json({
      message: wasInactive ? 'Vote bias reactivated and updated successfully' : 'Vote bias updated successfully',
      biasEntry: existingBias,
      wasReactivated: wasInactive
    });
    
  } catch (error) {
    console.error('Error updating vote bias:', error);
    res.status(500).json({
      error: {
        code: 'BIAS_UPDATE_ERROR',
        message: 'Failed to update vote bias',
        retryable: true
      }
    });
  }
});

/**
 * DELETE /api/admin/vote-bias/:biasId - Remove vote bias
 * Requires System_Admin role
 */
router.delete('/:biasId', authenticate, requirePermission('system:admin'), async (req, res) => {
  try {
    const { biasId } = req.params;
    const { reason = 'Removed by admin' } = req.body;
    const securityContext = securityLogger.createSecurityContext(req);
    
    // Validate biasId format
    if (!/^[0-9a-fA-F]{24}$/.test(biasId)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_BIAS_ID',
          message: 'Invalid bias ID format',
          retryable: false
        }
      });
    }
    
    const biasEntry = await VoteBias.findById(biasId)
      .populate('award', 'title')
      .populate('nominee', 'name');
    
    if (!biasEntry) {
      return res.status(404).json({
        error: {
          code: 'BIAS_NOT_FOUND',
          message: 'Vote bias entry not found',
          retryable: false
        }
      });
    }
    
    // Deactivate instead of deleting for audit trail
    biasEntry.isActive = false;
    biasEntry.deactivatedBy = req.user._id;
    biasEntry.deactivatedAt = new Date();
    biasEntry.deactivationReason = reason;
    
    await biasEntry.save();
    
    // Log the removal
    await auditService.createAuditEntry({
      adminUserId: req.user._id.toString(),
      targetUserId: null,
      action: 'VOTE_BIAS_REMOVED',
      details: {
        biasId,
        awardId: biasEntry.awardId,
        awardTitle: biasEntry.award?.title,
        nomineeId: biasEntry.nomineeId,
        nomineeName: biasEntry.nominee?.name,
        biasAmount: biasEntry.biasAmount,
        reason
      },
      ipAddress: securityContext.ipAddress,
      userAgent: securityContext.userAgent,
      success: true
    });
    
    // Clear vote counts cache to ensure fresh data is returned
    try {
      await voteService.clearVoteCountsCache(biasEntry.awardId.toString());
      console.log(`Vote counts cache cleared for award ${biasEntry.awardId} after bias removal`);
    } catch (cacheError) {
      console.warn('Failed to clear vote counts cache:', cacheError.message);
      // Don't fail the operation if cache clearing fails
    }
    
    res.json({
      message: 'Vote bias removed successfully',
      biasEntry
    });
    
  } catch (error) {
    console.error('Error removing vote bias:', error);
    res.status(500).json({
      error: {
        code: 'BIAS_REMOVAL_ERROR',
        message: 'Failed to remove vote bias',
        retryable: true
      }
    });
  }
});

/**
 * GET /api/admin/vote-bias/statistics - Get bias statistics
 * Requires System_Admin role
 */
router.get('/statistics', authenticate, requirePermission('system:admin'), async (req, res) => {
  try {
    const { timeframe = '30d' } = req.query;
    const days = parseInt(timeframe.replace('d', ''));
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // Get basic statistics
    const [
      totalActiveBias,
      totalInactiveBias,
      recentBias,
      biasDistribution
    ] = await Promise.all([
      VoteBias.countDocuments({ isActive: true }),
      VoteBias.countDocuments({ isActive: false }),
      VoteBias.countDocuments({ 
        appliedAt: { $gte: startDate },
        isActive: true 
      }),
      VoteBias.aggregate([
        { $match: { isActive: true } },
        {
          $group: {
            _id: {
              $switch: {
                branches: [
                  { case: { $lte: ['$biasAmount', 10] }, then: '1-10' },
                  { case: { $lte: ['$biasAmount', 50] }, then: '11-50' },
                  { case: { $lte: ['$biasAmount', 100] }, then: '51-100' },
                  { case: { $lte: ['$biasAmount', 500] }, then: '101-500' },
                  { case: { $lte: ['$biasAmount', 1000] }, then: '501-1000' }
                ],
                default: '1000+'
              }
            },
            count: { $sum: 1 },
            totalBias: { $sum: '$biasAmount' }
          }
        },
        { $sort: { '_id': 1 } }
      ])
    ]);
    
    // Get top biased awards
    const topBiasedAwards = await VoteBias.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: '$awardId',
          totalBias: { $sum: '$biasAmount' },
          biasCount: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'awards',
          localField: '_id',
          foreignField: '_id',
          as: 'award'
        }
      },
      { $unwind: '$award' },
      {
        $project: {
          awardId: '$_id',
          awardTitle: '$award.title',
          totalBias: 1,
          biasCount: 1
        }
      },
      { $sort: { totalBias: -1 } },
      { $limit: 10 }
    ]);
    
    res.json({
      statistics: {
        totalActiveBias,
        totalInactiveBias,
        recentBias,
        biasDistribution,
        topBiasedAwards
      },
      timeframe: `${days} days`,
      generatedAt: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error fetching bias statistics:', error);
    res.status(500).json({
      error: {
        code: 'BIAS_STATISTICS_ERROR',
        message: 'Failed to fetch bias statistics',
        retryable: true
      }
    });
  }
});

module.exports = router;