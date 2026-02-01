require('dotenv').config();
const mongoose = require('mongoose');
const VoteBias = require('../src/models/VoteBias');

const awardId = process.argv[2] || '69666d3a766df5560e534ad8';

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    return VoteBias.find({ awardId: awardId });
  })
  .then(biases => {
    console.log(`\nBias entries for award ${awardId}:`);
    console.log(JSON.stringify(biases, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
