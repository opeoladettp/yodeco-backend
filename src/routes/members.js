const express = require('express');
const router = express.Router();
const Member = require('../models/Member');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate, schemas } = require('../middleware/validation');
const securityLogger = require('../utils/securityLogger');
const auditService = require('../services/auditService');
const multer = require('multer');
const { s3Client, bucketName } = require('../config/aws');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and JPG images are allowed'), false);
    }
  }
});

// Helper function to upload profile picture
async function uploadProfilePicture(file) {
  const fileExtension = path.extname(file.originalname);
  const fileName = `members/profiles/${Date.now()}-${Math.random().toString(36).substring(7)}${fileExtension}`;
  
  const uploadCommand = new PutObjectCommand({
    Bucket: bucketName,
    Key: fileName,
    Body: file.buffer,
    ContentType: file.mimetype
    // Removed ACL: 'public-read' as it's not supported by the bucket
  });
  
  await s3Client.send(uploadCommand);
  
  return {
    url: `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`,
    key: fileName,
    uploadedAt: new Date()
  };
}

// Helper function to delete profile picture
async function deleteProfilePicture(key) {
  if (!key) return;
  
  const deleteCommand = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: key
  });
  
  await s3Client.send(deleteCommand);
}

/**
 * POST /api/members/register - Public member registration
 */
router.post('/register', upload.single('profilePicture'), async (req, res) => {
  try {
    const { firstName, lastName, otherNames, email, phoneNumber, dateOfBirth } = req.body;
    const securityContext = securityLogger.createSecurityContext(req);
    
    // Validate required fields
    if (!firstName || !lastName || !email || !phoneNumber || !dateOfBirth) {
      return res.status(400).json({
        error: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'firstName, lastName, email, phoneNumber, and dateOfBirth are required',
          retryable: false
        }
      });
    }
    
    // Check if email already exists
    const existingMember = await Member.findOne({ email: email.toLowerCase() });
    if (existingMember) {
      return res.status(409).json({
        error: {
          code: 'EMAIL_ALREADY_EXISTS',
          message: 'A member with this email address already exists',
          retryable: false
        }
      });
    }
    
    // Handle profile picture upload
    let profilePicture = { url: '', key: '', uploadedAt: null };
    if (req.file) {
      try {
        profilePicture = await uploadProfilePicture(req.file);
      } catch (uploadError) {
        console.error('Profile picture upload failed:', uploadError);
        // Continue without profile picture
      }
    }
    
    // Create new member
    const memberData = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      otherNames: otherNames ? otherNames.trim() : '',
      email: email.toLowerCase().trim(),
      phoneNumber: phoneNumber.trim(),
      dateOfBirth: new Date(dateOfBirth),
      profilePicture,
      metadata: {
        ipAddress: securityContext.ipAddress,
        userAgent: securityContext.userAgent,
        registrationSource: 'web'
      }
    };
    
    const member = new Member(memberData);
    await member.save();
    
    // Log the registration
    await auditService.createAuditEntry({
      adminUserId: null,
      targetUserId: null,
      action: 'MEMBER_REGISTRATION',
      details: {
        memberId: member._id,
        registrationNumber: member.registrationNumber,
        email: member.email,
        fullName: member.fullName
      },
      ipAddress: securityContext.ipAddress,
      userAgent: securityContext.userAgent,
      success: true
    });
    
    res.status(201).json({
      message: 'Member registration successful',
      member: {
        id: member._id,
        registrationNumber: member.registrationNumber,
        firstName: member.firstName,
        lastName: member.lastName,
        otherNames: member.otherNames,
        email: member.email,
        phoneNumber: member.phoneNumber,
        dateOfBirth: member.dateOfBirth,
        age: member.age,
        fullName: member.fullName,
        profilePicture: member.profilePicture,
        createdAt: member.createdAt
      }
    });
    
  } catch (error) {
    console.error('Member registration error:', error);
    
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(409).json({
        error: {
          code: 'DUPLICATE_FIELD',
          message: `A member with this ${field} already exists`,
          retryable: false
        }
      });
    }
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: messages.join(', '),
          retryable: false
        }
      });
    }
    
    res.status(500).json({
      error: {
        code: 'REGISTRATION_ERROR',
        message: 'Failed to register member',
        retryable: true
      }
    });
  }
});

/**
 * GET /api/members/profile/:id - Get member profile (public access for member's own profile)
 */
