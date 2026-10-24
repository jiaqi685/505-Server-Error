import assert from "node:assert/strict";
import test from "node:test";
import {
  makeMappedFlaskProductsPayload,
  mapFlaskProductRecord,
  parseFlaskProductsEnvelope,
} from "./flask-product-mapping.ts";

const source = {
  product_id: "premium-fragrant-rice",
  store_id: "krukkruk",
  name: "Premium Fragrant Rice",
  short_name: "Fragrant Rice",
  category: "Rice & staples",
  unit: "bag",
  pack_size: null,
  on_hand: 3,
  daily_usage: 3,
  weekly_usage: { previous_week: 18, this_week: 21 },
  estimated_days_until_stockout: 1,
  suggested_reorder_quantity: 6,
  reorder_level: 9,
  preferred_supplier_id: "SUP-A",
  supplier_lead_time_days: 2,
  last_purchase_price: 10,
  reorder_reason: "At or below reorder level",
  excess_inventory_quantity: null,
  unit_cost_rm: 10,
  estimated_excess_inventory_cost_rm: null,
  shelf_life_days: 180,
  expiry_date: "2027-04-20",
  keywords: ["beras", "rice"],
  data_source: "MINI_MART_DEMO",
};

const detail = (product = source) => ({
  product: {
    ...product,
    suppliers: [
      {
        supplier_id: "SUP-A",
        supplier_name: "Supplier A",
        lead_days: 2,
        moq: null,
        unit: "bag",
        pack_size: null,
      },
    ],
  },
});

const purchaseHistory = (purchases) => ({
  product_id: source.product_id,
  product_name: source.name,
  purchases,
});

const purchase = (id, date, price, supplier = "SUP-A") => ({
  purchase_id: id,
  supplier_id: supplier,
  supplier_name: supplier === "SUP-A" ? "Supplier A" : "Supplier B",
  unit_price: price,
  quantity: 20,
  purchase_date: date,
});

test("maps all supported fields using exact shared Mini Mart IDs", () => {
  const mapped = mapFlaskProductRecord(
    source,
    detail(),
    purchaseHistory([purchase(2, "2026-10-21", 10), purchase(1, "2026-10-01", 9.8)]),
  );

  assert.equal(mapped.product.productId, "premium-fragrant-rice");
  assert.equal(mapped.sourceProductId, "premium-fragrant-rice");
  assert.equal(mapped.product.productName, "Premium Fragrant Rice");
  assert.equal(mapped.product.shortName, "Fragrant Rice");
  assert.equal(mapped.product.currentStock, 3);
  assert.equal(mapped.product.averageDailyUsage, 3);
  assert.deepEqual(mapped.product.weeklyUsage, { previousWeek: 18, thisWeek: 21 });
  assert.equal(mapped.product.reorderLevel, 9);
  assert.equal(mapped.product.preferredSupplierId, "SUP-A");
  assert.equal(mapped.product.supplierLeadTimeDays, 2);
  assert.equal(mapped.product.lastPurchasePrice, 10);
  assert.equal(mapped.product.suppliers[0].supplierId, "SUP-A");
  assert.equal(mapped.product.purchaseHistory.length, 2);
  assert.equal(mapped.sourceOnlyFields.suggestedReorderQuantity, 6);
  assert.equal(mapped.sourceOnlyFields.supplierTerms[0].minimumOrderQuantity, null);
  assert.deepEqual(mapped.unmappedFields, []);
  assert.ok(mapped.unavailableFields.includes("barcode"));

  const payload = makeMappedFlaskProductsPayload(
    { data_source: "MINI_MART_DEMO", count: 1, products: [source] },
    [mapped],
  );
  assert.equal(payload.dataSource, "FLASK_MINI_MART");
  assert.equal(payload.count, 1);
  assert.equal(payload.sourceStoreId, "krukkruk");
});

test("preserves explicitly unknown use, pack, and target data as null", () => {
  const unknownUsage = {
    ...source,
    product_id: "cleaner-liquid",
    name: "Cleaner Liquid",
    short_name: "Cleaner Liquid",
    unit: "bottle",
    pack_size: null,
    daily_usage: null,
    weekly_usage: null,
    estimated_days_until_stockout: null,
    reorder_level: 2,
    preferred_supplier_id: "SUP-A",
    last_purchase_price: 6.5,
    expiry_date: null,
    shelf_life_days: null,
    keywords: ["pencuci"],
  };
  const mapped = mapFlaskProductRecord(
    unknownUsage,
    detail(unknownUsage),
    {
      product_id: unknownUsage.product_id,
      product_name: unknownUsage.name,
      purchases: [],
    },
  );
  assert.equal(mapped.product.averageDailyUsage, null);
  assert.equal(mapped.product.weeklyUsage, null);
  assert.equal(mapped.product.expiryDate, null);
  assert.equal(mapped.sourceOnlyFields.packSize, null);
  assert.equal(mapped.sourceOnlyFields.excessInventoryQuantity, null);
});

test("rejects detail or purchase data that would attach to another product", () => {
  const mismatched = { ...source, product_id: "unrelated-product" };
  assert.throws(
    () => mapFlaskProductRecord(source, detail(mismatched), purchaseHistory([])),
    /did not match source product/,
  );
  assert.throws(
    () => mapFlaskProductRecord(source, detail(), {
      product_id: "unrelated-product",
      product_name: source.name,
      purchases: [],
    }),
    /purchase history did not match/,
  );
});

test("validates envelope count and rejects duplicate IDs", () => {
  assert.throws(
    () => parseFlaskProductsEnvelope({ data_source: "MINI_MART_DEMO", count: 2, products: [source] }),
    /count does not match/,
  );
  assert.throws(
    () => parseFlaskProductsEnvelope({
      data_source: "MINI_MART_DEMO",
      count: 2,
      products: [source, source],
    }),
    /duplicate product IDs/,
  );
});
