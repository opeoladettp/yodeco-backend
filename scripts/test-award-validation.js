const mongoose = require('mongoose');
const { validate, schemas } = require('../src/middleware/validation');

async function testAwardValidation() {
  console.log('🧪 Testing Award Creation Validation...\n');

  // Test valid award data
  const validAwardData = {
    title: 'Best Innovation Award',
    criteria: 'Recognizing outstanding innovation in technology',
    categoryId: '507f1f77bcf86cd799439011', // Valid ObjectId format
    imageUrl: 'https://example.com/image.jpg',
    votingStartDate: '2024-02-01T00:00:00.000Z',
    votingEndDate: '2024-02-28T23:59:59.999Z',
    isActive: true,
    allowPublicNomination: true,
    nominationStartDate: '2024-01-15T00:00:00.000Z',
    nominationEndDate: '2024-01-31T23:59:59.999Z'
  };

  // Test invalid award data (missing required fields)
  const invalidAwardData = {
    title: '', // Empty title should fail
    criteria: 'Some criteria',
    categoryId: 'invalid-id', // Invalid ObjectId format
    nominationStartDate: 'invalid-date' // Invalid date format
  };

  console.log('✅ Test 1: Valid award data validation');
  try {
    const { error } = schemas.awardCreation.validate(validAwardData);
    if (error) {
      console.log('❌ Validation failed for valid data:', error.details);
    } else {
      console.log('✅ Valid award data passed validation');
    }
  } catch (err) {
    console.log('❌ Error during validation:', err.message);
  }

  console.log('\n✅ Test 2: Invalid award data validation');
  try {
    const { error } = schemas.awardCreation.validate(invalidAwardData);
    if (error) {
      console.log('✅ Invalid award data correctly failed validation:');
      error.details.forEach(detail => {
        console.log(`   - ${detail.message}`);
      });
    } else {
      console.log('❌ Invalid award data incorrectly passed validation');
    }
  } catch (err) {
    console.log('❌ Error during validation:', err.message);
  }

  console.log('\n✅ Test 3: Date validation specifically');
  const dateTestData = {
    title: 'Test Award',
    criteria: 'Test criteria',
    categoryId: '507f1f77bcf86cd799439011',
    nominationStartDate: new Date().toISOString(),
    nominationEndDate: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
    votingStartDate: new Date(Date.now() + 172800000).toISOString(), // Day after tomorrow
    votingEndDate: new Date(Date.now() + 259200000).toISOString() // 3 days from now
  };

  try {
    const { error } = schemas.awardCreation.validate(dateTestData);
    if (error) {
      console.log('❌ Date validation failed:', error.details);
    } else {
      console.log('✅ Date validation passed successfully');
    }
  } catch (err) {
    console.log('❌ Error during date validation:', err.message);
  }

  console.log('\n🎉 Award validation tests completed!');
}

// Run the test
testAwardValidation().catch(console.error);