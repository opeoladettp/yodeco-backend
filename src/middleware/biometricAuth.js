const WebAuthnService = require('../services/webauthnService');

/**
 * Middleware to require biometric verification for sensitive operations
 * This middleware checks if the user has completed WebAuthn authentication
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const requireBiometricVerification = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required',
          retryable: false
        }
      });
    }

    // Check if user has registered WebAuthn credentials
    const hasCredentials = await WebAuthnService.hasCredentials(req.user.id);
    if (!hasCredentials) {
      return res.status(428).json({
        error: {
          code: 'BIOMETRIC_REGISTRATION_REQUIRED',
          message: 'Biometric authentication must be registered before performing this action',
          retryable: false,
          details: {
            registrationEndpoint: '/api/webauthn/register/options'
          }
        }
      });
    }

    // Check for biometric verification header (support both old and new header names)
    // In a real implementation, this would verify a temporary verification token
    const biometricVerified = req.headers['x-biometric-verified'] || req.headers['biometric-verified'];
    if (!biometricVerified || biometricVerified !== 'true') {
      return res.status(428).json({
        error: {
          code: 'BIOMETRIC_VERIFICATION_REQUIRED',
          message: 'Biometric verification required for this action',
          retryable: true,
          details: {
            authenticationEndpoint: '/api/webauthn/authenticate/options'
          }
        }
      });
    }

    // In production, you would verify the biometric verification token here
    // For now, we'll trust the header (this is not secure for production)
    next();
  } catch (error) {
    console.error('Biometric verification middleware error:', error);
    res.status(500).json({
      error: {
        code: 'BIOMETRIC_VERIFICATION_ERROR',
        message: 'Failed to verify biometric authentication',
        retryable: true
      }
    });
  }
};

module.exports = {
  requireBiometricVerification
};