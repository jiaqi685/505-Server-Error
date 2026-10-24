import assert from "node:assert/strict";
import test from "node:test";
import { buildSeedProducts } from "../seed";
import { MockAdapter } from "../adapters/mock";
import { alertsFor, buildDashboard, insightFor } from "../../lib/inventory";
import { freshnessMessages, riceSpecificationReview } from "../../lib/pos-quality";
import { readCsv } from "./csv";
import { previewPosCsv } from "./preview";
import { syntheticInventoryCsv, syntheticSalesCsv } from "./fixtures";
import { applyPosState, emptyPosState, makeDataset, POS_STORAGE_KEY } from "./storage";
import { confirmWorkflowPreservation } from "./workflow-preservation.test-support";

const products = buildSeedProducts();
const riceId = "premium-fragrant-rice";
const baseline = syntheticSalesCsv(3);
const spike = syntheticSalesCsv(5);
const rice = (all: typeof products) => all.find((p) => p.productId === riceId)!;
const parse = (text = baseline) => previewPosCsv(text, "test.csv", "sales", products);

for (const resetKind of ["sales", "inventory", undefined] as const) {
  test(`synthetic baseline/spike imports and ${resetKind ?? "all"} reset preserve populated workflows byte-for-byte`, async (t) => {
    await confirmWorkflowPreservation(t, {
      baseline, spike, inventory: syntheticInventoryCsv(50),
      baselineName: "baseline.csv", spikeName: "spike.csv", inventoryName: "stock.csv",
    }, resetKind);
  });
}

test("baseline and rice spike use latest seven calendar days and existing formula", () => {
  for (const [text, average, order] of [[baseline, 3, 9], [spike, 5, 17]] as const) {
    const preview = parse(text);
    assert.equal(preview.canImport, true);
    assert.equal(preview.totalRows, 660);
    assert.equal(preview.matchedProducts, 22);
    assert.equal(preview.dateFrom, "2026-10-01");
    assert.equal(preview.dateTo, "2026-10-30");
    assert.equal(preview.windowFrom, "2026-10-24");
    const state = { ...emptyPosState(), sales: makeDataset("sales", "test.csv", preview.rows) };
    const p = rice(applyPosState(products, state));
    assert.equal(p.averageDailyUsage, average);
    assert.equal(p.weeklyUsage!.previousWeek, 21);
    assert.equal(p.weeklyUsage!.thisWeek, average * 7);
    assert.equal(p.currentStock, 3);
    assert.equal(insightFor(p).suggestedOrderQuantity, order);
    assert.equal(insightFor(p).daysOfCover, 3 / average);
    assert.equal(insightFor(p).stockoutRisk, true);
    assert.deepEqual(p.suppliers, rice(products).suppliers);
    assert.deepEqual(p.purchaseHistory, rice(products).purchaseHistory);
    assert.equal(p.lastPurchasePrice, rice(products).lastPurchasePrice);
  }
});

test("BOM, CRLF, quoted commas, escaped quotes and reordered columns", () => {
  assert.deepEqual(readCsv('\uFEFFa,b\r\n"rice, ""premium""",2\r\n'), [["a", "b"], ['rice, "premium"', "2"]]);
  const lines = baseline.split("\n").map((line) => line.split(",").reverse().join(","));
  assert.equal(parse(lines.join("\n")).canImport, true);
});

test("missing headers, empty data and malformed quoting are rejected clearly", () => {
  for (const text of ["", "date,product_id\n2026-10-01,x", baseline.slice(0, baseline.indexOf("\n")), 'a,b\n"broken']) {
    const preview = parse(text);
    assert.equal(preview.canImport, false);
    assert.ok(preview.issues.length > 0);
  }
  assert.equal(previewPosCsv(baseline, "not.csv.txt", "sales", products).canImport, false);
});

test("invalid values and negative quantities reject the whole file", () => {
  const tests: [number, string][] = [
    [0, "2026-02-30"], [0, ""], [1, "another-store"], [2, "rice-not-an-id"], [3, ""],
    [4, "carton"], [5, "-1"], [5, "NaN"], [5, ""], [5, "1.5"], [5, "Infinity"],
    [6, "-3"], [6, ""], [7, "not-a-number"], [8, "real_pos"],
  ];
  for (const [column, invalid] of tests) {
    const lines = baseline.split("\n");
    const fields = lines[1].split(",");
    fields[column] = invalid;
    lines[1] = fields.join(",");
    const preview = parse(lines.join("\n"));
    assert.equal(preview.canImport, false, `column ${column}: ${invalid}`);
    assert.equal(preview.rejectedRows, 1);
    assert.ok(preview.issues[0].message);
  }
});

