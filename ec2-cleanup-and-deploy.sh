#!/bin/bash

# YODECO Backend EC2 Cleanup and Fresh Deployment Script
# This script cleans up existing deployment and redeploys with Docker

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DOMAIN="yodeco-backend.duckdns.org"
FUTURE_DOMAIN="api.yodeco.ng"
EMAIL="opeoladettp@gmail.com"
REPO_URL="https://github.com/opeoladettp/yodeco-backend.git"

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

echo "========================================="
echo "    YODECO Backend EC2 Cleanup & Deploy"
echo "========================================="
echo

print_status "Starting cleanup and fresh deployment for domain: $DOMAIN"
print_status "Future domain: $FUTURE_DOMAIN"
echo

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   print_error "This script should not be run as root"
   exit 1
fi

# Step 1: Cleanup existing deployment
print_status "Step 1: Cleaning up existing deployment..."

# Stop and remove all Docker containers
print_status "Stopping all Docker containers..."
docker stop $(docker ps -aq) 2>/dev/null || true
docker rm $(docker ps -aq) 2>/dev/null || true

# Remove Docker images (keep base images)
print_status "Removing application Docker images..."
docker rmi $(docker images | grep -E "(yodeco|backend)" | awk '{print $3}') 2>/dev/null || true

# Clean up Docker system
print_status "Cleaning Docker system..."
docker system prune -af --volumes

# Remove existing application directories
print_status "Removing existing application files..."
sudo rm -rf /opt/yodeco-backend 2>/dev/null || true
rm -rf ~/yodeco-backend 2>/dev/null || true

# Clean up SSL certificates (will be regenerated)
print_status "Cleaning up SSL certificates..."
sudo rm -rf /etc/letsencrypt/live/$DOMAIN 2>/dev/null || true
sudo rm -rf /etc/letsencrypt/archive/$DOMAIN 2>/dev/null || true

print_success "Cleanup completed successfully"

# Step 2: Update system and install dependencies
print_status "Step 2: Updating system and installing dependencies..."

# Update system packages
sudo apt update && sudo apt upgrade -y

# Install required packages
sudo apt install -y curl wget gnupg lsb-release ca-certificates git unzip

# Install Docker if not installed
if ! command -v docker &> /dev/null; then
    print_status "Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
    
    # Start Docker service
    sudo systemctl enable docker
    sudo systemctl start docker
    print_success "Docker installed successfully"
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

# Step 3: Clone fresh repository
print_status "Step 3: Cloning fresh repository..."

# Clone repository
git clone $REPO_URL
cd yodeco-backend

print_success "Repository cloned successfully"

# Step 4: Generate secure production configuration
print_status "Step 4: Generating secure production configuration..."

MONGO_ROOT_PASSWORD=$(openssl rand -base64 32)
MONGO_PASSWORD=$(openssl rand -base64 32)
REDIS_PASSWORD=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 64)
JWT_REFRESH_SECRET=$(openssl rand -base64 64)
SESSION_SECRET=$(openssl rand -base64 64)

# Create production environment file
cat > .env.production << EOF
# Production Environment Configuration for YODECO Backend

# Server Configuration
NODE_ENV=production
PORT=5000

# Frontend URLs for CORS - All current and future domains
FRONTEND_URL=https://yodeco.duckdns.org
DEVELOPMENT_FRONTEND_URL=http://localhost:3000
PRODUCTION_FRONTEND_URL=https://portal.yodeco.ng

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

# Google OAuth Configuration (set these environment variables before running)
GOOGLE_CLIENT_ID=\${GOOGLE_CLIENT_ID:-"your-google-client-id"}
GOOGLE_CLIENT_SECRET=\${GOOGLE_CLIENT_SECRET:-"your-google-client-secret"}
GOOGLE_CALLBACK_URL=https://$DOMAIN/api/auth/google/callback

# AWS Configuration (set these environment variables before running)
AWS_ACCESS_KEY_ID=\${AWS_ACCESS_KEY_ID:-"your-aws-access-key"}
AWS_SECRET_ACCESS_KEY=\${AWS_SECRET_ACCESS_KEY:-"your-aws-secret-key"}
AWS_REGION=\${AWS_REGION:-"eu-north-1"}
AWS_S3_BUCKET=\${AWS_S3_BUCKET:-"bvp-storage"}
AWS_CLOUDFRONT_DOMAIN=\${AWS_CLOUDFRONT_DOMAIN:-""}

