const request = require('supertest');
const app = require('../src/server');
const { User, Category, Award, Nominee, Vote } = require('../src/models');
const jwtService = require('../src/services/jwtService');

describe('Vote Routes', () => {
  let testUser, testPanelist, testCategory, testAward, testNominee, testNominee2;
  let userTokens, panelistTokens;

  beforeEach(async () => {
    // Clean up database
    await Vote.deleteMany({});
    await User.deleteMany({});
    await Category.deleteMany({});
    await Award.deleteMany({});
    await Nominee.deleteMany({});

    // Create test users
    testUser = await User.create({
      googleId: 'test-user-google-id',
      email: 'user@test.com',
      name: 'Test User',
      role: 'User',
      webAuthnCredentials: [{ credentialID: 'test-credential', publicKey: 'test-key' }]
    });

    testPanelist = await User.create({
      googleId: 'test-panelist-google-id',
      email: 'panelist@test.com',
      name: 'Test Panelist',
      role: 'Panelist',
      webAuthnCredentials: [{ credentialID: 'test-credential', publicKey: 'test-key' }]
    });

    // Generate tokens
    userTokens = jwtService.generateTokenPair(testUser);
    panelistTokens = jwtService.generateTokenPair(testPanelist);

    // Create test content
    testCategory = await Category.create({
      name: 'Test Category',
      description: 'Test category description',
      slug: 'test-category',
      createdBy: testPanelist._id
    });

    testAward = await Award.create({
      title: 'Test Award',
      criteria: 'Test award criteria',
      categoryId: testCategory._id,
      createdBy: testPanelist._id,
      isActive: true
    });

    testNominee = await Nominee.create({
      name: 'Test Nominee 1',
      bio: 'First test nominee biography',
      awardId: testAward._id,
      createdBy: testPanelist._id
    });

    testNominee2 = await Nominee.create({
      name: 'Test Nominee 2',
      bio: 'Second test nominee biography',
      awardId: testAward._id,
      createdBy: testPanelist._id
    });
  });

  describe('POST /api/votes', () => {
    it('should submit vote successfully with biometric verification', async () => {
      const voteData = {
        awardId: testAward._id.toString(),
        nomineeId: testNominee._id.toString()
      };

      const response = await request(app)
        .post('/api/votes')
        .set('Authorization', `Bearer ${userTokens.accessToken}`)
        .set('x-biometric-verified', 'true')
        .send(voteData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Vote submitted successfully');
      expect(response.body.vote).toBeDefined();
      expect(response.body.vote.awardId).toBe(testAward._id.toString());
      expect(response.body.vote.nomineeId).toBe(testNominee._id.toString());
    });

    it('should require authentication', async () => {
      const voteData = {
        awardId: testAward._id.toString(),
        nomineeId: testNominee._id.toString()
      };

      await request(app)
        .post('/api/votes')
        .send(voteData)
        .expect(401);
    });

    it('should require biometric verification', async () => {
      const voteData = {
        awardId: testAward._id.toString(),
        nomineeId: testNominee._id.toString()
      };

      const response = await request(app)
        .post('/api/votes')
        .set('Authorization', `Bearer ${userTokens.accessToken}`)
        .send(voteData)
        .expect(428);

      expect(response.body.error.code).toBe('BIOMETRIC_VERIFICATION_REQUIRED');
    });

    it('should require WebAuthn credentials setup', async () => {
      // Create user without WebAuthn credentials
      const userWithoutCredentials = await User.create({
        googleId: 'no-credentials-user',
        email: 'nocreds@test.com',
        name: 'No Credentials User',
        role: 'User',
        webAuthnCredentials: []
      });

      const tokens = jwtService.generateTokenPair(userWithoutCredentials);

      const voteData = {
        awardId: testAward._id.toString(),
        nomineeId: testNominee._id.toString()
      };

      const response = await request(app)
        .post('/api/votes')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send(voteData)
        .expect(428);

      expect(response.body.error.code).toBe('BIOMETRIC_SETUP_REQUIRED');
    });

    it('should prevent duplicate votes', async () => {
      const voteData = {
        awardId: testAward._id.toString(),
        nomineeId: testNominee._id.toString()
      };

      // First vote should succeed
      await request(app)
        .post('/api/votes')
        .set('Authorization', `Bearer ${userTokens.accessToken}`)
        .set('x-biometric-verified', 'true')
        .send(voteData)
        .expect(201);

      // Second vote should fail
      const response = await request(app)
        .post('/api/votes')
        .set('Authorization', `Bearer ${userTokens.accessToken}`)
        .set('x-biometric-verified', 'true')
        .send(voteData)
        .expect(409);

      expect(response.body.error.code).toBe('DUPLICATE_VOTE');
    });

    it('should validate request data', async () => {
      const invalidVoteData = {
        awardId: 'invalid-id',
        nomineeId: testNominee._id.toString()
      };

      await request(app)
        .post('/api/votes')
        .set('Authorization', `Bearer ${userTokens.accessToken}`)
        .set('x-biometric-verified', 'true')
        .send(invalidVoteData)
        .expect(400);
    });

    it('should handle non-existent award', async () => {
      const voteData = {
        awardId: '507f1f77bcf86cd799439011', // Valid ObjectId but non-existent
        nomineeId: testNominee._id.toString()
      };

      const response = await request(app)
        .post('/api/votes')
        .set('Authorization', `Bearer ${userTokens.accessToken}`)
        .set('x-biometric-verified', 'true')
        .send(voteData)
        .expect(404);

      expect(response.body.error.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('should handle inactive award', async () => {
      // Create inactive award
      const inactiveAward = await Award.create({
        title: 'Inactive Award',
        criteria: 'Inactive award criteria',
        categoryId: testCategory._id,
        createdBy: testPanelist._id,
        isActive: false
      });

      const voteData = {
        awardId: inactiveAward._id.toString(),
        nomineeId: testNominee._id.toString()
      };

      const response = await request(app)
        .post('/api/votes')
        .set('Authorization', `Bearer ${userTokens.accessToken}`)
        .set('x-biometric-verified', 'true')
        .send(voteData)
        .expect(400);

      expect(response.body.error.code).toBe('VOTING_NOT_AVAILABLE');
    });
  });

  describe('GET /api/votes/my-history', () => {
    beforeEach(async () => {
      // Create some votes for the test user
      await Vote.create({
        userId: testUser._id,
        awardId: testAward._id,
        nomineeId: testNominee._id,
        biometricVerified: true
      });
    });

    it('should return user voting history', async () => {
      const response = await request(app)
        .get('/api/votes/my-history')
        .set('Authorization', `Bearer ${userTokens.accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.votes).toHaveLength(1);
      expect(response.body.votes[0].award.id).toBe(testAward._id.toString());
      expect(response.body.votes[0].nominee.id).toBe(testNominee._id.toString());
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/votes/my-history')
        .expect(401);
    });

    it('should return empty array for user with no votes', async () => {
      const response = await request(app)
        .get('/api/votes/my-history')
        .set('Authorization', `Bearer ${panelistTokens.accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.votes).toHaveLength(0);
    });
  });

  describe('GET /api/votes/counts/:awardId', () => {
    beforeEach(async () => {
      // Create some votes
      await Vote.create({
        userId: testUser._id,
        awardId: testAward._id,
        nomineeId: testNominee._id,
        biometricVerified: true
      });

      await Vote.create({
        userId: testPanelist._id,
        awardId: testAward._id,
        nomineeId: testNominee2._id,
        biometricVerified: true
      });
    });

    it('should return vote counts for award', async () => {
      const response = await request(app)
        .get(`/api/votes/counts/${testAward._id}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.awardId).toBe(testAward._id.toString());
      expect(response.body.counts).toHaveLength(2);
      expect(response.body.totalVotes).toBe(2);
      expect(response.body.lastUpdated).toBeDefined();

      // Check that both nominees have counts
      const nominee1Count = response.body.counts.find(c => c.nominee.id === testNominee._id.toString());
      const nominee2Count = response.body.counts.find(c => c.nominee.id === testNominee2._id.toString());
      
      expect(nominee1Count.voteCount).toBe(1);
      expect(nominee2Count.voteCount).toBe(1);
    });

    it('should handle invalid award ID format', async () => {
      const response = await request(app)
        .get('/api/votes/counts/invalid-id')
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_AWARD_ID');
    });

    it('should return empty counts for award with no votes', async () => {
      const anotherAward = await Award.create({
        title: 'Another Award',
        criteria: 'Another award criteria',
        categoryId: testCategory._id,
        createdBy: testPanelist._id,
        isActive: true
      });

      const response = await request(app)
        .get(`/api/votes/counts/${anotherAward._id}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.counts).toHaveLength(0);
      expect(response.body.totalVotes).toBe(0);
    });

    it('should not require authentication (public endpoint)', async () => {
      await request(app)
        .get(`/api/votes/counts/${testAward._id}`)
        .expect(200);
    });
  });

  describe('GET /api/votes/results', () => {
    beforeEach(async () => {
      // Create votes for testing
      await Vote.create({
        userId: testUser._id,
        awardId: testAward._id,
        nomineeId: testNominee._id,
        biometricVerified: true
      });

      await Vote.create({
        userId: testPanelist._id,
        awardId: testAward._id,
        nomineeId: testNominee2._id,
        biometricVerified: true
      });
    });

    it('should return results for all active awards', async () => {
      const response = await request(app)
        .get('/api/votes/results')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.results).toHaveLength(1);
      expect(response.body.generatedAt).toBeDefined();

      const awardResult = response.body.results[0];
      expect(awardResult.award.id).toBe(testAward._id.toString());
      expect(awardResult.award.title).toBe(testAward.title);
      expect(awardResult.nominees).toHaveLength(2);
      expect(awardResult.totalVotes).toBe(2);

      // Results should be sorted by vote count descending
      expect(awardResult.nominees[0].voteCount).toBeGreaterThanOrEqual(awardResult.nominees[1].voteCount);
    });

    it('should not require authentication (public endpoint)', async () => {
      await request(app)
        .get('/api/votes/results')
        .expect(200);
    });

    it('should exclude inactive awards', async () => {
      // Create inactive award with votes
      const inactiveAward = await Award.create({
        title: 'Inactive Award',
        criteria: 'Inactive award criteria',
        categoryId: testCategory._id,
        createdBy: testPanelist._id,
        isActive: false
      });

      const inactiveNominee = await Nominee.create({
        name: 'Inactive Nominee',
        bio: 'Inactive nominee bio',
        awardId: inactiveAward._id,
        createdBy: testPanelist._id
      });

      await Vote.create({
        userId: testUser._id,
        awardId: inactiveAward._id,
        nomineeId: inactiveNominee._id,
        biometricVerified: true
      });

      const response = await request(app)
        .get('/api/votes/results')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.results).toHaveLength(1); // Only active award
      expect(response.body.results[0].award.id).toBe(testAward._id.toString());
    });
  });

  describe('GET /api/votes/check/:awardId', () => {
    it('should return false when user has not voted', async () => {
      const response = await request(app)
        .get(`/api/votes/check/${testAward._id}`)
        .set('Authorization', `Bearer ${userTokens.accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.hasVoted).toBe(false);
      expect(response.body.vote).toBeNull();
    });

    it('should return true when user has voted', async () => {
      // Create a vote
      const vote = await Vote.create({
        userId: testUser._id,
        awardId: testAward._id,
        nomineeId: testNominee._id,
        biometricVerified: true
      });

      const response = await request(app)
        .get(`/api/votes/check/${testAward._id}`)
        .set('Authorization', `Bearer ${userTokens.accessToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.hasVoted).toBe(true);
      expect(response.body.vote).toBeDefined();
      expect(response.body.vote.id).toBe(vote._id.toString());
      expect(response.body.vote.nomineeId).toBe(testNominee._id.toString());
    });

    it('should require authentication', async () => {
      await request(app)
        .get(`/api/votes/check/${testAward._id}`)
        .expect(401);
    });

    it('should handle invalid award ID format', async () => {
      const response = await request(app)
        .get('/api/votes/check/invalid-id')
        .set('Authorization', `Bearer ${userTokens.accessToken}`)
        .expect(400);

      expect(response.body.error.code).toBe('INVALID_AWARD_ID');
    });
  });
});