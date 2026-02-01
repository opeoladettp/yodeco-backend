#!/bin/bash

# YODECO Backend Deployment Script for EC2
# This script sets up the complete Docker environment with HTTPS

set -e

echo "========================================="
echo "    YODECO Backend Deployment"
echo "========================================="
echo

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DOMAIN="yodeco-backend.duckdns.org"
EMAIL="opeoladettp@gmail.com"  # Email for Let's Encrypt
APP_DIR="/opt/yodeco-backend"

# Function to print status
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_status "Deploying YODECO Backend to: $DOMAIN"
echo

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   print_error "This script should not be run as root"
   exit 1
fi

# Check if domain resolves
print_status "Checking domain resolution..."
if ! nslookup $DOMAIN > /dev/null 2>&1; then
    print_warning "Domain $DOMAIN may not resolve properly"
    print_warning "Make sure your domain points to this server's IP address"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    print_success "Domain $DOMAIN resolves correctly"
fi

# Update system packages
print_status "Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install required packages
print_status "Installing required packages..."
sudo apt install -y curl wget gnupg lsb-release ca-certificates

# Install Docker if not installed
if ! command -v docker &> /dev/null; then
    print_status "Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
    print_success "Docker installed successfully"
    
    # Start Docker service
    sudo systemctl enable docker
    sudo systemctl start docker
else
    print_success "Docker is already installed"
fi

# Install Docker Compose if not installed
if ! command -v docker-compose &> /dev/null; then
    print_status "Installing Docker Compose..."
    DOCKER_COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep 'tag_name' | cut -d\" -f4)
    sudo curl -L "https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    print_success "Docker Compose installed successfully"
else
    print_success "Docker Compose is already installed"
fi

# Verify Docker installation
print_status "Verifying Docker installation..."
if ! docker --version > /dev/null 2>&1; then
    print_error "Docker installation failed"
    exit 1
fi

if ! docker-compose --version > /dev/null 2>&1; then
    print_error "Docker Compose installation failed"
    exit 1
fi

print_success "Docker and Docker Compose are working correctly"

# Create application directory
APP_DIR="/opt/yodeco-backend"
echo -e "${YELLOW}Setting up application directory: $APP_DIR${NC}"
sudo mkdir -p $APP_DIR
sudo chown $USER:$USER $APP_DIR

# Stop existing containers if running
echo -e "${YELLOW}Stopping existing containers...${NC}"
docker-compose -f docker-compose.prod.yml down --remove-orphans || true

# Clean up old images
echo -e "${YELLOW}Cleaning up old Docker images...${NC}"
docker system prune -f

# Generate secure passwords if .env.production doesn't exist
if [ ! -f .env.production ]; then
    echo -e "${YELLOW}Generating secure environment configuration...${NC}"
    
    # Generate random passwords
    MONGO_ROOT_PASSWORD=$(openssl rand -base64 32)
    MONGO_PASSWORD=$(openssl rand -base64 32)
    REDIS_PASSWORD=$(openssl rand -base64 32)
    JWT_SECRET=$(openssl rand -base64 64)
    JWT_REFRESH_SECRET=$(openssl rand -base64 64)
    SESSION_SECRET=$(openssl rand -base64 64)
    
    # Create .env.production with generated passwords
    cat > .env.production << EOF
# Production Environment Configuration for YODECO Backend
NODE_ENV=production
PORT=5000

# Frontend URLs for CORS
FRONTEND_URL=https://yodeco.duckdns.org
DEVELOPMENT_FRONTEND_URL=http://localhost:3000
PRODUCTION_FRONTEND_URL=https://yodeco.ng

# Database Configuration
MONGO_ROOT_USERNAME=admin
MONGO_ROOT_PASSWORD=$MONGO_ROOT_PASSWORD
MONGO_USERNAME=yodeco_user
MONGO_PASSWORD=$MONGO_PASSWORD
MONGODB_URI=mongodb://yodeco_user:$MONGO_PASSWORD@mongodb:27017/biometric-voting?authSource=biometric-voting

# Redis Configuration
REDIS_PASSWORD=$REDIS_PASSWORD
REDIS_URL=redis://:$REDIS_PASSWORD@redis:6379

