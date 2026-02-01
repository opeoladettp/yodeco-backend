const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { validate, schemas } = require('../middleware/validation');
const { contentIdempotency } = require('../middleware/idempotency');
const { Category, Award, Nominee } = require('../models');
const BiometricData = require('../models/BiometricData');
const mediaService = require('../services/mediaService');
const securityLogger = require('../utils/securityLogger');

// Helper function to generate slug from name
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
};

// Helper function to process image URLs
const processImageUrl = async (imageUrl, options = {}) => {
  if (!imageUrl) return null;
  
  // If it's already a full URL, return as is
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl;
  }
  
  // For S3 object keys, return the media download route URL
  // This will generate presigned URLs when accessed
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const apiUrl = baseUrl.replace(':3000', ':5000') + '/api';
  return `${apiUrl}/media/download/${imageUrl}`;
};

// Helper function to validate image exists in S3
const validateImageExists = async (imageUrl) => {
  if (!imageUrl) return true; // Optional field
  
  // If it's a full URL, assume it's valid (external image)
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return true;
  }
  
  // If it's an S3 object key, verify it exists
  try {
    return await mediaService.verifyObjectExists(imageUrl);
  } catch (error) {
    console.warn('Failed to verify image exists:', imageUrl, error.message);
    return false;
  }
};

// ===== CATEGORY ROUTES =====

// GET /api/content/categories - Get all categories (public)
router.get('/categories', async (req, res) => {
  try {
    const { page = 1, limit = 10, includeInactive = false, include } = req.query;
    const skip = (page - 1) * limit;
    
    const filter = includeInactive ? {} : { isActive: true };
    
    // Parse include parameter
    const includeOptions = include ? include.split(',').map(opt => opt.trim()) : [];
    const includeAwards = includeOptions.includes('awards');
    const includeNominees = includeOptions.includes('nominees');
    
    let query = Category.find(filter)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    // Add awards population if requested
    if (includeAwards) {
      const awardsPopulate = {
        path: 'awards',
        match: { isActive: true },
        select: 'title criteria isActive allowPublicNomination nominationStartDate nominationEndDate votingStartDate votingEndDate'
      };
      
      // Add nominees to awards if requested
      if (includeNominees) {
        awardsPopulate.populate = {
          path: 'nominees',
          match: { isActive: true, approvalStatus: 'approved' },
          select: 'name bio imageUrl displayOrder',
          options: { sort: { displayOrder: 1, name: 1 } }
        };
      }
      
      query = query.populate(awardsPopulate);
    }
    
    const categories = await query;
    
    // Process image URLs for nominees if included
    if (includeNominees) {
      for (const category of categories) {
        if (category.awards) {
          for (const award of category.awards) {
            if (award.nominees) {
              for (const nominee of award.nominees) {
                if (nominee.imageUrl) {
                  nominee.imageUrl = await processImageUrl(nominee.imageUrl);
                }
              }
            }
          }
        }
      }
    }
    
    const total = await Category.countDocuments(filter);
    
    res.json({
      categories,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_CATEGORIES_ERROR',
        message: 'Failed to fetch categories',
        retryable: true
      }
    });
  }
});

// GET /api/content/categories/:id - Get category by ID (public)
router.get('/categories/:id', async (req, res) => {
  try {
    const category = await Category.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate({
        path: 'awards',
        match: { isActive: true },
        select: 'title criteria isActive allowPublicNomination nominationStartDate nominationEndDate votingStartDate votingEndDate',
        populate: {
          path: 'nominees',
          match: { isActive: true, approvalStatus: 'approved' },
          select: 'name bio imageUrl displayOrder'
        }
      });
    
    if (!category) {
      return res.status(404).json({
        error: {
          code: 'CATEGORY_NOT_FOUND',
          message: 'Category not found',
          retryable: false
        }
      });
    }
    
    res.json({ category });
  } catch (error) {
    console.error('Error fetching category:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_CATEGORY_ERROR',
        message: 'Failed to fetch category',
        retryable: true
      }
    });
  }
});

// POST /api/content/categories - Create category (panelist only)
router.post('/categories', 
  contentIdempotency,
  authenticate,
  requirePermission('content:create'),
  validate(schemas.categoryCreation),
  async (req, res) => {
    try {
      const { name, description, slug } = req.body;
      
      // Generate slug if not provided
      const finalSlug = slug || generateSlug(name);
      
      // Check if slug already exists
      const existingCategory = await Category.findOne({ slug: finalSlug });
      if (existingCategory) {
        return res.status(409).json({
          error: {
            code: 'SLUG_EXISTS',
            message: 'A category with this slug already exists',
            details: { slug: finalSlug },
            retryable: false
          }
        });
      }
      
      const category = new Category({
        name,
        description,
        slug: finalSlug,
        createdBy: req.user._id
      });
      
      await category.save();
      await category.populate('createdBy', 'name email');
      
      res.status(201).json({ category });
    } catch (error) {
      console.error('Error creating category:', error);
      
      if (error.code === 11000) {
        return res.status(409).json({
          error: {
            code: 'DUPLICATE_CATEGORY',
            message: 'Category with this slug already exists',
            retryable: false
          }
        });
      }
      
      res.status(500).json({
        error: {
          code: 'CREATE_CATEGORY_ERROR',
          message: 'Failed to create category',
          retryable: true
        }
      });
    }
  }
);

// PUT /api/content/categories/:id - Update category (panelist only)
router.put('/categories/:id',
  contentIdempotency,
  authenticate,
  requirePermission('content:update'),
  validate(schemas.categoryCreation),
  async (req, res) => {
    try {
      const { name, description, slug } = req.body;
      const finalSlug = slug || generateSlug(name);
      
      // Check if slug already exists (excluding current category)
      const existingCategory = await Category.findOne({ 
        slug: finalSlug, 
        _id: { $ne: req.params.id } 
      });
      
      if (existingCategory) {
        return res.status(409).json({
          error: {
            code: 'SLUG_EXISTS',
            message: 'A category with this slug already exists',
            details: { slug: finalSlug },
            retryable: false
          }
        });
      }
      
      const category = await Category.findByIdAndUpdate(
        req.params.id,
        { name, description, slug: finalSlug },
        { new: true, runValidators: true }
      ).populate('createdBy', 'name email');
      
      if (!category) {
        return res.status(404).json({
          error: {
            code: 'CATEGORY_NOT_FOUND',
            message: 'Category not found',
            retryable: false
          }
        });
      }
      
      res.json({ category });
    } catch (error) {
      console.error('Error updating category:', error);
      res.status(500).json({
        error: {
          code: 'UPDATE_CATEGORY_ERROR',
          message: 'Failed to update category',
          retryable: true
        }
      });
    }
  }
);

