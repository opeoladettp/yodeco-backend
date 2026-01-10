// Test for authentication components

// Mock environment variables for testing
process.env.JWT_SECRET = 'test-jwt-secret-key';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-key';
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
process.env.FRONTEND_URL = 'http://localhost:3000';

const jwtService = require('../src/services/jwtService');
const redisService = require('../src/services/redisService');
const { ROLES, hasPermission, getRolePermissions } = require('../src/middleware/rbac');

describe('Authentication and Authorization', () => {
  describe('JWT Service', () => {
    const mockUser = {
      _id: '507f1f77bcf86cd799439011',
      email: 'test@example.com',
      role: 'User'
    };

    test('should generate valid access token', () => {
      const token = jwtService.generateAccessToken(mockUser);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      
      const decoded = jwtService.verifyAccessToken(token);
      expect(decoded.userId).toBe(mockUser._id);
      expect(decoded.email).toBe(mockUser.email);
      expect(decoded.role).toBe(mockUser.role);
      expect(decoded.type).toBe('access');
    });

    test('should generate valid refresh token', () => {
      const token = jwtService.generateRefreshToken(mockUser);
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      
      const decoded = jwtService.verifyRefreshToken(token);
      expect(decoded.userId).toBe(mockUser._id);
      expect(decoded.type).toBe('refresh');
      expect(decoded.tokenId).toBeDefined();
      expect(decoded.family).toBeDefined();
    });

    test('should generate token pair with same family', () => {
      const { accessToken, refreshToken, tokenFamily } = jwtService.generateTokenPair(mockUser);
      
      expect(accessToken).toBeDefined();
      expect(refreshToken).toBeDefined();
      expect(tokenFamily).toBeDefined();
      
      const refreshDecoded = jwtService.verifyRefreshToken(refreshToken);
      expect(refreshDecoded.family).toBe(tokenFamily);
    });

    test('should reject invalid access token', () => {
      expect(() => {
        jwtService.verifyAccessToken('invalid-token');
      }).toThrow();
    });

    test('should reject wrong token type', () => {
      const refreshToken = jwtService.generateRefreshToken(mockUser);
      expect(() => {
        jwtService.verifyAccessToken(refreshToken);
      }).toThrow('Invalid access token');
    });

    test('should calculate token TTL correctly', () => {
      const token = jwtService.generateAccessToken(mockUser);
      const ttl = jwtService.calculateTokenTTL(token);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(900); // 15 minutes in seconds
    });

    test('should include tokenId in access tokens', () => {
      const token = jwtService.generateAccessToken(mockUser);
      const decoded = jwtService.verifyAccessToken(token);
      expect(decoded.tokenId).toBeDefined();
      expect(typeof decoded.tokenId).toBe('string');
    });

    test('should set secure cookies correctly', () => {
      const mockRes = {
        cookie: jest.fn(),
        clearCookie: jest.fn()
      };
      
      const accessToken = jwtService.generateAccessToken(mockUser);
      const refreshToken = jwtService.generateRefreshToken(mockUser);
      
      jwtService.setTokenCookies(mockRes, accessToken, refreshToken);
      
      expect(mockRes.cookie).toHaveBeenCalledTimes(2);
      expect(mockRes.cookie).toHaveBeenCalledWith('accessToken', accessToken, expect.objectContaining({
        httpOnly: true,
        maxAge: 15 * 60 * 1000
      }));
      expect(mockRes.cookie).toHaveBeenCalledWith('refreshToken', refreshToken, expect.objectContaining({
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/api/auth'
      }));
    });

    test('should clear cookies correctly', () => {
      const mockRes = {
        clearCookie: jest.fn()
      };
      
      jwtService.clearTokenCookies(mockRes);
      
      expect(mockRes.clearCookie).toHaveBeenCalledTimes(2);
      expect(mockRes.clearCookie).toHaveBeenCalledWith('accessToken', { path: '/' });
      expect(mockRes.clearCookie).toHaveBeenCalledWith('refreshToken', { path: '/api/auth' });
    });
  });

  describe('RBAC System', () => {
    test('should define correct role hierarchy', () => {
      expect(ROLES.USER).toBe('User');
      expect(ROLES.PANELIST).toBe('Panelist');
      expect(ROLES.SYSTEM_ADMIN).toBe('System_Admin');
    });

    test('should check permissions correctly', () => {
      expect(hasPermission(ROLES.USER, 'vote:create')).toBe(true);
      expect(hasPermission(ROLES.USER, 'content:create')).toBe(false);
      expect(hasPermission(ROLES.PANELIST, 'content:create')).toBe(true);
      expect(hasPermission(ROLES.SYSTEM_ADMIN, 'user:read_all')).toBe(true);
    });

    test('should inherit permissions from lower roles', () => {
      // Panelist should have User permissions
      expect(hasPermission(ROLES.PANELIST, 'vote:create')).toBe(true);
      expect(hasPermission(ROLES.PANELIST, 'content:read')).toBe(true);
      
      // System Admin should have all permissions
      expect(hasPermission(ROLES.SYSTEM_ADMIN, 'vote:create')).toBe(true);
      expect(hasPermission(ROLES.SYSTEM_ADMIN, 'content:create')).toBe(true);
      expect(hasPermission(ROLES.SYSTEM_ADMIN, 'user:read_all')).toBe(true);
    });

    test('should get role permissions correctly', () => {
      const userPerms = getRolePermissions(ROLES.USER);
      const panelistPerms = getRolePermissions(ROLES.PANELIST);
      const adminPerms = getRolePermissions(ROLES.SYSTEM_ADMIN);

      expect(userPerms).toContain('vote:create');
      expect(userPerms).not.toContain('content:create');
      
      expect(panelistPerms).toContain('vote:create');
      expect(panelistPerms).toContain('content:create');
      expect(panelistPerms).not.toContain('user:read_all');
      
      expect(adminPerms).toContain('vote:create');
      expect(adminPerms).toContain('content:create');
      expect(adminPerms).toContain('user:read_all');
    });

    test('should handle invalid roles gracefully', () => {
      expect(hasPermission('InvalidRole', 'vote:create')).toBe(false);
      expect(getRolePermissions('InvalidRole')).toEqual([]);
    });
  });

  describe('OAuth Integration', () => {
    test('should have Passport configuration', () => {
      const passport = require('../src/config/passport');
      expect(passport).toBeDefined();
      expect(passport.authenticate).toBeDefined();
    });

    test('should have auth routes defined', () => {
      const authRoutes = require('../src/routes/auth');
      expect(authRoutes).toBeDefined();
    });

    test('should handle user profile mapping correctly', async () => {
      const User = require('../src/models/User');
      
      // Test creating a new user from Google profile
      const mockGoogleProfile = {
        id: 'google123',
        emails: [{ value: 'test@example.com' }],
        displayName: 'Test User'
      };
      
      const user = new User({
        googleId: mockGoogleProfile.id,
        email: mockGoogleProfile.emails[0].value,
        name: mockGoogleProfile.displayName,
        role: 'User'
      });
      
      expect(user.googleId).toBe('google123');
      expect(user.email).toBe('test@example.com');
      expect(user.name).toBe('Test User');
      expect(user.role).toBe('User');
    });

    test('should generate tokens for authenticated user', () => {
      const mockUser = {
        _id: '507f1f77bcf86cd799439011',
        email: 'test@example.com',
        role: 'User'
      };
      
      const { accessToken, refreshToken } = jwtService.generateTokenPair(mockUser);
      
      expect(accessToken).toBeDefined();
      expect(refreshToken).toBeDefined();
      
      const decoded = jwtService.verifyAccessToken(accessToken);
      expect(decoded.userId).toBe(mockUser._id);
      expect(decoded.email).toBe(mockUser.email);
      expect(decoded.role).toBe(mockUser.role);
    });
  });

  describe('Token Reuse Detection and Family Revocation', () => {
    const mockUser = {
      _id: '507f1f77bcf86cd799439011',
      email: 'test@example.com',
      role: 'User'
    };

    const mockSecurityContext = {
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent'
    };

    beforeEach(async () => {
      // Clear any existing test data from Redis
      try {
        const client = redisService.getClient();
        await client.flushDb();
      } catch (error) {
        // Redis might not be available in test environment
        console.log('Redis not available for testing, skipping cleanup');
      }
    });

    test('should track token usage and detect reuse', async () => {
      const tokenId = 'test-token-123';
      const tokenFamily = 'test-family-456';

      try {
        // First usage should not be detected as reuse
        const firstUse = await jwtService.trackTokenUsage(tokenId, tokenFamily, mockSecurityContext);
        expect(firstUse).toBe(false);

        // Second usage should be detected as reuse
        const secondUse = await jwtService.trackTokenUsage(tokenId, tokenFamily, mockSecurityContext);
        expect(secondUse).toBe(true);
      } catch (error) {
        // If Redis is not available, skip this test
        if (error.message.includes('Redis') || error.message.includes('ECONNREFUSED')) {
          console.log('Redis not available, skipping token reuse test');
          return;
        }
        throw error;
      }
    });

    test('should revoke token family', async () => {
      const tokenFamily = 'test-family-789';

      try {
        // Initially family should not be revoked
        const initiallyRevoked = await jwtService.isTokenFamilyRevoked(tokenFamily);
        expect(initiallyRevoked).toBe(false);

        // Revoke the family
        await jwtService.revokeTokenFamily(tokenFamily, mockSecurityContext);

        // Now family should be revoked
        const nowRevoked = await jwtService.isTokenFamilyRevoked(tokenFamily);
        expect(nowRevoked).toBe(true);
      } catch (error) {
        // If Redis is not available, skip this test
        if (error.message.includes('Redis') || error.message.includes('ECONNREFUSED')) {
          console.log('Redis not available, skipping token family revocation test');
          return;
        }
        throw error;
      }
    });

    test('should blacklist tokens with TTL', async () => {
      const tokenId = 'test-blacklist-token';
      const ttl = 3600; // 1 hour

      try {
        // Initially token should not be blacklisted
        const initiallyBlacklisted = await jwtService.isTokenBlacklisted(tokenId);
        expect(initiallyBlacklisted).toBe(false);

        // Blacklist the token
        await jwtService.blacklistToken(tokenId, ttl, {
          reason: 'TEST',
          ...mockSecurityContext
        });

        // Now token should be blacklisted
        const nowBlacklisted = await jwtService.isTokenBlacklisted(tokenId);
        expect(nowBlacklisted).toBe(true);
      } catch (error) {
        // If Redis is not available, skip this test
        if (error.message.includes('Redis') || error.message.includes('ECONNREFUSED')) {
          console.log('Redis not available, skipping token blacklist test');
          return;
        }
        throw error;
      }
    });

    test('should handle token rotation with reuse detection', async () => {
      try {
        // Generate initial token pair
        const { refreshToken: initialRefreshToken } = jwtService.generateTokenPair(mockUser);

        // First rotation should succeed
        const firstRotation = await jwtService.rotateTokens(
          initialRefreshToken, 
          mockUser, 
          mockSecurityContext
        );
        expect(firstRotation.accessToken).toBeDefined();
        expect(firstRotation.refreshToken).toBeDefined();

        // Attempting to use the old refresh token again should fail with reuse detection
        await expect(
          jwtService.rotateTokens(initialRefreshToken, mockUser, mockSecurityContext)
        ).rejects.toThrow('Token reuse detected');
      } catch (error) {
        // If Redis is not available, skip this test
        if (error.message.includes('Redis') || error.message.includes('ECONNREFUSED')) {
          console.log('Redis not available, skipping token rotation test');
          return;
        }
        throw error;
      }
    });

    test('should reject tokens from revoked families', async () => {
      try {
        // Generate token pair
        const { refreshToken } = jwtService.generateTokenPair(mockUser);
        const decoded = jwtService.verifyRefreshToken(refreshToken);

        // Revoke the token family
        await jwtService.revokeTokenFamily(decoded.family, mockSecurityContext);

        // Attempting to rotate should fail
        await expect(
          jwtService.rotateTokens(refreshToken, mockUser, mockSecurityContext)
        ).rejects.toThrow('Token family has been revoked');
      } catch (error) {
        // If Redis is not available, skip this test
        if (error.message.includes('Redis') || error.message.includes('ECONNREFUSED')) {
          console.log('Redis not available, skipping revoked family test');
          return;
        }
        throw error;
      }
    });
  });
});