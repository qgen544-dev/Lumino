const admin = require('firebase-admin');

// Credit System (20 credits = ₹80 = 1 video)
const CREDITS_PER_VIDEO = 20;
const CREDITS_PER_SCRIPT = 0; // Scripts are free

// Check video generation credits
const checkVideoLimits = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const uid = req.user.uid;
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    const userData = userDoc.data();
    const userCredits = userData?.credits || 0;
    
    if (userCredits < CREDITS_PER_VIDEO) {
      return res.status(403).json({
        error: 'Insufficient credits',
        message: `You need ${CREDITS_PER_VIDEO} credits to generate a video`,
        currentCredits: userCredits,
        creditsNeeded: CREDITS_PER_VIDEO,
        upgradeOptions: {
          buyCredits: {
            price: 80,
            credits: 20,
            message: 'Buy 20 credits for ₹80 (1 video)'
          },
          basicPlan: {
            price: 899,
            credits: 400,
            message: 'Basic Plan: 400 credits for ₹899 = 20 videos (Save ₹701!)'
          }
        }
      });
    }
    
    // Add credit info to request
    req.credits = {
      available: userCredits,
      required: CREDITS_PER_VIDEO,
      remaining: userCredits - CREDITS_PER_VIDEO
    };
    
    next();
  } catch (error) {
    console.error('Credit check error:', error);
    res.status(500).json({ error: 'Failed to check credits' });
  }
};

// Check script generation (scripts are free)
const checkScriptLimits = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Scripts are free, no credit check needed
    next();
  } catch (error) {
    console.error('Script check error:', error);
    res.status(500).json({ error: 'Failed to check script access' });
  }
};

// Update user credits after successful generation
const updateUsage = async (userId, type = 'video') => {
  try {
    const userRef = admin.firestore().collection('users').doc(userId);
    
    if (type === 'video') {
      await userRef.update({
        credits: admin.firestore.FieldValue.increment(-CREDITS_PER_VIDEO),
        creditsUsed: admin.firestore.FieldValue.increment(CREDITS_PER_VIDEO),
        videosGenerated: admin.firestore.FieldValue.increment(1),
        lastVideoGenerated: admin.firestore.FieldValue.serverTimestamp()
      });
    } else if (type === 'script') {
      await userRef.update({
        scriptsGenerated: admin.firestore.FieldValue.increment(1),
        lastScriptGenerated: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  } catch (error) {
    console.error('Usage update error:', error);
  }
};

module.exports = {
  checkVideoLimits,
  checkScriptLimits,
  updateUsage
};