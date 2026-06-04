'use strict';

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const resolvedRegion = process.env.REGION || process.env.AWS_REGION || 'us-east-1';
const resolvedEndpoint = process.env.ENDPOINT || undefined;

console.info('[s3] resolved region=%s endpoint=%s bucket=%s', resolvedRegion, resolvedEndpoint || 'none', process.env.BUCKET ? 'set' : 'unset');

const s3 = new S3Client({
  region: resolvedRegion,
  endpoint: resolvedEndpoint,
  credentials: {
    accessKeyId:     process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
  },
});

async function uploadImage(file, path) {
  const key = `${path}/${Date.now()}-${file.originalname}`;
  await s3.send(new PutObjectCommand({
    Bucket:      process.env.BUCKET,
    Key:         key,
    Body:        file.buffer,
    ContentType: file.mimetype,
  }));
  return `https://${process.env.BUCKET}.${process.env.ENDPOINT}/${key}`;
}

module.exports = { uploadImage };
