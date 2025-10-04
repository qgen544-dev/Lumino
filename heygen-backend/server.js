const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

// Load environment variables FIRST
dotenv.config();

const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const multer = require('multer');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const admin = require('firebase-admin');
const FormData = require('form-data');
const Groq = require('groq-sdk');

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// Import routes AFTER env variables are loaded
const { router: authRoutes } = require('./routes/auth');
const pricingRoutes = require('./routes/pricing');
const paymentRoutes = require('./routes/payment');
const historyRoutes = require('./routes/history');
const { verifyToken } = require('./middleware/auth');
const { checkVideoLimits, checkScriptLimits, updateUsage } = require('./middleware/limits');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Create directories
const uploadDir = process.env.UPLOAD_DIR || './uploads';
const outputDir = process.env.OUTPUT_DIR || './output';
fs.ensureDirSync(uploadDir);
fs.ensureDirSync(outputDir);

// Firebase Admin initialization
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token"
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}-${file.originalname}`);
  }
});
const upload = multer({ storage });

// HeyGen API Key Management
const HEYGEN_KEYS = process.env.HEYGEN_KEYS?.split(',') || [];
let keyUsageCount = {};
let currentKeyIndex = 0;

// Script Generation Prompts
const SCRIPT_PROMPTS = {
  business: "Create a professional business presentation script about {topic}. Make it engaging, informative, and suitable for a 45-60 second video. Include a strong opening, key points, and call to action.",
  social: "Write an engaging social media video script about {topic}. Make it trendy, relatable, and perfect for Instagram/TikTok. Keep it energetic and under 30 seconds. Include hooks and trending phrases.",
  educational: "Create an educational video script explaining {topic}. Make it clear, informative, and easy to understand. Structure it with introduction, main concepts, and conclusion. Suitable for 60-90 seconds.",
  marketing: "Write a compelling marketing video script for {topic}. Focus on benefits, create urgency, and include strong call-to-action. Make it persuasive and conversion-focused. 45-60 seconds ideal.",
  news: "Create a professional news-style script about {topic}. Make it factual, authoritative, and well-structured. Include key facts and maintain journalistic tone. 60-120 seconds.",
  motivational: "Write an inspiring motivational script about {topic}. Make it uplifting, powerful, and emotionally engaging. Include personal growth elements and actionable advice. 45-60 seconds.",
  hindi: "Create a Hindi script about {topic}. Make it natural, engaging, and culturally relevant. Use simple Hindi words mixed with English where appropriate. 45-60 seconds ke liye perfect.",
  custom: "Create a video script about {topic} with the following style and requirements: {customInstructions}. Make it engaging and suitable for video format."
};

// Popular Avatars (Hardcoded for performance)
const POPULAR_AVATARS = [
  { id: "Abigail_expressive_2024112501", name: "Abigail - Expressive", gender: "female", style: "professional" },
  { id: "Aditya_public_4", name: "Aditya - Professional", gender: "male", style: "business" },
  { id: "Adriana_BizTalk_Front_public", name: "Adriana - Business", gender: "female", style: "corporate" },
  { id: "Albert_public_3", name: "Albert - Casual", gender: "male", style: "friendly" },
  { id: "Abigail_standing_office_front", name: "Abigail - Office", gender: "female", style: "office" },
  { id: "Aditya_public_1", name: "Aditya - Casual", gender: "male", style: "casual" },
  { id: "Adriana_Business_Front_public", name: "Adriana - Executive", gender: "female", style: "executive" },
  { id: "Aiko_public", name: "Aiko - Asian", gender: "female", style: "modern" },
  { id: "Abigail_sitting_sofa_front", name: "Abigail - Relaxed", gender: "female", style: "casual" },
  { id: "Albert_public_2", name: "Albert - Business", gender: "male", style: "professional" }
];

// Popular Voices (Hardcoded for performance)
const POPULAR_VOICES = [
  // English Voices
  { id: "1bd001e7e50f421d891986aad5158bc8", name: "Emma - Professional", language: "en", gender: "female", accent: "US", style: "business" },
  { id: "Qz5fqQAsvzEUvsQ2ugLH", name: "James - Corporate", language: "en", gender: "male", accent: "US", style: "professional" },
  { id: "VoCODBvSDQUgLCiN46zd", name: "Sarah - Friendly", language: "en", gender: "female", accent: "UK", style: "casual" },
  { id: "73c0b6a2e29d4d38aca41454bf58c955", name: "David - Narrator", language: "en", gender: "male", accent: "US", style: "storytelling" },
  { id: "a04d81d19afd436db611060682276331", name: "Lisa - Energetic", language: "en", gender: "female", accent: "US", style: "upbeat" },
  { id: "b2ddcef2b1594794aa7f3a436d8cf8f2", name: "Michael - Calm", language: "en", gender: "male", accent: "UK", style: "soothing" },
  
  // Hindi Voices
  { id: "e3e89b7996b94daebf8a1d6904a1bd11", name: "Priya - Hindi", language: "hi", gender: "female", accent: "IN", style: "clear" },
  { id: "6d091fbb994c439eb9d249ba8b0e62da", name: "Raj - Hindi", language: "hi", gender: "male", accent: "IN", style: "professional" },
  { id: "f8c69e517f424cafaecde32dde57096b", name: "Anita - Hindi", language: "hi", gender: "female", accent: "IN", style: "warm" },
  
  // International Voices
  { id: "d2f4f24783d04e22ab49ee8fdc3715e0", name: "Sofia - Spanish", language: "es", gender: "female", accent: "ES", style: "elegant" },
  { id: "d92994ae0de34b2e8659b456a2f388b8", name: "Pierre - French", language: "fr", gender: "male", accent: "FR", style: "sophisticated" },
  { id: "f38a635bee7a4d1f9b0a654a31d050d2", name: "Yuki - Japanese", language: "ja", gender: "female", accent: "JP", style: "polite" },
  
  // Young Voices
  { id: "cef3bc4e0a84424cafcde6f2cf466c97", name: "Alex - Young", language: "en", gender: "male", accent: "US", style: "youthful" },
  { id: "5d8c378ba8c3434586081a52ac368738", name: "Zoe - Teen", language: "en", gender: "female", accent: "US", style: "trendy" },
  { id: "6be73833ef9a4eb0aeee399b8fe9d62b", name: "Ryan - Cool", language: "en", gender: "male", accent: "US", style: "modern" }
];

// Supported Languages (Since HeyGen translation is premium)
const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸', popular: true },
  { code: 'hi', name: 'Hindi', flag: '🇮🇳', popular: true },
  { code: 'es', name: 'Spanish', flag: '🇪🇸', popular: true },
  { code: 'fr', name: 'French', flag: '🇫🇷', popular: false },
  { code: 'de', name: 'German', flag: '🇩🇪', popular: false },
  { code: 'ja', name: 'Japanese', flag: '🇯🇵', popular: false },
  { code: 'ko', name: 'Korean', flag: '🇰🇷', popular: false },
  { code: 'zh', name: 'Chinese', flag: '🇨🇳', popular: false },
  { code: 'pt', name: 'Portuguese', flag: '🇵🇹', popular: false },
  { code: 'ru', name: 'Russian', flag: '🇷🇺', popular: false }
];

// Custom Templates (Since HeyGen templates endpoint is empty)
const CUSTOM_TEMPLATES = [
  {
    id: "business_presentation",
    name: "Business Presentation",
    category: "business",
    description: "Professional business presentation template",
    recommended_avatar: "Adriana_BizTalk_Front_public",
    recommended_voice: "1bd001e7e50f421d891986aad5158bc8",
    sample_script: "Welcome to our quarterly business review. Today I'll be presenting our key achievements and future strategies.",
    orientation: "landscape",
    duration: "60s"
  },
  {
    id: "social_media_post",
    name: "Social Media Content",
    category: "social",
    description: "Engaging social media video template",
    recommended_avatar: "Abigail_expressive_2024112501",
    recommended_voice: "a04d81d19afd436db611060682276331",
    sample_script: "Hey everyone! Welcome back to my channel. Today I have something amazing to share with you!",
    orientation: "portrait",
    duration: "30s"
  },
  {
    id: "educational_content",
    name: "Educational Video",
    category: "education",
    description: "Clear and informative educational template",
    recommended_avatar: "Albert_public_3",
    recommended_voice: "73c0b6a2e29d4d38aca41454bf58c955",
    sample_script: "In today's lesson, we'll explore the fundamental concepts that will help you understand this topic better.",
    orientation: "landscape",
    duration: "90s"
  },
  {
    id: "product_demo",
    name: "Product Demonstration",
    category: "marketing",
    description: "Showcase your product effectively",
    recommended_avatar: "Aditya_public_4",
    recommended_voice: "Qz5fqQAsvzEUvsQ2ugLH",
    sample_script: "Let me show you how this amazing product can solve your everyday problems and make your life easier.",
    orientation: "landscape",
    duration: "45s"
  },
  {
    id: "hindi_content",
    name: "Hindi Content",
    category: "regional",
    description: "Hindi language content template",
    recommended_avatar: "Aiko_public",
    recommended_voice: "e3e89b7996b94daebf8a1d6904a1bd11",
    sample_script: "Namaste! Aaj main aapke saath kuch bahut important baatein share karne wala hun.",
    orientation: "portrait",
    duration: "60s"
  },
  {
    id: "testimonial",
    name: "Customer Testimonial",
    category: "marketing",
    description: "Authentic customer testimonial template",
    recommended_avatar: "Abigail_sitting_sofa_front",
    recommended_voice: "VoCODBvSDQUgLCiN46zd",
    sample_script: "I've been using this service for months now, and I can honestly say it has transformed my business.",
    orientation: "square",
    duration: "30s"
  },
  {
    id: "news_update",
    name: "News & Updates",
    category: "news",
    description: "Professional news and updates template",
    recommended_avatar: "Adriana_Business_Front_public",
    recommended_voice: "b2ddcef2b1594794aa7f3a436d8cf8f2",
    sample_script: "Good evening. Here are today's top stories and important updates you need to know about.",
    orientation: "landscape",
    duration: "120s"
  },
  {
    id: "motivational",
    name: "Motivational Content",
    category: "lifestyle",
    description: "Inspiring and motivational template",
    recommended_avatar: "Albert_public_2",
    recommended_voice: "cef3bc4e0a84424cafcde6f2cf466c97",
    sample_script: "Remember, every great achievement starts with a single step. Today is your day to take that step forward.",
    orientation: "portrait",
    duration: "45s"
  }
];

function getNextHeyGenKey() {
  // Find key with usage < 10
  for (let i = 0; i < HEYGEN_KEYS.length; i++) {
    const key = HEYGEN_KEYS[i];
    if ((keyUsageCount[key] || 0) < 10) {
      keyUsageCount[key] = (keyUsageCount[key] || 0) + 1;
      console.log(`Using key ${i + 1}, usage: ${keyUsageCount[key]}/10`);
      return key;
    }
  }
  
  // All keys exhausted - reset counters
  console.log('All keys exhausted, resetting counters...');
  keyUsageCount = {};
  keyUsageCount[HEYGEN_KEYS[0]] = 1;
  return HEYGEN_KEYS[0];
}

// Remove HeyGen watermark
function removeWatermark(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .videoFilter('crop=iw-150:ih-80:0:0') // Remove right-bottom watermark
      .output(outputPath)
      .on('end', () => {
        console.log('Watermark removed successfully');
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        reject(err);
      })
      .run();
  });
}

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/pricing', pricingRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/history', historyRoutes);

// Routes
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    availableKeys: HEYGEN_KEYS.length,
    keyUsage: keyUsageCount
  });
});

// Upload to Catbox.moe (FREE!)
async function uploadToCatbox(videoPath) {
  try {
    console.log('Uploading to Catbox.moe...');
    
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', fs.createReadStream(videoPath));
    
    const response = await axios.post('https://catbox.moe/user/api.php', form, {
      headers: {
        ...form.getHeaders(),
        'User-Agent': 'HeyGen-Backend/1.0'
      },
      timeout: 120000 // 2 minutes timeout
    });
    
    const videoUrl = response.data.trim();
    console.log('Catbox upload successful:', videoUrl);
    
    return videoUrl;
  } catch (error) {
    console.error('Catbox upload error:', error);
    throw new Error('Failed to upload video to Catbox');
  }
}

// Store video URL in Firestore
async function storeVideoUrl(videoData) {
  try {
    console.log('Storing video URL in Firestore...');
    
    const docRef = admin.firestore().collection('videos').doc();
    await docRef.set({
      ...videoData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'completed'
    });
    
    console.log('Video URL stored with ID:', docRef.id);
    return docRef.id;
  } catch (error) {
    console.error('Firestore error:', error);
    throw error;
  }
}

// Generate video endpoint (Protected + Limits)
app.post('/api/generate-video', verifyToken, checkVideoLimits, async (req, res) => {
  try {
    const { 
      script, 
      avatar, 
      voice = '1bd001e7e50f421d891986aad5158bc8',
      orientation = 'landscape',
      customDimensions = null,
      templateId = null,
      customAssets = []
    } = req.body;
    
    if (!script || !avatar) {
      return res.status(400).json({ 
        error: 'Script and avatar are required' 
      });
    }

    console.log('Starting video generation...');
    console.log('Orientation:', orientation);
    
    // Step 1: Get HeyGen API key
    const apiKey = getNextHeyGenKey();
    if (!apiKey) {
      return res.status(503).json({ 
        error: 'No API keys available' 
      });
    }

    // Step 2: Determine dimensions based on orientation
    let dimensions = { width: 1280, height: 720 }; // Default landscape
    
    if (customDimensions) {
      dimensions = customDimensions;
    } else {
      switch (orientation) {
        case 'portrait':
          dimensions = { width: 720, height: 1280 };
          break;
        case 'square':
          dimensions = { width: 1080, height: 1080 };
          break;
        case 'landscape':
        default:
          dimensions = { width: 1280, height: 720 };
          break;
      }
    }
    
    console.log('Video dimensions:', dimensions);

    // Step 3: Call HeyGen API
    console.log('Calling HeyGen API...');
    const heygenResponse = await axios.post('https://api.heygen.com/v2/video/generate', {
      caption: false,
      dimension: dimensions,
      video_inputs: [{
        character: {
          type: 'avatar',
          avatar_id: avatar
        },
        voice: {
          type: 'text',
          input_text: script,
          voice_id: voice
        }
      }]
    }, {
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'x-api-key': apiKey
      },
      timeout: 300000 // 5 minutes
    });

    const videoId = heygenResponse.data.data.video_id;
    console.log('HeyGen video ID:', videoId);

    // Step 3: Poll for completion
    let videoUrl = null;
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes max wait

    while (!videoUrl && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      
      try {
        const statusResponse = await axios.get(`https://api.heygen.com/v1/video_status.get?video_id=${videoId}`, {
          headers: { 
            'accept': 'application/json',
            'x-api-key': apiKey 
          }
        });

        const status = statusResponse.data.data;
        console.log('Video status:', status.status);

        if (status.status === 'completed') {
          videoUrl = status.video_url;
          break;
        } else if (status.status === 'failed') {
          throw new Error('HeyGen video generation failed');
        }
      } catch (pollError) {
        console.error('Polling error:', pollError.message);
      }
      
      attempts++;
    }

    if (!videoUrl) {
      return res.status(408).json({ 
        error: 'Video generation timeout' 
      });
    }

    // Step 4: Download video from HeyGen URL
    console.log('Downloading video from HeyGen...');
    const videoResponse = await axios.get(videoUrl, { 
      responseType: 'stream' 
    });
    
    const tempVideoPath = path.join(outputDir, `temp-${uuidv4()}.mp4`);
    const writer = fs.createWriteStream(tempVideoPath);
    videoResponse.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    // Step 5: Remove watermark
    console.log('Removing watermark...');
    const cleanVideoPath = path.join(outputDir, `clean-${uuidv4()}.mp4`);
    await removeWatermark(tempVideoPath, cleanVideoPath);

    // Step 6: Upload to Catbox.moe (FREE hosting!)
    console.log('Uploading clean video to Catbox...');
    const catboxUrl = await uploadToCatbox(cleanVideoPath);

    // Step 7: Store video data in Firestore
    const videoData = {
      userId: req.user.uid, // User ID
      userEmail: req.user.email,
      originalUrl: videoUrl, // HeyGen URL
      processedUrl: catboxUrl, // Catbox public URL
      script,
      avatar,
      voice,
      orientation,
      dimensions,
      duration: '~45 seconds',
      storage: 'Catbox.moe',
      type: 'custom', // Mark as custom generation
      templateId: templateId || null,
      customAssets: customAssets || [],
      aiGenerated: false // Mark as manual generation
    };
    
    const storedVideoId = await storeVideoUrl(videoData);
    
    // Update user usage
    await updateUsage(req.user.uid, 'video');

    // Step 8: Clean up ALL local files
    fs.removeSync(tempVideoPath);
    fs.removeSync(cleanVideoPath);
    console.log('Local files cleaned up successfully');

    // Step 9: Return Catbox URL
    res.json({
      success: true,
      videoId: storedVideoId,
      videoUrl: catboxUrl, // Direct Catbox URL
      duration: '~45 seconds',
      message: 'Video processed and uploaded to Catbox successfully!',
      storage: 'Catbox.moe (FREE)',
      cost: '₹0'
    });

  } catch (error) {
    console.error('Video generation error:', error);
    
    if (error.response) {
      console.error('HeyGen API Error:', error.response.data);
      return res.status(error.response.status).json({
        error: 'HeyGen API Error',
        details: error.response.data
      });
    }
    
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
});