router.get('/profile/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ID format
    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_MEMBER_ID',
          message: 'Invalid member ID format',
          retryable: false
        }
      });
    }
    
    const member = await Member.findOne({ _id: id, isActive: true });
    
    if (!member) {
      return res.status(404).json({
        error: {
          code: 'MEMBER_NOT_FOUND',
          message: 'Member not found',
          retryable: false
        }
      });
    }
    
    res.json({
      member: {
        id: member._id,
        registrationNumber: member.registrationNumber,
        firstName: member.firstName,
        lastName: member.lastName,
        otherNames: member.otherNames,
        email: member.email,
        phoneNumber: member.phoneNumber,
        dateOfBirth: member.dateOfBirth,
        age: member.age,
        fullName: member.fullName,
        profilePicture: member.profilePicture,
        createdAt: member.createdAt,
        updatedAt: member.updatedAt
      }
    });
    
  } catch (error) {
    console.error('Get member profile error:', error);
    res.status(500).json({
      error: {
        code: 'PROFILE_FETCH_ERROR',
        message: 'Failed to fetch member profile',
        retryable: true
      }
    });
  }
});

/**
 * PUT /api/members/profile/:id - Update member profile
 */
router.put('/profile/:id', upload.single('profilePicture'), async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, otherNames, email, phoneNumber, dateOfBirth } = req.body;
    
    // Validate ID format
    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_MEMBER_ID',
          message: 'Invalid member ID format',
          retryable: false
        }
      });
    }
    
    const member = await Member.findOne({ _id: id, isActive: true });
    
    if (!member) {
      return res.status(404).json({
        error: {
          code: 'MEMBER_NOT_FOUND',
          message: 'Member not found',
          retryable: false
        }
      });
    }
    
    // Check if email is being changed and if it already exists
    if (email && email.toLowerCase() !== member.email) {
      const existingMember = await Member.findOne({ 
        email: email.toLowerCase(),
        _id: { $ne: id }
      });
      
      if (existingMember) {
        return res.status(409).json({
          error: {
            code: 'EMAIL_ALREADY_EXISTS',
            message: 'A member with this email address already exists',
            retryable: false
          }
        });
      }
    }
    
    // Handle profile picture upload
    let profilePictureUpdate = {};
    if (req.file) {
      try {
        // Delete old profile picture if exists
        if (member.profilePicture.key) {
          await deleteProfilePicture(member.profilePicture.key);
        }
        
        // Upload new profile picture
        profilePictureUpdate = await uploadProfilePicture(req.file);
      } catch (uploadError) {
        console.error('Profile picture upload failed:', uploadError);
        return res.status(500).json({
          error: {
            code: 'UPLOAD_ERROR',
            message: 'Failed to upload profile picture',
            retryable: true
          }
        });
      }
    }
    
    // Prepare update data
    const updateData = {};
    if (firstName) updateData.firstName = firstName.trim();
    if (lastName) updateData.lastName = lastName.trim();
    if (otherNames !== undefined) updateData.otherNames = otherNames.trim();
    if (email) updateData.email = email.toLowerCase().trim();
    if (phoneNumber) updateData.phoneNumber = phoneNumber.trim();
    if (dateOfBirth) updateData.dateOfBirth = new Date(dateOfBirth);
    if (Object.keys(profilePictureUpdate).length > 0) {
      updateData.profilePicture = profilePictureUpdate;
    }
    
    // Update member
    await member.updateProfile(updateData);
    
    res.json({
      message: 'Profile updated successfully',
      member: {
        id: member._id,
        registrationNumber: member.registrationNumber,
        firstName: member.firstName,
        lastName: member.lastName,
        otherNames: member.otherNames,
        email: member.email,
        phoneNumber: member.phoneNumber,
        dateOfBirth: member.dateOfBirth,
        age: member.age,
        fullName: member.fullName,
        profilePicture: member.profilePicture,
        createdAt: member.createdAt,
        updatedAt: member.updatedAt
      }
    });
    
  } catch (error) {
    console.error('Update member profile error:', error);
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: messages.join(', '),
          retryable: false
        }
      });
    }
    
    res.status(500).json({
      error: {
        code: 'PROFILE_UPDATE_ERROR',
        message: 'Failed to update member profile',
        retryable: true
      }
    });
  }
});

/**
 * GET /api/members - Get all members (Admin only)
 */
