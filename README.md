# Sushi - Live Sports Commentary with AI Avatars

Real-time sports commentary with 3D VRM avatars, AI-generated commentary, and high-quality TTS.

## Features

- **Live Sports Data**: ESPN API integration for NFL, NBA, MLB, NHL, Soccer
- **AI Commentary**: Powered by Modal LLM with personality-driven commentators
- **3D Avatars**: VRM anime characters with lip-sync and expressions
- **High-Quality TTS**: Piper TTS on Modal (Amy voice) with Web Speech fallback
- **Admin Dashboard**: Create/manage commentary sessions with custom personalities
- **Mobile Responsive**: Works on desktop and mobile browsers

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Browser   │────▶│  Node.js/    │────▶│    Modal    │
│  (Avatar)   │◀────│   Express    │◀────│  (LLM/TTS)  │
└─────────────┘     └──────────────┘     └─────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │    ESPN      │
                     │     API      │
                     └──────────────┘
```

## Quick Start

```bash
# Install dependencies
npm install

# Set environment variables
export MODAL_PIPER_URL="https://yourusername--sushi-piper-tts-tts.modal.run"
export MODAL_MISTRAL_URL="https://yourusername--claudeapps-mistral-mistralmodel-chat.modal.run"
export FIREBASE_SERVICE_ACCOUNT='{...}'

# Run locally
npm start
```

## Deploy to Railway

1. Connect GitHub repo to Railway
2. Add environment variables in Railway dashboard
3. Deploy automatically on push to main

## Project Structure

```
├── server.js              # Express server, ESPN API, commentary engine
├── public/
│   ├── index.html         # Main UI
│   ├── avatar.html        # VRM avatar viewer
│   ├── admin.html         # Admin dashboard
│   └── lib/               # Three.js, VRM libraries
├── modal-llm/
│   ├── mistral.py         # Modal LLM endpoint
│   └── piper/tts.py       # Modal TTS endpoint
└── README.md
```

## Documentation

- [Avatar Setup](docs/AVATAR.md) - VRM avatars, lip-sync, expressions
- [TTS Setup](docs/TTS.md) - Piper TTS on Modal
- [Commentary Engine](docs/COMMENTARY.md) - AI commentary system
- [API Reference](docs/API.md) - REST API endpoints

## License

MIT
