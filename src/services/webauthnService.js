const User = require('../models/User');

/**
 * WebAuthn Service for biometric verification
 */
class WebAuthnService {
  /**
   * Check if user has registered WebAuthn credentials
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} True if user has credentials
   */
  static async hasCredentials(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        return false;
      }
      return user.webAuthnCredentials && user.webAuthnCredentials.length > 0;
    } catch (error) {
      console.error('Error checking WebAuthn credentials:', error);
      return false;
    }
  }

  /**
   * Verify that user has completed biometric verification
   * This checks if the user has a valid authentication session
   * In a real implementation, this would check a temporary verification token
   * @param {string} userId - User ID
   * @param {string} sessionId - Session identifier for verification
   * @returns {Promise<boolean>} True if verification is valid
   */
  static async isVerificationValid(userId, sessionId) {
    // For now, we'll implement a simple check
    // In production, this would verify a temporary token or session state
    try {
      const user = await User.findById(userId);
      return user && user.webAuthnCredentials.length > 0;
    } catch (error) {
      console.error('Error verifying biometric authentication:', error);
      return false;
    }
  }

  /**
   * Get user's WebAuthn credentials
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Array of user credentials
   */
  static async getUserCredentials(userId) {
    try {
      const user = await User.findById(userId);
      return user ? user.webAuthnCredentials : [];
    } catch (error) {
      console.error('Error getting user credentials:', error);
      return [];
    }
  }
}

module.exports = WebAuthnService;