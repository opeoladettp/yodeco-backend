const { S3Client } = require('@aws-sdk/client-s3');

// Create S3 client with AWS SDK v3
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

module.exports = {
  s3Client,
  bucketName: process.env.AWS_S3_BUCKET,
  cloudfrontDomain: process.env.AWS_CLOUDFRONT_DOMAIN
};