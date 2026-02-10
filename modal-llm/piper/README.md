# Piper TTS on Modal

Deploys high-quality text-to-speech using Piper TTS on Modal.com

## Setup

1. Make sure you have Modal configured:
```bash
cd /Users/akara/.openclaw/workspace/polymarket-prod/claudeapps/apps/sushi/modal-llm/piper
modal setup
```

2. Deploy:
```bash
modal deploy tts.py
```

3. Get the endpoint URL from the output, e.g.:
```
https://yourusername--sushi-piper-tts-tts.modal.run
```

4. Set environment variable on Railway:
```
MODAL_PIPER_URL=https://yourusername--sushi-piper-tts-tts.modal.run
```

## Usage

POST to `/api/tts` with body:
```json
{"text": "Hello world"}
```

Response:
```json
{
  "audio": "base64_encoded_wav...",
  "format": "wav",
  "sample_rate": 22050
}
```
