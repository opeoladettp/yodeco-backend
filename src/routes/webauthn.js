const express = require('express');
const router = express.Router();
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { webauthnRateLimit } = require('../middleware/rateLimit');
const Joi = require('joi');

// WebAuthn configuration
const rpName = process.env.WEBAUTHN_RP_NAME || 'Biometric Voting Portal';
const rpID = process.env.WEBAUTHN_RP_ID || 'localhost';
const origin = process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000';

/**
 * POST /api/webauthn/register/options
 * Generate registration options for WebAuthn credential creation
 */
router.post('/register/options', webauthnRateLimit, authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          retryable: false
        }
      });
    }

    // Get existing credentials for this user
    const existingCredentials = user.webAuthnCredentials.map(cred => ({
      id: Buffer.from(cred.credentialID, 'base64url'),
      type: 'public-key',
      transports: cred.transports
    }));

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: Buffer.from(user._id.toString()),
      userName: user.email,
      userDisplayName: user.name,
      attestationType: 'none',
      excludeCredentials: existingCredentials,
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred'
      },
      supportedAlgorithmIDs: [-7, -257], // ES256 and RS256
      timeout: 120000 // 2 minutes timeout for Windows Hello
    });

    // Store the challenge in the user document
    user.currentChallenge = options.challenge;
    await user.save();

    res.json(options);
  } catch (error) {
    console.error('WebAuthn registration options error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      userId: req.user?.id
    });
    res.status(500).json({
      error: {
        code: 'WEBAUTHN_OPTIONS_ERROR',
        message: 'Failed to generate registration options',
        retryable: true
      }
    });
  }
});

/**
 * POST /api/webauthn/register/verify
 * Verify WebAuthn registration response and store credential
 */
const verifyRegistrationSchema = Joi.object({
  id: Joi.string().required(),
  rawId: Joi.string().required(),
  response: Joi.object({
    attestationObject: Joi.string().required(),
    clientDataJSON: Joi.string().required(),
    publicKeyAlgorithm: Joi.number().optional(),
    publicKey: Joi.string().optional(),
    authenticatorData: Joi.string().optional(),
    transports: Joi.array().items(Joi.string().valid('usb', 'nfc', 'ble', 'internal', 'hybrid')).optional()
  }).unknown(true).required(),
  type: Joi.string().valid('public-key').required(),
  clientExtensionResults: Joi.object().optional(),
  transports: Joi.array().items(Joi.string().valid('usb', 'nfc', 'ble', 'internal', 'hybrid')).optional(),
  authenticatorAttachment: Joi.string().valid('platform', 'cross-platform').optional()
}).unknown(true); // Allow additional properties that Windows Hello might send

router.post('/register/verify', 
  webauthnRateLimit,
  authenticate, 
  validate(verifyRegistrationSchema),
  async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found',
            retryable: false
          }
        });
      }

      if (!user.currentChallenge) {
        return res.status(400).json({
          error: {
            code: 'NO_CHALLENGE',
            message: 'No registration challenge found. Please request registration options first.',
            retryable: true
          }
        });
      }

      const verification = await verifyRegistrationResponse({
        response: req.body,
        expectedChallenge: user.currentChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true
      });

      console.log('WebAuthn verification result:', {
        verified: verification.verified,
        hasRegistrationInfo: !!verification.registrationInfo
      });

      if (verification.verified && verification.registrationInfo) {
        // Extract data from the correct structure in SimpleWebAuthn v13
        const registrationInfo = verification.registrationInfo;
        
        // The credential data is directly in registrationInfo, not nested under credential
        const credentialID = registrationInfo.credentialID;
        const credentialPublicKey = registrationInfo.credentialPublicKey;
        const counter = registrationInfo.counter || 0;

        console.log('Successfully extracted registration info:', {
          credentialID: credentialID ? 'present' : 'missing',
          credentialPublicKey: credentialPublicKey ? 'present' : 'missing',
          counter
        });

        // Check if this credential already exists
        const existingCredential = user.webAuthnCredentials.find(
          cred => cred.credentialID === Buffer.from(credentialID).toString('base64url')
        );

        if (existingCredential) {
          return res.status(400).json({
            error: {
              code: 'CREDENTIAL_EXISTS',
              message: 'This credential is already registered',
              retryable: false
            }
          });
        }

        // Store the new credential
        if (!credentialPublicKey) {
          console.error('credentialPublicKey is missing from verification result');
          return res.status(500).json({
            error: {
              code: 'MISSING_PUBLIC_KEY',
              message: 'Failed to extract public key from registration',
              retryable: true
            }
          });
        }

        user.webAuthnCredentials.push({
          credentialID: Buffer.from(credentialID).toString('base64url'), // Convert to base64url string
          publicKey: Buffer.from(credentialPublicKey).toString('base64url'),
          counter,
          transports: registrationInfo.transports || []
        });

        // Clear the challenge
        user.currentChallenge = null;
        await user.save();

        res.json({
          verified: true,
          message: 'WebAuthn credential registered successfully'
        });
      } else {
        console.log('WebAuthn verification failed:', {
          verified: verification.verified,
          registrationInfo: verification.registrationInfo,
          verificationError: verification.error
        });
        
        res.status(400).json({
          error: {
            code: 'VERIFICATION_FAILED',
            message: 'WebAuthn registration verification failed',
            retryable: true
          }
        });
      }
    } catch (error) {
      console.error('WebAuthn registration verification error:', error);
      console.error('Verification error details:', {
        message: error.message,
        stack: error.stack,
        userId: req.user?.id,
        bodyKeys: Object.keys(req.body || {})
      });
      res.status(500).json({
        error: {
          code: 'WEBAUTHN_VERIFICATION_ERROR',
          message: 'Failed to verify registration response',
          retryable: true
        }
      });
    }
  }
);

