import assert from "node:assert/strict";
import test from "node:test";
import type { SupplierQuote } from "../data/types";
import { validatePoInput } from "./costs";
import { comparisonPoQuantity, newRfqDefaultQuantity, preserveExtractedDraftOnSupplierSwitch, quotationEditorFields, quotationEditorKey } from "./procurement-safety";
import { MockAdapter } from "../data/adapters/mock";
import { buildQuotationMessage } from "./whatsapp";

test("RFQ partial orders are blocked even above MOQ, with exact remaining shortfall", () => {
  const partial = validatePoInput(10, 32.5, 10, 17);
  assert.equal(partial.valid, false);
  assert.match(partial.message, /Shortfall: 7/);
  assert.equal(validatePoInput(17, 32.5, 10, 17).valid, true);
  assert.equal(validatePoInput(30, 31.8, 30, 17).valid, true);
  assert.equal(validatePoInput(9, 32.5, 10, 17).valid, false);
  assert.equal(validatePoInput(10, 32.5, 10).valid, true, "Unlinked history remains unchanged");
});

test("what-if deadlines cannot prepare a PO and PO quantity always comes from the saved RFQ", () => {
  const rfq = { requestedQuantity: 17, requestedDeliveryDate: "2099-10-30" };
  assert.equal(comparisonPoQuantity(rfq, "2099-11-01"), null);
  assert.equal(comparisonPoQuantity(rfq, ""), null);
  assert.equal(comparisonPoQuantity(rfq, rfq.requestedDeliveryDate), 17);
  assert.deepEqual(rfq, { requestedQuantity: 17, requestedDeliveryDate: "2099-10-30" });
});

test("a new RFQ uses current POS suggestions, while saved RFQs and WhatsApp drafts retain exact quantities", async () => {
  assert.equal(newRfqDefaultQuantity(9, 6), 9, "baseline POS suggestion");
  assert.equal(newRfqDefaultQuantity(17, 6), 17, "rice spike POS suggestion");
  assert.equal(newRfqDefaultQuantity(null, 6), 6, "safe fallback when POS has no suggestion");
  const api = new MockAdapter(0);
  api.setOwnerId("isolated-new-rfq-quantity-regression");
  const savedNine = await api.createQuotationRequest({
    productId: "premium-fragrant-rice", requestedQuantity: 9,
    requestedDeliveryDate: "2099-10-30", supplierIds: ["SUP-A"],
  });
  const newSpikeRequest = await api.createQuotationRequest({
    productId: "premium-fragrant-rice", requestedQuantity: newRfqDefaultQuantity(17, 6),
    requestedDeliveryDate: "2099-10-30", supplierIds: ["SUP-A"],
  });
  const manualTwelve = await api.createQuotationRequest({
    productId: "premium-fragrant-rice", requestedQuantity: 12,
    requestedDeliveryDate: "2099-10-30", supplierIds: ["SUP-A"],
  });
  assert.equal(savedNine.requestedQuantity, 9);
  assert.equal(newSpikeRequest.requestedQuantity, 17);
  assert.equal(manualTwelve.requestedQuantity, 12);
  const message = (request: typeof savedNine) => buildQuotationMessage({
    supplierName: request.suppliers[0].supplierName, productName: "Premium Fragrant Rice",
    quantity: request.requestedQuantity, unit: "bag", deliveryDate: request.requestedDeliveryDate,
  });
  assert.match(message(savedNine), /Quantity: 9 bags/);
  assert.match(message(newSpikeRequest), /Quantity: 17 bags/);
  assert.match(message(manualTwelve), /Quantity: 12 bags/);
  assert.equal((await api.getLatestQuotationRequest(savedNine.productId))?.requestedQuantity, 12);
  assert.equal(savedNine.requestedQuantity, 9, "creating a later RFQ did not rewrite the earlier one");
});