test("duplicate daily records are rejected, never summed twice", () => {
  const preview = parse(baseline + "\n" + baseline.split("\n")[1]);
  assert.equal(preview.canImport, false);
  assert.equal(preview.rejectedRows, 1);
  assert.match(preview.issues[0].message, /Duplicate/);
});

test("incomplete recent dates produce null usage, not zero or old demo demand", () => {
  const partial = baseline.split("\n").filter((line) => !line.startsWith("2026-10-25,krukkruk,premium-fragrant-rice,")).join("\n");
  const preview = parse(partial);
  assert.equal(preview.canImport, true);
  const impact = preview.impacts.find((p) => p.productId === riceId)!;
  assert.equal(impact.coveredDays, 6);
  assert.equal(impact.averageDailyUsage, null);
  const p = rice(applyPosState(products, { ...emptyPosState(), sales: makeDataset("sales", "partial.csv", preview.rows) }));
  assert.equal(p.averageDailyUsage, null);
  assert.equal(p.weeklyUsage, null);
  assert.equal(insightFor(p).suggestedOrderQuantity, null);
});

test("explicit zero-sale days count toward seven-day coverage", () => {
  const preview = parse(syntheticSalesCsv(0));
  const impact = preview.impacts.find((p) => p.productId === riceId)!;
  assert.equal(impact.coveredDays, 7);
  assert.equal(impact.averageDailyUsage, 0);
  assert.equal(impact.latestSevenTotal, 0);
  const imported = applyPosState(products, { ...emptyPosState(), sales: makeDataset("sales", "zero.csv", preview.rows) });
  const p = rice(imported);
  const i = insightFor(p);
  assert.equal(i.hasUsageData, true);
  assert.equal(i.zeroDemand, true);
  assert.equal(i.status, "zero-demand");
  assert.equal(i.targetStock, 0);
  assert.equal(i.suggestedOrderQuantity, 0);
  assert.equal(i.daysOfCover, null);
  assert.equal(i.needsReplenishment, false);
  assert.equal(i.stockoutRisk, false);
  assert.equal(i.excessQuantity, 0);
  assert.ok(!alertsFor(i).some((a) => a.kind === "no-usage-data"));
});

test("positive orders above static reorder level show Reorder recommended consistently", () => {
  const p = { ...rice(products), currentStock: 10 };
  const i = insightFor(p);
  assert.equal(i.belowReorderLevel, false);
  assert.equal(i.suggestedOrderQuantity, 2);
  assert.equal(i.stockoutRisk, false);
  assert.equal(i.needsReplenishment, true);
  assert.equal(i.status, "reorder-recommended");
  assert.ok(alertsFor(i).some((a) => a.title === "Reorder recommended"));
  const dashboard = buildDashboard([p], [], [], []);
  assert.equal(dashboard.insights[0].status, i.status);
  assert.equal(dashboard.lowStockCount, 1);
  assert.equal(dashboard.top?.suggestedOrderQuantity, 2);
});

test("stockout risk is strictly below lead time; target stock and zero demand do not request zero orders", () => {
  const p = rice(products);
  assert.equal(insightFor({ ...p, currentStock: 6 }).status, "reorder-recommended");
  assert.equal(insightFor({ ...p, currentStock: 5 }).status, "stockout-risk");
  assert.equal(insightFor({ ...p, currentStock: 12 }).status, "ok");
  const zero = insightFor({ ...p, currentStock: 0, averageDailyUsage: 0 });
  assert.equal(zero.status, "zero-demand");
  assert.equal(zero.needsReplenishment, false);
  const unknown = insightFor({ ...p, averageDailyUsage: null });
  assert.equal(unknown.status, "no-usage-data");
  assert.equal(unknown.hasUsageData, false);
  assert.equal(unknown.suggestedOrderQuantity, null);
});

test("sales amounts allow one sen rounding tolerance and reject inconsistent totals", () => {
  const header = "date,store_id,product_id,product_name,stock_unit,quantity_sold,retail_unit_price_rm,gross_sales_rm,data_origin";
  const row = (quantity: number, price: number, gross: number) => `${header}\n2026-10-21,krukkruk,${riceId},Premium Fragrant Rice,bag,${quantity},${price},${gross},synthetic_demo`;
  assert.equal(parse(row(3, 12.2, 36.6)).canImport, true);
  assert.equal(parse(row(3, 0.335, 1.01)).canImport, true);
  assert.equal(parse(row(3, 12.2, 36.61)).canImport, true);
  for (const csv of [row(3, 12.2, 36.62), row(0, 12.2, 1), row(3, 12.2, 0)]) {
    const preview = parse(csv);
    assert.equal(preview.canImport, false);
    assert.equal(preview.rejectedRows, 1);
    assert.match(preview.issues[0].message, /does not match quantity_sold/);
  }
});

