// One-off: lets the browser PUT resumes straight to the S3 bucket with a
// presigned URL (lib/candidate/resume-client.ts). Without a CORS rule the
// browser blocks the request and the page shows "The upload did not go
// through. Check your connection and try again."
//
//   node --env-file=.env scripts/set-resume-bucket-cors.mjs [extra-origin ...]
//
// Needs s3:PutBucketCORS on AWS_S3_BUCKET. Replaces the bucket's CORS config.
import { GetBucketCorsCommand, PutBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";

const ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://talent.joindatasea.com",
  "https://joindatasea.com",
  "https://www.joindatasea.com",
  ...process.argv.slice(2),
];

const bucket = process.env.AWS_S3_BUCKET;
if (!bucket) throw new Error("AWS_S3_BUCKET is not set");
const s3 = new S3Client({ region: process.env.AWS_REGION });

const rules = [
  {
    AllowedOrigins: ORIGINS,
    AllowedMethods: ["GET", "HEAD", "PUT", "POST", "DELETE"],
    AllowedHeaders: ["*"],
    ExposeHeaders: ["ETag"],
    MaxAgeSeconds: 3000,
  },
];

await s3.send(
  new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: rules } }),
);
const { CORSRules } = await s3.send(new GetBucketCorsCommand({ Bucket: bucket }));
console.log(`CORS set on ${bucket}:`, JSON.stringify(CORSRules, null, 2));
