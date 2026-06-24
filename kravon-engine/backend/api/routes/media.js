'use strict';

const express = require('express');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const bucket    = process.env.AWS_S3_BUCKET_NAME  || process.env.BUCKET;
const endpoint  = process.env.AWS_ENDPOINT_URL     || process.env.ENDPOINT;
const region    = process.env.AWS_DEFAULT_REGION   || process.env.REGION || 'auto';
const accessKey = process.env.AWS_ACCESS_KEY_ID    || process.env.ACCESS_KEY_ID;
const secretKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.SECRET_ACCESS_KEY;

const s3 = new S3Client({
  region,
  endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
});

const router = express.Router();

// GET /v1/media/*  — public image proxy for Railway private bucket
// key = everything after /v1/media/  e.g. restaurants/uuid/slug/hero/hero-001.jpg
router.get('/*', async (req, res) => {
  const key = req.params[0];
  if (!key) return res.status(400).json({ error: 'Missing key.' });

  try {
    const cmd  = new GetObjectCommand({ Bucket: bucket, Key: key });
    const obj  = await s3.send(cmd);

    res.setHeader('Content-Type',  obj.ContentType  || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    if (obj.ContentLength) res.setHeader('Content-Length', obj.ContentLength);
    if (obj.ETag)          res.setHeader('ETag', obj.ETag);

    obj.Body.pipe(res);
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return res.status(404).json({ error: 'Not found.' });
    }
    console.error('[media] proxy error', err.message);
    res.status(502).json({ error: 'Failed to retrieve image.' });
  }
});

module.exports = router;
