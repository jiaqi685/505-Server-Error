import assert from "node:assert/strict";
import test from "node:test";
import { normaliseMultiQuotation, normaliseQuotation } from "./quotation-extraction.ts";

const fixture = {
  quotedSupplierName: "Bintang Wholesale", quotedProductName: "Premium Fragrant Rice",
  quotedUnit: "bag", packDescription: "5kg per bag", unitPrice: 31.8,
  minimumOrderQuantity: 30, orderMultiple: null, leadTimeDays: 2,
  leadTimeText: "2 working days", leadTimeBasis: "calendar-days",
  quotedDeliveryDate: "2026-11-30", deliveryDateExplicit: false,
  confidence: "high", notes: [],
};
test("static Bintang fixture preserves 31.80/MOQ30/two working days without promising the requested date", () => {
  const result = normaliseQuotation(fixture);
  assert.equal(result.unitPrice, 31.8);
  assert.equal(result.minimumOrderQuantity, 30);
  assert.equal(result.quotedSupplierName, "Bintang Wholesale");
  assert.equal(result.leadTimeDays, 2);
  assert.equal(result.leadTimeBasis, "working-days");
  assert.equal(result.leadTimeText, "2 working days");
  assert.equal(result.quotedDeliveryDate, null);
  assert.equal(result.needsHumanReview, true);
});
test("only valid dates with explicit document evidence survive", () => {
  assert.equal(normaliseQuotation({ ...fixture, deliveryDateExplicit: true }).quotedDeliveryDate, null);
  assert.equal(normaliseQuotation({ ...fixture, deliveryDateExplicit: true, deliveryDateText: "Delivery on 30 November 2026" }).quotedDeliveryDate, "2026-11-30");
  assert.equal(normaliseQuotation({ ...fixture, deliveryDateExplicit: true, deliveryDateText: "invalid", quotedDeliveryDate: "2026-02-30" }).quotedDeliveryDate, null);
});
test("invalid prices/quantities are not silently coerced and missing lead basis remains unknown", () => {
  const result = normaliseQuotation({ unitPrice: "31.80", minimumOrderQuantity: 0, orderMultiple: -1, leadTimeDays: 0 });
  assert.equal(result.unitPrice, null);
  assert.equal(result.minimumOrderQuantity, null);
  assert.equal(result.orderMultiple, null);
  assert.equal(result.leadTimeDays, 0);
  assert.equal(result.leadTimeBasis, "unknown");
  assert.equal(result.quotedDeliveryDate, null);
});

test("one document extraction normalizes all distinct lines without converting quantities into MOQ", () => {
  const items = [
    { description: "Premium Fragrant Rice 5kg", sku: "RICE-5", unit: "bag", packSpecification: "5 kg", quotedQuantity: 8, unitPrice: 32.4, lineTotal: 259.2 },
    { description: "Cooking Oil 1L", sku: null, unit: "bottle", quotedQuantity: 6, unitPrice: 7.2, itemDiscount: "RM 1 off", lineTotal: 43.2 },
    { description: "White Sugar", unit: "pack", quotedQuantity: 12, unitPrice: 2.9, lineTotal: 34.8 },
    ...Array.from({ length: 5 }, (_, index) => ({ description: `Product ${index + 4}`, unit: "pack", quotedQuantity: index + 2, unitPrice: index + 1, lineTotal: (index + 2) * (index + 1) })),
  ];
  const result = normaliseMultiQuotation({
    quotedSupplierName: "FreshChoice Trading Sdn. Bhd.",
    quotationDateText: "Dated 21 October 2026",
    validityText: "Valid for 14 days",
    deliveryWording: "Delivery in 2 working days",
    conditionalDiscounts: ["5% discount on orders over RM 500"],
    items,
  });
  assert.equal(result.items.length, 8);
  assert.equal(new Set(result.items.map((item) => item.lineItemId)).size, 8);
  assert.deepEqual(result.items.slice(0, 3).map((item) => item.unitPrice), [32.4, 7.2, 2.9]);
  assert.deepEqual(result.items.slice(0, 3).map((item) => item.quotedQuantity), [8, 6, 12]);
  assert.equal(result.items[1].itemDiscount, "RM 1 off");
  assert.equal(result.conditionalDiscounts[0], "5% discount on orders over RM 500");
  assert.equal(result.needsHumanReview, true);
  assert.equal("minimumOrderQuantity" in result.items[0], false);
});