// DELETE /api/content/categories/:id - Delete category (panelist only)
router.delete('/categories/:id',
  authenticate,
  requirePermission('content:delete'),
  async (req, res) => {
    try {
      console.log('DELETE /categories/:id called with ID:', req.params.id);
      console.log('User:', req.user?.email, 'Role:', req.user?.role);
      
      // Check if category has awards
      const awardsCount = await Award.countDocuments({ categoryId: req.params.id });
      console.log('Awards count for category:', awardsCount);
      
      if (awardsCount > 0) {
        return res.status(409).json({
          error: {
            code: 'CATEGORY_HAS_AWARDS',
            message: 'Cannot delete category that contains awards',
            details: { awardsCount },
            retryable: false
          }
        });
      }
      
      const category = await Category.findByIdAndDelete(req.params.id);
      console.log('Category found and deleted:', category ? 'Yes' : 'No');
      
      if (!category) {
        return res.status(404).json({
          error: {
            code: 'CATEGORY_NOT_FOUND',
            message: 'Category not found',
            retryable: false
          }
        });
      }
      
      console.log('Category deletion successful');
      res.json({ 
        message: 'Category deleted successfully',
        category: { _id: category._id, name: category.name }
      });
    } catch (error) {
      console.error('Error deleting category:', error);
      res.status(500).json({
        error: {
          code: 'DELETE_CATEGORY_ERROR',
          message: 'Failed to delete category',
          retryable: true
        }
      });
    }
  }
);

module.exports = router;
// ===== AWARD ROUTES =====

// GET /api/content/awards - Get all awards (public)
router.get('/awards', async (req, res) => {
  try {
    const { page = 1, limit = 10, categoryId, includeInactive = false } = req.query;
    const skip = (page - 1) * limit;
    
    const filter = includeInactive ? {} : { isActive: true };
    if (categoryId) {
      filter.categoryId = categoryId;
    }
    
    const awards = await Award.find(filter)
      .populate('createdBy', 'name email')
      .populate('category', 'name slug')
      .populate({
        path: 'nominees',
        match: { isActive: true },
        select: 'name bio imageUrl displayOrder',
        options: { sort: { displayOrder: 1, name: 1 } }
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    // Process image URLs for all awards and their nominees
    for (const award of awards) {
      if (award.imageUrl) {
        // Provide multiple sizes for awards list view
        award.imageUrls = {
          thumbnail: await processImageUrl(award.imageUrl, { width: 150, height: 150, quality: 80 }),
          medium: await processImageUrl(award.imageUrl, { width: 400, height: 400, quality: 85 }),
          original: await processImageUrl(award.imageUrl)
        };
        // Keep original field for backward compatibility
        award.imageUrl = award.imageUrls.medium;
      }
      
      if (award.nominees) {
        for (const nominee of award.nominees) {
          if (nominee.imageUrl) {
            // Provide multiple sizes for nominees
            nominee.imageUrls = {
              thumbnail: await processImageUrl(nominee.imageUrl, { width: 100, height: 100, quality: 80 }),
              medium: await processImageUrl(nominee.imageUrl, { width: 300, height: 300, quality: 85 }),
              original: await processImageUrl(nominee.imageUrl)
            };
            // Keep original field for backward compatibility
            nominee.imageUrl = nominee.imageUrls.medium;
          }
        }
      }
    }
    
    const total = await Award.countDocuments(filter);
    
    res.json({
      awards,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching awards:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_AWARDS_ERROR',
        message: 'Failed to fetch awards',
        retryable: true
      }
    });
  }
});

// GET /api/content/awards/:id - Get award by ID (public)
router.get('/awards/:id', async (req, res) => {
  try {
    const award = await Award.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('category', 'name slug description')
      .populate({
        path: 'nominees',
        match: { isActive: true },
        select: 'name bio imageUrl displayOrder',
        options: { sort: { displayOrder: 1, name: 1 } }
      });
    
    if (!award) {
      return res.status(404).json({
        error: {
          code: 'AWARD_NOT_FOUND',
          message: 'Award not found',
          retryable: false
        }
      });
    }
    
    // Process image URLs
    if (award.imageUrl) {
      // Provide multiple sizes for award detail view
      award.imageUrls = {
        thumbnail: await processImageUrl(award.imageUrl, { width: 150, height: 150, quality: 80 }),
        medium: await processImageUrl(award.imageUrl, { width: 600, height: 600, quality: 90 }),
        large: await processImageUrl(award.imageUrl, { width: 1200, height: 1200, quality: 95 }),
        original: await processImageUrl(award.imageUrl)
      };
      // Keep original field for backward compatibility
      award.imageUrl = award.imageUrls.large;
    }
    
    if (award.nominees) {
      for (const nominee of award.nominees) {
        if (nominee.imageUrl) {
          // Provide multiple sizes for nominees in detail view
          nominee.imageUrls = {
            thumbnail: await processImageUrl(nominee.imageUrl, { width: 100, height: 100, quality: 80 }),
            medium: await processImageUrl(nominee.imageUrl, { width: 400, height: 400, quality: 85 }),
            large: await processImageUrl(nominee.imageUrl, { width: 800, height: 800, quality: 90 }),
            original: await processImageUrl(nominee.imageUrl)
          };
          // Keep original field for backward compatibility
          nominee.imageUrl = nominee.imageUrls.medium;
        }
      }
    }
    
    res.json({ award });
  } catch (error) {
    console.error('Error fetching award:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_AWARD_ERROR',
        message: 'Failed to fetch award',
        retryable: true
      }
    });
  }
});

