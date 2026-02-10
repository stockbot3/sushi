#!/bin/bash

# Start script for Sushi
# Just runs Node.js server (Piper TTS is now on Modal)

cd "$(dirname "$0")"

echo "Starting Sushi server..."
node server.js
