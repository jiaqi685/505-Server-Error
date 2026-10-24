import assert from "node:assert/strict";
import test from "node:test";
import { MockAdapter, STORAGE_KEY } from "./mock";
import { ConnectedAdapter } from "./connected";
import { buildSeedProducts } from "../seed";
import { syntheticSalesCsv, syntheticInventoryCsv } from "../pos/fixtures";
import { insightFor } from "../../lib/inventory";
import { daysBetween, prettyDate } from "../../lib/format";

function storage() {
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (k: string) => entries.get(k) ?? null, setItem: (k: string, v: string) => entries.set(k, v),
    removeItem: (k: string) => entries.delete(k), clear: () => entries.clear(), key: (i: number) => [...entries.keys()][i] ?? null,
    get length() { return entries.size; },
  } });
  return entries;
}

test("catalogue ISO expiry dates and date-only values use identical calendar maths", () => {
  assert.equal(prettyDate("2027-04-21T00:00:00.000Z"), "21 Apr 2027");
  assert.equal(prettyDate("2027-04-21T00:00:00+08:00"), prettyDate("2027-04-21"));
  assert.equal(daysBetween("2026-10-23", "2027-08-31T00:00:00.000Z"), daysBetween("2026-10-23", "2027-08-31"));
  assert.ok(Number.isFinite(daysBetween("2026-10-23", "2027-08-31T00:00:00.000Z")));
});

test("connected procurement uses server reads while POS 9→17 and resets never write mock purchasing", async () => {
  const entries = storage(), original = globalThis.fetch;
  const calls: { url: string; method: string }[] = [];
  const order = { poNumber: "PO-persisted", status: "approved", total: 954 };
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    const body = String(url).endsWith("/products") ? { products: buildSeedProducts().map((product) => ({ product, sourceProductId: product.productId })) }
      : String(url).endsWith("/orders") ? [order]
        : { products: buildSeedProducts(), quotationRequests: [], quotes: [], purchaseOrders: [order] };
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const local = new MockAdapter(0, true);
    local.setOwnerId("connected-owner-A");
    const api = new ConnectedAdapter("/api", local);
    await local.confirmPosImport(await local.previewPosImport(new File([syntheticInventoryCsv(3)], "stock.csv"), "inventory"));
    await local.confirmPosImport(await local.previewPosImport(new File([syntheticSalesCsv(3)], "base.csv"), "sales"));
    assert.equal(insightFor((await api.getProductDetails("premium-fragrant-rice"))!).suggestedOrderQuantity, 9);
    await local.confirmPosImport(await local.previewPosImport(new File([syntheticSalesCsv(5)], "spike.csv"), "sales"));
    assert.equal(insightFor((await api.getProductDetails("premium-fragrant-rice"))!).suggestedOrderQuantity, 17);
    assert.deepEqual((await api.getDashboardData()).purchaseOrders, [order]);
    await local.resetPosImport();
    assert.deepEqual(await api.getPurchaseOrders(), [order]);
    assert.ok(calls.every((c) => c.method === "GET"));
    assert.ok([...entries.keys()].every((k) => !k.startsWith(STORAGE_KEY)), "Connected Mode must never write mock business state");
    local.setOwnerId("connected-owner-B");
    assert.equal((await local.getPosImportState()).sales, null);
  } finally { globalThis.fetch = original; }
});

test("ambiguous backend failure keeps the form retry idempotent and never falls back locally", async () => {
  const entries = storage(), original = globalThis.fetch;
  const keys: string[] = [];
  let fail = true;
  globalThis.fetch = (async (_url, init) => {
    keys.push(new Headers(init?.headers).get("Idempotency-Key")!);
    assert.equal(new Headers(init?.headers).get("X-NGate-Request"), "procurement-v2");
    if (fail) throw new TypeError("Network unavailable");
    return new Response(JSON.stringify({ poNumber: "PO-from-SQLite", status: "approved" }));
  }) as typeof fetch;
  try {
    const api = new ConnectedAdapter("/api", new MockAdapter(0, true));
    await assert.rejects(api.approvePurchaseOrder("PO-from-SQLite"), /Cannot reach/);
    fail = false;
    assert.equal((await api.approvePurchaseOrder("PO-from-SQLite")).status, "approved");
    assert.equal(keys[0], keys[1]);
    assert.equal(entries.size, 0);
  } finally { globalThis.fetch = original; }
});

test("patch projection displays legacy Supplier B RFQs and quotes without changing approved PO snapshots", async () => {
  storage();
  const originalFetch = globalThis.fetch;
  const rfq = { rfqId: "RFQ-old", productId: "premium-fragrant-rice", requestedQuantity: 17,
    requestedDeliveryDate: "2099-01-01", createdAt: "2026-10-23",
    suppliers: [{ supplierId: "SUP-B", supplierName: "Supplier B", status: "prepared" }] };
  const quotes = [{ supplierId: "SUP-B", supplierName: "Supplier B", unitPrice: 31.8 }];
  const orders = [{ supplierId: "SUP-B", supplier: "Supplier B", status: "approved", total: 954,
    quoteSnapshot: { supplierId: "SUP-B", supplierName: "Supplier B" } }];
  const serialized = JSON.stringify([rfq, quotes, orders]);
  globalThis.fetch = (async (url) => {
    const body = String(url).includes("/latest-rfq") ? rfq : String(url).includes("/quotes") ? quotes : orders;
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const api = new ConnectedAdapter("/api", new MockAdapter(0, true));
    assert.equal((await api.getLatestQuotationRequest(rfq.productId))?.suppliers[0].supplierName, "FreshChoice Trading Sdn. Bhd.");
    assert.equal((await api.getSupplierQuotes(rfq.rfqId))[0].supplierName, "FreshChoice Trading Sdn. Bhd.");
    assert.deepEqual(await api.getPurchaseOrders(), orders);
    assert.equal(JSON.stringify([rfq, quotes, orders]), serialized);
  } finally { globalThis.fetch = originalFetch; }
});