// POST /api/content/awards - Create award (panelist only)
router.post('/awards',
  contentIdempotency,
  authenticate,
  requirePermission('content:create'),
  validate(schemas.awardCreation),
  async (req, res) => {
    try {
      const { 
        title, 
        criteria, 
        categoryId, 
        imageUrl, 
        votingStartDate, 
        votingEndDate, 
        isActive,
        allowPublicNomination,
        nominationStartDate,
        nominationEndDate
      } = req.body;
      
      // Verify category exists
      const category = await Category.findById(categoryId);
      if (!category) {
        return res.status(404).json({
          error: {
            code: 'CATEGORY_NOT_FOUND',
            message: 'Category not found',
            retryable: false
          }
        });
      }
      
      // Validate image exists and format if provided
      if (imageUrl) {
        const imageExists = await validateImageExists(imageUrl);
        if (!imageExists) {
          return res.status(400).json({
            error: {
              code: 'INVALID_IMAGE_URL',
              message: 'Image not found in storage. Please upload the image first.',
              retryable: false
            }
          });
        }

        // Additional format validation for uploaded images (S3 object keys)
        if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
          try {
            // Attempt to determine content type from file extension
            const extension = imageUrl.split('.').pop().toLowerCase();
            const contentTypeMap = {
              'jpg': 'image/jpeg',
              'jpeg': 'image/jpeg',
              'png': 'image/png',
              'webp': 'image/webp'
            };
            const expectedContentType = contentTypeMap[extension];
            
            if (expectedContentType) {
              const validation = await mediaService.validateUploadedImage(imageUrl, expectedContentType);
              if (!validation.valid) {
                return res.status(400).json({
                  error: {
                    code: 'INVALID_IMAGE_FORMAT',
                    message: `Invalid image format: ${validation.error}`,
                    details: validation.details,
                    retryable: false
                  }
                });
              }
            }
          } catch (validationError) {
            console.warn('Image format validation failed:', validationError.message);
            // Continue with creation - validation is best effort
          }
        }
      }
      
      const award = new Award({
        title,
        criteria,
        categoryId,
        imageUrl,
        votingStartDate,
        votingEndDate,
        isActive,
        allowPublicNomination: allowPublicNomination || false,
        nominationStartDate,
        nominationEndDate,
        createdBy: req.user._id
      });
      
      await award.save();
      await award.populate([
        { path: 'createdBy', select: 'name email' },
        { path: 'category', select: 'name slug' }
      ]);
      
      // Process image URL for response
      if (award.imageUrl) {
        award.imageUrls = {
          thumbnail: await processImageUrl(award.imageUrl, { width: 150, height: 150, quality: 80 }),
          medium: await processImageUrl(award.imageUrl, { width: 600, height: 600, quality: 90 }),
          original: await processImageUrl(award.imageUrl)
        };
        award.imageUrl = award.imageUrls.medium;
      }
      
      res.status(201).json({ award });
    } catch (error) {
      console.error('Error creating award:', error);
      res.status(500).json({
        error: {
          code: 'CREATE_AWARD_ERROR',
          message: 'Failed to create award',
          retryable: true
        }
      });
    }
  }
);

// PUT /api/content/awards/:id - Update award (panelist only)
router.put('/awards/:id',
  contentIdempotency,
  authenticate,
  requirePermission('content:update'),
  validate(schemas.awardCreation),
  async (req, res) => {
    try {
      const { 
        title, 
        criteria, 
        categoryId, 
        imageUrl, 
        votingStartDate, 
        votingEndDate, 
        isActive,
        allowPublicNomination,
        nominationStartDate,
        nominationEndDate
      } = req.body;
      
      // Verify category exists
      const category = await Category.findById(categoryId);
      if (!category) {
        return res.status(404).json({
          error: {
            code: 'CATEGORY_NOT_FOUND',
            message: 'Category not found',
            retryable: false
          }
        });
      }
      
      // Validate image exists and format if provided
      if (imageUrl) {
        const imageExists = await validateImageExists(imageUrl);
        if (!imageExists) {
          return res.status(400).json({
            error: {
              code: 'INVALID_IMAGE_URL',
              message: 'Image not found in storage. Please upload the image first.',
              retryable: false
            }
          });
        }

        // Additional format validation for uploaded images (S3 object keys)
        if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
          try {
            // Attempt to determine content type from file extension
            const extension = imageUrl.split('.').pop().toLowerCase();
            const contentTypeMap = {
              'jpg': 'image/jpeg',
              'jpeg': 'image/jpeg',
              'png': 'image/png',
              'webp': 'image/webp'
            };
            const expectedContentType = contentTypeMap[extension];
            
            if (expectedContentType) {
              const validation = await mediaService.validateUploadedImage(imageUrl, expectedContentType);
              if (!validation.valid) {
                return res.status(400).json({
                  error: {
                    code: 'INVALID_IMAGE_FORMAT',
                    message: `Invalid image format: ${validation.error}`,
                    details: validation.details,
                    retryable: false
                  }
                });
              }
            }
          } catch (validationError) {
            console.warn('Image format validation failed:', validationError.message);
            // Continue with update - validation is best effort
          }
        }
      }
      
      // Build update object
      const updateData = {
        title,
        criteria,
        categoryId,
        imageUrl,
        votingStartDate: votingStartDate || null,
        votingEndDate: votingEndDate || null,
        isActive,
        allowPublicNomination: allowPublicNomination || false,
        nominationStartDate: nominationStartDate || null,
        nominationEndDate: nominationEndDate || null
      };
      
      // Log the update for debugging
      console.log('Updating award:', req.params.id);
      console.log('Update data:', JSON.stringify(updateData, null, 2));
      
      const award = await Award.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true, runValidators: true }
      ).populate([
        { path: 'createdBy', select: 'name email' },
        { path: 'category', select: 'name slug' }
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
      
      // Process image URL for response
      if (award.imageUrl) {
        award.imageUrls = {
          thumbnail: await processImageUrl(award.imageUrl, { width: 150, height: 150, quality: 80 }),
          medium: await processImageUrl(award.imageUrl, { width: 600, height: 600, quality: 90 }),
          original: await processImageUrl(award.imageUrl)
        };
        award.imageUrl = award.imageUrls.medium;
      }
      
      res.json({ award });
    } catch (error) {
      console.error('Error updating award:', error);
      res.status(500).json({
        error: {
          code: 'UPDATE_AWARD_ERROR',
          message: 'Failed to update award',
          retryable: true
        }
      });
    }
  }
);

// DELETE /api/content/awards/:id - Delete award (panelist only)
router.delete('/awards/:id',
  authenticate,
  requirePermission('content:delete'),
  async (req, res) => {
    try {
      console.log('DELETE /awards/:id called with ID:', req.params.id);
      console.log('User:', req.user?.email, 'Role:', req.user?.role);
      
      // Check if award has nominees
      const nomineesCount = await Nominee.countDocuments({ awardId: req.params.id });
      console.log('Nominees count for award:', nomineesCount);
      
      if (nomineesCount > 0) {
        return res.status(409).json({
          error: {
            code: 'AWARD_HAS_NOMINEES',
            message: 'Cannot delete award that contains nominees',
            details: { nomineesCount },
            retryable: false
          }
        });
      }
      
      const award = await Award.findByIdAndDelete(req.params.id);
      console.log('Award found and deleted:', award ? 'Yes' : 'No');
      
      if (!award) {
        return res.status(404).json({
          error: {
            code: 'AWARD_NOT_FOUND',
            message: 'Award not found',
            retryable: false
          }
        });
      }
      
      console.log('Award deletion successful');
      res.json({ 
        message: 'Award deleted successfully',
        award: { _id: award._id, title: award.title }
      });
    } catch (error) {
      console.error('Error deleting award:', error);
      res.status(500).json({
        error: {
          code: 'DELETE_AWARD_ERROR',
          message: 'Failed to delete award',
          retryable: true
        }
      });
    }
  }
);

// ===== NOMINEE ROUTES =====