router.get('/', authenticate, requirePermission('system:admin'), async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      includeInactive = 'false',
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;
    
    const skip = (page - 1) * limit;
    
    // Build filter
    let filter = {};
    
    if (includeInactive !== 'true') {
      filter.isActive = true;
    }
    
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { otherNames: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { registrationNumber: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Build sort object
    const sortObj = {};
    const validSortFields = ['createdAt', 'firstName', 'lastName', 'email', 'registrationNumber'];
    if (validSortFields.includes(sortBy)) {
      sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;
    } else {
      sortObj.createdAt = -1;
    }
    
    const members = await Member.find(filter)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .populate('deletedBy', 'name email')
      .sort(sortObj)
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await Member.countDocuments(filter);
    
    res.json({
      members: members.map(member => ({
        id: member._id,
        registrationNumber: member.registrationNumber,
        firstName: member.firstName,
        lastName: member.lastName,
        otherNames: member.otherNames,
        email: member.email,
        phoneNumber: member.phoneNumber,
        dateOfBirth: member.dateOfBirth,
        age: member.age,
        fullName: member.fullName,
        profilePicture: member.profilePicture,
        isActive: member.isActive,
        createdAt: member.createdAt,
        updatedAt: member.updatedAt,
        deletedAt: member.deletedAt,
        deletedBy: member.deletedBy,
        deletionReason: member.deletionReason
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
    
  } catch (error) {
    console.error('Get members error:', error);
    res.status(500).json({
      error: {
        code: 'MEMBERS_FETCH_ERROR',
        message: 'Failed to fetch members',
        retryable: true
      }
    });
  }
});

/**
 * GET /api/members/:id - Get member by ID (Admin only)
 */
router.get('/:id', authenticate, requirePermission('system:admin'), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Validate ID format
    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_MEMBER_ID',
          message: 'Invalid member ID format',
          retryable: false
        }
      });
    }
    
    const member = await Member.findById(id)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .populate('deletedBy', 'name email');
    
    if (!member) {
      return res.status(404).json({
        error: {
          code: 'MEMBER_NOT_FOUND',
          message: 'Member not found',
          retryable: false
        }
      });
    }
    
    res.json({
      member: {
        id: member._id,
        registrationNumber: member.registrationNumber,
        firstName: member.firstName,
        lastName: member.lastName,
        otherNames: member.otherNames,
        email: member.email,
        phoneNumber: member.phoneNumber,
        dateOfBirth: member.dateOfBirth,
        age: member.age,
        fullName: member.fullName,
        profilePicture: member.profilePicture,
        isActive: member.isActive,
        createdAt: member.createdAt,
        updatedAt: member.updatedAt,
        deletedAt: member.deletedAt,
        deletedBy: member.deletedBy,
        deletionReason: member.deletionReason,
        createdBy: member.createdBy,
        updatedBy: member.updatedBy,
        metadata: member.metadata
      }
    });
    
  } catch (error) {
    console.error('Get member by ID error:', error);
    res.status(500).json({
      error: {
        code: 'MEMBER_FETCH_ERROR',
        message: 'Failed to fetch member',
        retryable: true
      }
    });
  }
});

/**
 * PUT /api/members/:id - Update member (Admin only)
 */
router.put('/:id', authenticate, requirePermission('system:admin'), upload.single('profilePicture'), async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, otherNames, email, phoneNumber, dateOfBirth } = req.body;
    const securityContext = securityLogger.createSecurityContext(req);
    
    // Validate ID format
    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_MEMBER_ID',
          message: 'Invalid member ID format',
          retryable: false
        }
      });
    }
    
    const member = await Member.findById(id);
    
    if (!member) {
      return res.status(404).json({
        error: {
          code: 'MEMBER_NOT_FOUND',
          message: 'Member not found',
          retryable: false
        }
      });
    }
    
    // Check if email is being changed and if it already exists
    if (email && email.toLowerCase() !== member.email) {
      const existingMember = await Member.findOne({ 
        email: email.toLowerCase(),
        _id: { $ne: id }
      });
      
      if (existingMember) {
        return res.status(409).json({
          error: {
            code: 'EMAIL_ALREADY_EXISTS',
            message: 'A member with this email address already exists',
            retryable: false
          }
        });
      }
    }
    
    // Handle profile picture upload
    let profilePictureUpdate = {};
    if (req.file) {
      try {
        // Delete old profile picture if exists
        if (member.profilePicture.key) {
          await deleteProfilePicture(member.profilePicture.key);
        }
        
        // Upload new profile picture
        profilePictureUpdate = await uploadProfilePicture(req.file);
      } catch (uploadError) {
        console.error('Profile picture upload failed:', uploadError);
        return res.status(500).json({
          error: {
            code: 'UPLOAD_ERROR',
            message: 'Failed to upload profile picture',
            retryable: true
          }
        });
      }
    }
    
    // Prepare update data
    const updateData = {};
    if (firstName) updateData.firstName = firstName.trim();
    if (lastName) updateData.lastName = lastName.trim();
    if (otherNames !== undefined) updateData.otherNames = otherNames.trim();
    if (email) updateData.email = email.toLowerCase().trim();
    if (phoneNumber) updateData.phoneNumber = phoneNumber.trim();
    if (dateOfBirth) updateData.dateOfBirth = new Date(dateOfBirth);
    if (Object.keys(profilePictureUpdate).length > 0) {
      updateData.profilePicture = profilePictureUpdate;
    }
    
    // Update member
    await member.updateProfile(updateData, req.user._id);
    
    // Log the update
    await auditService.createAuditEntry({
      adminUserId: req.user._id.toString(),
      targetUserId: null,
      action: 'MEMBER_UPDATE',
      details: {
        memberId: member._id,
        registrationNumber: member.registrationNumber,
        updatedFields: Object.keys(updateData)
      },
      ipAddress: securityContext.ipAddress,
      userAgent: securityContext.userAgent,
      success: true
    });
    
    res.json({
      message: 'Member updated successfully',
      member: {
        id: member._id,
        registrationNumber: member.registrationNumber,
        firstName: member.firstName,
        lastName: member.lastName,
        otherNames: member.otherNames,
        email: member.email,
        phoneNumber: member.phoneNumber,
        dateOfBirth: member.dateOfBirth,
        age: member.age,
        fullName: member.fullName,
        profilePicture: member.profilePicture,
        isActive: member.isActive,
        createdAt: member.createdAt,
        updatedAt: member.updatedAt
      }
    });
    
  } catch (error) {
    console.error('Update member error:', error);
    
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: messages.join(', '),
          retryable: false
        }
      });
    }
    
    res.status(500).json({
      error: {
        code: 'MEMBER_UPDATE_ERROR',
        message: 'Failed to update member',
        retryable: true
      }
    });
  }
});

