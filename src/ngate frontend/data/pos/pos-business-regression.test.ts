/**
 * Regression: importing/resetting synthetic POS overlays must never mutate
 * existing RFQs, supplier quotations or purchase orders.
 *
 * This fixture creates genuine business records through MockAdapter methods
 * with a fresh in-memory localStorage and a unique isolated owner. No live
 * browser, Flask, Gemini, SQLite, or stable V4 data is accessed.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { MockAdapter, STORAGE_KEY } from "../adapters/mock";
import { buildSeedProducts } from "../seed";
import { insightFor } from "../../lib/inventory";
import { syntheticInventoryCsv, syntheticSalesCsv } from "./fixtures";
import { POS_STORAGE_KEY, emptyPosState } from "./storage";

function installIsolatedStorage() {
  const memory = new Map<string, string>();
  const storage: Storage = {
    get length() { return memory.size; },
    clear: () => memory.clear(),
    key: (index) => [...memory.keys()][index] ?? null,
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => { memory.set(key, value); },
    removeItem: (key) => { memory.delete(key); },
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  return storage;
}

function csvFile(data: string, name: string) {
  return new File([data], name, { type: "text/csv" });
}

test("POS baseline/spike imports and individual/all resets preserve non-empty RFQ, quote and PO byte-for-byte", async () => {
  const storage = installIsolatedStorage();
  const ownerId = "isolated-pos-workflow-regression-20261023";
  const stateKey = `${STORAGE_KEY}:${ownerId}`;
  const posKey = `${POS_STORAGE_KEY}:${ownerId}`;
  const adapter = new MockAdapter(0);
  adapter.setOwnerId(ownerId);

  const product = buildSeedProducts().find((p) => p.productId === "premium-fragrant-rice")!;
  assert.ok(product.suppliers.length > 0, "Rice must have a supplier in the seed catalogue");
  const supplier = product.suppliers[0];

  // Create a real, non-empty purchasing workflow through public adapter APIs.
  const rfq = await adapter.createQuotationRequest({
    productId: product.productId,
    requestedQuantity: 10,
    requestedDeliveryDate: "2099-01-01", // Future date so test does not depend on system clock.
    supplierIds: [supplier.supplierId],
  });
  const quote = await adapter.saveSupplierQuotation({
    rfqId: rfq.rfqId,
    supplierId: supplier.supplierId,
    unitPrice: 31.8,
    minimumOrderQuantity: 10,
    orderMultiple: null,
    leadTimeDays: 2,
    quotedDeliveryDate: null,
    source: "manual",
    reviewConfirmed: true,
    packUomConfirmed: true,
    quotedUnit: product.stockUnit,
  });
  const draft = await adapter.createPurchaseOrderDraft({
    productId: product.productId,
    supplierId: supplier.supplierId,
    qty: 10,
    unitPrice: quote.unitPrice,
    rfqId: rfq.rfqId,
    quoteId: quote.quoteId,
  });
  const approved = await adapter.approvePurchaseOrder(draft.poNumber);
  assert.equal(approved.status, "approved");

  const before = JSON.parse(storage.getItem(stateKey)!) as {
    requests: unknown[]; quotes: unknown[]; orders: unknown[];
    activity: { eventId: string; action: string }[];
    seq: { rfq: number; quote: number; po: number; event: number };
  };
  assert.equal(before.requests.length, 1);
  assert.equal(before.quotes.length, 1);
  assert.equal(before.orders.length, 1);
  assert.ok(before.activity.length > 0);

  // Compare persisted business JSON literally. POS audit events are the sole
  // permitted change to the workflow state (plus the event sequence counter).
  const originalRequestBytes = JSON.stringify(before.requests);
  const originalQuoteBytes = JSON.stringify(before.quotes);
  const originalOrderBytes = JSON.stringify(before.orders);
  const originalActivityBytes = JSON.stringify(before.activity);
  const originalSeq = { ...before.seq };
  const expectedPosAuditActions: string[] = [];

  async function assertUnchanged(stage: string) {
    const after = JSON.parse(storage.getItem(stateKey)!) as typeof before;
    assert.equal(JSON.stringify(after.requests), originalRequestBytes, `${stage}: RFQs changed`);
    assert.equal(JSON.stringify(after.quotes), originalQuoteBytes, `${stage}: quotes changed`);
    assert.equal(JSON.stringify(after.orders), originalOrderBytes, `${stage}: POs changed`);
    assert.equal(JSON.stringify(after.activity.slice(0, before.activity.length)), originalActivityBytes,
      `${stage}: pre-existing activity was changed`);
    assert.deepEqual(
      { rfq: after.seq.rfq, quote: after.seq.quote, po: after.seq.po },
      { rfq: originalSeq.rfq, quote: originalSeq.quote, po: originalSeq.po },
      `${stage}: workflow ID sequences changed`,
    );
    assert.equal(after.seq.event, originalSeq.event + expectedPosAuditActions.length,
      `${stage}: unexpected number of activity sequence changes`);
    assert.deepEqual(after.activity.slice(before.activity.length).map((entry) => entry.action),
      expectedPosAuditActions, `${stage}: unexpected audit activity`);

    // Also check all exposed public read APIs, not just localStorage internals.
    assert.deepEqual(await adapter.getLatestQuotationRequest(product.productId), rfq,
      `${stage}: latest RFQ changed via adapter`);
    assert.deepEqual(await adapter.getSupplierQuotes(rfq.rfqId), [quote],
      `${stage}: supplier quote changed via adapter`);
    assert.deepEqual(await adapter.getPurchaseOrders(), [approved],
      `${stage}: PO changed via adapter`);
    const dashboard = await adapter.getDashboardData();
    assert.deepEqual(dashboard.purchaseOrders, [approved]);
    assert.deepEqual(dashboard.quotes, [quote]);
  }

  await assertUnchanged("before POS activity");

  // A preview must not persist anything or append any audit event.
  const baselinePreview = await adapter.previewPosImport(csvFile(syntheticSalesCsv(3), "baseline.csv"), "sales");
  assert.equal(storage.getItem(posKey), null);
  await assertUnchanged("sales preview only");

  await adapter.confirmPosImport(baselinePreview);
  expectedPosAuditActions.push("Synthetic POS CSV imported");
  assert.equal(insightFor((await adapter.getProductDetails(product.productId))!).suggestedOrderQuantity, 9);
  await assertUnchanged("baseline import");

  await adapter.confirmPosImport(await adapter.previewPosImport(csvFile(syntheticSalesCsv(5), "rice-spike.csv"), "sales"));
  expectedPosAuditActions.push("Synthetic POS CSV imported");
  assert.equal(insightFor((await adapter.getProductDetails(product.productId))!).suggestedOrderQuantity, 17);
  await assertUnchanged("spike replaces baseline");

  await adapter.resetPosImport("sales");
  expectedPosAuditActions.push("Synthetic POS import reset");
  await assertUnchanged("individual sales reset");

  await adapter.confirmPosImport(await adapter.previewPosImport(csvFile(syntheticInventoryCsv(50), "snapshot.csv"), "inventory"));
  expectedPosAuditActions.push("Synthetic POS CSV imported");
  assert.equal((await adapter.getProductDetails(product.productId))!.currentStock, 50);
  await assertUnchanged("inventory snapshot import");

  await adapter.resetPosImport("inventory");
  expectedPosAuditActions.push("Synthetic POS import reset");
  assert.equal((await adapter.getProductDetails(product.productId))!.currentStock, product.currentStock);
  await assertUnchanged("individual inventory reset");

  await adapter.confirmPosImport(await adapter.previewPosImport(csvFile(syntheticSalesCsv(3), "baseline-again.csv"), "sales"));
  expectedPosAuditActions.push("Synthetic POS CSV imported");
  await adapter.confirmPosImport(await adapter.previewPosImport(csvFile(syntheticInventoryCsv(50), "snapshot-again.csv"), "inventory"));
  expectedPosAuditActions.push("Synthetic POS CSV imported");
  await assertUnchanged("both overlays present");

  await adapter.resetPosImport();
  expectedPosAuditActions.push("Synthetic POS import reset");
  assert.deepEqual(await adapter.getPosImportState(), emptyPosState());
  await assertUnchanged("all POS data reset");

  // Reload simulates a browser refresh using only this test's memory-backed data.
  const reloaded = new MockAdapter(0);
  reloaded.setOwnerId(ownerId);
  assert.deepEqual(await reloaded.getLatestQuotationRequest(product.productId), rfq);
  assert.deepEqual(await reloaded.getSupplierQuotes(rfq.rfqId), [quote]);
  assert.deepEqual(await reloaded.getPurchaseOrders(), [approved]);
  assert.equal((await reloaded.getActivityHistory()).length,
    before.activity.length + expectedPosAuditActions.length);
});
