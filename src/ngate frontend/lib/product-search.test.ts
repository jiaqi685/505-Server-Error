import assert from "node:assert/strict";
import test from "node:test";
import { buildSeedProducts } from "../data/seed";
import { rankProductsBySearch } from "./product-search";

test("product names outrank code, supplier, and category matches", () => {
  const base = buildSeedProducts()[0];
  const supplier = (supplierName: string) => [{ ...base.suppliers[0], supplierName }];
  const products = [
    { ...base, productId: "name-exact", productName: "Rice", category: "Other" },
    { ...base, productId: "name-prefix", productName: "Rice Noodles", category: "Other" },
    { ...base, productId: "name-contains", productName: "Premium Fragrant Rice", category: "Other" },
    { ...base, productId: "rice-code", productName: "Cooking Oil", category: "Other" },
    { ...base, productId: "supplier-match", productName: "Cooking Oil", category: "Other", suppliers: supplier("Rice Trading") },
    { ...base, productId: "category-match", productName: "Cooking Oil", category: "Rice" },
    { ...base, productId: "keyword-fallback", productName: "Cooking Oil", category: "Other", keywords: ["rice grain"] },
  ];
  assert.deepEqual(rankProductsBySearch(products, "  RICE  ").map((product) => product.productId), [
    "name-exact", "name-prefix", "name-contains", "rice-code", "supplier-match", "category-match", "keyword-fallback",
  ]);
  const skuProduct = { ...products[3], productId: "different-catalog-id", sku: "SKU-042" };
  assert.equal(rankProductsBySearch([skuProduct], "sku-042")[0].productId, "different-catalog-id");
  assert.equal(rankProductsBySearch([skuProduct], "sku-")[0].productId, "different-catalog-id");
  assert.equal(rankProductsBySearch(buildSeedProducts(), "premium fragrant rice")[0].productId, "premium-fragrant-rice");
});

test("search normalizes whitespace and retains supplier/category/other matching", () => {
  const products = buildSeedProducts();
  assert.ok(rankProductsBySearch(products, products[0].suppliers[0].supplierName).length > 0);
  assert.ok(rankProductsBySearch(products, products[0].category).length > 0);
  assert.ok(rankProductsBySearch(products, products[0].keywords[0]).length > 0);
  assert.deepEqual(rankProductsBySearch(products, "   "), products);
});
