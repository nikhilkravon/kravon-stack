'use strict';

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// Support both local .env names and Railway's auto-injected AWS_* names.
const bucket    = process.env.AWS_S3_BUCKET_NAME   || process.env.BUCKET;
const endpoint  = process.env.AWS_ENDPOINT_URL      || process.env.ENDPOINT;
const region    = process.env.AWS_DEFAULT_REGION    || process.env.REGION || process.env.AWS_REGION || 'auto';
const accessKey = process.env.AWS_ACCESS_KEY_ID     || process.env.ACCESS_KEY_ID;
const secretKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.SECRET_ACCESS_KEY;

// Public base URL for the backend image proxy (/v1/media/*).
// Railway buckets are private-only; we stream objects through the backend.
const mediaBase = (process.env.MEDIA_BASE_URL || '').replace(/\/$/, '');

console.info('[s3] region=%s bucket=%s mediaBase=%s', region, bucket ? 'set' : 'unset', mediaBase || '(not set)');

const s3 = new S3Client({
  region,
  ...(endpoint && { endpoint }),
  forcePathStyle: true,
  credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
});

async function uploadImage(file, path) {
  const sanitized = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `${path}/${Date.now()}-${sanitized}`;
  await s3.send(new PutObjectCommand({
    Bucket:      bucket,
    Key:         key,
    Body:        file.buffer,
    ContentType: file.mimetype,
  }));
  // Return a proxy URL served by GET /v1/media/:key.
  // Do NOT use the S3 endpoint directly — Railway buckets are not publicly accessible.
  return `${mediaBase}/v1/media/${key}`;
}

module.exports = { uploadImage };