// GET /api/content/nominees - Get all nominees (public)
router.get('/nominees', async (req, res) => {
  try {
    const { page = 1, limit = 10, awardId, includeInactive = false } = req.query;
    const skip = (page - 1) * limit;
    
    // Only show approved nominees to public
    const filter = { 
      approvalStatus: 'approved'
    };
    
    if (!includeInactive) {
      filter.isActive = true;
    }
    
    if (awardId) {
      filter.awardId = awardId;
    }
    
    const nominees = await Nominee.find(filter)
      .populate('createdBy', 'name email')
      .populate('nominatedBy', 'name email')
      .populate({
        path: 'award',
        select: 'title criteria',
        populate: {
          path: 'category',
          select: 'name slug'
        }
      })
      .sort({ displayOrder: 1, name: 1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    // Process image URLs
    for (const nominee of nominees) {
      if (nominee.imageUrl) {
        // Provide multiple sizes for nominees list view
        nominee.imageUrls = {
          thumbnail: await processImageUrl(nominee.imageUrl, { width: 100, height: 100, quality: 80 }),
          medium: await processImageUrl(nominee.imageUrl, { width: 300, height: 300, quality: 85 }),
          original: await processImageUrl(nominee.imageUrl)
        };
        // Keep original field for backward compatibility
        nominee.imageUrl = nominee.imageUrls.medium;
      }
    }
    
    const total = await Nominee.countDocuments(filter);
    
    res.json({
      nominees,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching nominees:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_NOMINEES_ERROR',
        message: 'Failed to fetch nominees',
        retryable: true
      }
    });
  }
});

// GET /api/content/nominees/:id - Get nominee by ID (public)
router.get('/nominees/:id', async (req, res) => {
  try {
    const nominee = await Nominee.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate({
        path: 'award',
        select: 'title criteria votingStartDate votingEndDate',
        populate: {
          path: 'category',
          select: 'name slug description'
        }
      });
    
    if (!nominee) {
      return res.status(404).json({
        error: {
          code: 'NOMINEE_NOT_FOUND',
          message: 'Nominee not found',
          retryable: false
        }
      });
    }
    
    // Process image URL
    if (nominee.imageUrl) {
      // Provide multiple sizes for nominee detail view
      nominee.imageUrls = {
        thumbnail: await processImageUrl(nominee.imageUrl, { width: 150, height: 150, quality: 80 }),
        medium: await processImageUrl(nominee.imageUrl, { width: 500, height: 500, quality: 85 }),
        large: await processImageUrl(nominee.imageUrl, { width: 1000, height: 1000, quality: 90 }),
        original: await processImageUrl(nominee.imageUrl)
      };
      // Keep original field for backward compatibility
      nominee.imageUrl = nominee.imageUrls.large;
    }
    
    res.json({ nominee });
  } catch (error) {
    console.error('Error fetching nominee:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_NOMINEE_ERROR',
        message: 'Failed to fetch nominee',
        retryable: true
      }
    });
  }
});

// POST /api/content/nominees - Create nominee (panelist only)
// POST /api/content/nominees - Create nominee (panelist only)
router.post('/nominees',
  contentIdempotency,
  authenticate,
  requirePermission('content:create'),
  validate(schemas.nomineeCreation),
  async (req, res) => {
    try {
      const { name, bio, awardId, imageUrl, displayOrder } = req.body;
      
      // Verify award exists
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
      
      // Check for existing nomination
      const existingNomination = await Nominee.hasExistingNomination(awardId, name);
      if (existingNomination) {
        return res.status(409).json({
          error: {
            code: 'DUPLICATE_NOMINATION',
            message: 'A nominee with this name already exists for this award',
            details: {
              existingNominee: {
                id: existingNomination._id,
                name: existingNomination.name,
                approvalStatus: existingNomination.approvalStatus
              }
            },
            retryable: false
          }
        });
      }
      
      // Validate image exists and format if provided
      if (imageUrl) {
        const imageExists = await validateImageExists(imageUrl);
        if (!imageExists) {
          return res.status(400).json({
            error: {
              code: 'INVALID_IMAGE_URL',
              message: 'Image not found in storage. Please upload the image first.',
              retryable: false
            }
          });
        }

        // Additional format validation for uploaded images (S3 object keys)
        if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
          try {
            // Attempt to determine content type from file extension
            const extension = imageUrl.split('.').pop().toLowerCase();
            const contentTypeMap = {
              'jpg': 'image/jpeg',
              'jpeg': 'image/jpeg',
              'png': 'image/png',
              'webp': 'image/webp'
            };
            const expectedContentType = contentTypeMap[extension];
            
            if (expectedContentType) {
              const validation = await mediaService.validateUploadedImage(imageUrl, expectedContentType);
              if (!validation.valid) {
                return res.status(400).json({
                  error: {
                    code: 'INVALID_IMAGE_FORMAT',
                    message: `Invalid image format: ${validation.error}`,
                    details: validation.details,
                    retryable: false
                  }
                });
              }
            }
          } catch (validationError) {
            console.warn('Image format validation failed:', validationError.message);
            // Continue with creation - validation is best effort
          }
        }
      }
      
      const nominee = new Nominee({
        name,
        bio,
        awardId,
        imageUrl,
        displayOrder: displayOrder || 0,
        createdBy: req.user._id,
        nominatedBy: req.user._id,
        isPublicNomination: false,
        approvalStatus: 'approved'
      });
      
      await nominee.save();
      await nominee.populate([
        { path: 'createdBy', select: 'name email' },
        { path: 'nominatedBy', select: 'name email' },
        { 
          path: 'award', 
          select: 'title criteria',
          populate: {
            path: 'category',
            select: 'name slug'
          }
        }
      ]);
      
      // Process image URL for response
      if (nominee.imageUrl) {
        nominee.imageUrls = {
          thumbnail: await processImageUrl(nominee.imageUrl, { width: 100, height: 100, quality: 80 }),
          medium: await processImageUrl(nominee.imageUrl, { width: 400, height: 400, quality: 85 }),
          original: await processImageUrl(nominee.imageUrl)
        };
        nominee.imageUrl = nominee.imageUrls.medium;
      }
      
      res.status(201).json({ nominee });
    } catch (error) {
      console.error('Error creating nominee:', error);
      
      // Handle duplicate key error
      if (error.code === 11000) {
        return res.status(409).json({
          error: {
            code: 'DUPLICATE_NOMINATION',
            message: 'A nominee with this name already exists for this award',
            retryable: false
          }
        });
      }
      
      res.status(500).json({
        error: {
          code: 'CREATE_NOMINEE_ERROR',
          message: 'Failed to create nominee',
          retryable: true
        }
      });
    }
  }
);

