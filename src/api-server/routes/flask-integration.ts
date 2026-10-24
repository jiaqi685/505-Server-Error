import { Router, type IRouter, type Response } from "express";
import { GetFlaskHealthResponse, GetFlaskProductsResponse } from "@workspace/api-zod";
import {
  makeMappedFlaskProductsPayload,
  mapFlaskProductRecord,
  parseFlaskProductsEnvelope,
} from "./flask-product-mapping.js";
import { flaskBaseUrl, internalHeaders } from "../lib/flask-service";

const router: IRouter = Router();
const REQUEST_TIMEOUT_MS = 8_000;
const PRODUCT_MAPPING_CONCURRENCY = 4;

class FlaskUpstreamError extends Error {
  constructor(
    message: string,
    readonly upstreamStatus?: number,
  ) {
    super(message);
  }
}

const configuredBaseUrl = flaskBaseUrl;

async function fetchFlaskJson(baseUrl: URL, path: string, owner?: string): Promise<unknown> {
  const url = new URL(`${baseUrl.toString().replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);
  const upstream = await fetch(url, {
    method: "GET",
    headers: owner ? internalHeaders("GET", url.pathname + url.search, owner) : { Accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!upstream.ok) {
    throw new FlaskUpstreamError("Flask backend did not return a successful response.", upstream.status);
  }
  if (!upstream.headers.get("content-type")?.toLowerCase().includes("json")) {
    throw new FlaskUpstreamError("Flask backend returned a non-JSON response.");
  }
  return upstream.json();
}

function sendProxyFailure(res: Response, error: unknown): void {
  if (error instanceof FlaskUpstreamError) {
    res.status(502).json({
      error: error.message,
      ...(error.upstreamStatus === undefined ? {} : { upstreamStatus: error.upstreamStatus }),
    });
    return;
  }
  res.status(502).json({ error: "Flask data could not be read or mapped to the NGate product contract." });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

// Health exposes only service availability; no procurement data is returned.
router.get("/integrations/flask/health", async (_req, res): Promise<void> => {
  const baseUrl = configuredBaseUrl();
  if (!baseUrl) {
    res.status(503).json({ error: "Flask integration is not configured." });
    return;
  }
  try {
    const raw = await fetchFlaskJson(baseUrl, "health");
    res.json(GetFlaskHealthResponse.parse(raw));
  } catch (error) {
    sendProxyFailure(res, error);
  }
});

// Product records are procurement data and require the existing NGate session.
export async function mappedCatalogue(baseUrl: URL, owner: string) {
  const envelope = parseFlaskProductsEnvelope(await fetchFlaskJson(baseUrl, "products", owner));
  const products = await mapWithConcurrency(envelope.products, PRODUCT_MAPPING_CONCURRENCY, async (source) => {
    const productPath = `products/${encodeURIComponent(source.product_id)}`;
    const [detail, purchases] = await Promise.all([
      fetchFlaskJson(baseUrl, productPath, owner), fetchFlaskJson(baseUrl, `${productPath}/purchases`, owner),
    ]);
    return mapFlaskProductRecord(source, detail, purchases);
  });
  return GetFlaskProductsResponse.parse(makeMappedFlaskProductsPayload(envelope, products));
}

router.get("/integrations/flask/products", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to access Flask product data." });
    return;
  }
  const baseUrl = configuredBaseUrl();
  if (!baseUrl) {
    res.status(503).json({ error: "Flask integration is not configured." });
    return;
  }
  try {
    res.json(await mappedCatalogue(baseUrl, req.user!.id));
  } catch (error) {
    sendProxyFailure(res, error);
  }
});

export default router;