/**
 * DELETE /api/members/:id - Soft delete member (Admin only)
 */
router.delete('/:id', authenticate, requirePermission('system:admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason = 'Deleted by admin' } = req.body;
    const securityContext = securityLogger.createSecurityContext(req);
    
    // Validate ID format
    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_MEMBER_ID',
          message: 'Invalid member ID format',
          retryable: false
        }
      });
    }
    
    const member = await Member.findById(id);
    
    if (!member) {
      return res.status(404).json({
        error: {
          code: 'MEMBER_NOT_FOUND',
          message: 'Member not found',
          retryable: false
        }
      });
    }
    
    if (!member.isActive) {
      return res.status(400).json({
        error: {
          code: 'MEMBER_ALREADY_DELETED',
          message: 'Member is already deleted',
          retryable: false
        }
      });
    }
    
    // Soft delete member
    await member.softDelete(req.user._id, reason);
    
    // Log the deletion
    await auditService.createAuditEntry({
      adminUserId: req.user._id.toString(),
      targetUserId: null,
      action: 'MEMBER_DELETION',
      details: {
        memberId: member._id,
        registrationNumber: member.registrationNumber,
        fullName: member.fullName,
        reason
      },
      ipAddress: securityContext.ipAddress,
      userAgent: securityContext.userAgent,
      success: true
    });
    
    res.json({
      message: 'Member deleted successfully',
      member: {
        id: member._id,
        registrationNumber: member.registrationNumber,
        fullName: member.fullName,
        isActive: member.isActive,
        deletedAt: member.deletedAt,
        deletionReason: member.deletionReason
      }
    });
    
  } catch (error) {
    console.error('Delete member error:', error);
    res.status(500).json({
      error: {
        code: 'MEMBER_DELETION_ERROR',
        message: 'Failed to delete member',
        retryable: true
      }
    });
  }
});

/**
 * POST /api/members/:id/restore - Restore deleted member (Admin only)
 */
router.post('/:id/restore', authenticate, requirePermission('system:admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const securityContext = securityLogger.createSecurityContext(req);
    
    // Validate ID format
    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_MEMBER_ID',
          message: 'Invalid member ID format',
          retryable: false
        }
      });
    }
    
    const member = await Member.findById(id);
    
    if (!member) {
      return res.status(404).json({
        error: {
          code: 'MEMBER_NOT_FOUND',
          message: 'Member not found',
          retryable: false
        }
      });
    }
    
    if (member.isActive) {
      return res.status(400).json({
        error: {
          code: 'MEMBER_NOT_DELETED',
          message: 'Member is not deleted',
          retryable: false
        }
      });
    }
    
    // Restore member
    await member.restore();
    
    // Log the restoration
    await auditService.createAuditEntry({
      adminUserId: req.user._id.toString(),
      targetUserId: null,
      action: 'MEMBER_RESTORATION',
      details: {
        memberId: member._id,
        registrationNumber: member.registrationNumber,
        fullName: member.fullName
      },
      ipAddress: securityContext.ipAddress,
      userAgent: securityContext.userAgent,
      success: true
    });
    
    res.json({
      message: 'Member restored successfully',
      member: {
        id: member._id,
        registrationNumber: member.registrationNumber,
        fullName: member.fullName,
        isActive: member.isActive
      }
    });
    
  } catch (error) {
    console.error('Restore member error:', error);
    res.status(500).json({
      error: {
        code: 'MEMBER_RESTORATION_ERROR',
        message: 'Failed to restore member',
        retryable: true
      }
    });
  }
});

module.exports = router;