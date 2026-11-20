import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { ResumeStorage } from "./resume";

export interface ResumeS3Config {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Only for a local S3 (S3Mock/MinIO); unset on real AWS. */
  endpoint?: string;
}

const REQUIRED = [
  "AWS_REGION",
  "AWS_S3_BUCKET",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
] as const;

/** Reads the S3 settings, or lists the missing variable names (names only). */
export function readResumeS3Config(
  env: Record<string, string | undefined>,
): { ok: true; config: ResumeS3Config } | { ok: false; missing: string[] } {
  const missing = REQUIRED.filter((name) => !env[name]?.trim());
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    config: {
      region: env.AWS_REGION!.trim(),
      bucket: env.AWS_S3_BUCKET!.trim(),
      accessKeyId: env.AWS_ACCESS_KEY_ID!.trim(),
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY!.trim(),
      endpoint: env.AWS_S3_ENDPOINT?.trim() || undefined,
    },
  };
}

export function createS3Client(config: ResumeS3Config): S3Client {
  return new S3Client({
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
  });
}

/** `attachment; filename*=` header value; non-ASCII names stay readable. */
function attachment(fileName: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function createS3ResumeStorage(client: S3Client, bucket: string): ResumeStorage {
  return {
    presignPut(key, contentType, size, ttlSeconds) {
      // Content-Type and length are signed, so the upload must match them.
      return getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
          ContentLength: size,
        }),
        // Without this the presigner leaves Content-Type unsigned.
        { expiresIn: ttlSeconds, signableHeaders: new Set(["content-type"]) },
      );
    },

    presignGet(key, fileName, ttlSeconds, disposition = "attachment", contentType) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentDisposition: disposition === "inline" ? "inline" : attachment(fileName),
          ...(disposition === "inline"
            ? { ResponseContentType: contentType ?? "application/pdf" }
            : {}),
        }),
        { expiresIn: ttlSeconds },
      );
    },

    async head(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { size: out.ContentLength ?? 0, contentType: out.ContentType ?? "" };
      } catch (err) {
        if (
          (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404
        ) {
          return null;
        }
        throw err;
      }
    },

    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

/** The bytes of one stored resume (server side only, to read its text). */
export async function downloadResumeFile(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<Uint8Array> {
  const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!out.Body) throw new Error("downloadResumeFile: empty body");
  return out.Body.transformToByteArray();
}

/** Deletes every object whose key starts with `prefix`. */
async function deletePrefix(client: S3Client, bucket: string, Prefix: string): Promise<void> {
  let ContinuationToken: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix, ContinuationToken }),
    );
    const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
    if (keys.length > 0) {
      const out = await client.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }),
      );
      if (out.Errors?.length) throw new Error("deletePrefix failed");
    }
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);
}

/** Deletes every file under resumes/<userId>/ (used by delete-account). */
export async function deleteUserResumeFiles(
  client: S3Client,
  bucket: string,
  userId: string,
): Promise<void> {
  await deletePrefix(client, bucket, `resumes/${userId}/`);
}

/** Deletes every interview recording and identity photo of a user (delete-account). */
export async function deleteUserRecordingFiles(
  client: S3Client,
  bucket: string,
  userId: string,
): Promise<void> {
  await deletePrefix(client, bucket, `recordings/${userId}/`);
  await deletePrefix(client, bucket, `identity/${userId}/`);
}

/** Deletes one session's recording and identity photo, whatever the file extension. */
export async function deleteSessionRecordingFile(
  client: S3Client,
  bucket: string,
  userId: string,
  sessionId: string,
): Promise<void> {
  await deletePrefix(client, bucket, `recordings/${userId}/${sessionId}.`);
  await deletePrefix(client, bucket, `identity/${userId}/${sessionId}.`);
}

/** Writes a small object from the server (identity photos). */
export async function putS3Object(
  client: S3Client,
  bucket: string,
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType }),
  );
}