/**
 * POST /api/webauthn/authenticate/options
 * Generate authentication options for WebAuthn credential assertion
 */
router.post('/authenticate/options', webauthnRateLimit, authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          retryable: false
        }
      });
    }

    if (user.webAuthnCredentials.length === 0) {
      return res.status(400).json({
        error: {
          code: 'NO_CREDENTIALS',
          message: 'No WebAuthn credentials registered. Please register a credential first.',
          retryable: false
        }
      });
    }

    // Get user's credentials for authentication
    const allowCredentials = user.webAuthnCredentials.map(cred => ({
      id: cred.credentialID, // Keep as base64url string
      type: 'public-key',
      transports: cred.transports
    }));

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials,
      userVerification: 'required',
      timeout: 120000 // 2 minutes timeout for Windows Hello
    });

    // Store the challenge in the user document
    user.currentChallenge = options.challenge;
    await user.save();

    res.json(options);
  } catch (error) {
    console.error('WebAuthn authentication options error:', error);
    console.error('Auth options error details:', {
      message: error.message,
      stack: error.stack,
      userId: req.user?.id
    });
    res.status(500).json({
      error: {
        code: 'WEBAUTHN_OPTIONS_ERROR',
        message: 'Failed to generate authentication options',
        retryable: true
      }
    });
  }
});

/**
 * POST /api/webauthn/authenticate/verify
 * Verify WebAuthn authentication response
 */
const verifyAuthenticationSchema = Joi.object({
  id: Joi.string().required(),
  rawId: Joi.string().required(),
  response: Joi.object({
    authenticatorData: Joi.string().required(),
    clientDataJSON: Joi.string().required(),
    signature: Joi.string().required(),
    userHandle: Joi.string().allow(null, '').optional()
  }).unknown(true).required(),
  type: Joi.string().valid('public-key').required(),
  clientExtensionResults: Joi.object().optional(),
  authenticatorAttachment: Joi.string().optional()
}).unknown(true); // Allow additional properties that might be sent by the browser

router.post('/authenticate/verify', 
  webauthnRateLimit,
  authenticate, 
  validate(verifyAuthenticationSchema),
  async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found',
            retryable: false
          }
        });
      }

      if (!user.currentChallenge) {
        return res.status(400).json({
          error: {
            code: 'NO_CHALLENGE',
            message: 'No authentication challenge found. Please request authentication options first.',
            retryable: true
          }
        });
      }

      // Find the credential being used
      const credentialID = req.body.id;
      const credential = user.webAuthnCredentials.find(
        cred => cred.credentialID === credentialID
      );

      if (!credential) {
        return res.status(400).json({
          error: {
            code: 'CREDENTIAL_NOT_FOUND',
            message: 'Credential not found for this user',
            retryable: false
          }
        });
      }

      const verification = await verifyAuthenticationResponse({
        response: req.body,
        expectedChallenge: user.currentChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        authenticator: {
          credentialID: credential.credentialID, // Use as string
          credentialPublicKey: Buffer.from(credential.publicKey, 'base64url'),
          counter: credential.counter
        },
        requireUserVerification: true
      });

      if (verification.verified) {
        // Update the counter
        credential.counter = verification.authenticationInfo.newCounter;
        
        // Clear the challenge
        user.currentChallenge = null;
        await user.save();

        res.json({
          verified: true,
          message: 'WebAuthn authentication successful'
        });
      } else {
        res.status(400).json({
          error: {
            code: 'VERIFICATION_FAILED',
            message: 'WebAuthn authentication verification failed',
            retryable: true
          }
        });
      }
    } catch (error) {
      console.error('WebAuthn authentication verification error:', error);
      res.status(500).json({
        error: {
          code: 'WEBAUTHN_VERIFICATION_ERROR',
          message: 'Failed to verify authentication response',
          retryable: true
        }
      });
    }
  }
);

module.exports = router;