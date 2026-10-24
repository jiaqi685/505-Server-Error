import assert from "node:assert/strict";
import test from "node:test";
import type { SupplierQuote } from "../data/types";
import { buildSeedProducts } from "../data/seed";
import { matchingRfqSupplierId, quotationReview } from "./quotation-review";
import { actualOrderQuantity, estimatedDelivery, rankSupplierQuotes } from "./supplier-ranking";
import { purchasingProgress } from "./workflow";

const rice = buildSeedProducts().find((p) => p.productId === "premium-fragrant-rice")!;
const quote = (id: string, price: number, moq: number | null, lead = 1): SupplierQuote => ({
  quoteId: id, rfqId: "test-rfq", productId: rice.productId, supplierId: `SUP-${id}`,
  supplierName: `Supplier ${id}`, unitPrice: price, previousUnitPrice: null,
  minimumOrderQuantity: moq, orderMultiple: null, leadTimeDays: lead,
  quotedDeliveryDate: null, source: "manual", receivedAt: "2026-10-23T01:00:00+08:00",
  reviewConfirmed: true, packUomConfirmed: true, quotedUnit: "bag",
});

test("Bintang never silently aliases to Supplier A, while literal identity matches", () => {
  const result = { quotedSupplierName: "Bintang Wholesale", quotedProductName: "Premium Fragrant Rice", quotedUnit: "bag", packDescription: "5kg per bag", unitPrice: 31.8 };
  assert.equal(quotationReview(result, "Supplier A", rice).supplierMismatch, true);
  assert.equal(quotationReview(result, "Bintang Wholesale", rice).supplierMismatch, false);
  assert.match(quotationReview(result, "Supplier A", rice).warnings.join(" "), /explicitly confirm an override/);
});

test("document company identity can select only an exact normalized supplier already on this RFQ", () => {
  const suppliers = [
    { supplierId: "SUP-B", supplierName: "FreshChoice Trading Sdn. Bhd." },
    { supplierId: "SUP-C", supplierName: "ValueStock Supply Sdn. Bhd." },
  ];
  assert.equal(matchingRfqSupplierId("FRESHCHOICE TRADING SDN.BHD.", suppliers), "SUP-B");
  assert.equal(matchingRfqSupplierId("ValueStock Supply Sdn Bhd", suppliers), "SUP-C");
  assert.equal(matchingRfqSupplierId("FreshChoice Trading", [suppliers[1]]), undefined);
  assert.equal(matchingRfqSupplierId("FreshChoice Trading Group", suppliers), undefined, "No fuzzy or filename-based supplier aliases");
  assert.equal(matchingRfqSupplierId(undefined, suppliers), undefined);
});

test("SKU, units, pack and retail discrepancies are warnings only, without data corrections", () => {
  const p = { ...rice, posData: { retailUnitPrice: 12.2 } };
  const result = { quotedSupplierName: "Bintang Wholesale", quotedProductName: "Other Rice", quotedUnit: "carton", packDescription: "5kg per bag", unitPrice: 31.8 };
  const before = JSON.stringify([p, result]);
  const warnings = quotationReview(result, "Supplier A", p).warnings.join(" ");
  for (const pattern of [/Product mismatch/, /Unit mismatch/, /pack weight is not verified/, /POS selling price/]) assert.match(warnings, pattern);
  assert.equal(JSON.stringify([p, result]), before);
});

test("two working days and unknown day basis never become an invented delivery promise", () => {
  const q = quote("A", 31.8, 30, 2);
  for (const leadTimeBasis of ["working-days", "calendar-days", "unknown"] as const)
    assert.equal(estimatedDelivery({ ...q, leadTimeBasis }), null);
  assert.equal(estimatedDelivery({ ...q, quotedDeliveryDate: "2026-10-29" }), null, "Legacy dates without verification are not promises");
  assert.equal(estimatedDelivery({ ...q, quotedDeliveryDate: "2026-10-29", deliveryDateConfirmed: true, deliveryConfirmationSource: "supplier-contact", deliveryConfirmationNote: "Confirmed by supplier" }, "2026-10-23"), "2026-10-29");
  assert.equal(rankSupplierQuotes([{ ...q, leadTimeBasis: "working-days" }], { requestedQuantity: 9, requestedDeliveryDate: "2026-10-29" }).recommended, null);
});

test("missing MOQ remains unknown, cannot produce a recommendation, and supplier-contact dates need no note", () => {
  const q = {
    ...quote("A", 31.8, null),
    quotedDeliveryDate: "2026-10-29",
    deliveryDateConfirmed: true,
    deliveryConfirmationSource: "supplier-contact" as const,
    deliveryConfirmationNote: null,
  };
  assert.equal(estimatedDelivery(q, "2026-10-23"), "2026-10-29");
  const result = rankSupplierQuotes([q], { requestedQuantity: 17, requestedDeliveryDate: "2026-10-30", today: "2026-10-23" });
  assert.equal(result.recommended, null);
  assert.equal(result.rows[0].actualOrderQuantity, 17);
  assert.equal(result.rows[0].eligible, false);
  assert.match(result.noRecommendationReason ?? "", /MOQ is not stated/i);
  assert.match(result.rows[0].reasons.join(" "), /confirm with supplier before final comparison/i);
});

