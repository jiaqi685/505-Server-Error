import assert from "node:assert/strict";
import test from "node:test";
import { HttpAdapter } from "./http";
import { buildSeedProducts } from "../seed";

test("HTTP catalogue uses the authenticated mapped envelope and fails closed on procurement", async () => {
  const previous = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ products: buildSeedProducts().map((product) => ({ product, sourceProductId: product.productId })), count: 22 }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const adapter = new HttpAdapter("/api");
    assert.equal((await adapter.getProducts()).length, 22);
    assert.equal((await adapter.getProductDetails("premium-fragrant-rice"))!.currentStock, 3);
    assert.ok((await adapter.getProducts("fragrant")).some((p) => p.productId === "premium-fragrant-rice"));
    assert.ok(calls.every((c) => c.url === "/api/integrations/flask/products" && c.init?.credentials === "include"));
    const count = calls.length;
    await assert.rejects(adapter.getDashboardData(), /not connected/);
    await assert.rejects(adapter.approvePurchaseOrder("test-po"), /not connected/);
    await assert.rejects(adapter.getPurchaseOrders(), /not connected/);
    assert.equal(calls.length, count, "Unavailable procurement must not send guessed write requests");
    assert.throws(() => new HttpAdapter("http://127.0.0.1:5051/api"), /same-origin/);
  } finally {
    globalThis.fetch = previous;
  }
});

test("HTTP authentication errors and invalid envelopes remain visible", async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: "Sign in to access Flask product data." }), { status: 401 })) as typeof fetch;
    await assert.rejects(new HttpAdapter("/api").getProducts(), /Sign in/);
    globalThis.fetch = (async () => new Response(JSON.stringify({ products: null }))) as typeof fetch;
    await assert.rejects(new HttpAdapter("/api").getProducts(), /invalid catalogue envelope/);
  } finally {
    globalThis.fetch = previous;
  }
});