// POST /api/content/nominations - Public nomination endpoint (users can nominate)
router.post('/nominations',
  contentIdempotency,
  authenticate,
  requirePermission('nomination:create'),
  validate(schemas.publicNomination),
  async (req, res) => {
    try {
      console.log('=== PUBLIC NOMINATION SUBMISSION ===');
      console.log('User:', req.user?.email, 'Role:', req.user?.role);
      console.log('Request body:', JSON.stringify(req.body, null, 2));
      
      const { name, bio, awardId, imageUrl } = req.body;
      
      // Verify award exists
      const award = await Award.findById(awardId);
      if (!award) {
        console.log('Award not found:', awardId);
        return res.status(404).json({
          error: {
            code: 'AWARD_NOT_FOUND',
            message: 'Award not found',
            retryable: false
          }
        });
      }
      
      console.log('Award found:', award.title, 'Allow public nomination:', award.allowPublicNomination);
      
      // Check if public nomination is allowed for this award
      const nominationStatus = award.isPublicNominationOpen();
      console.log('Nomination status:', nominationStatus);
      
      if (!nominationStatus.allowed) {
        console.log('Nomination not allowed:', nominationStatus.reason);
        return res.status(403).json({
          error: {
            code: 'NOMINATION_NOT_ALLOWED',
            message: nominationStatus.reason,
            details: {
              startDate: nominationStatus.startDate,
              endDate: nominationStatus.endDate
            },
            retryable: false
          }
        });
      }
      
      // Check for existing nomination
      const existingNomination = await Nominee.hasExistingNomination(awardId, name);
      console.log('Existing nomination check:', existingNomination ? 'Found duplicate' : 'No duplicate');
      
      if (existingNomination) {
        return res.status(409).json({
          error: {
            code: 'DUPLICATE_NOMINATION',
            message: 'This person has already been nominated for this award',
            details: {
              existingNominee: {
                id: existingNomination._id,
                name: existingNomination.name,
                approvalStatus: existingNomination.approvalStatus,
                nominatedBy: existingNomination.nominatedBy
              }
            },
            retryable: false
          }
        });
      }
      
      // Validate image exists and format if provided
      if (imageUrl) {
        console.log('Validating image URL:', imageUrl);
        const imageExists = await validateImageExists(imageUrl);
        if (!imageExists) {
          console.log('Image validation failed - not found');
          return res.status(400).json({
            error: {
              code: 'INVALID_IMAGE_URL',
              message: 'Image not found in storage. Please upload the image first.',
              retryable: false
            }
          });
        }
      }
      
      console.log('Creating nominee...');
      const nominee = new Nominee({
        name,
        bio,
        awardId,
        imageUrl,
        displayOrder: 0,
        createdBy: req.user._id,
        nominatedBy: req.user._id,
        isPublicNomination: true,
        approvalStatus: 'pending'
      });
      
      await nominee.save();
      console.log('Nominee saved successfully:', nominee._id);
      
      await nominee.populate([
        { path: 'nominatedBy', select: 'name email' },
        { 
          path: 'award', 
          select: 'title criteria allowPublicNomination',
          populate: {
            path: 'category',
            select: 'name slug'
          }
        }
      ]);
      
      // Process image URL for response
      if (nominee.imageUrl) {
        nominee.imageUrls = {
          thumbnail: await processImageUrl(nominee.imageUrl, { width: 100, height: 100, quality: 80 }),
          medium: await processImageUrl(nominee.imageUrl, { width: 400, height: 400, quality: 85 }),
          original: await processImageUrl(nominee.imageUrl)
        };
        nominee.imageUrl = nominee.imageUrls.medium;
      }
      
      console.log('Nomination submission successful');
      res.status(201).json({ 
        nominee,
        message: 'Nomination submitted successfully and is pending approval'
      });
    } catch (error) {
      console.error('Error creating public nomination:', error);
      console.error('Error stack:', error.stack);
      
      // Handle duplicate key error
      if (error.code === 11000) {
        return res.status(409).json({
          error: {
            code: 'DUPLICATE_NOMINATION',
            message: 'This person has already been nominated for this award',
            retryable: false
          }
        });
      }
      
      res.status(500).json({
        error: {
          code: 'CREATE_NOMINATION_ERROR',
          message: 'Failed to create nomination',
          retryable: true
        }
      });
    }
  }
);

// PUT /api/content/nominees/:id - Update nominee (panelist only)
router.put('/nominees/:id',
  contentIdempotency,
  authenticate,
  requirePermission('content:update'),
  validate(schemas.nomineeCreation),
  async (req, res) => {
    try {
      const { name, bio, awardId, imageUrl, displayOrder } = req.body;
      
      // Verify award exists
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
      
      // Validate image exists and format if provided
      if (imageUrl) {
        const imageExists = await validateImageExists(imageUrl);
        if (!imageExists) {
          return res.status(400).json({
            error: {
              code: 'INVALID_IMAGE_URL',
              message: 'Image not found in storage. Please upload the image first.',
              retryable: false
            }
          });
        }

        // Additional format validation for uploaded images (S3 object keys)
        if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
          try {
            // Attempt to determine content type from file extension
            const extension = imageUrl.split('.').pop().toLowerCase();
            const contentTypeMap = {
              'jpg': 'image/jpeg',
              'jpeg': 'image/jpeg',
              'png': 'image/png',
              'webp': 'image/webp'
            };
            const expectedContentType = contentTypeMap[extension];
            
            if (expectedContentType) {
              const validation = await mediaService.validateUploadedImage(imageUrl, expectedContentType);
              if (!validation.valid) {
                return res.status(400).json({
                  error: {
                    code: 'INVALID_IMAGE_FORMAT',
                    message: `Invalid image format: ${validation.error}`,
                    details: validation.details,
                    retryable: false
                  }
                });
              }
            }
          } catch (validationError) {
            console.warn('Image format validation failed:', validationError.message);
            // Continue with update - validation is best effort
          }
        }
      }
      
      const nominee = await Nominee.findByIdAndUpdate(
        req.params.id,
        { name, bio, awardId, imageUrl, displayOrder },
        { new: true, runValidators: true }
      ).populate([
        { path: 'createdBy', select: 'name email' },
        { 
          path: 'award', 
          select: 'title criteria',
          populate: {
            path: 'category',
            select: 'name slug'
          }
        }
      ]);
      
      if (!nominee) {
        return res.status(404).json({
          error: {
            code: 'NOMINEE_NOT_FOUND',
            message: 'Nominee not found',
            retryable: false
          }
        });
      }
      
      // Process image URL for response
      if (nominee.imageUrl) {
        nominee.imageUrls = {
          thumbnail: await processImageUrl(nominee.imageUrl, { width: 100, height: 100, quality: 80 }),
          medium: await processImageUrl(nominee.imageUrl, { width: 400, height: 400, quality: 85 }),
          original: await processImageUrl(nominee.imageUrl)
        };
        nominee.imageUrl = nominee.imageUrls.medium;
      }
      
      res.json({ nominee });
    } catch (error) {
      console.error('Error updating nominee:', error);
      res.status(500).json({
        error: {
          code: 'UPDATE_NOMINEE_ERROR',
          message: 'Failed to update nominee',
          retryable: true
        }
      });
    }
  }
);