test("original MOQ comparison cases stay deterministic and quote edits re-rank immediately", () => {
  const quotes = [quote("A", 12.5, 20, 2), quote("B", 9.8, 50), quote("C", 10.5, 20)].map((q): SupplierQuote => ({ ...q, quotedDeliveryDate: "2026-10-29", deliveryDateConfirmed: true, deliveryConfirmationSource: "supplier-contact", deliveryConfirmationNote: "Synthetic supplier promise confirmed" }));
  const input = { requestedQuantity: 20, requestedDeliveryDate: "2026-10-30", today: "2026-10-23" };
  const at20 = rankSupplierQuotes(quotes, input);
  assert.equal(at20.recommended?.quote.supplierId, "SUP-C");
  assert.equal(at20.rows.find((q) => q.quote.supplierId === "SUP-B")!.totalPurchaseCost, 490);
  assert.equal(at20.rows.find((q) => q.quote.supplierId === "SUP-B")!.excessQuantity, 30);
  assert.equal(rankSupplierQuotes(quotes, { ...input, requestedQuantity: 50 }).recommended?.quote.supplierId, "SUP-B");
  assert.equal(rankSupplierQuotes(quotes.map((q) => q.supplierId === "SUP-A" ? { ...q, unitPrice: 1 } : q), input).recommended?.quote.supplierId, "SUP-A");
  assert.equal(actualOrderQuantity(9, 30, 6), 30);
  assert.equal(actualOrderQuantity(31, 30, 6), 36);
  assert.equal(rankSupplierQuotes([quote("A", 31.8, 30)], { ...input, requestedQuantity: 9 }).rows[0].totalPurchaseCost, 954);
});

test("17-bag delivery safety: B only, verified A, revert A, then neither", () => {
  const a = { ...quote("A", 32.5, 10, 3), leadTimeBasis: "working-days" as const };
  const b: SupplierQuote = { ...quote("B", 31.8, 30), quotedDeliveryDate: "2026-10-29", deliveryDateConfirmed: true, deliveryConfirmationSource: "supplier-contact", deliveryConfirmationNote: "Supplier explicitly confirmed date" };
  const input = { requestedQuantity: 17, requestedDeliveryDate: "2026-10-30", today: "2026-10-23" };
  const first = rankSupplierQuotes([a, b], input);
  assert.equal(first.recommended?.quote.supplierId, "SUP-B");
  assert.equal(first.rows.find((r) => r.quote.supplierId === "SUP-A")?.totalPurchaseCost, 552.5);
  const confirmedA: SupplierQuote = { ...a, quotedDeliveryDate: "2026-10-28", deliveryDateConfirmed: true, deliveryConfirmationSource: "supplier-contact", deliveryConfirmationNote: "Owner checked supplier message" };
  assert.equal(rankSupplierQuotes([confirmedA, b], input).recommended?.quote.supplierId, "SUP-A");
  assert.equal(rankSupplierQuotes([{ ...confirmedA, quotedDeliveryDate: null, deliveryDateConfirmed: false }, b], input).recommended?.quote.supplierId, "SUP-B");
  const neither = rankSupplierQuotes([a, { ...b, quotedDeliveryDate: null, deliveryDateConfirmed: false }], input);
  assert.equal(neither.recommended, null);
  assert.match(neither.noRecommendationReason!, /until a delivery date is confirmed/);
  assert.equal(rankSupplierQuotes([confirmedA], { ...input, today: "2026-10-29" }).recommended, null, "Past commitment expires");
  assert.equal(estimatedDelivery({ ...b, deliveryConfirmationSource: "document", documentQuotedDeliveryDate: null }, input.today), null);
});

test("progress describes approved orders truthfully, never as pending or demo approval", () => {
  const rfq = { rfqId: "test-rfq", productId: rice.productId, requestedQuantity: 17, requestedDeliveryDate: "2099-10-30", suppliers: [], createdAt: "2026-10-23" };
  const order = { poNumber: "test-po", productId: rice.productId, productName: rice.productName, supplierId: "SUP-B", supplier: "Supplier B", rfqId: rfq.rfqId, qty: 30, unit: "bag", unitPrice: 31.8, total: 954, status: "approved" as const, preparedAt: "2026-10-23" };
  const progress = purchasingProgress(rfq, [], [order]);
  assert.match(progress.steps.find((s) => s.key === "po")!.note, /approved/);
  assert.doesNotMatch(progress.steps.map((s) => s.note).join(" "), /pending approval|Demo approval/);
  assert.equal(progress.steps.find((s) => s.key === "approved")!.note, "Owner approved · not sent");
});

// Merged from the supplied Supplier Master patch; keep the current master and safeguards.
test("confirmed FreshChoice identity matches SUP-B even when an old RFQ still says Supplier B", () => {
  const extracted = { quotedSupplierName: "FRESHCHOICE TRADING SDN.BHD." };
  const review = quotationReview(extracted, "Supplier B", rice, "SUP-B");
  assert.equal(review.supplierMismatch, false);
  assert.doesNotMatch(review.warnings.join(" "), /Supplier mismatch/);
  assert.equal(quotationReview(extracted, "Supplier A", rice, "SUP-A").supplierMismatch, true);
  assert.equal(quotationReview({ quotedSupplierName: "Other Wholesale" }, "Supplier B", rice, "SUP-B").supplierMismatch, true);
  assert.equal(quotationReview({ quotedSupplierName: "Other Wholesale" }, "Custom Company", rice, "SUP-B").supplierMismatch, true);
  assert.match(quotationReview({}, "Supplier B", rice, "SUP-B").warnings.join(" "), /identity is unverified/);
});
