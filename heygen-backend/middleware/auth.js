const admin = require('firebase-admin');

// Verify Firebase ID token
const verifyToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    
    if (!token) {
      return res.status(401).json({ 
        error: 'Authentication required',
        message: 'Please provide a valid token'
      });
    }
    
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    
    // Add user to database if not exists
    const userDoc = await admin.firestore().collection('users').doc(decodedToken.uid).get();
    if (!userDoc.exists) {
      await admin.firestore().collection('users').doc(decodedToken.uid).set({
        uid: decodedToken.uid,
        email: decodedToken.email,
        displayName: decodedToken.name || 'User',
        photoURL: decodedToken.picture || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastLogin: admin.firestore.FieldValue.serverTimestamp(),
        plan: 'free',
        videosGenerated: 0,
        creditsUsed: 0,
        isActive: true
      });
    } else {
      // Update last login
      await admin.firestore().collection('users').doc(decodedToken.uid).update({
        lastLogin: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ 
      error: 'Invalid token',
      message: 'Please login again'
    });
  }
};

// Optional auth - doesn't fail if no token
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split('Bearer ')[1];
    
    if (token) {
      const decodedToken = await admin.auth().verifyIdToken(token);
      req.user = decodedToken;
    }
    
    next();
  } catch (error) {
    // Continue without user if token is invalid
    next();
  }
};

// Check if user has premium plan
const requirePremium = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const userDoc = await admin.firestore().collection('users').doc(req.user.uid).get();
    const userData = userDoc.data();
    
    if (!userData || userData.plan === 'free') {
      return res.status(403).json({ 
        error: 'Premium plan required',
        message: 'This feature requires a premium subscription'
      });
    }
    
    next();
  } catch (error) {
    console.error('Premium check error:', error);
    res.status(500).json({ error: 'Failed to verify premium status' });
  }
};

// Rate limiting per user
const userRateLimit = (maxRequests = 10, windowMs = 60000) => {
  const requests = new Map();
  
  return (req, res, next) => {
    if (!req.user) {
      return next();
    }
    
    const userId = req.user.uid;
    const now = Date.now();
    const windowStart = now - windowMs;
    
    if (!requests.has(userId)) {
      requests.set(userId, []);
    }
    
    const userRequests = requests.get(userId);
    
    // Remove old requests
    const validRequests = userRequests.filter(time => time > windowStart);
    
    if (validRequests.length >= maxRequests) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: `Maximum ${maxRequests} requests per minute allowed`
      });
    }
    
    validRequests.push(now);
    requests.set(userId, validRequests);
    
    next();
  };
};

module.exports = {
  verifyToken,
  optionalAuth,
  requirePremium,
  userRateLimit
};