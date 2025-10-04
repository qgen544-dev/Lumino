const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const admin = require('firebase-admin');
const { verifyToken } = require('../middleware/auth');
const router = express.Router();

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// Create Razorpay order for credits
router.post('/create-order/credits', verifyToken, async (req, res) => {
  try {
    const { credits } = req.body;
    const uid = req.user.uid;
    
    if (!credits || credits < 20 || credits > 500) {
      return res.status(400).json({ error: 'Invalid credit amount (20-500)' });
    }
    
    const amount = credits * 4; // ₹4 per credit
    
    const options = {
      amount: amount * 100, // Amount in paise
      currency: 'INR',
      receipt: `credits_${uid}_${Date.now()}`,
      notes: {
        userId: uid,
        type: 'credits',
        credits: credits
      }
    };
    
    const order = await razorpay.orders.create(options);
    
    // Store order in database
    await admin.firestore().collection('orders').doc(order.id).set({
      userId: uid,
      type: 'credits',
      credits,
      amount,
      currency: 'INR',
      status: 'created',
      razorpayOrderId: order.id,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    res.json({
      success: true,
      data: {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        credits,
        key: process.env.RAZORPAY_KEY_ID
      },
      message: 'Order created successfully'
    });
    
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

// Create Razorpay order for subscription
router.post('/create-order/subscription', verifyToken, async (req, res) => {
  try {
    const { planId } = req.body;
    const uid = req.user.uid;
    
    const plans = {
      basic: { amount: 899, credits: 400 },
      pro: { amount: 2999, credits: 2000 }
    };
    
    if (!plans[planId]) {
      return res.status(400).json({ error: 'Invalid plan selected' });
    }
    
    const plan = plans[planId];
    
    const options = {
      amount: plan.amount * 100, // Amount in paise
      currency: 'INR',
      receipt: `plan_${planId}_${uid}_${Date.now()}`,
      notes: {
        userId: uid,
        type: 'subscription',
        planId,
        credits: plan.credits
      }
    };
    
    const order = await razorpay.orders.create(options);
    
    // Store order in database
    await admin.firestore().collection('orders').doc(order.id).set({
      userId: uid,
      type: 'subscription',
      planId,
      credits: plan.credits,
      amount: plan.amount,
      currency: 'INR',
      status: 'created',
      razorpayOrderId: order.id,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    res.json({
      success: true,
      data: {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        planId,
        credits: plan.credits,
        key: process.env.RAZORPAY_KEY_ID
      },
      message: 'Subscription order created successfully'
    });
    
  } catch (error) {
    console.error('Create subscription order error:', error);
    res.status(500).json({ error: 'Failed to create subscription order' });
  }
});

// Verify payment and add credits/subscription
router.post('/verify', verifyToken, async (req, res) => {
  try {
    const { 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature 
    } = req.body;
    
    const uid = req.user.uid;
    
    // Verify signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest('hex');
    
    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }
    
    // Get order details
    const orderDoc = await admin.firestore()
      .collection('orders')
      .doc(razorpay_order_id)
      .get();
    
    if (!orderDoc.exists) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    const orderData = orderDoc.data();
    
    if (orderData.userId !== uid) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    if (orderData.status === 'completed') {
      return res.status(400).json({ error: 'Order already processed' });
    }
    
    // Update user account based on order type
    const userRef = admin.firestore().collection('users').doc(uid);
    
    if (orderData.type === 'credits') {
      // Add credits
      await userRef.update({
        credits: admin.firestore.FieldValue.increment(orderData.credits),
        totalSpent: admin.firestore.FieldValue.increment(orderData.amount),
        lastPurchase: admin.firestore.FieldValue.serverTimestamp()
      });
      
    } else if (orderData.type === 'subscription') {
      // Update subscription
      const nextBilling = new Date();
      nextBilling.setMonth(nextBilling.getMonth() + 1);
      
      await userRef.update({
        plan: orderData.planId,
        credits: admin.firestore.FieldValue.increment(orderData.credits),
        totalSpent: admin.firestore.FieldValue.increment(orderData.amount),
        subscriptionStart: admin.firestore.FieldValue.serverTimestamp(),
        nextBilling: nextBilling,
        lastPurchase: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
    // Update order status
    await admin.firestore().collection('orders').doc(razorpay_order_id).update({
      status: 'completed',
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
      completedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Record transaction
    await admin.firestore().collection('transactions').add({
      userId: uid,
      type: orderData.type,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      amount: orderData.amount,
      credits: orderData.credits,
      planId: orderData.planId || null,
      status: 'completed',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Get updated user data
    const userDoc = await userRef.get();
    const userData = userDoc.data();
    
    res.json({
      success: true,
      data: {
        type: orderData.type,
        credits: orderData.credits,
        totalCredits: userData.credits,
        plan: userData.plan || 'free',
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id
      },
      message: `Payment successful! ${orderData.credits} credits added.`
    });
    
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ error: 'Payment verification failed' });
  }
});

// Get payment history
router.get('/history', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    
    const transactionsSnapshot = await admin.firestore()
      .collection('transactions')
      .where('userId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();
    
    const transactions = [];
    transactionsSnapshot.forEach(doc => {
      transactions.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    res.json({
      success: true,
      data: transactions,
      count: transactions.length,
      message: 'Payment history loaded successfully'
    });
    
  } catch (error) {
    console.error('Payment history error:', error);
    res.status(500).json({ error: 'Failed to fetch payment history' });
  }
});

module.exports = router;