# Session Configuration
SESSION_SECRET=$SESSION_SECRET

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# WebAuthn Configuration
WEBAUTHN_RP_NAME=YODECO Voting Portal
WEBAUTHN_RP_ID=$DOMAIN
WEBAUTHN_ORIGIN=https://yodeco.duckdns.org

# SSL Configuration
SSL_CERT_PATH=/etc/letsencrypt/live/$DOMAIN/fullchain.pem
SSL_KEY_PATH=/etc/letsencrypt/live/$DOMAIN/privkey.pem

# Logging
LOG_LEVEL=info
LOG_FILE=/app/logs/app.log

# Security
BCRYPT_ROUNDS=12
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_TIME=900000

# Performance
MAX_FILE_SIZE=10485760
REQUEST_TIMEOUT=30000

# CORS Configuration - All Frontend URLs
CORS_ORIGINS=https://yodeco.duckdns.org,http://localhost:3000,https://portal.yodeco.ng,https://yodeco.ng,https://www.yodeco.ng
EOF

print_success "Production environment configuration created"

# Update mongo-init.js with the actual password
sed -i "s/your-secure-mongo-password-here/$MONGO_PASSWORD/g" mongo-init.js

# Create necessary directories
mkdir -p logs ssl

print_success "Configuration completed"

# Step 5: Fix environment variable loading and start services
print_status "Step 5: Fixing environment variable loading and starting services..."

# Copy .env.production to .env for Docker Compose to read
cp .env.production .env
print_success "Environment variables configured for Docker Compose"

# Build and start services
docker-compose -f docker-compose.prod.yml up --build -d

# Wait for services to be ready
print_status "Waiting for services to start..."
sleep 30

# Check if services are running
print_status "Checking service status..."
docker-compose -f docker-compose.prod.yml ps

# Test health endpoint
print_status "Testing health endpoint..."
for i in {1..10}; do
    if curl -f http://localhost:5000/api/health > /dev/null 2>&1; then
        print_success "Backend health check passed"
        break
    else
        if [ $i -eq 10 ]; then
            print_error "Backend health check failed after 10 attempts"
            print_status "Checking logs..."
            docker-compose -f docker-compose.prod.yml logs backend
            exit 1
        fi
        print_status "Waiting for backend to be ready... (attempt $i/10)"
        sleep 10
    fi
done

print_success "Services are running successfully"

# Step 6: Setup SSL certificates
print_status "Step 6: Setting up SSL certificates..."