# JWT Configuration
JWT_SECRET=$JWT_SECRET
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Google OAuth Configuration
GOOGLE_CLIENT_ID=your-google-client-id-here
GOOGLE_CLIENT_SECRET=your-google-client-secret-here
GOOGLE_CALLBACK_URL=https://$DOMAIN/api/auth/google/callback

# AWS Configuration
AWS_ACCESS_KEY_ID=your-aws-access-key-here
AWS_SECRET_ACCESS_KEY=your-aws-secret-key-here
AWS_REGION=eu-north-1
AWS_S3_BUCKET=bvp-storage

# Session Configuration
SESSION_SECRET=$SESSION_SECRET

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# WebAuthn Configuration
WEBAUTHN_RP_NAME=YODECO Voting Portal
WEBAUTHN_RP_ID=$DOMAIN
WEBAUTHN_ORIGIN=https://yodeco.duckdns.org

# Logging
LOG_LEVEL=info
LOG_FILE=/app/logs/app.log
EOF

    echo -e "${GREEN}Generated secure environment configuration${NC}"
else
    echo -e "${GREEN}Using existing .env.production${NC}"
fi

# Update mongo-init.js with the actual password
MONGO_PASSWORD=$(grep MONGO_PASSWORD= .env.production | cut -d'=' -f2)
sed -i "s/your-secure-mongo-password-here/$MONGO_PASSWORD/g" mongo-init.js

# Create logs directory
mkdir -p logs

# Create SSL directory for certificates
mkdir -p ssl

# Build and start services
echo -e "${YELLOW}Building and starting services...${NC}"
docker-compose -f docker-compose.prod.yml up --build -d

# Wait for services to be ready
echo -e "${YELLOW}Waiting for services to start...${NC}"
sleep 30

# Check if services are running
echo -e "${YELLOW}Checking service status...${NC}"
docker-compose -f docker-compose.prod.yml ps

# Test health endpoint
echo -e "${YELLOW}Testing health endpoint...${NC}"
if curl -f http://localhost:5000/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}Backend health check passed${NC}"
else
    echo -e "${RED}Backend health check failed${NC}"
    echo "Checking logs..."
    docker-compose -f docker-compose.prod.yml logs backend
fi

# Setup SSL certificates
echo -e "${YELLOW}Setting up SSL certificates...${NC}"
if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    echo -e "${YELLOW}Obtaining SSL certificate for $DOMAIN...${NC}"
    
    # Stop nginx temporarily
    docker-compose -f docker-compose.prod.yml stop nginx
    
    # Get certificate
    docker run --rm \
        -v certbot_conf:/etc/letsencrypt \
        -v certbot_data:/var/www/certbot \
        -p 80:80 \
        certbot/certbot certonly \
        --standalone \
        --email $EMAIL \
        --agree-tos \
        --no-eff-email \
        -d $DOMAIN
    
    # Restart nginx
    docker-compose -f docker-compose.prod.yml start nginx
    
    echo -e "${GREEN}SSL certificate obtained successfully${NC}"
else
    echo -e "${GREEN}SSL certificate already exists${NC}"
fi

# Final status check
echo
echo -e "${YELLOW}Final deployment status:${NC}"
docker-compose -f docker-compose.prod.yml ps

# Test HTTPS endpoint
echo -e "${YELLOW}Testing HTTPS endpoint...${NC}"
if curl -f https://$DOMAIN/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}HTTPS health check passed${NC}"
else
    echo -e "${YELLOW}HTTPS not ready yet (SSL certificate may still be propagating)${NC}"
fi

echo
echo "========================================="
echo -e "${GREEN}    Deployment Complete!${NC}"
echo "========================================="
echo
echo -e "Backend URL: ${GREEN}https://$DOMAIN${NC}"
echo -e "Health Check: ${GREEN}https://$DOMAIN/api/health${NC}"
echo -e "API Documentation: ${GREEN}https://$DOMAIN/api${NC}"
echo
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Update your frontend to use: https://$DOMAIN"
echo "2. Update Google OAuth redirect URLs"
echo "3. Test all endpoints"
echo "4. Monitor logs: docker-compose -f docker-compose.prod.yml logs -f"
echo
echo -e "${YELLOW}Important Files:${NC}"
echo "- Environment: .env.production"
echo "- Logs: ./logs/"
echo "- SSL Certificates: /etc/letsencrypt/live/$DOMAIN/"
echo
echo -e "${GREEN}Deployment successful!${NC}"