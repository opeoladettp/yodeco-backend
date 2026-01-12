const mongoose = require('mongoose');
require('dotenv').config();

const Award = require('../src/models/Award');
const Nominee = require('../src/models/Nominee');
const Category = require('../src/models/Category');

async function checkData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/biometric-voting');
    console.log('Connected to MongoDB');

    const categories = await Category.find({});
    console.log(`\nFound ${categories.length} categories:`);
    categories.forEach(cat => console.log(`- ${cat.name} (${cat._id})`));

    const awards = await Award.find({}).populate('categoryId', 'name');
    console.log(`\nFound ${awards.length} awards:`);
    awards.forEach(award => console.log(`- ${award.title} (${award._id}) - Category: ${award.categoryId?.name} - Active: ${award.isActive}`));

    const nominees = await Nominee.find({}).populate('awardId', 'title');
    console.log(`\nFound ${nominees.length} nominees:`);
    nominees.forEach(nominee => console.log(`- ${nominee.name} (${nominee._id}) - Award: ${nominee.awardId?.title}`));

    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error);
  }
}

checkData();