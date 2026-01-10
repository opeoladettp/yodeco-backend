const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/server');
const { User, Category, Award, Nominee } = require('../src/models');
const jwtService = require('../src/services/jwtService');

describe('Content Management APIs', () => {
  let panelistUser, regularUser, adminUser;
  let panelistTokens, regularTokens, adminTokens;
  let testCategory, testAward, testNominee;

  beforeEach(async () => {
    // Create test users
    panelistUser = await User.create({
      googleId: 'panelist-google-id',
      email: 'panelist@test.com',
      name: 'Test Panelist',
      role: 'Panelist'
    });

    regularUser = await User.create({
      googleId: 'regular-google-id',
      email: 'regular@test.com',
      name: 'Regular User',
      role: 'User'
    });

    adminUser = await User.create({
      googleId: 'admin-google-id',
      email: 'admin@test.com',
      name: 'Admin User',
      role: 'System_Admin'
    });

    // Generate tokens
    panelistTokens = jwtService.generateTokenPair(panelistUser);
    regularTokens = jwtService.generateTokenPair(regularUser);
    adminTokens = jwtService.generateTokenPair(adminUser);
  });

  describe('Category Management', () => {
    describe('POST /api/content/categories', () => {
      it('should create category as panelist', async () => {
        const categoryData = {
          name: 'Test Category',
          description: 'A test category for testing purposes'
        };

        const response = await request(app)
          .post('/api/content/categories')
          .set('Authorization', `Bearer ${panelistTokens.accessToken}`)
          .send(categoryData)
          .expect(201);

        expect(response.body.category).toBeDefined();
        expect(response.body.category.name).toBe(categoryData.name);
        expect(response.body.category.description).toBe(categoryData.description);
        expect(response.body.category.slug).toBe('test-category');
        expect(response.body.category.createdBy._id).toBe(panelistUser._id.toString());

        testCategory = response.body.category;
      });

      it('should deny access to regular users', async () => {
        const categoryData = {
          name: 'Unauthorized Category',
          description: 'This should not be created'
        };

        await request(app)
          .post('/api/content/categories')
          .set('Authorization', `Bearer ${regularTokens.accessToken}`)
          .send(categoryData)
          .expect(403);
      });

      it('should require authentication', async () => {
        const categoryData = {
          name: 'Unauthenticated Category',
          description: 'This should not be created'
        };

        await request(app)
          .post('/api/content/categories')
          .send(categoryData)
          .expect(401);
      });

      it('should validate required fields', async () => {
        await request(app)
          .post('/api/content/categories')
          .set('Authorization', `Bearer ${panelistTokens.accessToken}`)
          .send({})
          .expect(400);
      });
    });

    describe('GET /api/content/categories', () => {
      it('should return categories for public access', async () => {
        const response = await request(app)
          .get('/api/content/categories')
          .expect(200);

        expect(response.body.categories).toBeDefined();
        expect(Array.isArray(response.body.categories)).toBe(true);
        expect(response.body.pagination).toBeDefined();
      });
    });

    describe('GET /api/content/categories/:id', () => {
      it('should return specific category', async () => {
        const response = await request(app)
          .get(`/api/content/categories/${testCategory._id}`)
          .expect(200);

        expect(response.body.category).toBeDefined();
        expect(response.body.category._id).toBe(testCategory._id);
      });

      it('should return 404 for non-existent category', async () => {
        const nonExistentId = new mongoose.Types.ObjectId();
        await request(app)
          .get(`/api/content/categories/${nonExistentId}`)
          .expect(404);
      });
    });
  });

  describe('Award Management', () => {
    describe('POST /api/content/awards', () => {
      it('should create award as panelist', async () => {
        const awardData = {
          title: 'Test Award',
          criteria: 'Criteria for the test award',
          categoryId: testCategory._id
        };

        const response = await request(app)
          .post('/api/content/awards')
          .set('Authorization', `Bearer ${panelistTokens.accessToken}`)
          .send(awardData)
          .expect(201);

        expect(response.body.award).toBeDefined();
        expect(response.body.award.title).toBe(awardData.title);
        expect(response.body.award.criteria).toBe(awardData.criteria);
        expect(response.body.award.categoryId).toBe(testCategory._id);

        testAward = response.body.award;
      });

      it('should deny access to regular users', async () => {
        const awardData = {
          title: 'Unauthorized Award',
          criteria: 'This should not be created',
          categoryId: testCategory._id
        };

        await request(app)
          .post('/api/content/awards')
          .set('Authorization', `Bearer ${regularTokens.accessToken}`)
          .send(awardData)
          .expect(403);
      });

      it('should validate category exists', async () => {
        const nonExistentCategoryId = new mongoose.Types.ObjectId();
        const awardData = {
          title: 'Invalid Award',
          criteria: 'Award with non-existent category',
          categoryId: nonExistentCategoryId
        };

        await request(app)
          .post('/api/content/awards')
          .set('Authorization', `Bearer ${panelistTokens.accessToken}`)
          .send(awardData)
          .expect(404);
      });
    });

    describe('GET /api/content/awards', () => {
      it('should return awards for public access', async () => {
        const response = await request(app)
          .get('/api/content/awards')
          .expect(200);

        expect(response.body.awards).toBeDefined();
        expect(Array.isArray(response.body.awards)).toBe(true);
      });

      it('should filter awards by category', async () => {
        const response = await request(app)
          .get(`/api/content/awards?categoryId=${testCategory._id}`)
          .expect(200);

        expect(response.body.awards).toBeDefined();
        response.body.awards.forEach(award => {
          expect(award.categoryId).toBe(testCategory._id);
        });
      });
    });
  });

  describe('Nominee Management', () => {
    describe('POST /api/content/nominees', () => {
      it('should create nominee as panelist', async () => {
        const nomineeData = {
          name: 'Test Nominee',
          bio: 'Biography of the test nominee',
          awardId: testAward._id
        };

        const response = await request(app)
          .post('/api/content/nominees')
          .set('Authorization', `Bearer ${panelistTokens.accessToken}`)
          .send(nomineeData)
          .expect(201);

        expect(response.body.nominee).toBeDefined();
        expect(response.body.nominee.name).toBe(nomineeData.name);
        expect(response.body.nominee.bio).toBe(nomineeData.bio);
        expect(response.body.nominee.awardId).toBe(testAward._id);

        testNominee = response.body.nominee;
      });

      it('should deny access to regular users', async () => {
        const nomineeData = {
          name: 'Unauthorized Nominee',
          bio: 'This should not be created',
          awardId: testAward._id
        };

        await request(app)
          .post('/api/content/nominees')
          .set('Authorization', `Bearer ${regularTokens.accessToken}`)
          .send(nomineeData)
          .expect(403);
      });

      it('should validate award exists', async () => {
        const nonExistentAwardId = new mongoose.Types.ObjectId();
        const nomineeData = {
          name: 'Invalid Nominee',
          bio: 'Nominee with non-existent award',
          awardId: nonExistentAwardId
        };

        await request(app)
          .post('/api/content/nominees')
          .set('Authorization', `Bearer ${panelistTokens.accessToken}`)
          .send(nomineeData)
          .expect(404);
      });
    });

    describe('GET /api/content/nominees', () => {
      it('should return nominees for public access', async () => {
        const response = await request(app)
          .get('/api/content/nominees')
          .expect(200);

        expect(response.body.nominees).toBeDefined();
        expect(Array.isArray(response.body.nominees)).toBe(true);
      });

      it('should filter nominees by award', async () => {
        const response = await request(app)
          .get(`/api/content/nominees?awardId=${testAward._id}`)
          .expect(200);

        expect(response.body.nominees).toBeDefined();
        response.body.nominees.forEach(nominee => {
          expect(nominee.awardId).toBe(testAward._id);
        });
      });
    });
  });

  describe('Content Hierarchy', () => {
    it('should populate relationships correctly', async () => {
      const response = await request(app)
        .get(`/api/content/categories/${testCategory._id}`)
        .expect(200);

      const category = response.body.category;
      expect(category.awards).toBeDefined();
      expect(Array.isArray(category.awards)).toBe(true);
      
      if (category.awards.length > 0) {
        const award = category.awards[0];
        expect(award.nominees).toBeDefined();
        expect(Array.isArray(award.nominees)).toBe(true);
      }
    });
  });
});