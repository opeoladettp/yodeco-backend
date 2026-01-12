const Joi = require('joi');

// Validation middleware factory
const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error } = schema.validate(req[property]);
    
    if (error) {
      const errorDetails = error.details.map(detail => detail.message);
      console.log('Validation failed:', {
        property,
        errorDetails,
        endpoint: req.path
      });
      
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errorDetails,
          retryable: false
        }
      });
    }
    
    next();
  };
};

// Common validation schemas
const schemas = {
  // User validation
  userRegistration: Joi.object({
    googleId: Joi.string().required(),
    email: Joi.string().email().required(),
    name: Joi.string().min(1).max(100).required()
  }),

  // Vote validation
  voteSubmission: Joi.object({
    awardId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
    nomineeId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required()
  }),

  // Content validation
  categoryCreation: Joi.object({
    name: Joi.string().min(1).max(100).required(),
    description: Joi.string().min(1).max(500).required(),
    slug: Joi.string().min(1).max(100).optional()
  }),

  awardCreation: Joi.object({
    title: Joi.string().min(1).max(150).required(),
    criteria: Joi.string().min(1).max(1000).required(),
    categoryId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
    imageUrl: Joi.string().optional(),
    votingStartDate: Joi.date().optional(),
    votingEndDate: Joi.date().optional(),
    isActive: Joi.boolean().optional(),
    allowPublicNomination: Joi.boolean().optional(),
    nominationStartDate: Joi.date().optional(),
    nominationEndDate: Joi.date().optional()
  }),

  nomineeCreation: Joi.object({
    name: Joi.string().min(1).max(100).required(),
    bio: Joi.string().min(1).max(2000).required(),
    awardId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
    imageUrl: Joi.string().optional(),
    displayOrder: Joi.number().integer().min(0).optional()
  }),

  // Public nomination validation (simpler than nominee creation)
  publicNomination: Joi.object({
    name: Joi.string().min(1).max(100).required(),
    bio: Joi.string().min(1).max(2000).required(),
    awardId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).required(),
    imageUrl: Joi.string().optional()
  }),

  // Nomination approval validation
  nominationApproval: Joi.object({
    displayOrder: Joi.number().integer().min(0).optional()
  }),

  // Nomination rejection validation
  nominationRejection: Joi.object({
    reason: Joi.string().min(1).max(500).required()
  }),

  // Query parameter validation
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10)
  })
};

module.exports = {
  validate,
  schemas
};