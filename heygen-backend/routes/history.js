const express = require('express');
const admin = require('firebase-admin');
const { verifyToken } = require('../middleware/auth');
const router = express.Router();

// Get user's video history
router.get('/videos', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { limit = 20, offset = 0, status } = req.query;
    
    let query = admin.firestore()
      .collection('videos')
      .where('userId', '==', uid)
      .orderBy('createdAt', 'desc');
    
    // Filter by status if provided
    if (status) {
      query = query.where('status', '==', status);
    }
    
    const videosSnapshot = await query
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
      message: 'Video history loaded successfully'
    });
    
  } catch (error) {
    console.error('Video history error:', error);
    res.status(500).json({ error: 'Failed to fetch video history' });
  }
});

// Get user's script history
router.get('/scripts', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { limit = 20, offset = 0, category } = req.query;
    
    let query = admin.firestore()
      .collection('scripts')
      .where('userId', '==', uid)
      .orderBy('createdAt', 'desc');
    
    // Filter by category if provided
    if (category) {
      query = query.where('category', '==', category);
    }
    
    const scriptsSnapshot = await query
      .limit(parseInt(limit))
      .offset(parseInt(offset))
      .get();
    
    const scripts = [];
    scriptsSnapshot.forEach(doc => {
      scripts.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    res.json({
      success: true,
      data: scripts,
      count: scripts.length,
      message: 'Script history loaded successfully'
    });
    
  } catch (error) {
    console.error('Script history error:', error);
    res.status(500).json({ error: 'Failed to fetch script history' });
  }
});

// Get combined activity history
router.get('/activity', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { limit = 10 } = req.query;
    
    // Get recent videos
    const videosSnapshot = await admin.firestore()
      .collection('videos')
      .where('userId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit))
      .get();
    
    // Get recent scripts
    const scriptsSnapshot = await admin.firestore()
      .collection('scripts')
      .where('userId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit))
      .get();
    
    const activities = [];
    
    // Add videos to activity
    videosSnapshot.forEach(doc => {
      activities.push({
        id: doc.id,
        type: 'video',
        ...doc.data()
      });
    });
    
    // Add scripts to activity
    scriptsSnapshot.forEach(doc => {
      activities.push({
        id: doc.id,
        type: 'script',
        ...doc.data()
      });
    });
    
    // Sort by creation date
    activities.sort((a, b) => {
      const aTime = a.createdAt?.toDate?.() || new Date(0);
      const bTime = b.createdAt?.toDate?.() || new Date(0);
      return bTime - aTime;
    });
    
    res.json({
      success: true,
      data: activities.slice(0, parseInt(limit)),
      count: activities.length,
      message: 'Activity history loaded successfully'
    });
    
  } catch (error) {
    console.error('Activity history error:', error);
    res.status(500).json({ error: 'Failed to fetch activity history' });
  }
});

// Delete video from history
router.delete('/videos/:videoId', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const videoId = req.params.videoId;
    
    const videoDoc = await admin.firestore()
      .collection('videos')
      .doc(videoId)
      .get();
    
    if (!videoDoc.exists) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    const videoData = videoDoc.data();
    
    if (videoData.userId !== uid) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    await admin.firestore().collection('videos').doc(videoId).delete();
    
    res.json({
      success: true,
      message: 'Video deleted from history'
    });
    
  } catch (error) {
    console.error('Delete video error:', error);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

// Delete script from history
router.delete('/scripts/:scriptId', verifyToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const scriptId = req.params.scriptId;
    
    const scriptDoc = await admin.firestore()
      .collection('scripts')
      .doc(scriptId)
      .get();
    
    if (!scriptDoc.exists) {
      return res.status(404).json({ error: 'Script not found' });
    }
    
    const scriptData = scriptDoc.data();
    
    if (scriptData.userId !== uid) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    await admin.firestore().collection('scripts').doc(scriptId).delete();
    
    res.json({
      success: true,
      message: 'Script deleted from history'
    });
    
  } catch (error) {
    console.error('Delete script error:', error);
    res.status(500).json({ error: 'Failed to delete script' });
  }
});

module.exports = router;