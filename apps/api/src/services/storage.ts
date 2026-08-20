import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import { env } from "../config/env";

export type StoredObject = { key: string; buffer: Buffer; mimeType: string };

export interface EvidenceStorage {
  put(key: string, buffer: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  ready(): Promise<void>;
}

const safeLocalPath = (root: string, key: string) => {
  const target = path.resolve(root, ...key.split("/"));
  const prefix = `${path.resolve(root)}${path.sep}`;
  if (!target.startsWith(prefix)) throw new Error("Invalid storage key.");
  return target;
};

class LocalEvidenceStorage implements EvidenceStorage {
  private readonly root = path.resolve(env.LOCAL_STORAGE_PATH);

  async ready() { await mkdir(this.root, { recursive: true }); }

  async put(key: string, buffer: Buffer) {
    const target = safeLocalPath(this.root, key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buffer, { flag: "wx" });
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      return { key, buffer: await readFile(safeLocalPath(this.root, key)), mimeType: "image/webp" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string) {
    try { await unlink(safeLocalPath(this.root, key)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}

class S3EvidenceStorage implements EvidenceStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
      throw new Error("S3 storage requires bucket and credentials.");
    }
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: Boolean(env.S3_ENDPOINT),
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
    });
  }

  async ready() { return; }
  async put(key: string, buffer: Buffer, mimeType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: mimeType }));
  }
  async get(key: string): Promise<StoredObject | null> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!result.Body) return null;
      return { key, buffer: Buffer.from(await result.Body.transformToByteArray()), mimeType: result.ContentType ?? "image/webp" };
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchKey") return null;
      throw error;
    }
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export const buildEvidenceStorage = (): EvidenceStorage =>
  env.STORAGE_DRIVER === "s3" ? new S3EvidenceStorage() : new LocalEvidenceStorage();

export const normalizeEvidenceImage = async (input: Buffer) => {
  const image = sharp(input, { failOn: "error", limitInputPixels: 40_000_000 });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || !["jpeg", "png", "webp"].includes(metadata.format ?? "")) {
    throw new Error("UNSUPPORTED_IMAGE");
  }
  const buffer = await image.rotate().webp({ quality: 92, effort: 4 }).toBuffer();
  return {
    buffer,
    mimeType: "image/webp",
    sha256: crypto.createHash("sha256").update(buffer).digest("hex")
  };
};

export const newEvidenceKey = (userId: string) => {
  const now = new Date();
  return `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${userId}/${crypto.randomUUID()}.webp`;
};
