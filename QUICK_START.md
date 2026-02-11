# 🚀 ElevenLabs Voice System - Quick Start

## Setup (2 minutes)

### 1. Get API Key
1. Go to https://elevenlabs.io
2. Sign up (free tier: 10K chars/month)
3. Copy API key from Profile → API Keys

### 2. Add to Environment
```bash
# Railway
Add variable: ELEVENLABS_API_KEY = your_key_here

# Local
export ELEVENLABS_API_KEY=your_key_here
```

### 3. Restart Server
```bash
npm start
```

## Usage (30 seconds)

### Create Game with Voices
1. Login to `/admin`
2. Click **+** button
3. Select sport → league → game
4. For each commentator:
   - Choose voice from dropdown
   - 13 male options, 10 female options
5. Click **CREATE**

### Test It
Visit: `/avatar.html?session=YOUR_SESSION_ID`

## 🎙️ Quick Voice Reference

### Top Male Voices
- **Adam** - Deep, professional (DEFAULT)
- **Josh** - Young, energetic
- **Michael** - Smooth broadcaster
- **Daniel** - Authoritative
- **Charlie** - Casual, Australian

### Top Female Voices
- **Rachel** - Calm, clear (DEFAULT)
- **Elli** - Emotional, expressive
- **Sarah** - News anchor quality
- **Domi** - Strong, confident
- **Freya** - Young, energetic

## ✅ Verification

### Check API Key Works
```bash
curl -X POST http://localhost:3000/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"Test","voice":"adam"}'
```

### Get Voice List
```bash
curl http://localhost:3000/api/voices
```

## 💰 Cost

- **Free Tier**: 10,000 chars = ~30 games FREE
- **Paid**: ~$0.10 per game
- **Fallback**: Piper TTS = FREE (lower quality)

## 🎯 Recommended Combos

### NFL/Football
- Adam (male) + Rachel (female)
- Michael + Sarah

### NBA/Basketball
- Josh (male) + Elli (female)
- Antoni + Freya

### Comedy Style
- Charlie (male) + Grace (female)
- George + Nicole

### Professional
- Daniel (male) + Sarah (female)
- Michael + Emily

## 🐛 Troubleshooting

### No Audio?
- Check API key is set
- Restart server
- Check browser console

### Robot Voice?
- Using Piper fallback (no API key)
- Add ELEVENLABS_API_KEY

### 502 Error?
- ElevenLabs API down
- System auto-falls back to Piper

## 📚 Full Docs

- **Setup**: ELEVENLABS_SETUP.md
- **Examples**: VOICE_EXAMPLES.md
- **Summary**: VOICE_SYSTEM_SUMMARY.md

---

**That's it! You're ready to go. 🎉**
