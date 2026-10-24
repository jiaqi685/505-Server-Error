import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { MockAdapter } from "../adapters/mock";
import { buildSeedProducts } from "../seed";
import { insightFor } from "../../lib/inventory";
import { readCsv } from "./csv";
import { previewPosCsv } from "./preview";
import { applyPosState, emptyPosState, makeDataset, POS_STORAGE_KEY } from "./storage";
import { confirmWorkflowPreservation } from "./workflow-preservation.test-support";
import { newRfqDefaultQuantity } from "../../lib/procurement-safety";

// Test the original attachment directly: no substitutions or rewritten CSV data.
const zip = fileURLToPath(new URL("../../../../../attached_assets/NGate_POS_Demo_Data_2026-10-21_1792688221160.zip", import.meta.url));
const text = (name: string) => execFileSync("unzip", ["-p", zip, name], { encoding: "utf8" });
function records(name: string) {
  const [header, ...rows] = readCsv(text(name));
  return rows.map((row) => Object.fromEntries(header.map((key, index) => [key, row[index]])));
}
const baselineName = "01_pos_sales_daily_30d_BASELINE.csv";
const spikeName = "04_pos_sales_daily_30d_RICE_SPIKE.csv";
const inventoryName = "02_inventory_snapshot_22_products.csv";
const products = buildSeedProducts();
const baseline = text(baselineName);
const spike = text(spikeName);
const inventory = text(inventoryName);

for (const resetKind of ["sales", "inventory", undefined] as const) {
  test(`supplied baseline/spike imports and ${resetKind ?? "all"} reset preserve populated workflows byte-for-byte`, async (t) => {
    await confirmWorkflowPreservation(t, {
      baseline, spike, inventory, baselineName, spikeName, inventoryName,
    }, resetKind);
  });
}

test("supplied 22-product mapping matches catalogue IDs, units, suppliers and existing policy", () => {
  const mapping = records("03_product_mapping_22_products.csv");
  assert.equal(mapping.length, 22);
  assert.equal(new Set(mapping.map((r) => r.product_id)).size, 22);
  for (const row of mapping) {
    const p = products.find((p) => p.productId === row.product_id);
    assert.ok(p, row.product_id);
    assert.equal(p.productName, row.product_name);
    assert.equal(p.category, row.category);
    assert.equal(p.stockUnit, row.stock_unit);
    assert.equal(p.preferredSupplierId, row.preferred_supplier_id);
    assert.equal(p.supplierLeadTimeDays, Number(row.lead_time_days));
    assert.equal(p.reorderLevel, Number(row.reorder_level));
  }
});

for (const [name, sales, expectedFile, order] of [
  [baselineName, baseline, "05_computed_inventory_metrics_BASELINE.csv", 9],
  [spikeName, spike, "06_computed_inventory_metrics_RICE_SPIKE.csv", 17],
] as const) {
  test(`supplied ${name} and snapshot reproduce all 22 expected metric rows`, () => {
    const salesPreview = previewPosCsv(sales, name, "sales", products);
    const stockPreview = previewPosCsv(inventory, inventoryName, "inventory", products);
    assert.equal(salesPreview.canImport, true, JSON.stringify(salesPreview.issues));
    assert.equal(stockPreview.canImport, true, JSON.stringify(stockPreview.issues));
    assert.equal(salesPreview.totalRows, 630);
    assert.equal(salesPreview.matchedProducts, 21);
    assert.equal(salesPreview.rejectedRows, 0);
    assert.equal(stockPreview.totalRows, 22);
    assert.equal(stockPreview.matchedProducts, 22);
    assert.equal(salesPreview.dateFrom, "2026-09-22");
    assert.equal(salesPreview.dateTo, "2026-10-21");
    assert.equal(salesPreview.windowFrom, "2026-10-15");
    assert.ok(salesPreview.rows.every((r) => r.storeId === "KRUKKRUK_MINI_MART_DEMO"));
    const imported = applyPosState(products, {
      version: 1,
      sales: makeDataset("sales", name, salesPreview.rows),
      inventory: makeDataset("inventory", inventoryName, stockPreview.rows),
    });
    const expected = records(expectedFile);
    assert.equal(expected.length, 22);
    for (const row of expected) {
      const p = imported.find((p) => p.productId === row.product_id)!;
      const original = products.find((p) => p.productId === row.product_id)!;
      const i = insightFor(p);
      assert.equal(p.currentStock, Number(row.current_stock), p.productId);
      assert.equal(p.averageDailyUsage, row.avg_daily_sales_latest_7d === "" ? null : Number(row.avg_daily_sales_latest_7d), p.productId);
      assert.equal(p.weeklyUsage?.thisWeek ?? null, row.latest_7d_units_sold === "" ? null : Number(row.latest_7d_units_sold), p.productId);
      assert.equal(p.weeklyUsage?.previousWeek ?? null, row.previous_7d_units_sold === "" ? null : Number(row.previous_7d_units_sold), p.productId);
      assert.equal(i.targetStock, row.reorder_target_units === "" ? null : Number(row.reorder_target_units), p.productId);
      assert.equal(i.daysOfCover == null ? null : Number(i.daysOfCover.toFixed(2)), row.stock_cover_days === "" ? null : Number(row.stock_cover_days), p.productId);
      assert.equal(i.suggestedOrderQuantity, row.suggested_order_units === "" ? null : Number(row.suggested_order_units), p.productId);
      // Fictional checkout prices must never overwrite supplier purchase prices.
      assert.equal(p.lastPurchasePrice, original.lastPurchasePrice);
      assert.deepEqual(p.suppliers, original.suppliers);
      assert.deepEqual(p.purchaseHistory, original.purchaseHistory);
    }
    assert.equal(insightFor(imported.find((p) => p.productId === "premium-fragrant-rice")!).suggestedOrderQuantity, order);
    const cleaner = imported.find((p) => p.productId === "cleaner-liquid")!;
    assert.equal(cleaner.averageDailyUsage, null);
    assert.equal(cleaner.currentStock, 6);
    assert.equal(insightFor(cleaner).suggestedOrderQuantity, null);
  });
}