// DELETE /api/content/nominees/:id - Delete nominee (panelist only)
router.delete('/nominees/:id',
  authenticate,
  requirePermission('content:delete'),
  async (req, res) => {
    try {
      console.log('DELETE /nominees/:id called with ID:', req.params.id);
      console.log('User:', req.user?.email, 'Role:', req.user?.role);
      
      // TODO: Check if nominee has votes when Vote model is implemented
      // const votesCount = await Vote.countDocuments({ nomineeId: req.params.id });
      // if (votesCount > 0) {
      //   return res.status(409).json({
      //     error: {
      //       code: 'NOMINEE_HAS_VOTES',
      //       message: 'Cannot delete nominee that has received votes',
      //       details: { votesCount },
      //       retryable: false
      //     }
      //   });
      // }
      
      const nominee = await Nominee.findByIdAndDelete(req.params.id);
      console.log('Nominee found and deleted:', nominee ? 'Yes' : 'No');
      
      if (!nominee) {
        return res.status(404).json({
          error: {
            code: 'NOMINEE_NOT_FOUND',
            message: 'Nominee not found',
            retryable: false
          }
        });
      }
      
      console.log('Nominee deletion successful');
      res.json({ 
        message: 'Nominee deleted successfully',
        nominee: { _id: nominee._id, name: nominee.name }
      });
    } catch (error) {
      console.error('Error deleting nominee:', error);
      res.status(500).json({
        error: {
          code: 'DELETE_NOMINEE_ERROR',
          message: 'Failed to delete nominee',
          retryable: true
        }
      });
    }
  }
);

// GET /api/content/nominations/pending - Get pending nominations (panelist+ only)
router.get('/nominations/pending',
  authenticate,
  requirePermission('nomination:read_all'),
  async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;
      
      const awardId = req.query.awardId;
      const filter = { 
        isPublicNomination: true,
        approvalStatus: 'pending'
      };
      
      if (awardId) {
        filter.awardId = awardId;
      }
      
      const [nominations, total] = await Promise.all([
        Nominee.find(filter)
          .populate([
            { path: 'nominatedBy', select: 'name email' },
            { 
              path: 'award', 
              select: 'title criteria allowPublicNomination',
              populate: {
                path: 'category',
                select: 'name slug'
              }
            }
          ])
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        Nominee.countDocuments(filter)
      ]);
      
      // Process image URLs for response
      for (const nomination of nominations) {
        if (nomination.imageUrl) {
          nomination.imageUrls = {
            thumbnail: await processImageUrl(nomination.imageUrl, { width: 100, height: 100, quality: 80 }),
            medium: await processImageUrl(nomination.imageUrl, { width: 400, height: 400, quality: 85 }),
            original: await processImageUrl(nomination.imageUrl)
          };
          nomination.imageUrl = nomination.imageUrls.medium;
        }
      }
      
      res.json({
        nominations,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Error fetching pending nominations:', error);
      res.status(500).json({
        error: {
          code: 'FETCH_NOMINATIONS_ERROR',
          message: 'Failed to fetch pending nominations',
          retryable: true
        }
      });
    }
  }
);

// POST /api/content/nominations/:id/approve - Approve a public nomination (panelist+ only)
router.post('/nominations/:id/approve',
  authenticate,
  requirePermission('nomination:approve'),
  validate(schemas.nominationApproval),
  async (req, res) => {
    try {
      const { displayOrder } = req.body;
      
      const nomination = await Nominee.findById(req.params.id);
      if (!nomination) {
        return res.status(404).json({
          error: {
            code: 'NOMINATION_NOT_FOUND',
            message: 'Nomination not found',
            retryable: false
          }
        });
      }
      
      if (!nomination.isPublicNomination) {
        return res.status(400).json({
          error: {
            code: 'NOT_PUBLIC_NOMINATION',
            message: 'This is not a public nomination',
            retryable: false
          }
        });
      }
      
      if (nomination.approvalStatus !== 'pending') {
        return res.status(400).json({
          error: {
            code: 'NOMINATION_ALREADY_PROCESSED',
            message: `Nomination has already been ${nomination.approvalStatus}`,
            retryable: false
          }
        });
      }
      
      // Update nomination status
      nomination.approvalStatus = 'approved';
      nomination.approvedBy = req.user._id;
      nomination.approvedAt = new Date();
      nomination.isActive = true;
      
      if (displayOrder !== undefined) {
        nomination.displayOrder = displayOrder;
      }
      
      await nomination.save();
      await nomination.populate([
        { path: 'nominatedBy', select: 'name email' },
        { path: 'approvedBy', select: 'name email' },
        { 
          path: 'award', 
          select: 'title criteria allowPublicNomination',
          populate: {
            path: 'category',
            select: 'name slug'
          }
        }
      ]);
      
      // Process image URL for response
      if (nomination.imageUrl) {
        nomination.imageUrls = {
          thumbnail: await processImageUrl(nomination.imageUrl, { width: 100, height: 100, quality: 80 }),
          medium: await processImageUrl(nomination.imageUrl, { width: 400, height: 400, quality: 85 }),
          original: await processImageUrl(nomination.imageUrl)
        };
        nomination.imageUrl = nomination.imageUrls.medium;
      }
      
      res.json({ 
        nomination,
        message: 'Nomination approved successfully'
      });
    } catch (error) {
      console.error('Error approving nomination:', error);
      res.status(500).json({
        error: {
          code: 'APPROVE_NOMINATION_ERROR',
          message: 'Failed to approve nomination',
          retryable: true
        }
      });
    }
  }
);

// POST /api/content/nominations/:id/reject - Reject a public nomination (panelist+ only)
router.post('/nominations/:id/reject',
  authenticate,
  requirePermission('nomination:reject'),
  validate(schemas.nominationRejection),
  async (req, res) => {
    try {
      const { reason } = req.body;
      
      if (!reason || !reason.trim()) {
        return res.status(400).json({
          error: {
            code: 'REJECTION_REASON_REQUIRED',
            message: 'Rejection reason is required',
            retryable: false
          }
        });
      }
      
      const nomination = await Nominee.findById(req.params.id);
      if (!nomination) {
        return res.status(404).json({
          error: {
            code: 'NOMINATION_NOT_FOUND',
            message: 'Nomination not found',
            retryable: false
          }
        });
      }
      
      if (!nomination.isPublicNomination) {
        return res.status(400).json({
          error: {
            code: 'NOT_PUBLIC_NOMINATION',
            message: 'This is not a public nomination',
            retryable: false
          }
        });
      }
      
      if (nomination.approvalStatus !== 'pending') {
        return res.status(400).json({
          error: {
            code: 'NOMINATION_ALREADY_PROCESSED',
            message: `Nomination has already been ${nomination.approvalStatus}`,
            retryable: false
          }
        });
      }
      
      // Update nomination status
      nomination.approvalStatus = 'rejected';
      nomination.approvedBy = req.user._id;
      nomination.approvedAt = new Date();
      nomination.rejectionReason = reason.trim();
      nomination.isActive = false;
      
      await nomination.save();
      await nomination.populate([
        { path: 'nominatedBy', select: 'name email' },
        { path: 'approvedBy', select: 'name email' },
        { 
          path: 'award', 
          select: 'title criteria allowPublicNomination',
          populate: {
            path: 'category',
            select: 'name slug'
          }
        }
      ]);
      
      res.json({ 
        nomination,
        message: 'Nomination rejected successfully'
      });
    } catch (error) {
      console.error('Error rejecting nomination:', error);
      res.status(500).json({
        error: {
          code: 'REJECT_NOMINATION_ERROR',
          message: 'Failed to reject nomination',
          retryable: true
        }
      });
    }
  }
);

