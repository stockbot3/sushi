#!/bin/bash

# Piper TTS Setup Script
# Downloads Piper binaries and voice models

set -e

PIPER_VERSION="1.2.0"
PIPER_DIR="$(dirname "$0")"
VOICE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx"
VOICE_JSON_URL="https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/amy/medium/en_US-amy-medium.onnx.json"

echo "Setting up Piper TTS..."

# Detect architecture
ARCH=$(uname -m)
if [ "$ARCH" = "x86_64" ]; then
    PIPER_ARCH="x86_64"
elif [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
    PIPER_ARCH="aarch64"
else
    echo "Unsupported architecture: $ARCH"
    exit 1
fi

# Download Piper binary if not exists
if [ ! -f "$PIPER_DIR/piper" ]; then
    echo "Downloading Piper binary for $PIPER_ARCH..."
    curl -L "https://github.com/rhasspy/piper/releases/download/v${PIPER_VERSION}/piper_${PIPER_ARCH}.tar.gz" | tar -xz -C "$PIPER_DIR"
    chmod +x "$PIPER_DIR/piper"
fi

# Download voice model if not exists
if [ ! -f "$PIPER_DIR/voice.onnx" ]; then
    echo "Downloading voice model..."
    curl -L -o "$PIPER_DIR/voice.onnx" "$VOICE_URL"
    curl -L -o "$PIPER_DIR/voice.onnx.json" "$VOICE_JSON_URL"
fi

echo "Piper setup complete!"
echo "Binary: $PIPER_DIR/piper"
echo "Voice: $PIPER_DIR/voice.onnx"
