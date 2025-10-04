const express = require('express');
const admin = require('firebase-admin');
const router = express.Router();

// Verify Firebase ID token middleware
const verifyToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Register/Login user
router.post('/register', async (req, res) => {
  try {
    const { uid, email, displayName, photoURL } = req.body;
    
    if (!uid || !email) {
      return res.status(400).json({ error: 'UID and email are required' });
    }
    
    // Check if user already exists
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    
    if (userDoc.exists) {
      // Update existing user
      await admin.firestore().collection('users').doc(uid).update({
        lastLogin: admin.firestore.FieldValue.serverTimestamp(),
        displayName: displayName || userDoc.data().displayName,
        photoURL: photoURL || userDoc.data().photoURL
      });
      
      return res.json({
        success: true,
        user: { uid, email, displayName, photoURL },
        message: 'User logged in successfully'
      });
    }
    
    // Create new user
    const userData = {
      uid,
      email,
      displayName: displayName || 'User',
      photoURL: photoURL || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastLogin: admin.firestore.FieldValue.serverTimestamp(),
      plan: 'free',
      videosGenerated: 0,
      creditsUsed: 0,
      totalSpent: 0,
      isActive: true
    };
    
    await admin.firestore().collection('users').doc(uid).set(userData);
    
    res.json({
      success: true,
      user: userData,
      message: 'User registered successfully'
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Get user profile
router.get('/profile', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    
    // Get user's video count
    const videosSnapshot = await admin.firestore()
      .collection('videos')
      .where('userId', '==', uid)
      .get();
    
    const scriptsSnapshot = await admin.firestore()
      .collection('scripts')
      .where('userId', '==', uid)
      .get();
    
    res.json({
      success: true,
      user: {
        ...userData,
        videosCount: videosSnapshot.size,
        scriptsCount: scriptsSnapshot.size
      },
      message: 'Profile loaded successfully'
    });
    
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update user profile
router.put('/profile', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { displayName, photoURL, preferences } = req.body;
    
    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    if (displayName) updateData.displayName = displayName;
    if (photoURL) updateData.photoURL = photoURL;
    if (preferences) updateData.preferences = preferences;
    
    await admin.firestore().collection('users').doc(uid).update(updateData);
    
    res.json({
      success: true,
      message: 'Profile updated successfully'
    });
    
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Get user's videos
router.get('/videos', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { limit = 20, offset = 0 } = req.query;
    
    const videosSnapshot = await admin.firestore()
      .collection('videos')
      .where('userId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset))
      .get();
    
    const videos = [];
    videosSnapshot.forEach(doc => {
      videos.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    res.json({
      success: true,
      data: videos,
      count: videos.length,
      message: 'User videos loaded successfully'
    });
    
  } catch (error) {
    console.error('User videos fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch user videos' });
  }
});

module.exports = { router, verifyToken };