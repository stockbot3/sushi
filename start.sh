#!/bin/bash

# Start script for Sushi with Piper TTS
# Runs both Node.js server and Piper TTS server

cd "$(dirname "$0")"

# Function to cleanup processes on exit
cleanup() {
    echo "Shutting down servers..."
    kill $NODE_PID $PIPER_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

echo "Starting Sushi with Piper TTS..."

# Setup Piper
if [ -f "piper/setup.sh" ]; then
    echo "Setting up Piper..."
    bash piper/setup.sh
fi

# Start Piper TTS server in background
echo "Starting Piper TTS server on port 5000..."
python3 piper/server.py &
PIPER_PID=$!

# Wait for Piper to be ready
echo "Waiting for Piper to be ready..."
for i in {1..30}; do
    if curl -s http://localhost:5000/health > /dev/null 2>&1; then
        echo "Piper is ready!"
        break
    fi
    sleep 1
done

# Start Node.js server
echo "Starting Node.js server..."
node server.js &
NODE_PID=$!

# Wait for both processes
wait $NODE_PID $PIPER_PID