// GET /api/content/nominations/my - Get user's own nominations
router.get('/nominations/my',
  authenticate,
  requirePermission('nomination:read_own'),
  async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const skip = (page - 1) * limit;
      
      const [nominations, total] = await Promise.all([
        Nominee.find({ 
          nominatedBy: req.user._id,
          isPublicNomination: true
        })
          .populate([
            { 
              path: 'award', 
              select: 'title criteria allowPublicNomination',
              populate: {
                path: 'category',
                select: 'name slug'
              }
            },
            { path: 'approvedBy', select: 'name email' }
          ])
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        Nominee.countDocuments({ 
          nominatedBy: req.user._id,
          isPublicNomination: true
        })
      ]);
      
      // Process image URLs for response
      for (const nomination of nominations) {
        if (nomination.imageUrl) {
          nomination.imageUrls = {
            thumbnail: await processImageUrl(nomination.imageUrl, { width: 100, height: 100, quality: 80 }),
            medium: await processImageUrl(nomination.imageUrl, { width: 400, height: 400, quality: 85 }),
            original: await processImageUrl(nomination.imageUrl)
          };
          nomination.imageUrl = nomination.imageUrls.medium;
        }
      }
      
      res.json({
        nominations,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Error fetching user nominations:', error);
      res.status(500).json({
        error: {
          code: 'FETCH_USER_NOMINATIONS_ERROR',
          message: 'Failed to fetch your nominations',
          retryable: true
        }
      });
    }
  }
);

// GET /api/content/awards/:id/nominees - Get nominees for a specific award (public)
router.get('/awards/:id/nominees', async (req, res) => {
  try {
    const { includeInactive = false } = req.query;
    
    // Verify award exists
    const award = await Award.findById(req.params.id);
    if (!award) {
      return res.status(404).json({
        error: {
          code: 'AWARD_NOT_FOUND',
          message: 'Award not found',
          retryable: false
        }
      });
    }
    
    // Only show approved nominees to public
    const filter = { 
      awardId: req.params.id,
      approvalStatus: 'approved'
    };
    
    if (!includeInactive) {
      filter.isActive = true;
    }
    
    const nominees = await Nominee.find(filter)
      .populate('createdBy', 'name email')
      .populate('nominatedBy', 'name email')
      .sort({ displayOrder: 1, name: 1 });
    
    // Process image URLs
    for (const nominee of nominees) {
      if (nominee.imageUrl) {
        nominee.imageUrls = {
          thumbnail: await processImageUrl(nominee.imageUrl, { width: 100, height: 100, quality: 80 }),
          medium: await processImageUrl(nominee.imageUrl, { width: 300, height: 300, quality: 85 }),
          original: await processImageUrl(nominee.imageUrl)
        };
        nominee.imageUrl = nominee.imageUrls.medium;
      }
    }
    
    res.json({
      nominees,
      award: {
        _id: award._id,
        title: award.title
      }
    });
  } catch (error) {
    console.error('Error fetching award nominees:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_AWARD_NOMINEES_ERROR',
        message: 'Failed to fetch award nominees',
        retryable: true
      }
    });
  }
});

// GET /api/content/awards/:id/nomination-status - Check if award allows public nomination
router.get('/awards/:id/nomination-status',
  async (req, res) => {
    try {
      const award = await Award.findById(req.params.id).select('title allowPublicNomination nominationStartDate nominationEndDate');
      
      if (!award) {
        return res.status(404).json({
          error: {
            code: 'AWARD_NOT_FOUND',
            message: 'Award not found',
            retryable: false
          }
        });
      }
      
      const nominationStatus = award.isPublicNominationOpen();
      
      res.json({
        award: {
          id: award._id,
          title: award.title,
          allowPublicNomination: award.allowPublicNomination,
          nominationStartDate: award.nominationStartDate,
          nominationEndDate: award.nominationEndDate
        },
        nominationStatus
      });
    } catch (error) {
      console.error('Error checking nomination status:', error);
      res.status(500).json({
        error: {
          code: 'CHECK_NOMINATION_STATUS_ERROR',
          message: 'Failed to check nomination status',
          retryable: true
        }
      });
    }
  }
);

// ===== BIOMETRIC VERIFICATION ROUTES =====

// POST /api/content/votes/check-biometric-duplicate - Check for duplicate biometric data
router.post('/votes/check-biometric-duplicate',
  authenticate,
  async (req, res) => {
    try {
      const { faceSignature, awardId } = req.body;
      const securityContext = securityLogger.createSecurityContext(req);
      
      if (!faceSignature || !faceSignature.data || !awardId) {
        return res.status(400).json({
          error: {
            code: 'INVALID_BIOMETRIC_DATA',
            message: 'Face signature and award ID are required',
            retryable: false
          }
        });
      }
      
      // Find potential duplicates using the BiometricData model
      const matches = await BiometricData.findPotentialDuplicates(
        faceSignature, 
        awardId, 
        req.user._id, 
        0.6 // Threshold for face matching
      );
      
      const isDuplicate = matches.length > 0;
      const highestConfidence = isDuplicate ? matches[0].confidence : 0;
      
      // Log the biometric check for audit purposes
      console.log(`Biometric duplicate check for user ${req.user._id}, award ${awardId}: ${isDuplicate ? 'DUPLICATE FOUND' : 'NO DUPLICATES'}`);
      
      if (isDuplicate) {
        console.log(`Duplicate match details:`, {
          matchedUserId: matches[0].userId,
          confidence: matches[0].confidence,
          timestamp: matches[0].timestamp
        });
      }
      
      res.json({
        isDuplicate,
        confidence: highestConfidence,
        matches: matches.slice(0, 3), // Return top 3 matches for analysis
        message: isDuplicate 
          ? `Biometric match found with ${(highestConfidence * 100).toFixed(1)}% confidence`
          : 'No biometric duplicates detected'
      });
      
    } catch (error) {
      console.error('Biometric duplicate check error:', error);
      res.status(500).json({
        error: {
          code: 'BIOMETRIC_CHECK_ERROR',
          message: 'Failed to check for biometric duplicates',
          retryable: true
        }
      });
    }
  }
);

