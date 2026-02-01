#!/bin/bash

# Script to update GitHub repository with latest backend code

set -e

echo "========================================="
echo "    Updating GitHub Repository"
echo "========================================="
echo

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in the backend directory
if [ ! -f "package.json" ]; then
    echo "Error: Please run this script from the backend directory"
    exit 1
fi

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo -e "${YELLOW}Initializing git repository...${NC}"
    git init
    git remote add origin https://github.com/opeoladettp/yodeco-backend.git
fi

# Add all files
echo -e "${YELLOW}Adding files to git...${NC}"
git add .

# Create .gitignore if it doesn't exist
if [ ! -f ".gitignore" ]; then
    echo -e "${YELLOW}Creating .gitignore...${NC}"
    cat > .gitignore << 'EOF'
# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment files
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Logs
logs/
*.log

# Runtime data
pids/
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/

# nyc test coverage
.nyc_output/

# Dependency directories
node_modules/
jspm_packages/

# Optional npm cache directory
.npm

# Optional REPL history
.node_repl_history

# Output of 'npm pack'
*.tgz

# Yarn Integrity file
.yarn-integrity

# dotenv environment variables file
.env

# IDE files
.vscode/
.idea/
*.swp
*.swo

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# Docker
.dockerignore

# SSL certificates
ssl/
*.pem
*.key
*.crt

# Database dumps
*.sql
*.dump

# Temporary files
tmp/
temp/
EOF
fi

# Commit changes
echo -e "${YELLOW}Committing changes...${NC}"
git add .gitignore
git commit -m "Complete YODECO backend with Docker deployment

Features:
- Complete biometric voting system with facial recognition
- Member registration and management system
- Vote bias management for admins
- Award and nomination management
- Docker production deployment with HTTPS
- MongoDB and Redis integration
- Google OAuth authentication
- AWS S3 integration for file uploads
- Comprehensive API with health checks
- Rate limiting and security features
- CORS configuration for multiple frontend URLs

Deployment:
- Docker Compose production setup
- Nginx reverse proxy with SSL
- Let's Encrypt SSL certificates
- Health monitoring and logging
- Secure environment configuration

Ready for EC2 deployment with HTTPS support."

# Push to GitHub
echo -e "${YELLOW}Pushing to GitHub...${NC}"
git branch -M main
git push -u origin main --force

echo -e "${GREEN}Successfully updated GitHub repository!${NC}"
echo
echo "Repository: https://github.com/opeoladettp/yodeco-backend.git"
echo "Ready for EC2 deployment"