const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema({
  // Unique YODECO Registration Number
  registrationNumber: {
    type: String,
    unique: true,
    index: true
  },
  
  // Personal Information
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    maxlength: [50, 'First name cannot exceed 50 characters']
  },
  
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
    maxlength: [50, 'Last name cannot exceed 50 characters']
  },
  
  otherNames: {
    type: String,
    trim: true,
    maxlength: [100, 'Other names cannot exceed 100 characters'],
    default: ''
  },
  
  // Contact Information
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  
  phoneNumber: {
    type: String,
    required: [true, 'Phone number is required'],
    trim: true,
    match: [/^[\+]?[1-9][\d]{0,15}$/, 'Please enter a valid phone number']
  },
  
  // Personal Details
  dateOfBirth: {
    type: Date,
    required: [true, 'Date of birth is required'],
    validate: {
      validator: function(value) {
        const today = new Date();
        const age = today.getFullYear() - value.getFullYear();
        return age >= 16 && age <= 120; // Reasonable age range
      },
      message: 'Age must be between 16 and 120 years'
    }
  },
  
  // Profile Picture
  profilePicture: {
    url: {
      type: String,
      default: ''
    },
    key: {
      type: String,
      default: ''
    },
    uploadedAt: {
      type: Date,
      default: null
    }
  },
  
  // Registration Status
  isActive: {
    type: Boolean,
    default: true,
    required: true
  },
  
  // Soft Delete Fields
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  
  deletedAt: {
    type: Date,
    default: null
  },
  
  deletionReason: {
    type: String,
    maxlength: [500, 'Deletion reason cannot exceed 500 characters'],
    default: ''
  },
  
  // Audit Fields
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  
  // Metadata
  metadata: {
    ipAddress: {
      type: String,
      default: ''
    },
    userAgent: {
      type: String,
      default: ''
    },
    registrationSource: {
      type: String,
      enum: ['web', 'admin', 'import'],
      default: 'web'
    }
  }
}, {
  timestamps: true,
  collection: 'members'
});

// Indexes for efficient queries
memberSchema.index({ phoneNumber: 1 });
memberSchema.index({ isActive: 1, createdAt: -1 });
memberSchema.index({ firstName: 1, lastName: 1 });
memberSchema.index({ createdAt: -1 });

// Virtual for full name
memberSchema.virtual('fullName').get(function() {
  const names = [this.firstName, this.otherNames, this.lastName].filter(name => name && name.trim());
  return names.join(' ');
});

// Virtual for age
memberSchema.virtual('age').get(function() {
  if (!this.dateOfBirth) return null;
  const today = new Date();
  const birthDate = new Date(this.dateOfBirth);
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  
  return age;
});

// Ensure virtual fields are serialized
memberSchema.set('toJSON', { virtuals: true });
memberSchema.set('toObject', { virtuals: true });

// Pre-save middleware to generate registration number
memberSchema.pre('save', async function(next) {
  if (this.isNew && !this.registrationNumber) {
    try {
      this.registrationNumber = await this.constructor.generateRegistrationNumber();
    } catch (error) {
      return next(error);
    }
  }
  next();
});

// Static method to generate unique registration number
memberSchema.statics.generateRegistrationNumber = async function() {
  const currentYear = new Date().getFullYear();
  const prefix = `YODECO${currentYear}`;
  
  // Find the highest existing number for this year
  const lastMember = await this.findOne({
    registrationNumber: { $regex: `^${prefix}` }
  }).sort({ registrationNumber: -1 });
  
  let nextNumber = 1;
  if (lastMember) {
    const lastNumber = parseInt(lastMember.registrationNumber.replace(prefix, ''));
    nextNumber = lastNumber + 1;
  }
  
  // Format: YODECO2026001, YODECO2026002, etc.
  return `${prefix}${nextNumber.toString().padStart(3, '0')}`;
};

// Static method to get active members
memberSchema.statics.getActiveMembers = function(filter = {}) {
  return this.find({ ...filter, isActive: true }).sort({ createdAt: -1 });
};

// Static method to search members
memberSchema.statics.searchMembers = function(searchTerm, includeInactive = false) {
  const filter = {
    $or: [
      { firstName: { $regex: searchTerm, $options: 'i' } },
      { lastName: { $regex: searchTerm, $options: 'i' } },
      { otherNames: { $regex: searchTerm, $options: 'i' } },
      { email: { $regex: searchTerm, $options: 'i' } },
      { registrationNumber: { $regex: searchTerm, $options: 'i' } }
    ]
  };
  
  if (!includeInactive) {
    filter.isActive = true;
  }
  
  return this.find(filter).sort({ createdAt: -1 });
};

// Instance method to soft delete
memberSchema.methods.softDelete = function(deletedBy, reason = '') {
  this.isActive = false;
  this.deletedBy = deletedBy;
  this.deletedAt = new Date();
  this.deletionReason = reason;
  return this.save();
};

// Instance method to restore
memberSchema.methods.restore = function() {
  this.isActive = true;
  this.deletedBy = null;
  this.deletedAt = null;
  this.deletionReason = '';
  return this.save();
};

// Instance method to update profile
memberSchema.methods.updateProfile = function(updateData, updatedBy = null) {
  const allowedFields = [
    'firstName', 'lastName', 'otherNames', 'email', 
    'phoneNumber', 'dateOfBirth', 'profilePicture'
  ];
  
  allowedFields.forEach(field => {
    if (updateData[field] !== undefined) {
      this[field] = updateData[field];
    }
  });
  
  if (updatedBy) {
    this.updatedBy = updatedBy;
  }
  
  return this.save();
};

module.exports = mongoose.model('Member', memberSchema);