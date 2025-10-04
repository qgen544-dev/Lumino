const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const validator = require('validator');
const xss = require('xss');

// Global rate limiting
const globalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 minutes
  message: {
    error: 'Too many requests',
    message: 'Please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Strict rate limiting for expensive operations
const strictRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per minute
  message: {
    error: 'Rate limit exceeded',
    message: 'Maximum 5 requests per minute allowed'
  }
});

// Payment rate limiting
const paymentRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 3, // 3 payment attempts per minute
  message: {
    error: 'Payment rate limit exceeded',
    message: 'Maximum 3 payment attempts per minute'
  }
});

// Enhanced input sanitization
const sanitizeInput = (req, res, next) => {
  try {
    // Deep sanitization function
    const deepSanitize = (obj) => {
      if (typeof obj === 'string') {
        // XSS protection
        let cleaned = xss(obj, {
          whiteList: {}, // No HTML tags allowed
          stripIgnoreTag: true,
          stripIgnoreTagBody: ['script']
        });
        
        // SQL injection patterns
        const sqlPatterns = [
          /('|(\-\-)|(;)|(\||\|)|(\*|\*))/i,
          /(union|select|insert|delete|update|drop|create|alter|exec|execute)/i
        ];
        
        // NoSQL injection patterns  
        const noSqlPatterns = [
          /\$where/i, /\$ne/i, /\$in/i, /\$nin/i, /\$gt/i, /\$lt/i,
          /\$regex/i, /\$exists/i, /\$elemMatch/i
        ];
        
        // Check for malicious patterns
        const isMalicious = [...sqlPatterns, ...noSqlPatterns].some(pattern => pattern.test(cleaned));
        
        if (isMalicious) {
          console.warn(`🚨 Malicious input detected: ${obj.substring(0, 100)}...`);
          throw new Error('Invalid input detected');
        }
        
        return cleaned;
      }
      
      if (Array.isArray(obj)) {
        return obj.map(item => deepSanitize(item));
      }
      
      if (typeof obj === 'object' && obj !== null) {
        const sanitized = {};
        for (let key in obj) {
          // Sanitize keys too
          const cleanKey = key.replace(/[^a-zA-Z0-9_]/g, '');
          sanitized[cleanKey] = deepSanitize(obj[key]);
        }
        return sanitized;
      }
      
      return obj;
    };
    
    // Apply sanitization
    if (req.body) req.body = deepSanitize(req.body);
    if (req.query) req.query = deepSanitize(req.query);
    if (req.params) req.params = deepSanitize(req.params);
    
    next();
  } catch (error) {
    console.error('Security sanitization error:', error.message);
    return res.status(400).json({
      success: false,
      error: 'Invalid request format',
      message: 'Please check your input and try again'
    });
  }
};

// MongoDB sanitization middleware
const mongoSanitization = mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key }) => {
    console.warn(`🚨 NoSQL injection attempt blocked: ${key}`);
  }
});

// Environment validation
const validateEnvironment = () => {
  const required = [
    'HEYGEN_KEYS',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_PRIVATE_KEY',
    'GROQ_API_KEY',
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET'
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing environment variables:', missing);
    process.exit(1);
  }
  
  console.log('✅ Environment variables validated');
};

// Security headers
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
});

// Input validation helpers
const validateEmail = (email) => {
  return validator.isEmail(email) && validator.isLength(email, { max: 254 });
};

const validateString = (str, options = {}) => {
  const { minLength = 1, maxLength = 1000, alphanumeric = false } = options;
  
  if (!validator.isLength(str, { min: minLength, max: maxLength })) {
    return false;
  }
  
  if (alphanumeric && !validator.isAlphanumeric(str, 'en-US', { ignore: ' -_' })) {
    return false;
  }
  
  return true;
};

// Enhanced error handler
const securityErrorHandler = (error, req, res, next) => {
  // Log detailed error internally
  console.error('🔒 Security Error:', {
    error: error.message,
    stack: error.stack,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    url: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
  
  // Send user-friendly response
  const userFriendlyErrors = {
    'Invalid input detected': 'Please check your input format',
    'Rate limit exceeded': 'Too many requests, please slow down',
    'Unauthorized': 'Please log in to continue',
    'Forbidden': 'Access denied'
  };
  
  const message = userFriendlyErrors[error.message] || 'Something went wrong';
  
  res.status(error.status || 400).json({
    success: false,
    error: 'Security Error',
    message,
    timestamp: new Date().toISOString()
  });
};

module.exports = {
  globalRateLimit,
  strictRateLimit,
  paymentRateLimit,
  sanitizeInput,
  mongoSanitization,
  validateEnvironment,
  securityHeaders,
  validateEmail,
  validateString,
  securityErrorHandler
};