test("freshness is based on measurement dates and warns for each stale source", () => {
  const warnings = freshnessMessages("2026-10-21", "2026-10-20", "2026-10-23");
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /Outdated sales.*2 calendar days/);
  assert.match(warnings[1], /Outdated inventory snapshot.*not verified real-time stock/);
  assert.deepEqual(freshnessMessages("2026-10-22", "2026-10-23", "2026-10-23"), []);
  assert.deepEqual(freshnessMessages(undefined, undefined, "2026-10-23"), []);
  assert.match(freshnessMessages("2026-10-24", undefined, "2026-10-23")[0], /Future-dated/);
});

test("rice specification review flags unverified packs and retail below demo quotes without changing history", () => {
  const p = { ...rice(products), posData: { retailUnitPrice: 12.2, retailPriceDate: "2026-10-21" } };
  const before = JSON.stringify(p);
  const review = riceSpecificationReview(p);
  assert.equal(review.sku, riceId);
  assert.equal(review.packWeight, null);
  assert.equal(review.retail, 12.2);
  assert.equal(review.historical[0].unitPrice, 10);
  assert.equal(review.examples.find((q) => q.supplierName === "Supplier A")!.unitPrice, 12.5);
  assert.equal(review.belowExamplePrice, true);
  assert.equal(JSON.stringify(p), before);
});

test("under seven days has unknown usage and under fourteen days has no trend", () => {
  const p6 = parse(syntheticSalesCsv(3, 6)).impacts[0];
  assert.equal(p6.averageDailyUsage, null);
  const p10 = parse(syntheticSalesCsv(3, 10)).impacts[0];
  assert.equal(p10.averageDailyUsage, 3);
  assert.equal(p10.weeklyUsage, null);
});

test("unmatched absent products keep original demo estimates with an explicit warning", () => {
  const onlyRice = baseline.split("\n").filter((line, i) => i === 0 || line.includes(`,${riceId},`)).join("\n");
  const preview = parse(onlyRice);
  assert.equal(preview.matchedProducts, 1);
  assert.match(preview.warnings[0], /21 catalogue products are absent/);
  const after = applyPosState(products, { ...emptyPosState(), sales: makeDataset("sales", "rice.csv", preview.rows) });
  assert.deepEqual(after.find((p) => p.productId === "drinking-water"), products.find((p) => p.productId === "drinking-water"));
});

test("unit plurals accepted but no packaging conversion or name-only matching", () => {
  assert.equal(parse(baseline.replace(",bag,", ",bags,")).canImport, true);
  assert.equal(parse(baseline.replace(riceId, "unknown-rice")).canImport, false);
});

test("snapshot dates, negative stock and duplicate products are checked", () => {
  const preview = previewPosCsv(syntheticInventoryCsv(), "stock.csv", "inventory", products);
  assert.equal(preview.canImport, true);
  assert.equal(preview.impacts[0].currentStock, 3);
  const mixed = syntheticInventoryCsv() + "\n2026-10-29,krukkruk,drinking-water,Drinking Water,bottle,20,synthetic_demo";
  assert.equal(previewPosCsv(mixed, "stock.csv", "inventory", products).canImport, false);
  assert.equal(previewPosCsv(syntheticInventoryCsv(-3), "stock.csv", "inventory", products).canImport, false);
});

test("oversized files and duplicate header names are rejected", () => {
  assert.equal(parse(" ".repeat(2 * 1024 * 1024 + 1)).canImport, false);
  assert.equal(parse(baseline.replace("date,", "product_id,")).canImport, false);
});

const memory = new Map<string, string>();
const storage: Storage = {
  get length() { return memory.size; },
  clear: () => memory.clear(),
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => { memory.set(key, value); },
  removeItem: (key) => { memory.delete(key); },
  key: (index) => [...memory.keys()][index] ?? null,
};
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });

function salesFile(text: string, name = "sales.csv") { return new File([text], name, { type: "text/csv" }); }

