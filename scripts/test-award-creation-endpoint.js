const mongoose = require('mongoose');
const { Category, Award, User } = require('../src/models');

async function testAwardCreationEndpoint() {
  try {
    console.log('🧪 Testing Award Creation Endpoint...\n');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/biometric-voting');
    console.log('✅ Connected to MongoDB\n');

    // Clean up any existing test data
    await Award.deleteMany({ title: { $regex: /Test Award/ } });
    await Category.deleteMany({ name: { $regex: /Test Category/ } });
    await User.deleteMany({ email: { $regex: /test.*@award\.test/ } });

    // Create test user
    const testUser = new User({
      googleId: 'test-user-award-creation',
      email: 'testuser@award.test',
      name: 'Test User',
      role: 'Panelist'
    });
    await testUser.save();
    console.log('✅ Created test user');

    // Create test category
    const testCategory = new Category({
      name: 'Test Category for Award Creation',
      description: 'Test category for award creation testing',
      slug: 'test-award-category',
      createdBy: testUser._id
    });
    await testCategory.save();
    console.log('✅ Created test category');

    // Test 1: Create award with empty dates (frontend scenario)
    console.log('\n🧪 Test 1: Award with empty dates');
    const awardWithEmptyDates = new Award({
      title: 'Test Award with Empty Dates',
      criteria: 'Test criteria for award with empty dates',
      categoryId: testCategory._id,
      createdBy: testUser._id,
      isActive: true,
      allowPublicNomination: false,
      // These fields will be undefined/empty
      nominationStartDate: undefined,
      nominationEndDate: undefined,
      votingStartDate: undefined,
      votingEndDate: undefined
    });

    try {
      await awardWithEmptyDates.save();
      console.log('✅ Award with empty dates saved successfully');
    } catch (error) {
      console.log('❌ Failed to save award with empty dates:', error.message);
    }

    // Test 2: Create award with valid dates
    console.log('\n🧪 Test 2: Award with valid dates');
    const awardWithValidDates = new Award({
      title: 'Test Award with Valid Dates',
      criteria: 'Test criteria for award with valid dates',
      categoryId: testCategory._id,
      createdBy: testUser._id,
      isActive: true,
      allowPublicNomination: true,
      nominationStartDate: new Date('2024-01-15T10:00:00.000Z'),
      nominationEndDate: new Date('2024-01-31T18:00:00.000Z'),
      votingStartDate: new Date('2024-02-01T09:00:00.000Z'),
      votingEndDate: new Date('2024-02-28T17:00:00.000Z')
    });

    try {
      await awardWithValidDates.save();
      console.log('✅ Award with valid dates saved successfully');
    } catch (error) {
      console.log('❌ Failed to save award with valid dates:', error.message);
    }

    // Test 3: Create award with minimal data
    console.log('\n🧪 Test 3: Award with minimal data');
    const minimalAward = new Award({
      title: 'Test Minimal Award',
      criteria: 'Minimal test criteria',
      categoryId: testCategory._id,
      createdBy: testUser._id
    });

    try {
      await minimalAward.save();
      console.log('✅ Minimal award saved successfully');
    } catch (error) {
      console.log('❌ Failed to save minimal award:', error.message);
    }

    // Verify awards were created
    const createdAwards = await Award.find({ 
      title: { $regex: /Test Award/ } 
    }).populate('category', 'name');

    console.log(`\n✅ Successfully created ${createdAwards.length} test awards:`);
    createdAwards.forEach((award, index) => {
      console.log(`   ${index + 1}. ${award.title}`);
      console.log(`      Category: ${award.category?.name || 'Unknown'}`);
      console.log(`      Nomination dates: ${award.nominationStartDate || 'None'} - ${award.nominationEndDate || 'None'}`);
      console.log(`      Voting dates: ${award.votingStartDate || 'None'} - ${award.votingEndDate || 'None'}`);
    });

    console.log('\n🎉 Award creation endpoint test completed successfully!');

    // Cleanup test data
    await Award.deleteMany({ title: { $regex: /Test Award/ } });
    await Category.deleteMany({ name: { $regex: /Test Category/ } });
    await User.deleteMany({ email: { $regex: /test.*@award\.test/ } });
    console.log('\n🧹 Cleaned up test data');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the test
testAwardCreationEndpoint();