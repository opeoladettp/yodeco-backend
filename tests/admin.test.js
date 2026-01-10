const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const User = require('../src/models/User');
const jwtService = require('../src/services/jwtService');
const adminRoutes = require('../src/routes/admin');
const { errorHandler } = require('../src/middleware');

// Create a test app without the full server setup
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  app.use(errorHandler);
  return app;
};

describe('Admin User Management', () => {
  let adminUser, regularUser, adminToken, app;

  beforeEach(async () => {
    app = createTestApp();
    
    // Create test users
    adminUser = new User({
      googleId: 'admin123',
      email: 'admin@test.com',
      name: 'Admin User',
      role: 'System_Admin'
    });
    await adminUser.save();

    regularUser = new User({
      googleId: 'user123',
      email: 'user@test.com',
      name: 'Regular User',
      role: 'User'
    });
    await regularUser.save();

    // Generate admin token
    adminToken = jwtService.generateAccessToken(adminUser);
  });

  describe('GET /api/admin/users', () => {
    it('should return list of users for admin', async () => {
      const response = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.users).toBeDefined();
      expect(Array.isArray(response.body.users)).toBe(true);
      expect(response.body.users.length).toBeGreaterThan(0);
      expect(response.body.pagination).toBeDefined();
    });

    it('should deny access to non-admin users', async () => {
      const userToken = jwtService.generateAccessToken(regularUser);
      
      await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/admin/users')
        .expect(401);
    });
  });

  describe('GET /api/admin/users/:userId', () => {
    it('should return specific user for admin', async () => {
      const response = await request(app)
        .get(`/api/admin/users/${regularUser._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.user).toBeDefined();
      expect(response.body.user._id).toBe(regularUser._id.toString());
      expect(response.body.user.email).toBe(regularUser.email);
    });

    it('should return 404 for non-existent user', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      
      await request(app)
        .get(`/api/admin/users/${fakeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('PUT /api/admin/users/:userId/role', () => {
    it('should update user role successfully', async () => {
      const response = await request(app)
        .put(`/api/admin/users/${regularUser._id}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newRole: 'Panelist' })
        .expect(200);

      expect(response.body.message).toBe('User role updated successfully');
      expect(response.body.user.role).toBe('Panelist');
      expect(response.body.user.oldRole).toBe('User');
      expect(response.body.sessionInvalidated).toBe(true);

      // Verify user was actually updated in database
      const updatedUser = await User.findById(regularUser._id);
      expect(updatedUser.role).toBe('Panelist');
    });

    it('should prevent self-role modification', async () => {
      const response = await request(app)
        .put(`/api/admin/users/${adminUser._id}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newRole: 'User' })
        .expect(400);

      expect(response.body.error.code).toBe('SELF_MODIFICATION_DENIED');
    });

    it('should reject invalid roles', async () => {
      const response = await request(app)
        .put(`/api/admin/users/${regularUser._id}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newRole: 'InvalidRole' })
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_ROLE');
    });

    it('should handle role unchanged scenario', async () => {
      // First set user to Panelist
      await User.findByIdAndUpdate(regularUser._id, { role: 'Panelist' });

      const response = await request(app)
        .put(`/api/admin/users/${regularUser._id}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newRole: 'Panelist' })
        .expect(400);

      expect(response.body.error.code).toBe('ROLE_UNCHANGED');
    });

    it('should deny access to non-admin users', async () => {
      const userToken = jwtService.generateAccessToken(regularUser);
      
      await request(app)
        .put(`/api/admin/users/${regularUser._id}/role`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ newRole: 'Panelist' })
        .expect(403);
    });
  });

  describe('PUT /api/admin/users/:userId/promote', () => {
    it('should promote user successfully', async () => {
      // Reset user to User role first
      await User.findByIdAndUpdate(regularUser._id, { role: 'User' });

      const response = await request(app)
        .put(`/api/admin/users/${regularUser._id}/promote`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ newRole: 'Panelist' })
        .expect(200);

      expect(response.body.message).toBe('User role updated successfully');
      expect(response.body.user.role).toBe('Panelist');
      expect(response.body.sessionInvalidated).toBe(true);
    });
  });

  describe('GET /api/admin/audit-logs', () => {
    it('should return audit logs for admin', async () => {
      const response = await request(app)
        .get('/api/admin/audit-logs')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.auditLogs).toBeDefined();
      expect(Array.isArray(response.body.auditLogs)).toBe(true);
      expect(response.body.pagination).toBeDefined();
    });

    it('should deny access to non-admin users', async () => {
      const userToken = jwtService.generateAccessToken(regularUser);
      
      await request(app)
        .get('/api/admin/audit-logs')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });
  });
});