test("adapter previews without writes; confirmed second import replaces, survives reload; reset preserves workflows", async () => {
  memory.clear();
  const adapter = new MockAdapter(0);
  adapter.setOwnerId("test-owner");
  const before = await adapter.getProductDetails(riceId);
  const preview = await adapter.previewPosImport(salesFile(spike), "sales");
  assert.deepEqual(await adapter.getProductDetails(riceId), before);
  assert.equal(storage.getItem(`${POS_STORAGE_KEY}:test-owner`), null);
  await adapter.logActivity({ action: "Existing workflow", status: "Preserved", details: "Do not delete this" });
  await adapter.confirmPosImport(preview);
  assert.equal((await adapter.getProductDetails(riceId))!.averageDailyUsage, 5);
  assert.equal(rice((await adapter.getDashboardData()).products).averageDailyUsage, 5);
  assert.equal(rice(await adapter.getProducts()).averageDailyUsage, 5);
  await adapter.confirmPosImport(await adapter.previewPosImport(salesFile(baseline), "sales"));
  assert.equal((await adapter.getProductDetails(riceId))!.averageDailyUsage, 3);
  assert.equal((await adapter.getPosImportState()).sales!.rows.length, 660);
  const reloaded = new MockAdapter(0);
  reloaded.setOwnerId("test-owner");
  assert.equal((await reloaded.getPosImportState()).sales!.rows.length, 660);
  assert.equal((await reloaded.getProductDetails(riceId))!.averageDailyUsage, 3);
  await reloaded.resetPosImport();
  assert.deepEqual(await reloaded.getProductDetails(riceId), rice(products));
  const activity = await reloaded.getActivityHistory();
  assert.equal(activity.length, 4);
  assert.ok(activity.some((entry) => entry.action === "Existing workflow"));
  assert.equal(activity.filter((entry) => entry.action === "Synthetic POS CSV imported").length, 2);
  assert.equal(activity.filter((entry) => entry.action === "Synthetic POS import reset").length, 1);
});

test("stock snapshots are independent and sales are never deducted a second time", async () => {
  memory.clear();
  const adapter = new MockAdapter(0);
  adapter.setOwnerId("snapshot-owner");
  await adapter.confirmPosImport(await adapter.previewPosImport(salesFile(syntheticInventoryCsv(50), "stock.csv"), "inventory"));
  assert.equal((await adapter.getProductDetails(riceId))!.currentStock, 50);
  await adapter.confirmPosImport(await adapter.previewPosImport(salesFile(spike), "sales"));
  const p = (await adapter.getProductDetails(riceId))!;
  assert.equal(p.currentStock, 50);
  assert.equal(p.averageDailyUsage, 5);
  await adapter.resetPosImport("sales");
  assert.equal((await adapter.getProductDetails(riceId))!.currentStock, 50);
  assert.equal((await adapter.getProductDetails(riceId))!.averageDailyUsage, 3);
  await adapter.resetPosImport("inventory");
  assert.equal((await adapter.getProductDetails(riceId))!.currentStock, 3);
});

test("owner switching isolates imports and rejects stale previews", async () => {
  memory.clear();
  const adapter = new MockAdapter(0);
  adapter.setOwnerId("owner-a");
  const preview = await adapter.previewPosImport(salesFile(spike), "sales");
  await adapter.confirmPosImport(preview);
  adapter.setOwnerId("owner-b");
  assert.equal((await adapter.getProductDetails(riceId))!.averageDailyUsage, 3);
  await assert.rejects(adapter.confirmPosImport(preview), /current account/);
  adapter.setOwnerId("owner-a");
  assert.equal((await adapter.getProductDetails(riceId))!.averageDailyUsage, 5);
});

test("quota failures and invalid previews leave current state untouched", async () => {
  memory.clear();
  const adapter = new MockAdapter(0);
  adapter.setOwnerId("quota-owner");
  const preview = await adapter.previewPosImport(salesFile(spike), "sales");
  const original = storage.setItem;
  storage.setItem = () => { throw new Error("quota"); };
  await assert.rejects(adapter.confirmPosImport(preview), /No import was applied/);
  storage.setItem = original;
  assert.equal((await adapter.getProductDetails(riceId))!.averageDailyUsage, 3);
  const invalid = await adapter.previewPosImport(salesFile("not,a,valid\nfile,at,all"), "sales");
  await assert.rejects(adapter.confirmPosImport(invalid), /rejected rows/);
  assert.equal((await adapter.getProductDetails(riceId))!.averageDailyUsage, 3);
});

test("corrupt saved POS data reports a recoverable error and never deletes business records", async () => {
  memory.clear();
  storage.setItem(`${POS_STORAGE_KEY}:corrupt-owner`, "{bad json");
  const adapter = new MockAdapter(0);
  adapter.setOwnerId("corrupt-owner");
  await assert.rejects(adapter.getPosImportState(), /could not be restored/);
  assert.equal((await adapter.getProductDetails(riceId))!.averageDailyUsage, 3);
  await adapter.resetPosImport();
  assert.deepEqual(await adapter.getPosImportState(), emptyPosState());
});
