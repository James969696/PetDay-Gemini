#!/bin/bash

# Kill any existing processes (optional but recommended)
pkill -f ts-node
pkill -f vite

echo "🚀 Starting PetDay Fullstack (Gemini 3 Flash)..."

# Run concurrently using the root package.json script
npm run dev
