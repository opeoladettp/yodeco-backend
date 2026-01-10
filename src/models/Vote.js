const mongoose = require('mongoose');

const voteSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required for voting']
  },
  awardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Award',
    required: [true, 'Award ID is required for voting']
  },
  nomineeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Nominee',
    required: [true, 'Nominee ID is required for voting']
  },
  timestamp: {
    type: Date,
    default: Date.now,
    required: true
  },
  biometricVerified: {
    type: Boolean,
    required: [true, 'Biometric verification status is required'],
    default: false
  },
  ipAddress: {
    type: String,
    required: false,
    validate: {
      validator: function(v) {
        // If provided, should be a hashed IP address (hex string)
        if (!v) return true;
        return /^[a-f0-9]{64}$/.test(v);
      },
      message: 'IP address must be a SHA-256 hash (64 character hex string)'
    }
  }
});

// Create compound unique index to prevent duplicate votes per user per award
voteSchema.index({ userId: 1, awardId: 1 }, { unique: true });

// Additional indexes for efficient queries
voteSchema.index({ awardId: 1, timestamp: -1 });
voteSchema.index({ nomineeId: 1 });
voteSchema.index({ userId: 1, timestamp: -1 });
voteSchema.index({ timestamp: -1 });

// Virtual for getting user details
voteSchema.virtual('user', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

// Virtual for getting award details
voteSchema.virtual('award', {
  ref: 'Award',
  localField: 'awardId',
  foreignField: '_id',
  justOne: true
});

// Virtual for getting nominee details
voteSchema.virtual('nominee', {
  ref: 'Nominee',
  localField: 'nomineeId',
  foreignField: '_id',
  justOne: true
});

// Ensure virtual fields are serialized
voteSchema.set('toJSON', { virtuals: true });
voteSchema.set('toObject', { virtuals: true });

// Pre-save validation to ensure nominee belongs to the award
voteSchema.pre('save', async function(next) {
  try {
    const Nominee = mongoose.model('Nominee');
    const nominee = await Nominee.findById(this.nomineeId);
    
    if (!nominee) {
      return next(new Error('Nominee not found'));
    }
    
    if (!nominee.awardId.equals(this.awardId)) {
      return next(new Error('Nominee does not belong to the specified award'));
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// Static method to check for existing vote
voteSchema.statics.hasUserVotedForAward = async function(userId, awardId) {
  const existingVote = await this.findOne({ userId, awardId });
  return existingVote;
};

// Static method to get vote counts for an award
voteSchema.statics.getVoteCountsForAward = async function(awardId) {
  const counts = await this.aggregate([
    { $match: { awardId: new mongoose.Types.ObjectId(awardId) } },
    { $group: { _id: '$nomineeId', count: { $sum: 1 } } },
    { $lookup: { from: 'nominees', localField: '_id', foreignField: '_id', as: 'nominee' } },
    { $unwind: '$nominee' },
    { $project: { nomineeId: '$_id', nomineeName: '$nominee.name', count: 1, _id: 0 } }
  ]);
  return counts;
};

// Static method to get user's voting history
voteSchema.statics.getUserVotingHistory = async function(userId) {
  return this.find({ userId })
    .populate('award', 'title')
    .populate('nominee', 'name')
    .sort({ timestamp: -1 });
};

module.exports = mongoose.model('Vote', voteSchema);