// Redirect to Catbox URL (no local serving needed)
app.get('/api/serve/:videoId', async (req, res) => {
  try {
    const videoId = req.params.videoId;
    const doc = await admin.firestore().collection('videos').doc(videoId).get();
    
    if (!doc.exists) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    const videoData = doc.data();
    // Redirect to Catbox URL
    res.redirect(videoData.processedUrl);
    
  } catch (error) {
    console.error('Video redirect error:', error);
    res.status(500).json({ error: 'Failed to redirect to video' });
  }
});

// Get video info from Firestore
app.get('/api/video/:videoId', async (req, res) => {
  try {
    const videoId = req.params.videoId;
    const doc = await admin.firestore().collection('videos').doc(videoId).get();
    
    if (!doc.exists) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    res.json({
      success: true,
      videoId,
      data: doc.data()
    });
    
  } catch (error) {
    console.error('Video info error:', error);
    res.status(500).json({ error: 'Failed to get video info' });
  }
});

// Get custom templates
app.get('/api/templates', async (req, res) => {
  try {
    const { category } = req.query;
    
    let templates = CUSTOM_TEMPLATES;
    
    // Filter by category if provided
    if (category) {
      templates = templates.filter(t => t.category === category);
    }
    
    res.json({
      success: true,
      data: templates,
      count: templates.length,
      categories: ['business', 'social', 'education', 'marketing', 'regional', 'news', 'lifestyle'],
      message: 'Custom templates loaded successfully'
    });
  } catch (error) {
    console.error('Templates error:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// Get specific template
app.get('/api/template/:templateId', async (req, res) => {
  try {
    const templateId = req.params.templateId;
    const template = CUSTOM_TEMPLATES.find(t => t.id === templateId);
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    res.json({
      success: true,
      data: template,
      message: 'Template details loaded successfully'
    });
  } catch (error) {
    console.error('Template details error:', error);
    res.status(500).json({ error: 'Failed to fetch template details' });
  }
});

// Generate video from template
app.post('/api/template/:templateId/generate', async (req, res) => {
  try {
    const templateId = req.params.templateId;
    const { script, customizations = {} } = req.body;
    
    const template = CUSTOM_TEMPLATES.find(t => t.id === templateId);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    // Use template defaults with user customizations
    const avatar = customizations.avatar || template.recommended_avatar;
    const voice = customizations.voice || template.recommended_voice;
    const finalScript = script || template.sample_script;
    
    // Set dimensions based on template orientation
    let dimensions = { width: 1280, height: 720 }; // Default landscape
    if (template.orientation === 'portrait') {
      dimensions = { width: 720, height: 1280 };
    } else if (template.orientation === 'square') {
      dimensions = { width: 1080, height: 1080 };
    }
    
    // Call the same video generation logic
    const apiKey = getNextHeyGenKey();
    if (!apiKey) {
      return res.status(503).json({ error: 'No API keys available' });
    }
    
    console.log(`Generating video from template: ${template.name}`);
    
    // Generate video with template settings
    const heygenResponse = await axios.post('https://api.heygen.com/v2/video/generate', {
      caption: false,
      dimension: dimensions,
      video_inputs: [{
        character: {
          type: 'avatar',
          avatar_id: avatar
        },
        voice: {
          type: 'text',
          input_text: finalScript,
          voice_id: voice
        }
      }]
    }, {
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'x-api-key': apiKey
      },
      timeout: 300000
    });
    
    const videoId = heygenResponse.data.data.video_id;
    
    res.json({
      success: true,
      videoId,
      template: template.name,
      orientation: template.orientation,
      message: 'Template video generation started',
      estimatedTime: '2-3 minutes'
    });
    
  } catch (error) {
    console.error('Template video generation error:', error);
    res.status(500).json({ error: 'Failed to generate video from template' });
  }
});

// Get supported languages
app.get('/api/languages', async (req, res) => {
  try {
    const { popular_only } = req.query;
    
    let languages = SUPPORTED_LANGUAGES;
    
    // Filter popular languages if requested
    if (popular_only === 'true') {
      languages = languages.filter(lang => lang.popular);
    }
    
    res.json({
      success: true,
      data: languages,
      count: languages.length,
      message: 'Supported languages loaded successfully',
      note: 'Translation feature coming soon'
    });
  } catch (error) {
    console.error('Languages error:', error);
    res.status(500).json({ error: 'Failed to fetch languages' });
  }
});

// Upload asset to HeyGen (Protected)
app.post('/api/upload-asset', verifyToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const { type = 'image' } = req.body;
    const filePath = req.file.path;
    
    console.log('Uploading asset to HeyGen:', req.file.originalname);
    
    // Get API key
    const apiKey = getNextHeyGenKey();
    if (!apiKey) {
      return res.status(503).json({ error: 'No API keys available' });
    }
    
    // Create form data for HeyGen upload
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    
    // Determine content type
    let contentType = 'image/jpeg';
    if (req.file.mimetype) {
      contentType = req.file.mimetype;
    }
    
    // Upload to HeyGen
    const uploadResponse = await axios.post('https://upload.heygen.com/v1/asset', form, {
      headers: {
        ...form.getHeaders(),
        'x-api-key': apiKey,
        'Content-Type': contentType
      },
      timeout: 120000 // 2 minutes
    });
    
    // Clean up local file
    fs.removeSync(filePath);
    
    // Store asset info in Firestore
    const assetData = {
      userId: req.user.uid,
      userEmail: req.user.email,
      originalName: req.file.originalname,
      size: req.file.size,
      type: type,
      mimeType: req.file.mimetype,
      heygenAssetId: uploadResponse.data.asset_id || uploadResponse.data.data?.asset_id,
      uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'uploaded'
    };
    
    const assetDoc = await admin.firestore().collection('assets').add(assetData);
    
    res.json({
      success: true,
      assetId: assetDoc.id,
      heygenAssetId: assetData.heygenAssetId,
      originalName: req.file.originalname,
      size: req.file.size,
      type: type,
      message: 'Asset uploaded successfully to HeyGen'
    });
    
  } catch (error) {
    console.error('Asset upload error:', error);
    
    // Clean up file on error
    if (req.file && req.file.path) {
      fs.removeSync(req.file.path);
    }
    
    if (error.response) {
      return res.status(error.response.status).json({
        error: 'HeyGen upload failed',
        details: error.response.data
      });
    }
    
    res.status(500).json({ error: 'Asset upload failed' });
  }
});

// Get user's uploaded assets (Protected)
app.get('/api/assets', verifyToken, async (req, res) => {
  try {
    const { type } = req.query;
    
    let query = admin.firestore().collection('assets')
      .where('userId', '==', req.user.uid)
      .orderBy('uploadedAt', 'desc');
    
    // Filter by type if provided
    if (type) {
      query = query.where('type', '==', type);
    }
    
    const snapshot = await query.limit(50).get();
    const assets = [];
    
    snapshot.forEach(doc => {
      assets.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    res.json({
      success: true,
      data: assets,
      count: assets.length,
      message: 'Assets loaded successfully'
    });
    
  } catch (error) {
    console.error('Assets fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch assets' });
  }
});

// Generate AI script using Groq (Protected + Limits)
app.post('/api/generate-script', verifyToken, checkScriptLimits, async (req, res) => {
  try {
    const { 
      topic, 
      category = 'business', 
      duration = '60s',
      language = 'english',
      customInstructions = '',
      tone = 'professional'
    } = req.body;
    
    if (!topic) {
      return res.status(400).json({ error: 'Topic is required' });
    }
    
    console.log('Generating AI script for topic:', topic);
    
    // Select appropriate prompt
    let promptTemplate = SCRIPT_PROMPTS[category] || SCRIPT_PROMPTS.business;
    
    // Replace placeholders
    let prompt = promptTemplate.replace('{topic}', topic);
    if (category === 'custom' && customInstructions) {
      prompt = prompt.replace('{customInstructions}', customInstructions);
    }
    
    // Add additional context
    prompt += `\n\nAdditional requirements:
- Duration: ${duration}
- Language: ${language}
- Tone: ${tone}
- Make it suitable for AI avatar video
- Include natural pauses and emphasis
- Avoid complex words that are hard to pronounce
- Make it engaging from the first sentence`;
    
    // Call Groq API
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "You are an expert video script writer specializing in AI avatar videos. Create engaging, natural-sounding scripts that work perfectly with text-to-speech technology. Focus on clarity, engagement, and proper pacing."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      model: "openai/gpt-oss-20b", // Best model available
      temperature: 0.7,
      max_tokens: 500,
      top_p: 0.9
    });
    
    const generatedScript = completion.choices[0]?.message?.content;
    
    if (!generatedScript) {
      throw new Error('Failed to generate script');
    }
    
    // Store script in Firestore for history
    const scriptData = {
      userId: req.user.uid,
      userEmail: req.user.email,
      topic,
      category,
      duration,
      language,
      tone,
      customInstructions,
      generatedScript,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      wordCount: generatedScript.split(' ').length,
      estimatedDuration: Math.ceil(generatedScript.split(' ').length / 2.5) + 's' // ~2.5 words per second
    };
    
    const scriptDoc = await admin.firestore().collection('scripts').add(scriptData);
    
    // Update user usage
    await updateUsage(req.user.uid, 'script');
    
    res.json({
      success: true,
      scriptId: scriptDoc.id,
      script: generatedScript,
      topic,
      category,
      wordCount: scriptData.wordCount,
      estimatedDuration: scriptData.estimatedDuration,
      message: 'AI script generated successfully',
      model: 'Groq GPT-OSS-20B (Best Model)'
    });
    
  } catch (error) {
    console.error('Script generation error:', error);
    
    if (error.response) {
      return res.status(error.response.status).json({
        error: 'Groq API Error',
        details: error.response.data
      });
    }
    
    res.status(500).json({ 
      error: 'Script generation failed',
      message: error.message 
    });
  }
});

