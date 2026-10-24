import { randomUUID } from "node:crypto";
import { File, Storage } from "@google-cloud/storage";

const SIDECAR = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${SIDECAR}/token`,
    type: "external_account",
    credential_source: {
      url: `${SIDECAR}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function privateDir(): string {
  const dir = process.env.PRIVATE_OBJECT_DIR?.replace(/\/+$/, "");
  if (!dir) throw new Error("Private object storage is not configured.");
  return dir;
}

function parseStoragePath(path: string): { bucketName: string; objectName: string } {
  const parts = path.replace(/^\/+/, "").split("/");
  const bucketName = parts.shift();
  if (!bucketName || parts.length === 0) throw new Error("Invalid object path.");
  return { bucketName, objectName: parts.join("/") };
}

export function createDocumentObjectPath(): string {
  return `/objects/uploads/${randomUUID()}`;
}

export function getDocumentFile(objectPath: string): File {
  if (!/^\/objects\/uploads\/[0-9a-f-]{36}$/i.test(objectPath)) {
    throw new Error("Invalid quotation document path.");
  }
  const fullPath = `${privateDir()}/${objectPath.slice("/objects/".length)}`;
  const { bucketName, objectName } = parseStoragePath(fullPath);
  return objectStorageClient.bucket(bucketName).file(objectName);
}

export async function createDocumentUploadUrl(objectPath: string): Promise<string> {
  const fullPath = `${privateDir()}/${objectPath.slice("/objects/".length)}`;
  const { bucketName, objectName } = parseStoragePath(fullPath);
  const response = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket_name: bucketName,
      object_name: objectName,
      method: "PUT",
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Could not create a private upload URL (${response.status}).`);
  const result = (await response.json()) as { signed_url?: string };
  if (!result.signed_url) throw new Error("The storage service did not return an upload URL.");
  return result.signed_url;
}

export async function findPublicObject(path: string): Promise<File | null> {
  const roots = (process.env.PUBLIC_OBJECT_SEARCH_PATHS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const root of roots) {
    const { bucketName, objectName } = parseStoragePath(`${root.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (exists) return file;
  }
  return null;
}