if [ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    print_status "Obtaining SSL certificate for $DOMAIN..."
    
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
    
    print_success "SSL certificate obtained successfully"
else
    print_success "SSL certificate already exists"
fi

# Step 7: Final verification
print_status "Step 7: Final verification..."

# Final status check
print_status "Final deployment status:"
docker-compose -f docker-compose.prod.yml ps

# Test HTTPS endpoint
print_status "Testing HTTPS endpoint..."
sleep 10
if curl -f https://$DOMAIN/api/health > /dev/null 2>&1; then
    print_success "HTTPS health check passed"
else
    print_warning "HTTPS not ready yet (SSL certificate may still be propagating)"
    print_status "You can test manually: curl https://$DOMAIN/api/health"
fi

# Step 8: Create management scripts
print_status "Step 8: Creating management scripts..."

# Create backup script
cat > backup.sh << 'EOF'
#!/bin/bash
# YODECO Backend Backup Script

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/opt/backups"

# Create backup directory
sudo mkdir -p $BACKUP_DIR

# Backup MongoDB
docker exec yodeco-mongodb mongodump --out /tmp/mongo_backup_$DATE
docker cp yodeco-mongodb:/tmp/mongo_backup_$DATE $BACKUP_DIR/

# Backup Redis
docker exec yodeco-redis redis-cli --rdb /tmp/redis_backup_$DATE.rdb
docker cp yodeco-redis:/tmp/redis_backup_$DATE.rdb $BACKUP_DIR/

# Backup application files
tar -czf $BACKUP_DIR/app_backup_$DATE.tar.gz .env.production logs/

echo "Backup completed: $BACKUP_DIR"
EOF

chmod +x backup.sh

# Create update script
cat > update.sh << 'EOF'
#!/bin/bash
# YODECO Backend Update Script

echo "Updating YODECO Backend..."

# Pull latest code
git pull origin main

# Rebuild and restart services
docker-compose -f docker-compose.prod.yml up --build -d

# Wait for services
sleep 30

# Test health
if curl -f https://yodeco-backend.duckdns.org/api/health > /dev/null 2>&1; then
    echo "Update successful!"
else
    echo "Update may have issues. Check logs:"
    docker-compose -f docker-compose.prod.yml logs backend
fi
EOF

chmod +x update.sh

# Create monitoring script
cat > monitor.sh << 'EOF'
#!/bin/bash
# YODECO Backend Monitoring Script

echo "YODECO Backend Status Report"
echo "============================"
echo

echo "Docker Services:"
docker-compose -f docker-compose.prod.yml ps
echo

echo "System Resources:"
df -h
echo
free -h
echo

echo "Recent Logs (last 50 lines):"
docker-compose -f docker-compose.prod.yml logs --tail=50 backend
EOF

chmod +x monitor.sh

print_success "Management scripts created"

# Save important information
cat > deployment-info.txt << EOF
YODECO Backend Deployment Information
=====================================

Deployment Date: $(date)
Domain: $DOMAIN
Future Domain: $FUTURE_DOMAIN
Backend URL: https://$DOMAIN
Health Check: https://$DOMAIN/api/health

Frontend URLs (CORS Configured):
- https://yodeco.duckdns.org (current)
- http://localhost:3000 (development)
- https://portal.yodeco.ng (future)
- https://yodeco.ng (future)
- https://www.yodeco.ng (future)

Database Passwords (KEEP SECURE):
- MongoDB Root: $MONGO_ROOT_PASSWORD
- MongoDB User: $MONGO_PASSWORD
- Redis: $REDIS_PASSWORD

JWT Secrets (KEEP SECURE):
- JWT Secret: $JWT_SECRET
- JWT Refresh Secret: $JWT_REFRESH_SECRET
- Session Secret: $SESSION_SECRET

Google OAuth Callback: https://$DOMAIN/api/auth/google/callback

Management Commands:
- Update: ./update.sh
- Backup: ./backup.sh
- Monitor: ./monitor.sh
- Logs: docker-compose -f docker-compose.prod.yml logs -f

IMPORTANT: Keep this file secure and backup the passwords!
EOF

echo
echo "========================================="
print_success "    Deployment Complete!"
echo "========================================="
echo
echo -e "Backend URL: ${GREEN}https://$DOMAIN${NC}"
echo -e "Health Check: ${GREEN}https://$DOMAIN/api/health${NC}"
echo -e "API Documentation: ${GREEN}https://$DOMAIN/api${NC}"
echo
echo -e "${YELLOW}Frontend URLs Configured for CORS:${NC}"
echo "- https://yodeco.duckdns.org (current)"
echo "- http://localhost:3000 (development)"
echo "- https://portal.yodeco.ng (future)"
echo "- https://yodeco.ng (future)"
echo "- https://www.yodeco.ng (future)"
echo
echo -e "${YELLOW}Google OAuth Callback URLs to Add:${NC}"
echo "- https://$DOMAIN/api/auth/google/callback"
echo "- https://$FUTURE_DOMAIN/api/auth/google/callback (for future)"
echo
echo -e "${YELLOW}Management Commands:${NC}"
echo "- Update application: ./update.sh"
echo "- Create backup: ./backup.sh"
echo "- Monitor status: ./monitor.sh"
echo "- View logs: docker-compose -f docker-compose.prod.yml logs -f"
echo
echo -e "${YELLOW}Important Files:${NC}"
echo "- Environment: .env.production"
echo "- Deployment info: deployment-info.txt"
echo "- Logs: ./logs/"
echo "- SSL Certificates: /etc/letsencrypt/live/$DOMAIN/"
echo
print_success "YODECO Backend is now running in production with HTTPS!"
print_warning "IMPORTANT: Keep deployment-info.txt secure - it contains sensitive passwords!"

echo
echo -e "${BLUE}Next Steps:${NC}"
echo "1. Update Google OAuth redirect URLs in Google Cloud Console"
echo "2. Test frontend connections from all configured URLs"
echo "3. Monitor logs and ensure everything works correctly"
echo "4. Set up automated backups and monitoring"
echo
print_success "Fresh deployment completed successfully! 🎉"