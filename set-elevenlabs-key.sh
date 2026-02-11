#!/bin/bash
# Upload ElevenLabs API key to Railway

echo "🚂 Railway - Set ElevenLabs API Key"
echo "====================================="
echo ""

# Check if railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found!"
    echo ""
    echo "Install it with:"
    echo "  npm install -g @railway/cli"
    echo "  or"
    echo "  brew install railway"
    exit 1
fi

# Prompt for API key
echo "Enter your ElevenLabs API key:"
read -s ELEVENLABS_API_KEY
echo ""

if [ -z "$ELEVENLABS_API_KEY" ]; then
    echo "❌ API key cannot be empty"
    exit 1
fi

echo "Setting ELEVENLABS_API_KEY in Railway..."
railway variables --set ELEVENLABS_API_KEY="$ELEVENLABS_API_KEY"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ API key set successfully!"
    echo ""
    echo "Triggering redeploy..."
    railway up --detach
    echo ""
    echo "🎉 Done! Check Railway dashboard to monitor deployment."
    echo "   Once deployed, your avatars will use ElevenLabs voices."
else
    echo ""
    echo "❌ Failed to set API key. Make sure you're logged in:"
    echo "   railway login"
fi
