const express = require('express');
const admin = require('firebase-admin');
const { verifyToken } = require('../middleware/auth');
const router = express.Router();

// Credit-Based Pricing System
const PRICING_PLANS = {
  free: {
    id: 'free',
    name: 'Free Account',
    price: 0,
    currency: 'INR',
    features: {
      creditsOnSignup: 20,
      creditsPerVideo: 20,
      maxVideos: 1, // 20 credits = 1 video
      scriptsPerMonth: 'unlimited',
      maxDuration: '60s',
      watermark: false,
      templates: true,
      support: 'community'
    },
    description: 'Get 20 free credits on signup - Make 1 video!'
  },
  basic: {
    id: 'basic',
    name: 'Basic Plan',
    price: 899,
    currency: 'INR',
    billing: 'monthly',
    features: {
      creditsPerMonth: 400,
      creditsPerVideo: 20,
      maxVideos: 20, // 400 credits = 20 videos
      scriptsPerMonth: 'unlimited',
      maxDuration: '120s',
      watermark: false,
      templates: true,
      customAvatars: false,
      support: 'email'
    },
    description: '400 credits monthly = 20 videos! Best value for creators',
    savings: 'Save ₹701 vs pay-per-video',
    popular: true
  },
  pro: {
    id: 'pro',
    name: 'Pro Plan',
    price: 2999,
    currency: 'INR',
    billing: 'monthly',
    features: {
      creditsPerMonth: 2000,
      creditsPerVideo: 20,
      maxVideos: 100, // 2000 credits = 100 videos
      scriptsPerMonth: 'unlimited',
      maxDuration: '300s',
      watermark: false,
      templates: true,
      customAvatars: true,
      bulkGeneration: true,
      support: 'priority'
    },
    description: '2000 credits monthly = 100 videos! Perfect for agencies',
    badge: 'BEST VALUE'
  }
};

// Custom Credit Purchase Settings (20 credits = ₹80 = 1 video)
const CREDIT_SETTINGS = {
  minCredits: 20,
  maxCredits: 500,
  pricePerCredit: 4, // ₹4 per credit (20 credits = ₹80)
  currency: 'INR',
  description: 'Buy any amount between 20-500 credits (20 credits = ₹80 = 1 video)',
  examples: [
    { credits: 20, price: 80, videos: 1, description: '20 credits = 1 video = ₹80' },
    { credits: 100, price: 400, videos: 5, description: '100 credits = 5 videos = ₹400' },
    { credits: 200, price: 800, videos: 10, description: '200 credits = 10 videos = ₹800' },
    { credits: 400, price: 1600, videos: 20, description: '400 credits = 20 videos = ₹1600' }
  ]
};

// Get all pricing plans
router.get('/plans', async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        subscription: PRICING_PLANS,
        customCredits: CREDIT_SETTINGS,
        creditSystem: {
          creditsPerVideo: 20,
          freeCreditsOnSignup: 20,
          minPurchase: 20,
          maxPurchase: 500,
          pricePerCredit: 4
        }
      },
      message: 'Pricing plans loaded successfully'
    });
  } catch (error) {
    console.error('Pricing plans error:', error);
    res.status(500).json({ error: 'Failed to fetch pricing plans' });
  }
});

// Get user's current plan and usage
router.get('/usage', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    const currentPlan = PRICING_PLANS[userData.plan] || PRICING_PLANS.free;
    
    // Get current month usage
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    // Count videos this month
    const videosSnapshot = await admin.firestore()
      .collection('videos')
      .where('userId', '==', uid)
      .where('createdAt', '>=', startOfMonth)
      .get();
    
    // Count scripts this month
    const scriptsSnapshot = await admin.firestore()
      .collection('scripts')
      .where('userId', '==', uid)
      .where('createdAt', '>=', startOfMonth)
      .get();
    
    const usage = {
      videosUsed: videosSnapshot.size,
      videosLimit: currentPlan.features.videosPerMonth,
      scriptsUsed: scriptsSnapshot.size,
      scriptsLimit: currentPlan.features.scriptsPerMonth,
      videosRemaining: Math.max(0, currentPlan.features.videosPerMonth - videosSnapshot.size),
      scriptsRemaining: Math.max(0, currentPlan.features.scriptsPerMonth - scriptsSnapshot.size)
    };
    
    res.json({
      success: true,
      data: {
        currentPlan,
        usage,
        billingCycle: userData.billingCycle || 'monthly',
        nextBilling: userData.nextBilling || null,
        totalSpent: userData.totalSpent || 0
      },
      message: 'Usage data loaded successfully'
    });
    
  } catch (error) {
    console.error('Usage fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch usage data' });
  }
});

// Check if user can generate video
router.get('/check-limits', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { type = 'video' } = req.query; // video or script
    
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    const userData = userDoc.data();
    const currentPlan = PRICING_PLANS[userData.plan] || PRICING_PLANS.free;
    
    // Get current month usage
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    let canGenerate = false;
    let remaining = 0;
    let limit = 0;
    
    if (type === 'video') {
      const videosSnapshot = await admin.firestore()
        .collection('videos')
        .where('userId', '==', uid)
        .where('createdAt', '>=', startOfMonth)
        .get();
      
      limit = currentPlan.features.videosPerMonth;
      remaining = Math.max(0, limit - videosSnapshot.size);
      canGenerate = remaining > 0;
    } else if (type === 'script') {
      const scriptsSnapshot = await admin.firestore()
        .collection('scripts')
        .where('userId', '==', uid)
        .where('createdAt', '>=', startOfMonth)
        .get();
      
      limit = currentPlan.features.scriptsPerMonth;
      remaining = Math.max(0, limit - scriptsSnapshot.size);
      canGenerate = remaining > 0;
    }
    
    res.json({
      success: true,
      data: {
        canGenerate,
        remaining,
        limit,
        currentPlan: currentPlan.name,
        upgradeRequired: !canGenerate,
        customCredits: CREDIT_SETTINGS
      },
      message: canGenerate ? 'Generation allowed' : 'Credits required - buy credits or upgrade plan'
    });
    
  } catch (error) {
    console.error('Limit check error:', error);
    res.status(500).json({ error: 'Failed to check limits' });
  }
});

