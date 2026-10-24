import { createHash, createHmac, randomUUID } from "node:crypto";

export function flaskBaseUrl(): URL | null {
  try {
    const value = process.env.FLASK_API_BASE_URL?.trim();
    if (!value) return null;
    const url = new URL(value);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1")) || url.username || url.password) return null;
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = ""; url.hash = "";
    return url;
  } catch { return null; }
}

export function internalHeaders(method: string, target: string, owner: string, body = "", idempotencyKey = ""): Record<string, string> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("Internal procurement authentication is unavailable.");
  const stamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const key = createHmac("sha256", secret).update("ngate-procurement-v2").digest();
  const message = [method, target, owner, stamp, nonce, idempotencyKey, createHash("sha256").update(body).digest("hex")].join("\n");
  return {
    Accept: "application/json", "Content-Type": "application/json",
    "X-NGate-Owner": owner, "X-NGate-Time": stamp, "X-NGate-Nonce": nonce,
    "X-NGate-Signature": createHmac("sha256", key).update(message).digest("hex"),
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  };
}

export async function callFlask(base: URL, path: string, owner: string, method = "GET", input?: unknown, idempotencyKey = "") {
  const url = new URL(`${base.toString().replace(/\/+$/, "")}/${path}`);
  const body = input === undefined ? "" : JSON.stringify(input);
  return fetch(url, {
    method, headers: internalHeaders(method, url.pathname + url.search, owner, body, idempotencyKey),
    ...(body ? { body } : {}), redirect: "manual", signal: AbortSignal.timeout(15_000),
  });
}
