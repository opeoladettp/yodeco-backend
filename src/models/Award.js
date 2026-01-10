const mongoose = require('mongoose');

const awardSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Award title is required'],
    trim: true,
    maxlength: [150, 'Award title cannot exceed 150 characters']
  },
  criteria: {
    type: String,
    required: [true, 'Award criteria is required'],
    trim: true,
    maxlength: [1000, 'Award criteria cannot exceed 1000 characters']
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
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'Award must belong to a category']
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Award creator is required']
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
  votingStartDate: {
    type: Date,
    default: null
  },
  votingEndDate: {
    type: Date,
    default: null
  }
});

// Update the updatedAt field before saving
awardSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Validate voting dates
awardSchema.pre('save', function(next) {
  if (this.votingStartDate && this.votingEndDate) {
    if (this.votingStartDate >= this.votingEndDate) {
      return next(new Error('Voting start date must be before voting end date'));
    }
  }
  next();
});

// Create indexes for efficient queries
awardSchema.index({ categoryId: 1 });
awardSchema.index({ createdBy: 1 });
awardSchema.index({ isActive: 1 });
awardSchema.index({ votingStartDate: 1, votingEndDate: 1 });

// Virtual for getting nominees in this award
awardSchema.virtual('nominees', {
  ref: 'Nominee',
  localField: '_id',
  foreignField: 'awardId'
});

// Virtual for getting category details
awardSchema.virtual('category', {
  ref: 'Category',
  localField: 'categoryId',
  foreignField: '_id',
  justOne: true
});

// Ensure virtual fields are serialized
awardSchema.set('toJSON', { virtuals: true });
awardSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Award', awardSchema);