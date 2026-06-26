import * as fs from 'fs/promises'
import * as path from 'path'
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl as presignS3Url } from '@aws-sdk/s3-request-presigner'

export interface StorageProvider {
  save(relativePath: string, data: Buffer | Uint8Array): Promise<void>
  read(relativePath: string): Promise<Buffer>
  delete(relativePath: string): Promise<void>
  exists(relativePath: string): Promise<boolean>
  getAbsolutePath(relativePath: string): string
  /**
   * Returns a temporary, publicly-fetchable URL for the object, or `null` when
   * the backend can't mint one (e.g. local disk). Callers should fall back to
   * streaming the bytes themselves when this returns `null`.
   */
  getSignedUrl(relativePath: string, expiresInSeconds?: number): Promise<string | null>
}

const EXT_TO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

function contentTypeFor(relativePath: string): string | undefined {
  const ext = relativePath.split('.').pop()?.toLowerCase()
  return ext ? EXT_TO_MIME[ext] : undefined
}

function requiredEnv(key: string): string {
  const value = process.env[key]
  if (!value) throw new Error(`Missing required env var ${key} for S3/R2 storage`)
  return value
}

class LocalStorageProvider implements StorageProvider {
  private basePath: string

  constructor() {
    this.basePath = path.resolve(process.env.STORAGE_LOCAL_PATH ?? './storage')
  }

  getAbsolutePath(relativePath: string): string {
    return path.join(this.basePath, relativePath)
  }

  async save(relativePath: string, data: Buffer | Uint8Array): Promise<void> {
    const absPath = this.getAbsolutePath(relativePath)
    await fs.mkdir(path.dirname(absPath), { recursive: true })
    await fs.writeFile(absPath, data)
  }

  async read(relativePath: string): Promise<Buffer> {
    return fs.readFile(this.getAbsolutePath(relativePath))
  }

  async delete(relativePath: string): Promise<void> {
    await fs.unlink(this.getAbsolutePath(relativePath))
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await fs.access(this.getAbsolutePath(relativePath))
      return true
    } catch {
      return false
    }
  }

  // Local disk has no notion of a signed URL - callers stream the bytes instead.
  async getSignedUrl(): Promise<string | null> {
    return null
  }
}

/**
 * S3-compatible object storage. Works with AWS S3, Cloudflare R2, Backblaze B2,
 * MinIO, etc. - the backend is chosen entirely by env vars:
 *   AWS_S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 *   AWS_S3_ENDPOINT  - set for non-AWS backends (R2: https://<account>.r2.cloudflarestorage.com)
 *
 * Objects are keyed by the same relative path used by the local provider, so the
 * paths stored in Postgres (originalFilePath / editedFilePath) are backend-agnostic.
 */
class S3StorageProvider implements StorageProvider {
  private client: S3Client
  private bucket: string

  constructor() {
    const endpoint = process.env.AWS_S3_ENDPOINT
    this.bucket = requiredEnv('AWS_S3_BUCKET')
    this.client = new S3Client({
      // R2 ignores region but the SDK requires one; "auto" is the conventional value.
      region: process.env.AWS_REGION || 'auto',
      endpoint: endpoint || undefined,
      // Custom endpoints (R2/MinIO) expect path-style addressing, not bucket-as-subdomain.
      forcePathStyle: Boolean(endpoint),
      credentials: {
        accessKeyId: requiredEnv('AWS_ACCESS_KEY_ID'),
        secretAccessKey: requiredEnv('AWS_SECRET_ACCESS_KEY'),
      },
    })
  }

  // The key is the relative path itself; there is no local filesystem path.
  getAbsolutePath(relativePath: string): string {
    return relativePath
  }

  async save(relativePath: string, data: Buffer | Uint8Array): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: relativePath,
        Body: data instanceof Buffer ? data : Buffer.from(data),
        ContentType: contentTypeFor(relativePath),
      }),
    )
  }

  async read(relativePath: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: relativePath }),
    )
    if (!res.Body) throw new Error(`Empty object body for ${relativePath}`)
    const bytes = await res.Body.transformToByteArray()
    return Buffer.from(bytes)
  }

  async delete(relativePath: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: relativePath }),
    )
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: relativePath }),
      )
      return true
    } catch (err: unknown) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
      if (e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404) return false
      throw err
    }
  }

  async getSignedUrl(relativePath: string, expiresInSeconds = 3600): Promise<string> {
    return presignS3Url(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: relativePath }),
      { expiresIn: expiresInSeconds },
    )
  }
}

function createStorage(): StorageProvider {
  const type = (process.env.STORAGE_TYPE ?? 'local').toLowerCase()
  if (type === 's3' || type === 'r2') return new S3StorageProvider()
  return new LocalStorageProvider()
}

// Export a singleton storage instance
export const storage: StorageProvider = createStorage()
