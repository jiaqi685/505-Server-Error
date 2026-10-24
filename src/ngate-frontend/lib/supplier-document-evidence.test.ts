import assert from "node:assert/strict";
import test from "node:test";
import { buildSeedProducts, SUPPLIERS } from "../data/seed";
import type { SupplierQuote } from "../data/types";
import { presentSupplierNames } from "./supplier-master";
import { SUPPLIER_DOCUMENT_EVIDENCE as evidence, documentLinesFor, pendingSuppliers, activeDocumentedSupplier, compatibleQuote } from "./supplier-document-evidence";
import { rankSupplierQuotes } from "./supplier-ranking";
import { quotationReview } from "./quotation-review";

test("all 66 lines retain document evidence, unknown MOQ/pack mapping and no invented calendar dates", () => {
  assert.equal(evidence.documents.reduce((n, d) => n + d.items.length, 0), 66);
  assert.equal(evidence.minimumOrderQuantity, null);
  assert.equal(evidence.confirmedDeliveryDate, null);
  assert.equal(evidence.packMappingConfirmed, false);
  const productIds = buildSeedProducts().map((p) => p.productId);
  for (const ids of Object.values(evidence.groups)) for (const id of ids) assert.ok(productIds.includes(id), id);
  for (const doc of evidence.documents) {
    assert.match(doc.deliveryWording, /^Within \d-\d working days$/);
    assert.equal(doc.items.length, (evidence.groups as Record<string, string[]>)[doc.group].length);
  }
  assert.equal(documentLinesFor("premium-fragrant-rice")[0].quotedQuantity, 10);
  assert.equal(documentLinesFor("premium-fragrant-rice")[0].minimumOrderQuantity, null);
});

test("F-I have verified identities but are pending and never appear in registered choices", () => {
  assert.deepEqual(pendingSuppliers.map((s) => s.supplierId), ["SUP-F", "SUP-G", "SUP-H", "SUP-I"]);
  assert.deepEqual(SUPPLIERS.map((s) => s.supplierId), ["SUP-A", "SUP-B", "SUP-C", "SUP-D", "SUP-E"]);
  assert.equal(activeDocumentedSupplier("original-uht-milk", "SUP-F"), false);
});

test("unsupported historical relationships are quarantined without rewriting histories or replenishment calculations", () => {
  const products = buildSeedProducts();
  const before = JSON.stringify(products);
  const shown = presentSupplierNames(products);
  const noodles = shown.find((p) => p.productId === "instant-noodles-5-pack")!;
  assert.ok(noodles.purchaseHistory.some((p) => p.supplierId === "SUP-D"));
  assert.equal(noodles.suppliers.some((s) => s.supplierId === "SUP-D"), false);
  assert.ok(noodles.suppliers.some((s) => s.supplierId === "SUP-B"));
  assert.equal(activeDocumentedSupplier(noodles.productId, "SUP-D"), false);
  const detergent = shown.find((p) => p.productId === "laundry-detergent")!;
  assert.equal(detergent.suppliers.length, 0, "Pending household suppliers are not silently selectable");
  for (const p of shown) {
    const original = products.find((x) => x.productId === p.productId)!;
    assert.equal(p.currentStock, original.currentStock);
    assert.equal(p.supplierLeadTimeDays, original.supplierLeadTimeDays);
    assert.deepEqual(p.purchaseHistory, original.purchaseHistory);
  }
  assert.equal(JSON.stringify(products), before);
});

const rice: SupplierQuote = {
  quoteId: "q", rfqId: "r", productId: "premium-fragrant-rice", supplierId: "SUP-B",
  supplierName: "FreshChoice Trading Sdn. Bhd.", unitPrice: 31.5, previousUnitPrice: null,
  minimumOrderQuantity: 1, leadTimeDays: 3, quotedDeliveryDate: "2099-10-28",
  deliveryDateConfirmed: true, deliveryConfirmationSource: "supplier-contact",
  deliveryConfirmationNote: "Explicit synthetic supplier confirmation",
  source: "manual", receivedAt: "2026-10-23", reviewConfirmed: true, packUomConfirmed: true, quotedUnit: "bags",
};

test("human SKU/pack confirmation and compatible UOM are required even with a timely delivery promise", () => {
  const input = { requestedQuantity: 17, requestedDeliveryDate: "2099-10-30", unit: "bag" };
  assert.ok(rankSupplierQuotes([rice], input).recommended);
  for (const q of [{ ...rice, reviewConfirmed: false }, { ...rice, packUomConfirmed: false }, { ...rice, packUomConfirmed: undefined }, { ...rice, quotedUnit: "cartons" }, { ...rice, quotedUnit: null }]) {
    assert.equal(compatibleQuote(q, "bag"), false);
    assert.equal(rankSupplierQuotes([q], input).recommended, null);
  }
  const noodles = { ...rice, productId: "instant-noodles-5-pack", supplierId: "SUP-D", quotedUnit: "packs" };
  assert.equal(compatibleQuote(noodles, "pack"), false, "Human review cannot turn an unsupported supplier into a document-backed one");
  assert.equal(compatibleQuote({ ...rice, quotedUnit: "sets" }, "pack"), false);
});

test("a carton price never becomes comparable to a bottle price from a one-to-one note", () => {
  const cartonQuote: SupplierQuote = {
    ...rice,
    productId: "drinking-water",
    quotedUnit: "carton",
    unitConversionConfirmed: true,
    unitConversionNote: "One carton equals one bottle.",
  };
  assert.equal(compatibleQuote(cartonQuote, "bottle"), false);
  const ranked = rankSupplierQuotes([cartonQuote], {
    requestedQuantity: 24,
    requestedDeliveryDate: "2099-10-30",
    unit: "bottle",
  });
  assert.equal(ranked.recommended, null);
  assert.equal(ranked.rows[0].eligible, false);
  assert.equal(cartonQuote.unitPrice, rice.unitPrice, "The original quoted price remains unchanged.");
});

test("conditional discount evidence stays separate from single-item ranking", () => {
  assert.equal(evidence.documents.find((d) => d.supplierId === "SUP-C")!.items[4][4], "5%");
  const row = rankSupplierQuotes([{ ...rice, unitPrice: 32 }], { requestedQuantity: 10, requestedDeliveryDate: "2099-10-30", unit: "bag" }).rows[0];
  assert.equal(row.totalPurchaseCost, 320);
});

test("QuickBuy and FreshChoice identities match harmless formatting while wrong companies still warn", () => {
  const p = buildSeedProducts()[0];
  assert.equal(quotationReview({ quotedSupplierName: "QUICKBUY FMCG DISTRIBUTION SDN.BHD." }, "Supplier D", p, "SUP-D").supplierMismatch, false);
  assert.equal(quotationReview({ quotedSupplierName: "FreshChoice Trading SDN. BHD." }, "Supplier B", p, "SUP-B").supplierMismatch, false);
  assert.equal(quotationReview({ quotedSupplierName: "FreshChoice Trading SDN. BHD." }, "Supplier D", p, "SUP-D").supplierMismatch, true);
});
