const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  googleId: {
    type: String,
    required: true,
    unique: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['User', 'Panelist', 'System_Admin'],
    default: 'User'
  },
  // WebAuthn credential data
  webAuthnCredentials: [{
    credentialID: {
      type: String,
      required: true
    },
    publicKey: {
      type: String,
      required: true
    },
    counter: {
      type: Number,
      default: 0
    },
    transports: [{
      type: String,
      enum: ['usb', 'nfc', 'ble', 'internal', 'hybrid']
    }],
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  // Current challenge for WebAuthn operations
  currentChallenge: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastLogin: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('User', userSchema);