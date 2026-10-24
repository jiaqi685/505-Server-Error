import assert from "node:assert/strict";
import test from "node:test";
import type { Product, QuotationLineItemExtraction, SupplierQuote } from "@/data";
import { assessPackConversion, parseExplicitPackConversion } from "./quotation-pack-conversion";
import { rankSupplierQuotes } from "./supplier-ranking";

const line = (overrides: Partial<QuotationLineItemExtraction> = {}): QuotationLineItemExtraction => ({
  lineItemId: "line-water",
  description: "DRINKING WATER 500ML X24 PER CTN",
  sku: null,
  unit: "cartons",
  packSpecification: null,
  quotedQuantity: 5,
  unitPrice: 14,
  itemDiscount: null,
  lineTotal: 70,
  ...overrides,
});

const water = (packSize: string): Product => ({
  id: "drinking-water",
  productName: "Drinking Water",
  stockUnit: "bottle",
  packSize,
} as Product);

test("converts 500ml x24 per CTN while retaining the original quote values", () => {
  const result = assessPackConversion(line(), water(""));
  assert.equal(result.status, "catalogue-confirmation-required");
  assert.equal(result.conversion?.outerUnit, "carton");
  assert.equal(result.conversion?.innerUnit, null);
  assert.equal(result.conversion?.unitsPerOuter, 24);
  assert.equal(result.conversion?.innerSizeMl, 500);
  assert.equal(result.normalizedUnitPrice, 14 / 24);
  assert.equal(result.equivalentQuantity, 120);
  assert.equal(line().unitPrice, 14);
  assert.equal(line().quotedQuantity, 5);
  assert.equal(line().lineTotal, 70);
});

test("catalogue size match is compatible, but a conflicting bottle size is blocked", () => {
  assert.equal(assessPackConversion(line(), water("500ml bottle")).status, "compatible");
  const conflict = assessPackConversion(line(), water("1L bottle"));
  assert.equal(conflict.status, "incompatible");
  assert.match(conflict.reason ?? "", /catalogue specifies 1000ml/i);
});

test("parses count-first, volume conversion and explicit unit aliases", () => {
  const parsed = parseExplicitPackConversion("12 x 1.5L bottles per carton", null, "ctn");
  assert.equal(parsed?.outerUnit, "carton");
  assert.equal(parsed?.innerUnit, "bottle");
  assert.equal(parsed?.unitsPerOuter, 12);
  assert.equal(parsed?.innerSizeMl, 1500);
});

test("does not treat an incompatible inner unit as a bottle conversion", () => {
  const result = assessPackConversion(
    line({ description: "500ml x24 cans per carton" }),
    water("500ml"),
  );
  assert.equal(result.status, "incompatible");
});

test("ambiguous multipliers remain unsupported", () => {
  const result = assessPackConversion(
    line({ description: "500ml x24 or x30 per carton" }),
    water("500ml"),
  );
  assert.equal(result.status, "unsupported");
});

test("ranking uses bottle-normalized pricing and whole cartons without inventing an MOQ", () => {
  const originalUnitPrice = 14;
  const normalizedUnitPrice = originalUnitPrice / 24;
  const quote = {
    quoteId: "quote-water",
    rfqId: "rfq-water",
    productId: "drinking-water",
    supplierId: "SUP-C",
    supplierName: "Demo supplier",
    unitPrice: originalUnitPrice,
    normalizedUnitPrice,
    minimumOrderQuantity: null,
    orderMultiple: null,
    leadTimeDays: null,
    quotedDeliveryDate: null,
    source: "document-upload",
    reviewConfirmed: true,
    packUomConfirmed: true,
    quotedUnit: "cartons",
    supplierProductRelationshipConfirmed: true,
    packConversionEvidence: {
      sourceText: "500ML X24 PER CTN",
      outerUnit: "carton",
      innerUnit: "bottle",
      unitsPerOuter: 24,
      innerSizeMl: 500,
      originalUnitPrice,
      normalizedUnitPrice,
      quotedQuantity: 5,
      equivalentQuantity: 120,
      originalLineTotal: 70,
      cataloguePackStatus: "owner-confirmed",
      cataloguePackDescription: null,
      reviewedAt: "2026-10-24T00:00:00Z",
    },
  } as SupplierQuote;

  const result = rankSupplierQuotes([quote], {
    requestedQuantity: 5,
    requestedDeliveryDate: "2026-11-01",
    unit: "bottle",
    today: "2026-10-24",
  });
  assert.equal(result.rows[0].compatibilityConfirmed, true);
  assert.equal(result.rows[0].actualOrderQuantity, 24);
  assert.equal(result.rows[0].excessQuantity, 19);
  assert.equal(result.rows[0].totalPurchaseCost, 14);
  assert.equal(quote.minimumOrderQuantity, null);
  assert.equal(result.recommended, null);
});
