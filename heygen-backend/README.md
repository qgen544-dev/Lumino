# HeyGen Video Generation Backend

## Features
- 🔄 **HeyGen API Key Rotation** (10 videos per key)
- 🎬 **Automatic Watermark Removal** (FFmpeg)
- 📁 **File Management** (Auto cleanup)
- 🚀 **Fast Processing** (2-3 minutes per video)
- 💰 **100% Profit Margin** (Free HeyGen + Paid service)

## Setup

1. **Install Dependencies**
```bash
npm install
```

2. **Environment Setup**
```bash
cp .env.example .env
# Add your HeyGen API keys
```

3. **Start Server**
```bash
npm run dev
```

## API Endpoints

### Generate Video
```
POST /api/generate-video
{
  "script": "Hello, this is my AI avatar speaking!",
  "avatar": "avatar_id_here",
  "voice": "natural"
}
```

### Download Video
```
GET /api/download/:filename
```

### Get Avatars
```
GET /api/avatars
```

### Get Voices
```
GET /api/voices
```

## Business Model

- **Cost:** ₹0 (Free HeyGen accounts)
- **Revenue:** ₹500 per video
- **Profit:** 100% 💰

## Key Rotation System

- Automatically rotates between multiple HeyGen free accounts
- Each key allows 10 videos per month
- 100 keys = 1000 free videos per month!

## Watermark Removal

- Static watermark in right-bottom corner
- FFmpeg crop filter removes it perfectly
- No quality loss, just cropping

## Scaling

- Add more HeyGen accounts as needed
- Horizontal scaling with multiple servers
- Queue system for high volume

## 20L Car Goal 🚗

With 1000 free videos/month × ₹500 = ₹5,00,000/month
Car goal achieved in 1 month! 🔥