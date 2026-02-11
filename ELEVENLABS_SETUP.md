# ElevenLabs Voice Integration

## Overview

Sushi now supports high-quality TTS using ElevenLabs API with 20+ professional voice options (male and female).

## Setup Instructions

### 1. Get ElevenLabs API Key

1. Go to [ElevenLabs](https://elevenlabs.io/)
2. Sign up for an account (free tier available)
3. Navigate to Profile → API Keys
4. Copy your API key

### 2. Add to Environment Variables

#### Local Development
Create a `.env` file or add to your environment:
```bash
ELEVENLABS_API_KEY=your_api_key_here
```

#### Railway Deployment
1. Go to Railway Dashboard → Your Project
2. Click "Variables"
3. Add new variable:
   - **Name**: `ELEVENLABS_API_KEY`
   - **Value**: Your API key

### 3. Restart Server

```bash
npm start
```

## Available Voices

### Male Voices (13 options)
- **Adam** - Deep, middle-aged (default male)
- **Antoni** - Young, energetic
- **Arnold** - Strong, crisp
- **Callum** - Hoarse, masculine
- **Charlie** - Casual, Australian
- **Clyde** - War veteran, raspy
- **Daniel** - Deep, authoritative
- **George** - British, warm
- **Joseph** - Mature, articulate
- **Josh** - Young, expressive
- **Michael** - Smooth, professional
- **Thomas** - Calm, British
- **Bryce** - Piper fallback (free)

### Female Voices (10 options)
- **Rachel** - Calm, young (default female)
- **Domi** - Strong, confident
- **Bella** - Soft, American
- **Elli** - Emotional, expressive
- **Emily** - Calm, American
- **Freya** - Young, American
- **Grace** - Southern, smooth
- **Nicole** - Whisper, expressive
- **Sarah** - Soft, news anchor
- **Amy** - Piper fallback (free)

## Usage

### In Admin Panel

1. Create or edit a game session
2. For each commentator, select a voice from the dropdown
3. Voices are grouped by gender for easy selection
4. Save the session

### Fallback Behavior

If ElevenLabs API fails or no API key is provided:
- System automatically falls back to Piper TTS (free)
- Piper voices: Amy (female), Bryce (male)
- No interruption to service

## Cost Estimates

### ElevenLabs Pricing (as of 2024)
- **Free Tier**: 10,000 characters/month
- **Starter**: $5/month - 30,000 characters
- **Creator**: $22/month - 100,000 characters

### Typical Usage
- Average commentary turn: ~100-200 characters
- 3 turns per play: ~300-600 characters
- ~16-50 plays per game
- Estimated cost: **$0.10-0.50 per game**

## Testing

Test a voice:
```bash
curl -X POST http://localhost:3000/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"This is a test of the voice system","voice":"adam"}'
```

Get available voices:
```bash
curl http://localhost:3000/api/voices
```

## Troubleshooting

### No audio playing
- Check browser console for errors
- Verify API key is set in environment
- Check ElevenLabs dashboard for quota/credits

### 502 Error
- ElevenLabs API might be down
- System will fallback to Piper automatically
- Check server logs for details

### Poor audio quality
- Piper fallback has lower quality than ElevenLabs
- Add/verify ELEVENLABS_API_KEY environment variable
- Restart server after adding key

## API Endpoints

### POST /api/tts
Generate speech from text
```json
{
  "text": "Your commentary text",
  "voice": "adam"
}
```

### GET /api/voices
Get available voice options
```json
{
  "male": [...],
  "female": [...]
}
```

## Voice Selection Guide

### For Sports Commentary

**Play-by-Play (Excited, Fast-paced)**
- Male: Antoni, Josh, Charlie
- Female: Elli, Freya, Domi

**Color Commentary (Analytical, Calm)**
- Male: Daniel, Thomas, Michael
- Female: Rachel, Emily, Sarah

**Comedic/Personality-Driven**
- Male: Clyde, Callum, George
- Female: Grace, Nicole, Bella

**Professional/Broadcast**
- Male: Adam, Joseph, Daniel
- Female: Rachel, Sarah, Emily

## Advanced Configuration

### Voice Settings (in server.js)
```javascript
{
  stability: 0.5,           // 0-1, higher = more consistent
  similarity_boost: 0.75,   // 0-1, higher = closer to original
  style: 0.0,               // 0-1, style exaggeration
  use_speaker_boost: true   // Enhance speaker clarity
}
```

### Model Selection
- Current: `eleven_turbo_v2_5` (fast, high quality)
- Alternative: `eleven_monolingual_v1` (slower, more accurate)

## Resources

- [ElevenLabs Documentation](https://elevenlabs.io/docs)
- [Voice Library](https://elevenlabs.io/voice-library)
- [API Reference](https://elevenlabs.io/docs/api-reference)