test("supplied CSVs replace in adapter, persist with original store ID, and append audit events only on confirmation", async () => {
  const memory = new Map<string, string>();
  const storage = {
    get length() { return memory.size; },
    clear: () => memory.clear(),
    key: (index: number) => [...memory.keys()][index] ?? null,
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); },
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  const adapter = new MockAdapter(0);
  adapter.setOwnerId("supplied-dataset-owner");
  const rice = () => adapter.getProductDetails("premium-fragrant-rice");
  const file = (body: string, name: string) => new File([body], name, { type: "text/csv" });
  const stockPreview = await adapter.previewPosImport(file(inventory, inventoryName), "inventory");
  assert.equal((await adapter.getActivityHistory()).length, 0);
  await adapter.confirmPosImport(stockPreview);
  await adapter.confirmPosImport(await adapter.previewPosImport(file(baseline, baselineName), "sales"));
  assert.equal(insightFor((await rice())!).suggestedOrderQuantity, 9);
  assert.equal(newRfqDefaultQuantity(insightFor((await rice())!).suggestedOrderQuantity, (await rice())!.reorderLevel), 9);
  const preview = await adapter.previewPosImport(file(spike, spikeName), "sales");
  assert.equal(insightFor((await rice())!).suggestedOrderQuantity, 9);
  assert.equal((await adapter.getActivityHistory()).length, 2);
  await adapter.confirmPosImport(preview);
  assert.equal(insightFor((await rice())!).suggestedOrderQuantity, 17);
  assert.equal(newRfqDefaultQuantity(insightFor((await rice())!).suggestedOrderQuantity, (await rice())!.reorderLevel), 17);
  assert.equal((await rice())!.currentStock, 3);
  assert.equal((await adapter.getPosImportState()).sales!.rows.length, 630);
  const restored = new MockAdapter(0);
  restored.setOwnerId("supplied-dataset-owner");
  const reloadedRice = (await restored.getProductDetails("premium-fragrant-rice"))!;
  assert.equal(insightFor(reloadedRice).suggestedOrderQuantity, 17);
  assert.equal(reloadedRice.posData!.dateTo, "2026-10-21");
  assert.ok((await restored.getActivityHistory()).some((entry) => entry.details?.includes(spikeName)));
  const persisted = JSON.parse(storage.getItem(`${POS_STORAGE_KEY}:supplied-dataset-owner`)!);
  assert.equal(persisted.sales.rows.length, 630);
  assert.equal(persisted.sales.rows[0].storeId, "KRUKKRUK_MINI_MART_DEMO");
  await restored.resetPosImport();
  assert.deepEqual(await restored.getPosImportState(), emptyPosState());
  assert.equal((await restored.getActivityHistory()).length, 4);
  assert.equal(insightFor((await restored.getProductDetails("premium-fragrant-rice"))!).suggestedOrderQuantity, 9);
});

test("supporting the supplied store alias does not accept unknown stores or duplicate daily records", () => {
  const foreign = previewPosCsv(baseline.replaceAll("KRUKKRUK_MINI_MART_DEMO", "UNRELATED_STORE"), baselineName, "sales", products);
  assert.equal(foreign.canImport, false);
  assert.equal(foreign.rejectedRows, 630);
  const duplicate = previewPosCsv(`${baseline.trim()}\n${baseline.split(/\r?\n/)[1]}`, baselineName, "sales", products);
  assert.equal(duplicate.canImport, false);
  assert.ok(duplicate.issues.some((issue) => /duplicate/i.test(issue.message)));
});
