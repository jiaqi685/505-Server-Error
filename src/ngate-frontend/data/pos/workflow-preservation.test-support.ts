import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { MockAdapter, STORAGE_KEY } from "../adapters/mock";
import { buildSeedProducts } from "../seed";
import { activeDocumentedSupplier } from "../../lib/supplier-document-evidence";
import type { ActivityEntry, LogActivityInput } from "../types";
import { OWNER_ACTOR } from "../../lib/brand";
import { emptyPosState, POS_STORAGE_KEY } from "./storage";
import type { PosImportKind } from "./types";

interface CsvFixture {
  baseline: string;
  spike: string;
  inventory: string;
  baselineName: string;
  spikeName: string;
  inventoryName: string;
}

/** Exercise only the browser mock adapter, never browser data or backend services. */
export async function confirmWorkflowPreservation(
  t: TestContext,
  csv: CsvFixture,
  resetKind?: PosImportKind,
) {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const memory = new Map<string, string>();
  const storage: Storage = {
    get length() { return memory.size; },
    clear: () => memory.clear(),
    key: (index) => [...memory.keys()][index] ?? null,
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => { memory.set(key, value); },
    removeItem: (key) => { memory.delete(key); },
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  t.after(() => {
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });

  const owner = `pos-workflow-regression-${randomUUID()}`;
  const workflowKey = `${STORAGE_KEY}:${owner}`;
  const posKey = `${POS_STORAGE_KEY}:${owner}`;
  let adapter = new MockAdapter(0);
  adapter.setOwnerId(owner);

  // Use actual workflow APIs so the linked fixture is representative and valid.
  // A fixed far-future delivery date avoids a dependency on today's date.
  for (const [index, productId] of ["premium-fragrant-rice", "edible-cooking-oil"].entries()) {
    const product = buildSeedProducts().find((p) => p.productId === productId)!;
    const supplierId = product.suppliers.find((s) => activeDocumentedSupplier(product.productId, s.supplierId))?.supplierId;
    assert.ok(supplierId, `Test fixture requires a document-supported supplier for ${productId}`);
    const request = await adapter.createQuotationRequest({
      productId, requestedQuantity: 20, requestedDeliveryDate: "9999-12-31",
      supplierIds: [supplierId],
    });
    await adapter.recordWhatsAppOpened(request.rfqId, supplierId);
    await adapter.markQuotationSent(request.rfqId, supplierId);
    const quote = await adapter.saveSupplierQuotation({
      rfqId: request.rfqId, supplierId, unitPrice: 10.5 + index,
      minimumOrderQuantity: 10, orderMultiple: 5, leadTimeDays: 2,
      quotedDeliveryDate: "9999-12-31",
      quotedUnit: product.stockUnit,
      reviewConfirmed: true,
      packUomConfirmed: true,
      source: index === 0 ? "document-upload" : "manual",
      documentId: index === 0 ? "fixture-document" : null,
      documentName: index === 0 ? "fixture-quotation.pdf" : null,
      documentPath: index === 0 ? "/test-fixtures/quotation.pdf" : null,
    });
    const order = await adapter.createPurchaseOrderDraft({
      productId, supplierId, qty: 20, unitPrice: quote.unitPrice,
      rfqId: request.rfqId, quoteId: quote.quoteId,
    });
    if (index === 1) await adapter.approvePurchaseOrder(order.poNumber);
  }

  const originalRaw = storage.getItem(workflowKey)!;
  const original = JSON.parse(originalRaw);
  assert.equal(original.requests.length, 2);
  assert.equal(original.quotes.length, 2);
  assert.deepEqual(original.orders.map((order: { status: string }) => order.status), ["draft", "approved"]);
  assert.ok(original.activity.length > 0);
  const expectedEvents: ActivityEntry[] = [];

  async function workflowReads() {
    const dashboard = await adapter.getDashboardData();
    return JSON.stringify({
      requests: await Promise.all(original.requests.map((request: { productId: string }) =>
        adapter.getLatestQuotationRequest(request.productId))),
      quotes: await Promise.all(original.requests.map((request: { rfqId: string }) =>
        adapter.getSupplierQuotes(request.rfqId))),
      orders: await adapter.getPurchaseOrders(),
      dashboardRequests: dashboard.quotationRequests,
      dashboardQuotes: dashboard.quotes,
      dashboardOrders: dashboard.purchaseOrders,
    });
  }
  const originalReads = await workflowReads();

  async function assertPreserved(expectedEvent?: LogActivityInput) {
    const raw = storage.getItem(workflowKey)!;
    const saved = JSON.parse(raw);
    if (expectedEvent) {
      const event = saved.activity.at(-1) as ActivityEntry;
      assert.equal(typeof event.timestamp, "string");
      assert.equal(new Date(event.timestamp).toISOString(), event.timestamp);
      expectedEvents.push({
        eventId: `EVT-${String(original.seq.event + expectedEvents.length + 1).padStart(5, "0")}`,
        timestamp: event.timestamp,
        actor: OWNER_ACTOR,
        ...expectedEvent,
      });
    }
    // Exact serialized equality catches any changed field, order, sequence,
    // relationship, timestamp, or pre-existing audit event (not just counts).
    assert.equal(raw, JSON.stringify({
      ...original,
      activity: [...original.activity, ...expectedEvents],
      seq: { ...original.seq, event: original.seq.event + expectedEvents.length },
    }));
    assert.equal(await workflowReads(), originalReads);
    assert.equal(
      JSON.stringify(await adapter.getActivityHistory()),
      JSON.stringify([...original.activity, ...expectedEvents].reverse()),
    );
  }

  async function reloadAndCheck() {
    const posBefore = JSON.stringify(await adapter.getPosImportState());
    adapter = new MockAdapter(0);
    adapter.setOwnerId(owner);
    assert.equal(JSON.stringify(await adapter.getPosImportState()), posBefore);
    await assertPreserved();
  }

  async function importCsv(body: string, name: string, kind: PosImportKind) {
    const posBefore = storage.getItem(posKey);
    const preview = await adapter.previewPosImport(new File([body], name, { type: "text/csv" }), kind);
    assert.equal(preview.canImport, true, JSON.stringify(preview.issues));
    assert.equal(storage.getItem(posKey), posBefore, "preview must not persist POS data");
    await assertPreserved();
    await adapter.confirmPosImport(preview);
    await assertPreserved({
      action: "Synthetic POS CSV imported",
      status: "Demo data · replaced",
      details: `${name} · ${kind === "sales" ? "Daily sales" : "Stock snapshot"} · ${preview.rows.length} rows · ${preview.impacts.length} products · ${preview.dateFrom} to ${preview.dateTo}. Synthetic POS Demo Data; no live POS connection.`,
    });
    const state = await adapter.getPosImportState();
    assert.equal(state[kind]!.fileName, name);
    assert.deepEqual(state[kind]!.rows, preview.rows);
    await reloadAndCheck();
  }

  await importCsv(csv.inventory, csv.inventoryName, "inventory");
  await importCsv(csv.baseline, csv.baselineName, "sales");
  await importCsv(csv.spike, csv.spikeName, "sales");
  const beforeReset = await adapter.getPosImportState();
  assert.ok(beforeReset.sales && beforeReset.inventory, "both overlays must exist before reset");
  await adapter.resetPosImport(resetKind);
  await assertPreserved({
    action: "Synthetic POS import reset",
    status: "Demo estimates restored",
    details: `${resetKind === "sales" ? "Sales import" : resetKind === "inventory" ? "Stock snapshot" : "Sales and stock imports"} removed. Existing RFQs, quotations and purchase orders were kept.`,
  });
  assert.deepEqual(await adapter.getPosImportState(), resetKind
    ? { ...beforeReset, [resetKind]: null }
    : emptyPosState());
  await reloadAndCheck();
  assert.equal(expectedEvents.length, 4, "three imports and one reset, with no extra workflow events");
}
