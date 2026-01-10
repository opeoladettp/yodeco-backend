const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  // Unique identifier for this audit entry
  auditId: {
    type: String,
    required: true,
    unique: true
  },
  
  // Timestamp of the action
  timestamp: {
    type: Date,
    required: true,
    default: Date.now
  },
  
  // User who performed the action
  adminUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Target user (if applicable)
  targetUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  
  // Action performed
  action: {
    type: String,
    required: true,
    enum: [
      'USER_ROLE_PROMOTION',
      'USER_ROLE_DEMOTION',
      'USER_CREATION',
      'USER_DELETION',
      'CONTENT_CREATION',
      'CONTENT_MODIFICATION',
      'CONTENT_DELETION',
      'VOTE_CAST',
      'VOTE_DELETION',
      'SYSTEM_CONFIGURATION',
      'AUDIT_LOG_EXPORT',
      'LOGIN_ATTEMPT',
      'LOGOUT',
      'PASSWORD_RESET',
      'WEBAUTHN_REGISTRATION',
      'WEBAUTHN_AUTHENTICATION',
      'SECURITY_INCIDENT',
      'DATA_EXPORT',
      'DATA_IMPORT',
      'BACKUP_CREATED',
      'BACKUP_RESTORED'
    ]
  },
  
  // Detailed information about the action
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  // Security context
  ipAddress: {
    type: String,
    required: true
  },
  
  userAgent: {
    type: String,
    default: ''
  },
  
  sessionId: {
    type: String,
    default: null
  },
  
  requestId: {
    type: String,
    default: null
  },
  
  // Success/failure status
  success: {
    type: Boolean,
    required: true,
    default: true
  },
  
  // Error details if action failed
  errorDetails: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  
  // Hash chain for integrity verification
  previousHash: {
    type: String,
    default: null
  },
  
  currentHash: {
    type: String,
    required: true
  },
  
  // Sequence number for ordering
  sequenceNumber: {
    type: Number,
    required: true
  },
  
  // Additional metadata
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: false, // We manage timestamp manually
  collection: 'auditlogs'
});

// Indexes for efficient querying
auditLogSchema.index({ timestamp: -1 });
auditLogSchema.index({ adminUserId: 1, timestamp: -1 });
auditLogSchema.index({ targetUserId: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, timestamp: -1 });
auditLogSchema.index({ sequenceNumber: 1 }, { unique: true });

// Compound indexes for common queries
auditLogSchema.index({ adminUserId: 1, action: 1, timestamp: -1 });
auditLogSchema.index({ targetUserId: 1, action: 1, timestamp: -1 });

// Static method to get next sequence number
auditLogSchema.statics.getNextSequenceNumber = async function() {
  const lastEntry = await this.findOne().sort({ sequenceNumber: -1 });
  return lastEntry ? lastEntry.sequenceNumber + 1 : 1;
};

// Static method to get last hash for chaining
auditLogSchema.statics.getLastHash = async function() {
  const lastEntry = await this.findOne().sort({ sequenceNumber: -1 });
  return lastEntry ? lastEntry.currentHash : '0000000000000000000000000000000000000000000000000000000000000000';
};

// Method to calculate hash for this entry
auditLogSchema.methods.calculateHash = function() {
  const crypto = require('crypto');
  const data = {
    auditId: this.auditId,
    timestamp: this.timestamp.toISOString(),
    adminUserId: this.adminUserId.toString(),
    targetUserId: this.targetUserId ? this.targetUserId.toString() : null,
    action: this.action,
    details: JSON.stringify(this.details),
    success: this.success,
    sequenceNumber: this.sequenceNumber,
    previousHash: this.previousHash
  };
  
  const hashString = JSON.stringify(data);
  return crypto.createHash('sha256').update(hashString).digest('hex');
};

// Pre-save middleware to set sequence number and hash
auditLogSchema.pre('save', async function(next) {
  if (this.isNew) {
    try {
      // Set sequence number
      this.sequenceNumber = await this.constructor.getNextSequenceNumber();
      
      // Set previous hash
      this.previousHash = await this.constructor.getLastHash();
      
      // Calculate and set current hash
      this.currentHash = this.calculateHash();
      
      next();
    } catch (error) {
      console.error('Error in audit log pre-save middleware:', error);
      // Set default values if database operations fail
      this.sequenceNumber = Date.now(); // Use timestamp as fallback
      this.previousHash = '0000000000000000000000000000000000000000000000000000000000000000';
      this.currentHash = this.calculateHash();
      next();
    }
  } else {
    next();
  }
});

// Method to verify integrity of this entry
auditLogSchema.methods.verifyIntegrity = function() {
  const calculatedHash = this.calculateHash();
  return calculatedHash === this.currentHash;
};

// Static method to verify chain integrity
auditLogSchema.statics.verifyChainIntegrity = async function(startSequence = 1, endSequence = null) {
  const query = { sequenceNumber: { $gte: startSequence } };
  if (endSequence) {
    query.sequenceNumber.$lte = endSequence;
  }
  
  const entries = await this.find(query).sort({ sequenceNumber: 1 });
  
  const results = {
    totalEntries: entries.length,
    validEntries: 0,
    invalidEntries: 0,
    chainBreaks: 0,
    errors: []
  };
  
  let expectedPreviousHash = startSequence === 1 ? 
    '0000000000000000000000000000000000000000000000000000000000000000' : 
    null;
  
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    
    // Verify individual entry hash
    if (!entry.verifyIntegrity()) {
      results.invalidEntries++;
      results.errors.push({
        sequenceNumber: entry.sequenceNumber,
        auditId: entry.auditId,
        error: 'Hash verification failed'
      });
      continue;
    }
    
    // Verify chain continuity
    if (expectedPreviousHash !== null && entry.previousHash !== expectedPreviousHash) {
      results.chainBreaks++;
      results.errors.push({
        sequenceNumber: entry.sequenceNumber,
        auditId: entry.auditId,
        error: 'Chain break detected',
        expected: expectedPreviousHash,
        actual: entry.previousHash
      });
    }
    
    results.validEntries++;
    expectedPreviousHash = entry.currentHash;
  }
  
  results.integrityScore = results.totalEntries > 0 ? 
    (results.validEntries / results.totalEntries) * 100 : 100;
  
  return results;
};

module.exports = mongoose.model('AuditLog', auditLogSchema);