// Get script generation history (Protected)
app.get('/api/scripts', verifyToken, async (req, res) => {
  try {
    const { category, limit = 20 } = req.query;
    
    let query = admin.firestore().collection('scripts')
      .where('userId', '==', req.user.uid)
      .orderBy('createdAt', 'desc');
    
    if (category) {
      query = query.where('category', '==', category);
    }
    
    const snapshot = await query.limit(parseInt(limit)).get();
    const scripts = [];
    
    snapshot.forEach(doc => {
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
    console.error('Scripts fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch scripts' });
  }
});

// Generate video with AI script (Protected + Limits)
app.post('/api/generate-video-with-ai', verifyToken, checkVideoLimits, checkScriptLimits, async (req, res) => {
  try {
    const {
      topic,
      category = 'business',
      avatar,
      voice,
      orientation = 'landscape',
      duration = '60s',
      language = 'english',
      tone = 'professional'
    } = req.body;
    
    if (!topic || !avatar) {
      return res.status(400).json({ error: 'Topic and avatar are required' });
    }
    
    console.log('Generating AI script + video for:', topic);
    
    // Step 1: Generate script using Groq
    const promptTemplate = SCRIPT_PROMPTS[category] || SCRIPT_PROMPTS.business;
    let prompt = promptTemplate.replace('{topic}', topic);
    prompt += `\n\nRequirements: ${duration}, ${language}, ${tone} tone, AI avatar suitable`;
    
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: "Create engaging video scripts for AI avatars. Focus on natural speech patterns and clear pronunciation."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      model: "openai/gpt-oss-20b",
      temperature: 0.7,
      max_tokens: 400
    });
    
    const script = completion.choices[0]?.message?.content;
    
    if (!script) {
      throw new Error('Failed to generate script');
    }
    
    // Step 2: Generate video with the AI script
    const apiKey = getNextHeyGenKey();
    if (!apiKey) {
      return res.status(503).json({ error: 'No API keys available' });
    }
    
    // Set dimensions
    let dimensions = { width: 1280, height: 720 };
    if (orientation === 'portrait') dimensions = { width: 720, height: 1280 };
    if (orientation === 'square') dimensions = { width: 1080, height: 1080 };
    
    const heygenResponse = await axios.post('https://api.heygen.com/v2/video/generate', {
      caption: false,
      dimension: dimensions,
      video_inputs: [{
        character: { type: 'avatar', avatar_id: avatar },
        voice: { type: 'text', input_text: script, voice_id: voice }
      }]
    }, {
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'x-api-key': apiKey
      },
      timeout: 300000
    });
    
    const videoId = heygenResponse.data.data.video_id;
    
    // Store combined data
    const combinedData = {
      userId: req.user.uid,
      userEmail: req.user.email,
      topic,
      category,
      generatedScript: script,
      avatar,
      voice,
      orientation,
      dimensions,
      videoId,
      status: 'processing',
      type: 'ai-generated',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    const docRef = await admin.firestore().collection('ai-videos').add(combinedData);
    
    // Update user usage for both video and script
    await updateUsage(req.user.uid, 'video');
    await updateUsage(req.user.uid, 'script');
    
    res.json({
      success: true,
      id: docRef.id,
      videoId,
      script,
      topic,
      category,
      wordCount: script.split(' ').length,
      message: 'AI script generated (GPT-OSS-20B) and video creation started',
      estimatedTime: '2-3 minutes'
    });
    
  } catch (error) {
    console.error('AI video generation error:', error);
    res.status(500).json({ error: 'AI video generation failed' });
  }
});

