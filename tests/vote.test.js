const { Vote, User, Category, Award, Nominee } = require('../src/models');
const voteService = require('../src/services/voteService');

describe('Vote Model and Service', () => {
  let testUser, testCategory, testAward, testNominee;

  beforeEach(async () => {
    // Clean up database
    await Vote.deleteMany({});
    await User.deleteMany({});
    await Category.deleteMany({});
    await Award.deleteMany({});
    await Nominee.deleteMany({});

    // Create test data
    testUser = await User.create({
      googleId: 'test-google-id',
      email: 'test@example.com',
      name: 'Test User',
      role: 'User'
    });

    testCategory = await Category.create({
      name: 'Test Category',
      description: 'Test category description',
      slug: 'test-category',
      createdBy: testUser._id
    });

    testAward = await Award.create({
      title: 'Test Award',
      criteria: 'Test award criteria',
      categoryId: testCategory._id,
      createdBy: testUser._id,
      isActive: true
    });

    testNominee = await Nominee.create({
      name: 'Test Nominee',
      bio: 'Test nominee biography',
      awardId: testAward._id,
      createdBy: testUser._id
    });
  });

  describe('Vote Model', () => {
    it('should create a valid vote', async () => {
      const voteData = {
        userId: testUser._id,
        awardId: testAward._id,
        nomineeId: testNominee._id,
        biometricVerified: true,
        ipAddress: 'a'.repeat(64) // Valid SHA-256 hash format
      };

      const vote = new Vote(voteData);
      const savedVote = await vote.save();

      expect(savedVote._id).toBeDefined();
      expect(savedVote.userId.toString()).toBe(testUser._id.toString());
      expect(savedVote.awardId.toString()).toBe(testAward._id.toString());
      expect(savedVote.nomineeId.toString()).toBe(testNominee._id.toString());
      expect(savedVote.biometricVerified).toBe(true);
      expect(savedVote.timestamp).toBeDefined();
    });

    it('should enforce compound unique index (userId, awardId)', async () => {
      const voteData = {
        userId: testUser._id,
        awardId: testAward._id,
        nomineeId: testNominee._id,
        biometricVerified: true
      };

      // First vote should succeed
      const vote1 = new Vote(voteData);
      await vote1.save();

      // Second vote with same user and award should fail
      const vote2 = new Vote(voteData);
      await expect(vote2.save()).rejects.toThrow();
    });

    it('should validate nominee belongs to award', async () => {
      // Create another award
      const anotherAward = await Award.create({
        title: 'Another Award',
        criteria: 'Another award criteria',
        categoryId: testCategory._id,
        createdBy: testUser._id,
        isActive: true
      });

      const voteData = {
        userId: testUser._id,
        awardId: anotherAward._id, // Different award
        nomineeId: testNominee._id, // Nominee belongs to testAward
        biometricVerified: true
      };

      const vote = new Vote(voteData);
      await expect(vote.save()).rejects.toThrow('Nominee does not belong to the specified award');
    });

    it('should check if user has voted for award', async () => {
      // Initially no vote
      const existingVote = await Vote.hasUserVotedForAward(testUser._id, testAward._id);
      expect(existingVote).toBeNull();

      // Create a vote
      const vote = new Vote({
        userId: testUser._id,
        awardId: testAward._id,
        nomineeId: testNominee._id,
        biometricVerified: true
      });
      await vote.save();

      // Now should find the vote
      const foundVote = await Vote.hasUserVotedForAward(testUser._id, testAward._id);
      expect(foundVote).toBeTruthy();
      expect(foundVote._id.toString()).toBe(vote._id.toString());
    });

    it('should get vote counts for award', async () => {
      // Create multiple votes for different nominees
      const nominee2 = await Nominee.create({
        name: 'Test Nominee 2',
        bio: 'Second test nominee',
        awardId: testAward._id,
        createdBy: testUser._id
      });

      const user2 = await User.create({
        googleId: 'test-google-id-2',
        email: 'test2@example.com',
        name: 'Test User 2',
        role: 'User'
      });

      // Vote 1: testUser votes for testNominee
      await Vote.create({
        userId: testUser._id,
        awardId: testAward._id,
        nomineeId: testNominee._id,
        biometricVerified: true
      });

      // Vote 2: user2 votes for nominee2
      await Vote.create({
        userId: user2._id,
        awardId: testAward._id,
        nomineeId: nominee2._id,
        biometricVerified: true
      });

      const counts = await Vote.getVoteCountsForAward(testAward._id);
      expect(counts).toHaveLength(2);
      
      const nominee1Count = counts.find(c => c.nomineeId.toString() === testNominee._id.toString());
      const nominee2Count = counts.find(c => c.nomineeId.toString() === nominee2._id.toString());
      
      expect(nominee1Count.count).toBe(1);
      expect(nominee2Count.count).toBe(1);
    });
  });

  describe('Vote Service', () => {
    it('should submit vote successfully', async () => {
      const voteData = {
        userId: testUser._id.toString(),
        awardId: testAward._id.toString(),
        nomineeId: testNominee._id.toString(),
        biometricVerified: true,
        ipAddress: '127.0.0.1'
      };

      const result = await voteService.submitVote(voteData);

      expect(result.success).toBe(true);
      expect(result.vote).toBeDefined();
      expect(result.message).toBe('Vote submitted successfully');
    });

    it('should prevent duplicate votes', async () => {
      const voteData = {
        userId: testUser._id.toString(),
        awardId: testAward._id.toString(),
        nomineeId: testNominee._id.toString(),
        biometricVerified: true,
        ipAddress: '127.0.0.1'
      };

      // First vote should succeed
      await voteService.submitVote(voteData);

      // Second vote should fail
      await expect(voteService.submitVote(voteData)).rejects.toThrow('User has already voted for this award');
    });

    it('should require biometric verification', async () => {
      const voteData = {
        userId: testUser._id.toString(),
        awardId: testAward._id.toString(),
        nomineeId: testNominee._id.toString(),
        biometricVerified: false, // Not verified
        ipAddress: '127.0.0.1'
      };

      await expect(voteService.submitVote(voteData)).rejects.toThrow('Biometric verification is required for vote submission');
    });

    it('should validate required fields', async () => {
      const invalidVoteData = {
        userId: testUser._id.toString(),
        // Missing awardId and nomineeId
        biometricVerified: true
      };

      await expect(voteService.submitVote(invalidVoteData)).rejects.toThrow('Missing required fields');
    });

    it('should validate award exists and is active', async () => {
      // Create inactive award
      const inactiveAward = await Award.create({
        title: 'Inactive Award',
        criteria: 'Inactive award criteria',
        categoryId: testCategory._id,
        createdBy: testUser._id,
        isActive: false
      });

      const voteData = {
        userId: testUser._id.toString(),
        awardId: inactiveAward._id.toString(),
        nomineeId: testNominee._id.toString(),
        biometricVerified: true
      };

      await expect(voteService.submitVote(voteData)).rejects.toThrow('Voting is not active for this award');
    });

    it('should get user voting history', async () => {
      // Create a vote
      await voteService.submitVote({
        userId: testUser._id.toString(),
        awardId: testAward._id.toString(),
        nomineeId: testNominee._id.toString(),
        biometricVerified: true,
        ipAddress: '127.0.0.1'
      });

      const history = await voteService.getUserVotingHistory(testUser._id.toString());
      expect(history).toHaveLength(1);
      expect(history[0].userId.toString()).toBe(testUser._id.toString());
    });

    it('should validate vote data structure', () => {
      const validData = {
        userId: 'user123',
        awardId: 'award123',
        nomineeId: 'nominee123',
        biometricVerified: true
      };

      const result = voteService.validateVoteData(validData);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);

      const invalidData = {
        userId: 'user123',
        // Missing required fields
        biometricVerified: 'not-boolean'
      };

      const invalidResult = voteService.validateVoteData(invalidData);
      expect(invalidResult.isValid).toBe(false);
      expect(invalidResult.errors.length).toBeGreaterThan(0);
    });
  });
});