# YODECO Voting Portal - Backend

A secure, scalable backend API for the YODECO biometric voting portal built with Node.js and Express.

## Features

- 🔐 **WebAuthn Integration** - Biometric authentication support
- 🛡️ **JWT Authentication** - Secure token-based auth with refresh tokens
- 👥 **Role-Based Access Control** - User, Panelist, and System_Admin roles
- 📊 **Real-time Monitoring** - Performance metrics and alerting
- 🔍 **Comprehensive Audit Logging** - Full audit trail with integrity verification
- 📈 **Vote Analytics** - Real-time vote counting and statistics
- 🚀 **Redis Caching** - High-performance caching layer
- 🔄 **Background Jobs** - Automated maintenance and integrity checks

## Tech Stack

- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **MongoDB** - Primary database with Mongoose ODM
- **Redis** - Caching and session storage
- **Passport.js** - Authentication middleware
- **WebAuthn** - Biometric authentication
- **Joi** - Input validation
- **Winston** - Logging

## Getting Started

### Prerequisites

- Node.js 16+
- MongoDB 4.4+
- Redis 6+
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/opeoladettp/yodeco-backend.git
cd yodeco-backend
```

2. Install dependencies:
```bash
npm install
```

3. Create environment file:
```bash
cp .env.example .env
```

4. Update the `.env` file with your configuration:
```env
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://localhost:27017/yodeco-voting
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-super-secret-jwt-key
JWT_REFRESH_SECRET=your-super-secret-refresh-key
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
FRONTEND_URL=http://localhost:3000
WEBAUTHN_RP_NAME=YODECO Voting Portal
WEBAUTHN_RP_ID=localhost
WEBAUTHN_ORIGIN=http://localhost:3000
```

5. Start the development server:
```bash
npm run dev
```

The API will be available at `http://localhost:5000`

## Project Structure

```
src/
├── config/             # Configuration files
├── middleware/         # Express middleware
├── models/             # MongoDB models
├── routes/             # API route handlers
├── services/           # Business logic services
├── utils/              # Utility functions
└── server.js           # Application entry point
```

## API Endpoints

### Authentication
- `POST /api/auth/google` - Google OAuth login
- `POST /api/auth/refresh` - Refresh JWT token
- `POST /api/auth/logout` - Logout user

### WebAuthn
- `POST /api/webauthn/register/options` - Get registration options
- `POST /api/webauthn/register/verify` - Verify registration
- `POST /api/webauthn/authenticate/options` - Get authentication options
- `POST /api/webauthn/authenticate/verify` - Verify authentication

### Voting
- `GET /api/content/categories` - Get voting categories
- `POST /api/votes` - Submit a vote
- `GET /api/votes/my-history` - Get user's voting history
- `GET /api/votes/counts/:awardId` - Get vote counts for an award

### Admin
- `GET /api/admin/users` - Manage users
- `GET /api/admin/system/stats` - System statistics
- `GET /api/admin/audit-logs` - Audit logs
- `GET /api/health/*` - Health monitoring endpoints

## Security Features

- **Rate Limiting** - Configurable rate limits per endpoint
- **Input Validation** - Joi schema validation
- **CORS Protection** - Configurable CORS policies
- **Helmet.js** - Security headers
- **Audit Logging** - Comprehensive audit trail
- **Token Rotation** - Automatic JWT refresh token rotation
- **Biometric Auth** - WebAuthn for secure authentication

## Monitoring & Alerts

- **Performance Metrics** - Request/response times, error rates
- **Memory Monitoring** - Memory usage alerts
- **Database Monitoring** - Query performance tracking
- **Cache Monitoring** - Redis hit/miss rates
- **Background Jobs** - Automated maintenance tasks

## Available Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with nodemon
- `npm test` - Run tests
- `npm run test:watch` - Run tests in watch mode

## Environment Variables

See `.env.example` for all available configuration options.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new features
5. Ensure all tests pass
6. Submit a pull request

## License

© 2024 YODECO. All rights reserved.