// Get popular avatars (hardcoded for speed)
app.get('/api/avatars', async (req, res) => {
  try {
    res.json({
      success: true,
      data: POPULAR_AVATARS,
      count: POPULAR_AVATARS.length,
      message: 'Popular avatars loaded successfully'
    });
  } catch (error) {
    console.error('Avatar list error:', error);
    res.status(500).json({ error: 'Failed to fetch avatars' });
  }
});

// Get popular voices (hardcoded for speed)
app.get('/api/voices', async (req, res) => {
  try {
    res.json({
      success: true,
      data: POPULAR_VOICES,
      count: POPULAR_VOICES.length,
      languages: ['en', 'hi', 'es', 'fr', 'ja'],
      message: 'Popular voices loaded successfully'
    });
  } catch (error) {
    console.error('Voice list error:', error);
    res.status(500).json({ error: 'Failed to fetch voices' });
  }
});

// Error handling
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 HeyGen Backend running on port ${PORT}`);
  console.log(`🔑 Available API keys: ${HEYGEN_KEYS.length}`);
  console.log(`👤 Popular avatars: ${POPULAR_AVATARS.length}`);
  console.log(`🎤 Popular voices: ${POPULAR_VOICES.length}`);
  console.log(`📋 Custom templates: ${CUSTOM_TEMPLATES.length}`);
  console.log(`🌍 Supported languages: ${SUPPORTED_LANGUAGES.length}`);
  console.log(`📁 Asset upload: Enabled`);
  console.log(`🤖 Groq AI: ${process.env.GROQ_API_KEY ? 'Configured' : 'Not configured'}`);
  console.log(`💳 Razorpay: ${process.env.RAZORPAY_KEY_ID ? 'Configured' : 'Not configured'}`);
  console.log(`✍️ AI Script Generation: Enabled`);
  console.log(`📁 Upload directory: ${uploadDir}`);
  console.log(`📁 Output directory: ${outputDir}`);
  console.log(`🔥 Firebase Firestore: ${process.env.FIREBASE_PROJECT_ID || 'Not configured'}`);
  console.log(`☁️  Video URLs stored in Firestore`);
  console.log(`🎁 Video hosting: Catbox.moe (FREE!)`);
  console.log(`💰 Storage cost: ₹0`);
});

module.exports = app;