test("emergency Mock Mode also rejects RFQ partial orders without adding orders or activity", async () => {
  const api = new MockAdapter(0, true);
  const rfq = await api.createQuotationRequest({
    productId: "premium-fragrant-rice", requestedQuantity: 17,
    requestedDeliveryDate: "2099-10-30", supplierIds: ["SUP-A"],
  });
  const before = await api.getActivityHistory();
  await assert.rejects(api.createPurchaseOrderDraft({
    productId: rfq.productId, supplierId: "SUP-A", qty: 10, unitPrice: 32.5,
    rfqId: rfq.rfqId, historicalPriceConfirmed: true,
  }), /Shortfall: 7/);
  assert.deepEqual(await api.getPurchaseOrders(), []);
  assert.deepEqual(await api.getActivityHistory(), before);
});

test("switch A quote → supplier B without a quote → supplier C without a quote resets every editor field", () => {
  const a: SupplierQuote = {
    quoteId: "quote-a", rfqId: "rfq", productId: "rice", supplierId: "A", supplierName: "A",
    unitPrice: 32.5, previousUnitPrice: null, minimumOrderQuantity: 10, orderMultiple: 5,
    quotedDeliveryDate: "2099-10-28", leadTimeDays: 3, leadTimeBasis: "working-days",
    source: "document-upload", receivedAt: "2026-10-23",
    documentId: "doc-a", documentName: "A.pdf", documentPath: "/private/A.pdf",
    documentQuotedDeliveryDate: "2099-10-28",
    reviewConfirmed: true, packUomConfirmed: true, supplierOverrideConfirmed: true, deliveryDateConfirmed: true,
    deliveryConfirmationNote: "A confirmed",
  };
  const keys = [quotationEditorKey("rfq", "A", a.quoteId), quotationEditorKey("rfq", "B"), quotationEditorKey("rfq", "C")];
  assert.equal(new Set(keys).size, 3, "No-quote suppliers must not share the undefined quote key");
  let fields = quotationEditorFields(a);
  fields.notes.push("Unsaved extraction note belonging only to A");
  assert.equal(fields.documentRef?.documentName, "A.pdf");
  for (const supplier of ["B", "C"]) {
    fields = quotationEditorFields();
    assert.deepEqual(fields, {
      file: null, uploadError: "",
      price: "", moq: "", multiple: "", date: "", leadDays: "", leadBasis: "unknown",
      extraction: null, reviewConfirmed: false, packUomConfirmed: false, overrideConfirmed: false,
      deliveryStatus: "none", deliveryConfirmed: false, confirmationNote: "",
      documentDate: null, notes: [], step: "upload", documentRef: null,
    }, `${supplier} cannot reuse A's prices, file evidence, promises or review confirmations`);
  }
  assert.equal(quotationEditorKey("rfq", "A", a.quoteId), quotationEditorKey("rfq", "A", { ...a, unitPrice: 99 }.quoteId),
    "Same-quote refetch preserves the editor identity and unsaved inputs");
  assert.notEqual(quotationEditorKey("other-rfq", "A", a.quoteId), keys[0]);
});

test("supplier changes keep a parsed document draft available for explicit correction, but blank editors reset", () => {
  const a: SupplierQuote = {
    quoteId: "quote-a", rfqId: "rfq", productId: "rice", supplierId: "A", supplierName: "Supplier A",
    unitPrice: 32.5, previousUnitPrice: null, minimumOrderQuantity: 10,
    quotedDeliveryDate: null, leadTimeDays: 3, source: "document-upload", receivedAt: "2026-10-23",
    documentId: "doc-a", documentName: "not-used-for-identity.pdf", documentPath: "/private/A.pdf",
    quotedSupplierName: "FreshChoice Trading Sdn. Bhd.", quotedUnit: "bag",
  };
  assert.equal(preserveExtractedDraftOnSupplierSwitch(a.documentId, a), true);
  assert.equal(preserveExtractedDraftOnSupplierSwitch(null, null), false);
  const draft = quotationEditorFields(a);
  assert.equal(draft.price, "32.5");
  assert.equal(draft.documentRef?.documentId, "doc-a");
  assert.equal(draft.extraction?.quotedSupplierName, "FreshChoice Trading Sdn. Bhd.");
  assert.deepEqual(quotationEditorFields(), quotationEditorFields(undefined));
});
