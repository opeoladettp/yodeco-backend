const { validate, schemas } = require('../src/middleware/validation');

async function testAwardCreationFix() {
  console.log('🧪 Testing Award Creation Fix for Frontend Issues...\n');

  // Test 1: Award with empty date strings (common frontend scenario)
  console.log('✅ Test 1: Award with empty date strings');
  const awardWithEmptyDates = {
    title: 'Test Award',
    criteria: 'Test criteria for award',
    categoryId: '507f1f77bcf86cd799439011',
    imageUrl: '',
    votingStartDate: '',
    votingEndDate: '',
    isActive: true,
    allowPublicNomination: false,
    nominationStartDate: '',
    nominationEndDate: ''
  };

  try {
    const { error } = schemas.awardCreation.validate(awardWithEmptyDates);
    if (error) {
      console.log('❌ Validation failed for empty dates:', error.details.map(d => d.message));
    } else {
      console.log('✅ Empty date strings passed validation');
    }
  } catch (err) {
    console.log('❌ Error during validation:', err.message);
  }

  // Test 2: Award with null dates
  console.log('\n✅ Test 2: Award with null dates');
  const awardWithNullDates = {
    title: 'Test Award',
    criteria: 'Test criteria for award',
    categoryId: '507f1f77bcf86cd799439011',
    votingStartDate: null,
    votingEndDate: null,
    isActive: true,
    allowPublicNomination: false,
    nominationStartDate: null,
    nominationEndDate: null
  };

  try {
    const { error } = schemas.awardCreation.validate(awardWithNullDates);
    if (error) {
      console.log('❌ Validation failed for null dates:', error.details.map(d => d.message));
    } else {
      console.log('✅ Null dates passed validation');
    }
  } catch (err) {
    console.log('❌ Error during validation:', err.message);
  }

  // Test 3: Award with valid ISO date strings
  console.log('\n✅ Test 3: Award with valid ISO date strings');
  const awardWithValidDates = {
    title: 'Test Award',
    criteria: 'Test criteria for award',
    categoryId: '507f1f77bcf86cd799439011',
    votingStartDate: '2024-02-01T00:00:00.000Z',
    votingEndDate: '2024-02-28T23:59:59.999Z',
    isActive: true,
    allowPublicNomination: true,
    nominationStartDate: '2024-01-15T00:00:00.000Z',
    nominationEndDate: '2024-01-31T23:59:59.999Z'
  };

  try {
    const { error } = schemas.awardCreation.validate(awardWithValidDates);
    if (error) {
      console.log('❌ Validation failed for valid dates:', error.details.map(d => d.message));
    } else {
      console.log('✅ Valid ISO date strings passed validation');
    }
  } catch (err) {
    console.log('❌ Error during validation:', err.message);
  }

  // Test 4: Award with missing optional fields (minimal data)
  console.log('\n✅ Test 4: Award with minimal required data only');
  const minimalAward = {
    title: 'Minimal Award',
    criteria: 'Minimal criteria',
    categoryId: '507f1f77bcf86cd799439011'
  };

  try {
    const { error } = schemas.awardCreation.validate(minimalAward);
    if (error) {
      console.log('❌ Validation failed for minimal data:', error.details.map(d => d.message));
    } else {
      console.log('✅ Minimal award data passed validation');
    }
  } catch (err) {
    console.log('❌ Error during validation:', err.message);
  }

  // Test 5: Simulate frontend datetime-local input format
  console.log('\n✅ Test 5: Frontend datetime-local format');
  const frontendFormatAward = {
    title: 'Frontend Format Award',
    criteria: 'Testing frontend datetime format',
    categoryId: '507f1f77bcf86cd799439011',
    allowPublicNomination: true,
    nominationStartDate: '2024-01-15T10:30', // datetime-local format
    nominationEndDate: '2024-01-31T18:00',
    votingStartDate: '2024-02-01T09:00',
    votingEndDate: '2024-02-28T17:00'
  };

  try {
    const { error } = schemas.awardCreation.validate(frontendFormatAward);
    if (error) {
      console.log('❌ Validation failed for frontend format:', error.details.map(d => d.message));
    } else {
      console.log('✅ Frontend datetime-local format passed validation');
    }
  } catch (err) {
    console.log('❌ Error during validation:', err.message);
  }

  console.log('\n🎉 Award creation fix tests completed!');
  console.log('\n📊 Summary:');
  console.log('   ✅ Empty date strings: Should pass');
  console.log('   ✅ Null dates: Should pass');
  console.log('   ✅ Valid ISO dates: Should pass');
  console.log('   ✅ Minimal data: Should pass');
  console.log('   ✅ Frontend format: Should pass');
}

// Run the test
testAwardCreationFix().catch(console.error);