// POST /api/content/votes/store-biometric-data - Store biometric data for vote
router.post('/votes/store-biometric-data',
  authenticate,
  async (req, res) => {
    try {
      const { faceSignature, awardId, userId } = req.body;
      const securityContext = securityLogger.createSecurityContext(req);
      
      if (!faceSignature || !faceSignature.data || !awardId) {
        return res.status(400).json({
          error: {
            code: 'INVALID_BIOMETRIC_DATA',
            message: 'Face signature and award ID are required',
            retryable: false
          }
        });
      }
      
      // Verify the user is storing their own biometric data or is an admin
      if (userId && userId !== req.user._id.toString() && req.user.role !== 'System_Admin') {
        return res.status(403).json({
          error: {
            code: 'UNAUTHORIZED_BIOMETRIC_STORAGE',
            message: 'Cannot store biometric data for another user',
            retryable: false
          }
        });
      }
      
      // Generate biometric hash for indexing
      const biometricHash = generateBiometricHash(faceSignature.data);
      
      // Calculate confidence and quality metrics
      const confidence = Math.min(0.95, Math.max(0.5, Math.random() * 0.45 + 0.5)); // Simulated confidence
      const faceQuality = {
        faceDetected: true,
        confidence: confidence,
        isGoodQuality: confidence > 0.7,
        issues: confidence < 0.7 ? ['Lower confidence detection'] : []
      };
      
      // Create biometric data record
      const biometricData = new BiometricData({
        userId: userId || req.user._id,
        awardId,
        faceSignature,
        biometricHash,
        confidence,
        faceQuality,
        metadata: {
          ipAddress: securityContext.ipAddress,
          userAgent: securityContext.userAgent,
          deviceInfo: req.headers['user-agent'] || 'Unknown',
          verificationSource: 'web'
        }
      });
      
      await biometricData.save();
      
      console.log(`Biometric data stored for user ${biometricData.userId}, award ${awardId}, hash: ${biometricHash}`);
      
      res.status(201).json({
        message: 'Biometric data stored successfully',
        biometricId: biometricData._id,
        biometricHash,
        confidence,
        timestamp: biometricData.createdAt
      });
      
    } catch (error) {
      console.error('Biometric data storage error:', error);
      
      if (error.code === 11000) {
        return res.status(409).json({
          error: {
            code: 'DUPLICATE_BIOMETRIC_DATA',
            message: 'Biometric data already exists for this user and award',
            retryable: false
          }
        });
      }
      
      res.status(500).json({
        error: {
          code: 'BIOMETRIC_STORAGE_ERROR',
          message: 'Failed to store biometric data',
          retryable: true
        }
      });
    }
  }
);

// GET /api/content/votes/biometric-status/:awardId - Get biometric verification status for award
router.get('/votes/biometric-status/:awardId',
  authenticate,
  async (req, res) => {
    try {
      const { awardId } = req.params;
      
      // Check if user has already provided biometric data for this award
      const existingBiometric = await BiometricData.findOne({
        userId: req.user._id,
        awardId,
        isActive: true
      });
      
      const hasVerified = !!existingBiometric;
      
      res.json({
        hasVerified,
        verificationDate: hasVerified ? existingBiometric.createdAt : null,
        confidence: hasVerified ? existingBiometric.confidence : null,
        biometricId: hasVerified ? existingBiometric._id : null
      });
      
    } catch (error) {
      console.error('Biometric status check error:', error);
      res.status(500).json({
        error: {
          code: 'BIOMETRIC_STATUS_ERROR',
          message: 'Failed to check biometric verification status',
          retryable: true
        }
      });
    }
  }
);

// DELETE /api/content/votes/biometric-data/:biometricId - Delete biometric data (admin only)
router.delete('/votes/biometric-data/:biometricId',
  authenticate,
  requirePermission('system:admin'),
  async (req, res) => {
    try {
      const { biometricId } = req.params;
      const { reason } = req.body;
      
      const biometricData = await BiometricData.findById(biometricId);
      
      if (!biometricData) {
        return res.status(404).json({
          error: {
            code: 'BIOMETRIC_DATA_NOT_FOUND',
            message: 'Biometric data not found',
            retryable: false
          }
        });
      }
      
      // Soft delete by marking as inactive
      biometricData.isActive = false;
      biometricData.deletionReason = reason || 'Deleted by admin';
      biometricData.deletedBy = req.user._id;
      biometricData.deletedAt = new Date();
      
      await biometricData.save();
      
      console.log(`Biometric data ${biometricId} deleted by admin ${req.user._id}`);
      
      res.json({
        message: 'Biometric data deleted successfully',
        biometricId,
        deletedAt: biometricData.deletedAt
      });
      
    } catch (error) {
      console.error('Biometric data deletion error:', error);
      res.status(500).json({
        error: {
          code: 'BIOMETRIC_DELETION_ERROR',
          message: 'Failed to delete biometric data',
          retryable: true
        }
      });
    }
  }
);

// GET /api/content/votes/biometric-analytics/:awardId - Get biometric analytics for award (admin only)
router.get('/votes/biometric-analytics/:awardId',
  authenticate,
  requirePermission('system:admin'),
  async (req, res) => {
    try {
      const { awardId } = req.params;
      
      const analytics = await BiometricData.aggregate([
        {
          $match: {
            awardId: new mongoose.Types.ObjectId(awardId),
            isActive: true
          }
        },
        {
          $group: {
            _id: null,
            totalVerifications: { $sum: 1 },
            averageConfidence: { $avg: '$confidence' },
            highQualityCount: {
              $sum: {
                $cond: [{ $eq: ['$faceQuality.isGoodQuality', true] }, 1, 0]
              }
            },
            uniqueUsers: { $addToSet: '$userId' }
          }
        },
        {
          $project: {
            _id: 0,
            totalVerifications: 1,
            uniqueUsers: { $size: '$uniqueUsers' },
            averageConfidence: { $round: ['$averageConfidence', 3] },
            highQualityPercentage: {
              $round: [
                { $multiply: [{ $divide: ['$highQualityCount', '$totalVerifications'] }, 100] },
                1
              ]
            }
          }
        }
      ]);
      
      const result = analytics[0] || {
        totalVerifications: 0,
        uniqueUsers: 0,
        averageConfidence: 0,
        highQualityPercentage: 0
      };
      
      res.json({
        awardId,
        analytics: result,
        generatedAt: new Date()
      });
      
    } catch (error) {
      console.error('Biometric analytics error:', error);
      res.status(500).json({
        error: {
          code: 'BIOMETRIC_ANALYTICS_ERROR',
          message: 'Failed to generate biometric analytics',
          retryable: true
        }
      });
    }
  }
);

// Helper function to generate biometric hash
function generateBiometricHash(descriptorArray) {
  // Create a hash from the face descriptor for audit purposes
  const hashInput = descriptorArray.join(',');
  
  // Simple hash function (in production, use a proper crypto hash)
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    const char = hashInput.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return Math.abs(hash).toString(16);
}

module.exports = router;