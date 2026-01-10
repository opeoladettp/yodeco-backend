const request = require('supertest');
const app = require('../src/server');
const User = require('../src/models/User');
const { jwtService } = require('../src/services');

describe('WebAuthn Biometric Verification', () => {
  let testUser;
  let userTokens;

  beforeEach(async () => {
    // Create test user
    testUser = new User({
      googleId: 'test-google-id-webauthn',
      email: 'webauthn@test.com',
      name: 'WebAuthn Test User',
      role: 'User'
    });
    await testUser.save();

    // Generate tokens for the user
    userTokens = jwtService.generateTokenPair({
      _id: testUser._id,
      email: testUser.email,
      role: testUser.role
    });
  });

  describe('WebAuthn Registration', () => {
    describe('POST /api/webauthn/register/options', () => {
      it('should generate registration options for authenticated user', async () => {
        const response = await request(app)
          .post('/api/webauthn/register/options')
          .set('Authorization', `Bearer ${userTokens.accessToken}`)
          .expect(200);

        expect(response.body).toBeDefined();
        expect(response.body.challenge).toBeDefined();
        expect(response.body.rp).toBeDefined();
        expect(response.body.user).toBeDefined();
        expect(response.body.user.id).toBeDefined(); // Will be base64url encoded
        expect(Buffer.from(response.body.user.id, 'base64url').toString()).toBe(testUser._id.toString());
        expect(response.body.user.name).toBe(testUser.email);
        expect(response.body.user.displayName).toBe(testUser.name);
        expect(response.body.authenticatorSelection).toBeDefined();
        expect(response.body.authenticatorSelection.authenticatorAttachment).toBe('platform');
        expect(response.body.authenticatorSelection.userVerification).toBe('required');

        // Verify challenge is stored in user document
        const updatedUser = await User.findById(testUser._id);
        expect(updatedUser.currentChallenge).toBe(response.body.challenge);
      });

      it('should require authentication', async () => {
        await request(app)
          .post('/api/webauthn/register/options')
          .expect(401);
      });

      it('should return 401 for deleted user with valid token', async () => {
        // Delete the user but keep the token
        await User.findByIdAndDelete(testUser._id);

        await request(app)
          .post('/api/webauthn/register/options')
          .set('Authorization', `Bearer ${userTokens.accessToken}`)
          .expect(401); // Token becomes invalid when user is deleted
      });
    });

    describe('POST /api/webauthn/register/verify', () => {
      it('should require authentication', async () => {
        await request(app)
          .post('/api/webauthn/register/verify')
          .send({
            id: 'test-credential-id',
            rawId: 'test-raw-id',
            response: {
              attestationObject: 'test-attestation',
              clientDataJSON: 'test-client-data'
            },
            type: 'public-key'
          })
          .expect(401);
      });

      it('should validate request body', async () => {
        await request(app)
          .post('/api/webauthn/register/verify')
          .set('Authorization', `Bearer ${userTokens.accessToken}`)
          .send({
            // Missing required fields
            id: 'test-credential-id'
          })
          .expect(400);
      });

      it('should require challenge to be set first', async () => {
        await request(app)
          .post('/api/webauthn/register/verify')
          .set('Authorization', `Bearer ${userTokens.accessToken}`)
          .send({
            id: 'test-credential-id',
            rawId: 'test-raw-id',
            response: {
              attestationObject: 'test-attestation',
              clientDataJSON: 'test-client-data'
            },
            type: 'public-key'
          })
          .expect(400);

        // Should get error about no challenge
        const response = await request(app)
          .post('/api/webauthn/register/verify')
          .set('Authorization', `Bearer ${userTokens.accessToken}`)
          .send({
            id: 'test-credential-id',
            rawId: 'test-raw-id',
            response: {
              attestationObject: 'test-attestation',
              clientDataJSON: 'test-client-data'
            },
            type: 'public-key'
          });

        expect(response.body.error.code).toBe('NO_CHALLENGE');
      });
    });
  });

  describe('WebAuthn Authentication', () => {
    describe('POST /api/webauthn/authenticate/options', () => {
      it('should generate authentication options for user with credentials', async () => {
        // First add a mock credential to the user
        testUser.webAuthnCredentials.push({
          credentialID: 'test-credential-id',
          publicKey: 'test-public-key',
          counter: 0,
          transports: ['internal']
        });
        await testUser.save();

        const response = await request(app)
          .post('/api/webauthn/authenticate/options')
          .set('Authorization', `Bearer ${userTokens.accessToken}`)
          .expect(200);

        expect(response.body).toBeDefined();
        expect(response.body.challenge).toBeDefined();
        expect(response.body.allowCredentials).toBeDefined();
        expect(response.body.allowCredentials).toHaveLength(1);
        expect(response.body.userVerification).toBe('required');

        // Verify challenge is stored in user document
        const updatedUser = await User.findById(testUser._id);
        expect(updatedUser.currentChallenge).toBe(response.body.challenge);
      });

      it('should require authentication', async () => {
        await request(app)
          .post('/api/webauthn/authenticate/options')
          .expect(401);
      });

      it('should return error for user without credentials', async () => {
        const response = await request(app)
          .post('/api/webauthn/authenticate/options')
          .set('Authorization', `Bearer ${userTokens.accessToken}`)
          .expect(400);

        expect(response.body.error.code).toBe('NO_CREDENTIALS');
      });
    });

    describe('POST /api/webauthn/authenticate/verify', () => {
      it('should require authentication', async () => {
        await request(app)
          .post('/api/webauthn/authenticate/verify')
          .send({
            id: 'test-credential-id',
            rawId: 'test-raw-id',
            response: {
              authenticatorData: 'test-auth-data',
              clientDataJSON: 'test-client-data',
              signature: 'test-signature'
            },
            type: 'public-key'
          })
          .expect(401);
      });

      it('should validate request body', async () => {
        await request(app)
          .post('/api/webauthn/authenticate/verify')
          .set('Authorization', `Bearer ${userTokens.accessToken}`)
          .send({
            // Missing required fields
            id: 'test-credential-id'
          })
          .expect(400);
      });

      it('should require challenge to be set first', async () => {
        const response = await request(app)
          .post('/api/webauthn/authenticate/verify')
          .set('Authorization', `Bearer ${userTokens.accessToken}`)
          .send({
            id: 'test-credential-id',
            rawId: 'test-raw-id',
            response: {
              authenticatorData: 'test-auth-data',
              clientDataJSON: 'test-client-data',
              signature: 'test-signature'
            },
            type: 'public-key'
          });

        expect(response.body.error.code).toBe('NO_CHALLENGE');
      });
    });
  });

  describe('WebAuthn Service', () => {
    const WebAuthnService = require('../src/services/webauthnService');

    it('should check if user has credentials', async () => {
      // User without credentials
      let hasCredentials = await WebAuthnService.hasCredentials(testUser._id);
      expect(hasCredentials).toBe(false);

      // Add credential to user
      testUser.webAuthnCredentials.push({
        credentialID: 'test-credential-id',
        publicKey: 'test-public-key',
        counter: 0,
        transports: ['internal']
      });
      await testUser.save();

      // User with credentials
      hasCredentials = await WebAuthnService.hasCredentials(testUser._id);
      expect(hasCredentials).toBe(true);
    });

    it('should get user credentials', async () => {
      // Add credential to user
      const testCredential = {
        credentialID: 'test-credential-id',
        publicKey: 'test-public-key',
        counter: 0,
        transports: ['internal']
      };
      testUser.webAuthnCredentials.push(testCredential);
      await testUser.save();

      const credentials = await WebAuthnService.getUserCredentials(testUser._id);
      expect(credentials).toHaveLength(1);
      expect(credentials[0].credentialID).toBe(testCredential.credentialID);
    });

    it('should handle non-existent user gracefully', async () => {
      const fakeUserId = '507f1f77bcf86cd799439011';
      
      const hasCredentials = await WebAuthnService.hasCredentials(fakeUserId);
      expect(hasCredentials).toBe(false);

      const credentials = await WebAuthnService.getUserCredentials(fakeUserId);
      expect(credentials).toEqual([]);
    });
  });

  describe('Biometric Authentication Middleware', () => {
    const { requireBiometricVerification } = require('../src/middleware/biometricAuth');

    it('should require authentication first', async () => {
      const req = {};
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      await requireBiometricVerification(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required',
          retryable: false
        }
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should require WebAuthn registration', async () => {
      const req = {
        user: { id: testUser._id }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      await requireBiometricVerification(req, res, next);

      expect(res.status).toHaveBeenCalledWith(428);
      expect(res.json).toHaveBeenCalledWith({
        error: {
          code: 'BIOMETRIC_REGISTRATION_REQUIRED',
          message: 'Biometric authentication must be registered before performing this action',
          retryable: false,
          details: {
            registrationEndpoint: '/api/webauthn/register/options'
          }
        }
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should require biometric verification header', async () => {
      // Add credential to user
      testUser.webAuthnCredentials.push({
        credentialID: 'test-credential-id',
        publicKey: 'test-public-key',
        counter: 0,
        transports: ['internal']
      });
      await testUser.save();

      const req = {
        user: { id: testUser._id },
        headers: {}
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      await requireBiometricVerification(req, res, next);

      expect(res.status).toHaveBeenCalledWith(428);
      expect(res.json).toHaveBeenCalledWith({
        error: {
          code: 'BIOMETRIC_VERIFICATION_REQUIRED',
          message: 'Biometric verification required for this action',
          retryable: true,
          details: {
            authenticationEndpoint: '/api/webauthn/authenticate/options'
          }
        }
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should allow access with proper biometric verification', async () => {
      // Add credential to user
      testUser.webAuthnCredentials.push({
        credentialID: 'test-credential-id',
        publicKey: 'test-public-key',
        counter: 0,
        transports: ['internal']
      });
      await testUser.save();

      const req = {
        user: { id: testUser._id },
        headers: {
          'x-biometric-verified': 'true'
        }
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      await requireBiometricVerification(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});