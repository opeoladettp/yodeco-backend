const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const Category = require('../src/models/Category');
const Award = require('../src/models/Award');
const Nominee = require('../src/models/Nominee');

const sampleData = {
  categories: [
    {
      name: "Entertainment",
      description: "Entertainment and media awards",
      slug: "entertainment",
      isActive: true
    },
    {
      name: "Sports",
      description: "Sports and athletics awards",
      slug: "sports", 
      isActive: true
    }
  ],
  awards: [
    {
      title: "Best Actor",
      criteria: "Best performance by an actor",
      categoryName: "Entertainment"
    },
    {
      title: "Best Director", 
      criteria: "Best film direction",
      categoryName: "Entertainment"
    },
    {
      title: "Athlete of the Year",
      criteria: "Outstanding athletic performance",
      categoryName: "Sports"
    }
  ],
  nominees: [
    {
      name: "John Doe",
      description: "Outstanding performance in drama",
      awardName: "Best Actor"
    },
    {
      name: "Jane Smith", 
      description: "Exceptional acting skills",
      awardName: "Best Actor"
    },
    {
      name: "Mike Johnson",
      description: "Innovative film direction",
      awardName: "Best Director"
    },
    {
      name: "Sarah Wilson",
      description: "Record-breaking athletic achievements",
      awardName: "Athlete of the Year"
    }
  ]
};

async function seedDatabase() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/biometric-voting');
    console.log('Connected to MongoDB');

    // Clear existing data
    await Category.deleteMany({});
    await Award.deleteMany({});
    await Nominee.deleteMany({});
    console.log('Cleared existing data');

    // Create categories
    const createdCategories = {};
    const dummyUserId = new mongoose.Types.ObjectId(); // Create a dummy user ID
    
    for (const categoryData of sampleData.categories) {
      const category = new Category({
        ...categoryData,
        createdBy: dummyUserId
      });
      await category.save();
      createdCategories[category.name] = category._id;
      console.log(`Created category: ${category.name}`);
    }

    // Create awards
    const createdAwards = {};
    for (const awardData of sampleData.awards) {
      const award = new Award({
        ...awardData,
        categoryId: createdCategories[awardData.categoryName],
        createdBy: dummyUserId
      });
      await award.save();
      createdAwards[award.title] = award._id;
      console.log(`Created award: ${award.title}`);
    }

    // Create nominees
    for (const nomineeData of sampleData.nominees) {
      const nominee = new Nominee({
        ...nomineeData,
        awardId: createdAwards[nomineeData.awardName]
      });
      await nominee.save();
      console.log(`Created nominee: ${nominee.name}`);
    }

    console.log('✅ Sample data created successfully!');
    console.log('You can now test the voting portal with sample data.');
    
  } catch (error) {
    console.error('❌ Error seeding database:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the seed function
seedDatabase();