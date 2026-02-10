#!/bin/bash

# Deploy Piper TTS to Modal
cd "$(dirname "$0")"

# Check if modal is installed
if ! command -v modal &> /dev/null; then
    echo "Modal not found. Install with: pip install modal"
    exit 1
fi

echo "Deploying Piper TTS to Modal..."
modal deploy tts.py

echo "Done! Your TTS endpoint will be available at:"
echo "  https://{username}--sushi-piper-tts-tts.modal.run"
