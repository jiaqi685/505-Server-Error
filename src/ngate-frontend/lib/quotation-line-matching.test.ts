import assert from "node:assert/strict";
import test from "node:test";
import { buildSeedProducts } from "@/data/seed";
import type { QuotationLineItemExtraction } from "@/data";
import { matchQuotationLineToProduct } from "./quotation-line-matching";

function line(
  lineItemId: string,
  description: string,
  unit: string,
  unitPrice: number,
  packSpecification: string | null = null,
  sku: string | null = null,
): QuotationLineItemExtraction {
  return {
    lineItemId, description, sku, unit, packSpecification, quotedQuantity: 8,
    unitPrice, itemDiscount: null, lineTotal: unitPrice * 8,
  };
}

test("multi-product lines independently suggest the matching catalogue item without sharing prices", () => {
  const products = buildSeedProducts();
  const source = [
    line("line-001", "Premium Fragrant Rice 5kg bag", "bag", 32.4),
    line("line-002", "Edible Cooking Oil 1L", "bottle", 7.2),
    line("line-003", "Granulated White Sugar", "pack", 2.9),
    line("line-004", "5-Packet Instant Noodles", "pack", 4.8),
  ];
  const matches = source.map((item) => matchQuotationLineToProduct(item, products));

  assert.deepEqual(matches.map((match) => match.product?.productId), [
    "premium-fragrant-rice", "edible-cooking-oil", "granulated-white-sugar", "instant-noodles-5-pack",
  ]);
  assert.ok(matches.every((match) => match.confidence === "high"));
  assert.ok(matches.every((match) => match.autoAssignable));
  assert.deepEqual(source.map((item) => item.unitPrice), [32.4, 7.2, 2.9, 4.8]);
  assert.deepEqual(source.map((item) => item.lineTotal), [259.2, 57.6, 23.2, 38.4]);
});

test("an unclear line stays unmatched and a unit conflict remains visible", () => {
  const products = buildSeedProducts();
  const unknown = matchQuotationLineToProduct(line("line-001", "Miscellaneous handling", "fee", 10), products);
  assert.equal(unknown.product, null);
  assert.equal(unknown.confidence, "none");

  const mismatch = matchQuotationLineToProduct(line("line-002", "Edible Cooking Oil 1L", "carton", 42), products);
  assert.equal(mismatch.product?.productId, "edible-cooking-oil");
  assert.equal(mismatch.unitCompatible, false);
  assert.equal(mismatch.autoAssignable, true);
  assert.equal(mismatch.purchaseCompatible, false, "identifying a product must not verify incompatible units");
});

test("UHT milk matching respects explicit flavour and leaves flavourless lines for review", () => {
  const products = buildSeedProducts();
  const cases = [
    ["Original UHT Milk", "original-uht-milk"],
    ["Strawberry UHT Milk", "strawberry-uht-milk"],
    ["Chocolate UHT Milk", "chocolate-uht-milk"],
  ] as const;

  for (const [description, expectedId] of cases) {
    const match = matchQuotationLineToProduct(line(expectedId, description, "carton", 5), products);
    assert.equal(match.product?.productId, expectedId, description);
    assert.equal(match.confidence, "high", description);
    assert.equal(match.autoAssignable, true, description);
    assert.equal(match.purchaseCompatible, true, description);
  }

  const ambiguous = matchQuotationLineToProduct(line("milk-unknown", "UHT Milk", "carton", 5), products);
  assert.equal(ambiguous.product, null);
  assert.equal(ambiguous.confidence, "low");
  assert.equal(ambiguous.autoAssignable, false);
});

test("an explicit pack-size conflict prevents an automatic product suggestion", () => {
  const products = buildSeedProducts().map((product) => product.productId === "strawberry-uht-milk"
    ? { ...product, packSize: "250 ml bottle" }
    : product);
  const compatible = matchQuotationLineToProduct(
    line("milk-250", "Strawberry UHT Milk", "carton", 1.65, "24 x 250 ml"),
    products,
  );
  const mismatch = matchQuotationLineToProduct(
    line("milk-1l", "Strawberry UHT Milk", "carton", 1.65, "12 x 1 L"),
    products,
  );

  assert.equal(compatible.product?.productId, "strawberry-uht-milk");
  assert.equal(mismatch.product, null);
});

test("detergent powder is identified as a family but proposed as a pending catalogue item", () => {
  const products = buildSeedProducts();
  const powder = line(
    "detergent-powder-1kg",
    "LAUNDRY DETERGENT POWDER 1KG PKT",
    "pkt",
    14,
    "1kg packet",
    "LD-PWD-1KG",
  );
  const match = matchQuotationLineToProduct(powder, products);

  assert.equal(match.product, null, "do not assign the liquid bottle catalogue item");
  assert.equal(match.familyProduct?.productId, "laundry-detergent");
  assert.equal(match.autoAssignable, false);
  assert.equal(match.purchaseCompatible, false);
  assert.match(match.issue ?? "", /powder.*bottle/i);
  assert.deepEqual(match.pendingCatalogueItem, {
    proposedName: powder.description,
    quotedSku: "LD-PWD-1KG",
    quotedUnit: "pkt",
    quotedPackSpecification: "1kg packet",
    identifiedFamily: "Laundry Detergent",
    reason: match.issue,
  });
});

test("a quote SKU must match a catalogue code before the product is assigned", () => {
  const products = buildSeedProducts();
  const unmatchedSku = matchQuotationLineToProduct(
    line("rice-sku", "Premium Fragrant Rice 5kg bag", "bag", 32.4, "5kg bag", "RICE-5KG"),
    products,
  );
  assert.equal(unmatchedSku.product, null);
  assert.equal(unmatchedSku.autoAssignable, false);
  assert.equal(unmatchedSku.pendingCatalogueItem?.quotedSku, "RICE-5KG");

  const exactSkuProducts = products.map((product) => product.productId === "premium-fragrant-rice"
    ? { ...product, sku: "RICE-5KG", packSize: "5kg bag" }
    : product);
  const exactSku = matchQuotationLineToProduct(
    line("rice-sku-exact", "Premium Fragrant Rice 5kg bag", "bag", 32.4, "5kg bag", "RICE-5KG"),
    exactSkuProducts,
  );
  assert.equal(exactSku.product?.productId, "premium-fragrant-rice");
  assert.equal(exactSku.autoAssignable, true);
  assert.equal(exactSku.purchaseCompatible, true);
});

test("explicit quoted pack data stays pending until the catalogue has compatible pack data", () => {
  const products = buildSeedProducts();
  const quote = line("rice-pack", "Premium Fragrant Rice 5kg bag", "bag", 32.4, "5kg bag");
  const match = matchQuotationLineToProduct(quote, products);
  assert.equal(match.product?.productId, "premium-fragrant-rice");
  assert.equal(match.autoAssignable, true, "product identification can be automatic");
  assert.equal(match.packCompatible, false, "purchase compatibility needs catalogue pack evidence");
  assert.equal(match.purchaseCompatible, false, "automatic assignment must not verify the price");
});
