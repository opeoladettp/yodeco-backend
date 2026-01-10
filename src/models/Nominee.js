const mongoose = require('mongoose');

const nomineeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Nominee name is required'],
    trim: true,
    maxlength: [100, 'Nominee name cannot exceed 100 characters']
  },
  bio: {
    type: String,
    required: [true, 'Nominee biography is required'],
    trim: true,
    maxlength: [2000, 'Nominee biography cannot exceed 2000 characters']
  },
  imageUrl: {
    type: String,
    default: null,
    trim: true,
    validate: {
      validator: function(v) {
        // If imageUrl is provided, it should be a valid S3 key format or URL
        if (!v) return true;
        return /^[a-zA-Z0-9\-_\/\.]+$/.test(v) || /^https?:\/\/.+/.test(v);
      },
      message: 'Invalid image URL format'
    }
  },
  awardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Award',
    required: [true, 'Nominee must belong to an award']
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Nominee creator is required']
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  },
  displayOrder: {
    type: Number,
    default: 0
  }
});

// Update the updatedAt field before saving
nomineeSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Create indexes for efficient queries
nomineeSchema.index({ awardId: 1 });
nomineeSchema.index({ createdBy: 1 });
nomineeSchema.index({ isActive: 1 });
nomineeSchema.index({ awardId: 1, displayOrder: 1 });

// Virtual for getting award details
nomineeSchema.virtual('award', {
  ref: 'Award',
  localField: 'awardId',
  foreignField: '_id',
  justOne: true
});

// Virtual for getting vote count (will be populated by aggregation)
nomineeSchema.virtual('voteCount', {
  ref: 'Vote',
  localField: '_id',
  foreignField: 'nomineeId',
  count: true
});

// Ensure virtual fields are serialized
nomineeSchema.set('toJSON', { virtuals: true });
nomineeSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Nominee', nomineeSchema);