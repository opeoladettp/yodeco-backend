// Model exports will be added as models are created
// This file serves as a central export point for all models

const User = require('./User');
const Category = require('./Category');
const Award = require('./Award');
const Nominee = require('./Nominee');
const Vote = require('./Vote');
const AuditLog = require('./AuditLog');

module.exports = {
  User,
  Category,
  Award,
  Nominee,
  Vote,
  AuditLog,
};