#!/bin/bash

# Quick Update Script for YODECO Backend
# This script pulls the latest code and restarts the backend service

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "========================================="
echo "    YODECO Backend Quick Update"
echo "========================================="
echo

echo -e "${BLUE}[INFO]${NC} Pulling latest code from GitHub..."
git pull origin clean-main

echo -e "${BLUE}[INFO]${NC} Rebuilding and restarting backend service..."
docker-compose -f docker-compose.prod.yml up --build -d backend

echo -e "${BLUE}[INFO]${NC} Waiting for backend to be ready..."
sleep 15

echo -e "${BLUE}[INFO]${NC} Testing health endpoint..."
if curl -f http://localhost:5000/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}[SUCCESS]${NC} Backend updated successfully!"
else
    echo -e "${BLUE}[INFO]${NC} Backend may still be starting. Check logs with:"
    echo "docker-compose -f docker-compose.prod.yml logs backend"
fi

echo
echo -e "${GREEN}Update completed!${NC}"
echo "View logs: docker-compose -f docker-compose.prod.yml logs -f backend"
