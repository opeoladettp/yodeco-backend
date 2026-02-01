const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');

// Configure Google OAuth strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback'
}, async (accessToken, refreshToken, profile, done) => {
  try {
    console.log('🔍 Google OAuth Strategy Called');
    console.log('  Profile ID:', profile.id);
    console.log('  Profile email:', profile.emails?.[0]?.value);
    console.log('  Profile name:', profile.displayName);
    
    // Check if user already exists with this Google ID
    let user = await User.findOne({ googleId: profile.id });
    
    if (user) {
      console.log('✅ Existing user found with Google ID:', user._id);
      // Update last login time for existing user
      user.lastLogin = new Date();
      await user.save();
      return done(null, user);
    }
    
    // Check if user exists with same email (account linking scenario)
    user = await User.findOne({ email: profile.emails[0].value });
    
    if (user) {
      console.log('✅ Existing user found with email, linking Google account:', user._id);
      // Link Google account to existing user
      user.googleId = profile.id;
      user.lastLogin = new Date();
      await user.save();
      return done(null, user);
    }
    
    console.log('🆕 Creating new user for Google profile');
    // Create new user
    const newUser = new User({
      googleId: profile.id,
      email: profile.emails[0].value,
      name: profile.displayName,
      role: 'User', // Default role as per requirements
      createdAt: new Date(),
      lastLogin: new Date()
    });
    
    await newUser.save();
    console.log('✅ New user created successfully:', newUser._id);
    return done(null, newUser);
    
  } catch (error) {
    console.error('❌ Google OAuth strategy error:', error);
    console.error('Error stack:', error.stack);
    return done(error, null);
  }
}));

// Serialize user for session
passport.serializeUser((user, done) => {
  done(null, user._id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;