// Upgrade plan (placeholder for payment integration)
router.post('/upgrade', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { planId, paymentMethod = 'razorpay' } = req.body;
    
    if (!PRICING_PLANS[planId]) {
      return res.status(400).json({ error: 'Invalid plan selected' });
    }
    
    const selectedPlan = PRICING_PLANS[planId];
    
    // For now, just return payment details
    // In production, integrate with Razorpay/Stripe
    
    res.json({
      success: true,
      data: {
        planId,
        planName: selectedPlan.name,
        amount: selectedPlan.price,
        currency: selectedPlan.currency,
        paymentMethod,
        // These would be real payment gateway details
        paymentUrl: `/payment/razorpay?plan=${planId}&user=${uid}`,
        orderId: `order_${Date.now()}_${uid.substring(0, 8)}`
      },
      message: 'Payment details generated - integrate with Razorpay next'
    });
    
  } catch (error) {
    console.error('Plan upgrade error:', error);
    res.status(500).json({ error: 'Failed to process upgrade' });
  }
});

// Buy custom credits (min 20, max 500)
router.post('/buy-credits', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { credits } = req.body;
    
    // Validate credit amount
    if (!credits || typeof credits !== 'number') {
      return res.status(400).json({ error: 'Credits amount is required' });
    }
    
    if (credits < 20) {
      return res.status(400).json({ 
        error: 'Minimum 20 credits required',
        minimum: 20
      });
    }
    
    if (credits > 500) {
      return res.status(400).json({ 
        error: 'Maximum 500 credits allowed per purchase',
        maximum: 500
      });
    }
    
    // Calculate price (20 credits = ₹80, so 1 credit = ₹4)
    const pricePerCredit = 4;
    const totalAmount = credits * pricePerCredit;
    
    // Calculate savings vs individual ₹80 purchases
    const individualPrice = Math.ceil(credits / 20) * 80;
    const savings = individualPrice - totalAmount;
    
    res.json({
      success: true,
      data: {
        credits,
        amount: totalAmount,
        currency: 'INR',
        pricePerCredit,
        description: `${credits} credits for ₹${totalAmount}`,
        savings: savings > 0 ? `Save ₹${savings} vs individual purchase` : null,
        paymentUrl: `/payment/razorpay?type=credits&credits=${credits}&user=${uid}`,
        orderId: `credits_${Date.now()}_${uid.substring(0, 8)}`
      },
      message: 'Custom credit purchase details generated'
    });
    
  } catch (error) {
    console.error('Credit purchase error:', error);
    res.status(500).json({ error: 'Failed to process credit purchase' });
  }
});

// Add credits to user account (after successful payment)
router.post('/add-credits', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { credits, orderId, paymentId, amount } = req.body;
    
    if (!credits || credits < 20 || credits > 500) {
      return res.status(400).json({ error: 'Invalid credit amount (20-500 allowed)' });
    }
    
    // Add credits to user account
    const userRef = admin.firestore().collection('users').doc(uid);
    await userRef.update({
      credits: admin.firestore.FieldValue.increment(credits),
      totalSpent: admin.firestore.FieldValue.increment(amount || credits * 4),
      lastPurchase: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Record transaction
    await admin.firestore().collection('transactions').add({
      userId: uid,
      type: 'credit_purchase',
      credits,
      amount: amount || credits * 4,
      pricePerCredit: 4,
      orderId,
      paymentId,
      status: 'completed',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Get updated user data
    const userDoc = await userRef.get();
    const userData = userDoc.data();
    
    res.json({
      success: true,
      data: {
        creditsAdded: credits,
        totalCredits: userData.credits,
        amountPaid: amount || credits * 4,
        orderId,
        paymentId
      },
      message: `${credits} credits added successfully!`
    });
    
  } catch (error) {
    console.error('Add credits error:', error);
    res.status(500).json({ error: 'Failed to add credits' });
  }
});

// Get user's credit balance
router.get('/credits', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const userDoc = await admin.firestore().collection('users').doc(uid).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userData = userDoc.data();
    
    res.json({
      success: true,
      data: {
        credits: userData.credits || 0,
        creditsUsed: userData.creditsUsed || 0,
        videosGenerated: userData.videosGenerated || 0,
        creditsPerVideo: 20,
        possibleVideos: Math.floor((userData.credits || 0) / 20)
      },
      message: 'Credit balance loaded successfully'
    });
    
  } catch (error) {
    console.error('Credit balance error:', error);
    res.status(500).json({ error: 'Failed to fetch credit balance' });
  }
});

// Get billing history
router.get('/billing', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    
    const billingSnapshot = await admin.firestore()
      .collection('billing')
      .where('userId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();
    
    const billingHistory = [];
    billingSnapshot.forEach(doc => {
      billingHistory.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    res.json({
      success: true,
      data: billingHistory,
      count: billingHistory.length,
      message: 'Billing history loaded successfully'
    });
    
  } catch (error) {
    console.error('Billing history error:', error);
    res.status(500).json({ error: 'Failed to fetch billing history' });
  }
});

module.exports = router;