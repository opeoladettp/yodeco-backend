const mongoose = require('mongoose');

const voteBiasSchema = new mongoose.Schema({
  awardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Award',
    required: [true, 'Award ID is required']
  },
  nomineeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Nominee',
    required: [true, 'Nominee ID is required']
  },
  biasAmount: {
    type: Number,
    required: [true, 'Bias amount is required'],
    min: [0, 'Bias amount cannot be negative'],
    max: [10000, 'Bias amount cannot exceed 10,000']
  },
  reason: {
    type: String,
    required: [true, 'Reason for bias is required'],
    maxlength: [500, 'Reason cannot exceed 500 characters']
  },
  appliedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Applied by user ID is required']
  },
  appliedAt: {
    type: Date,
    default: Date.now,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true,
    required: true
  },
  deactivatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  deactivatedAt: {
    type: Date,
    required: false
  },
  deactivationReason: {
    type: String,
    maxlength: [500, 'Deactivation reason cannot exceed 500 characters'],
    required: false
  },
  metadata: {
    ipAddress: {
      type: String,
      required: false
    },
    userAgent: {
      type: String,
      required: false
    },
    sessionId: {
      type: String,
      required: false
    }
  }
});

// Create compound unique index to prevent duplicate ACTIVE bias entries per nominee per award
voteBiasSchema.index({ awardId: 1, nomineeId: 1, isActive: 1 }, { 
  unique: true,
  partialFilterExpression: { isActive: true }
});

// Additional indexes for efficient queries
voteBiasSchema.index({ awardId: 1, isActive: 1 });
voteBiasSchema.index({ nomineeId: 1, isActive: 1 });
voteBiasSchema.index({ appliedBy: 1, appliedAt: -1 });
voteBiasSchema.index({ appliedAt: -1 });

// Virtual for getting award details
voteBiasSchema.virtual('award', {
  ref: 'Award',
  localField: 'awardId',
  foreignField: '_id',
  justOne: true
});

// Virtual for getting nominee details
voteBiasSchema.virtual('nominee', {
  ref: 'Nominee',
  localField: 'nomineeId',
  foreignField: '_id',
  justOne: true
});

// Virtual for getting admin user details
voteBiasSchema.virtual('admin', {
  ref: 'User',
  localField: 'appliedBy',
  foreignField: '_id',
  justOne: true
});

// Ensure virtual fields are serialized
voteBiasSchema.set('toJSON', { virtuals: true });
voteBiasSchema.set('toObject', { virtuals: true });

// Pre-save validation to ensure nominee belongs to the award
voteBiasSchema.pre('save', async function(next) {
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

// Static method to get active bias for an award
voteBiasSchema.statics.getActiveBiasForAward = async function(awardId) {
  return this.find({ awardId, isActive: true })
    .populate('nominee', 'name')
    .populate('appliedBy', 'name email')
    .sort({ appliedAt: -1 });
};

// Static method to get bias for a specific nominee
voteBiasSchema.statics.getBiasForNominee = async function(awardId, nomineeId) {
  return this.findOne({ awardId, nomineeId, isActive: true });
};

// Static method to get total bias amount for a nominee
voteBiasSchema.statics.getTotalBiasForNominee = async function(awardId, nomineeId) {
  const bias = await this.findOne({ awardId, nomineeId, isActive: true });
  return bias ? bias.biasAmount : 0;
};

// Static method to get all bias entries with admin details
voteBiasSchema.statics.getAllBiasWithDetails = async function(filter = {}) {
  const query = { ...filter };
  if (query.isActive === undefined) {
    query.isActive = true; // Default to active bias entries
  }
  
  return this.find(query)
    .populate('award', 'title')
    .populate('nominee', 'name')
    .populate('appliedBy', 'name email role')
    .sort({ appliedAt: -1 });
};

// Instance method to deactivate bias
voteBiasSchema.methods.deactivate = async function(deactivatedBy, reason) {
  this.isActive = false;
  this.deactivatedBy = deactivatedBy;
  this.deactivatedAt = new Date();
  this.deactivationReason = reason;
  return this.save();
};

// Instance method to get audit trail
voteBiasSchema.methods.getAuditTrail = function() {
  return {
    biasId: this._id,
    awardId: this.awardId,
    nomineeId: this.nomineeId,
    biasAmount: this.biasAmount,
    reason: this.reason,
    appliedBy: this.appliedBy,
    appliedAt: this.appliedAt,
    isActive: this.isActive,
    metadata: this.metadata
  };
};

module.exports = mongoose.model('VoteBias', voteBiasSchema);