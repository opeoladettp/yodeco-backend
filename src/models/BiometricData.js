const mongoose = require('mongoose');

const biometricDataSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  awardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Award',
    required: true
  },
  faceSignature: {
    data: {
      type: [Number],
      required: true
    },
    timestamp: {
      type: Date,
      required: true
    },
    version: {
      type: String,
      required: true,
      default: '1.0'
    }
  },
  biometricHash: {
    type: String,
    required: true
  },
  confidence: {
    type: Number,
    required: true,
    min: 0,
    max: 1
  },
  faceQuality: {
    faceDetected: {
      type: Boolean,
      required: true
    },
    confidence: {
      type: Number,
      required: true
    },
    isGoodQuality: {
      type: Boolean,
      required: true
    },
    issues: [{
      type: String
    }]
  },
  metadata: {
    ipAddress: String,
    userAgent: String,
    deviceInfo: String,
    verificationSource: {
      type: String,
      enum: ['web', 'mobile'],
      default: 'web'
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for efficient querying
biometricDataSchema.index({ userId: 1, awardId: 1 });
biometricDataSchema.index({ awardId: 1, isActive: 1 });
biometricDataSchema.index({ createdAt: -1 });

// Compound index for duplicate checking
biometricDataSchema.index({ 
  awardId: 1, 
  isActive: 1, 
  'faceSignature.timestamp': -1 
});

// Update the updatedAt field on save
biometricDataSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Instance method to compare face signatures
biometricDataSchema.methods.compareFaceSignature = function(otherSignature, threshold = 0.6) {
  if (!this.faceSignature.data || !otherSignature.data) {
    return { match: false, distance: 1 };
  }

  // Calculate Euclidean distance between face descriptors
  const descriptor1 = this.faceSignature.data;
  const descriptor2 = otherSignature.data;
  
  if (descriptor1.length !== descriptor2.length) {
    return { match: false, distance: 1 };
  }

  let sumSquaredDifferences = 0;
  for (let i = 0; i < descriptor1.length; i++) {
    const diff = descriptor1[i] - descriptor2[i];
    sumSquaredDifferences += diff * diff;
  }
  
  const distance = Math.sqrt(sumSquaredDifferences);
  const match = distance < threshold;

  return {
    match,
    distance,
    confidence: Math.max(0, 1 - distance)
  };
};

// Static method to find potential duplicates
biometricDataSchema.statics.findPotentialDuplicates = async function(faceSignature, awardId, excludeUserId = null, threshold = 0.6) {
  const query = {
    awardId,
    isActive: true
  };
  
  if (excludeUserId) {
    query.userId = { $ne: excludeUserId };
  }

  const existingData = await this.find(query)
    .populate('userId', 'name email')
    .sort({ createdAt: -1 });

  const matches = [];
  
  for (const data of existingData) {
    const comparison = data.compareFaceSignature(faceSignature, threshold);
    if (comparison.match) {
      matches.push({
        biometricId: data._id,
        userId: data.userId._id,
        userName: data.userId.name,
        userEmail: data.userId.email,
        confidence: comparison.confidence,
        distance: comparison.distance,
        timestamp: data.createdAt,
        originalConfidence: data.confidence
      });
    }
  }

  // Sort by confidence (highest first)
  matches.sort((a, b) => b.confidence - a.confidence);

  return matches;
};

// Static method to clean up old biometric data (for privacy)
biometricDataSchema.statics.cleanupOldData = async function(daysOld = 30) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  
  const result = await this.updateMany(
    { 
      createdAt: { $lt: cutoffDate },
      isActive: true 
    },
    { 
      isActive: false,
      updatedAt: new Date()
    }
  );
  
  return result;
};

// Virtual for formatted creation date
biometricDataSchema.virtual('formattedCreatedAt').get(function() {
  return this.createdAt.toLocaleString();
});

// Ensure virtual fields are serialized
biometricDataSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    delete ret.__v;
    return ret;
  }
});

const BiometricData = mongoose.model('BiometricData', biometricDataSchema);

module.exports = BiometricData;