import type { Product } from "../types";
import { readCsv } from "./csv";
import { POS_MAX_BYTES, POS_ACCEPTED_STORE_IDS, type PosImportKind, type PosPreview, type PosRow } from "./types";

const COMMON = ["store_id", "product_id", "product_name", "stock_unit", "data_origin"];
const SALES = ["date", ...COMMON, "quantity_sold", "retail_unit_price_rm", "gross_sales_rm"];
const INVENTORY = ["as_of_date", ...COMMON, "current_stock"];
const MAX_ROWS = 25000;

export function calendarDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function shiftDay(value: string, offset: number): string {
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function number(value: string, whole: boolean): number {
  // No blank -> zero coercion, currency symbols, NaN, infinity, hex or exponents.
  if (!/^\d+(?:\.\d+)?$/.test(value)) return NaN;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000_000 && (!whole || Number.isSafeInteger(n)) ? n : NaN;
}

export function summarizeRows(kind: PosImportKind, rows: PosRow[], products: Product[]) {
  const dates = rows.map((r) => r.date).sort();
  const dateFrom = dates[0] ?? null;
  const dateTo = dates.at(-1) ?? null;
  const windowFrom = dateTo ? shiftDay(dateTo, -6) : null;
  const impacts = products.filter((p) => rows.some((r) => r.productId === p.productId)).map((p) => {
    const productRows = rows.filter((r) => r.productId === p.productId);
    const byDate = new Map(productRows.map((r) => [r.date, r.quantity]));
    let coveredDays = 0;
    let weeklyCoveredDays = 0;
    let currentTotal = 0;
    let previousTotal = 0;
    for (let day = 0; day < 14 && dateTo; day += 1) {
      const key = shiftDay(dateTo, -day);
      if (byDate.has(key)) {
        if (day < 7) { coveredDays += 1; currentTotal += byDate.get(key)!; }
        else { weeklyCoveredDays += 1; previousTotal += byDate.get(key)!; }
      }
    }
    return {
      productId: p.productId, productName: p.productName, stockUnit: p.stockUnit,
      coveredDays, weeklyCoveredDays,
      latestSevenTotal: kind === "sales" && coveredDays === 7 ? currentTotal : null,
      averageDailyUsage: kind === "sales" && coveredDays === 7 ? currentTotal / 7 : null,
      weeklyUsage: kind === "sales" && coveredDays === 7 && weeklyCoveredDays === 7
        ? { thisWeek: currentTotal, previousWeek: previousTotal } : null,
      currentStock: kind === "inventory" ? productRows.at(-1)!.quantity : null,
    };
  });
  return { dateFrom, dateTo, windowFrom, impacts };
}

export function previewPosCsv(text: string, fileName: string, kind: PosImportKind, products: Product[], maxBytes = POS_MAX_BYTES): PosPreview {
  const result: PosPreview = {
    kind, fileName, totalRows: 0, uniqueProducts: 0, matchedProducts: 0, rejectedRows: 0,
    dateFrom: null, dateTo: null, windowFrom: null, rows: [], issues: [], warnings: [], impacts: [], canImport: false,
  };
  function fatal(message: string) {
    result.issues.push({ rowNumber: 0, message });
    return result;
  }
  if (!/\.csv$/i.test(fileName)) return fatal("Choose a .csv file.");
  if (new TextEncoder().encode(text).length > maxBytes) return fatal("CSV files must be no larger than 2 MB.");
  let records: string[][];
  try { records = readCsv(text); }
  catch (error) { return fatal(error instanceof Error ? error.message : "Could not read this CSV."); }
  if (records.length < 2) return fatal("The CSV must contain a header and at least one data row.");
  const header = records[0].map((v) => v.toLowerCase());
  if (new Set(header).size !== header.length) return fatal("The CSV contains duplicate column headers.");
  const required = kind === "sales" ? SALES : INVENTORY;
  const missing = required.filter((name) => !header.includes(name));
  if (missing.length) return fatal(`Missing required columns: ${missing.join(", ")}.`);
  result.totalRows = records.length - 1;
  if (result.totalRows > MAX_ROWS) return fatal(`Use no more than ${MAX_ROWS.toLocaleString()} rows per CSV.`);
  const catalogue = new Map(products.map((p) => [p.productId, p]));
  const unique = new Set<string>();
  const matched = new Set<string>();
  const seen = new Set<string>();
  const snapshotDates = new Set<string>();
  let nameMismatch = false;
  for (let index = 1; index < records.length; index += 1) {
    const cells = records[index];
    const rowNumber = index + 1;
    const get = (name: string) => cells[header.indexOf(name)] ?? "";
    const productId = get("product_id");
    if (productId) unique.add(productId);
    const p = catalogue.get(productId);
    if (p) matched.add(productId);
    const errors: string[] = [];
    if (cells.length !== header.length) errors.push(`Expected ${header.length} columns, received ${cells.length}`);
    const date = get(kind === "sales" ? "date" : "as_of_date");
    if (!calendarDay(date)) errors.push("Use a valid YYYY-MM-DD date");
    if (!POS_ACCEPTED_STORE_IDS.includes(get("store_id"))) errors.push(`store_id must be ${POS_ACCEPTED_STORE_IDS.join(" or ")}`);
    if (!p) errors.push("Unknown or missing product_id; match the catalogue ID, not the name");
    const unit = get("stock_unit").toLowerCase();
    if (p && unit !== p.stockUnit && unit !== `${p.stockUnit}s`) errors.push(`Unit must be ${p.stockUnit} or ${p.stockUnit}s`);
    if (!get("product_name")) errors.push("product_name is required");
    if (!/(?:synthetic|demo)/i.test(get("data_origin"))) errors.push("data_origin must explicitly identify synthetic or demo data");
    const quantity = number(get(kind === "sales" ? "quantity_sold" : "current_stock"), true);
    if (!Number.isFinite(quantity)) errors.push("Quantity must be a non-negative whole number");
    const retailUnitPrice = kind === "sales" ? number(get("retail_unit_price_rm"), false) : null;
    const grossSales = kind === "sales" ? number(get("gross_sales_rm"), false) : null;
    if (retailUnitPrice != null && !Number.isFinite(retailUnitPrice)) errors.push("retail_unit_price_rm must be a non-negative number");
    if (grossSales != null && !Number.isFinite(grossSales)) errors.push("gross_sales_rm must be a non-negative number");
    if (kind === "sales" && Number.isFinite(quantity) && retailUnitPrice != null && grossSales != null && Number.isFinite(retailUnitPrice) && Number.isFinite(grossSales)) {
      const expected = Math.round((quantity * retailUnitPrice + Number.EPSILON) * 100) / 100;
      if (Math.abs(grossSales - expected) > 0.01000001)
        errors.push(`gross_sales_rm ${grossSales.toFixed(2)} does not match quantity_sold × retail_unit_price_rm (${quantity} × ${retailUnitPrice} = RM ${expected.toFixed(2)}; tolerance RM 0.01)`);
    }
    const key = kind === "sales" ? `${date}:${productId}` : productId;
    if (seen.has(key)) errors.push("Duplicate product/date record; provide one daily aggregate per product (one row per product for a snapshot)");
    seen.add(key);
    if (errors.length) {
      result.rejectedRows += 1;
      result.issues.push({ rowNumber, message: errors.join(". ") + "." });
      continue;
    }
    if (p && get("product_name").toLowerCase() !== p.productName.toLowerCase()) nameMismatch = true;
    snapshotDates.add(date);
    result.rows.push({
      rowNumber, date, storeId: get("store_id"), productId, productName: p!.productName,
      stockUnit: p!.stockUnit, quantity, retailUnitPrice, grossSales, dataOrigin: get("data_origin"),
    });
  }
  result.uniqueProducts = unique.size;
  result.matchedProducts = matched.size;
  Object.assign(result, summarizeRows(kind, result.rows, products));
  if (kind === "inventory" && snapshotDates.size > 1) {
    return fatal("An inventory snapshot must use one as_of_date for every row. Upload separate snapshots separately.");
  }
  if (result.matchedProducts < products.length) result.warnings.push(
    `${products.length - result.matchedProducts} catalogue products are absent. Their ${kind === "sales" ? "usage estimates" : "stock levels"} stay at the original demo values, not zero.`,
  );
  if (nameMismatch) result.warnings.push("Some names differ from the catalogue. Matching uses product_id; catalogue names are preserved.");
  if (kind === "sales") {
    const incomplete = result.impacts.filter((p) => p.coveredDays < 7);
    if (incomplete.length) result.warnings.push(`${incomplete.length} matched products lack all 7 calendar dates in the latest window. Their usage and order estimate will be unknown, not zero.`);
    const noTrend = result.impacts.filter((p) => !p.weeklyUsage);
    if (noTrend.length) result.warnings.push(`${noTrend.length} matched products lack two complete 7-day windows. No week-on-week trend will be calculated for them.`);
    result.warnings.push("Only explicit daily rows establish coverage, including quantity_sold = 0. Missing dates are not assumed to have zero sales. Current stock is unchanged.");
  } else result.warnings.push("This sets stock directly as of the snapshot date. Imported sales are never subtracted from this stock.");
  if (result.rejectedRows) result.warnings.push("Import is blocked until all rejected rows are fixed. No partial file will be applied.");
  result.canImport = result.rows.length > 0 && result.rejectedRows === 0 && !result.issues.length;
  return result;
}
