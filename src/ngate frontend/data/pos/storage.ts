import type { Product } from "../types";
import { previewPosCsv, summarizeRows } from "./preview";
import { POS_SOURCE, type PosDataset, type PosImportKind, type PosImportState, type PosRow } from "./types";

export const POS_STORAGE_KEY = "ngate-pos-demo-v1";
export const emptyPosState = (): PosImportState => ({ version: 1, sales: null, inventory: null });

/** Serialize normalized records for validation again at confirmation/restoration. */
export function datasetCsv(kind: PosImportKind, rows: PosRow[]): string {
  const header = kind === "sales"
    ? ["date", "store_id", "product_id", "product_name", "stock_unit", "quantity_sold", "retail_unit_price_rm", "gross_sales_rm", "data_origin"]
    : ["as_of_date", "store_id", "product_id", "product_name", "stock_unit", "current_stock", "data_origin"];
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [header.join(","), ...rows.map((r) => {
    const values: unknown[] = [r.date, r.storeId, r.productId, r.productName, r.stockUnit, r.quantity];
    if (kind === "sales") values.push(r.retailUnitPrice, r.grossSales);
    values.push(r.dataOrigin);
    return values.map(escape).join(",");
  })].join("\n");
}

export function loadPosState(key: string, products: Product[]): PosImportState {
  if (typeof localStorage === "undefined") return emptyPosState();
  const raw = localStorage.getItem(key);
  if (!raw) return emptyPosState();
  const state = JSON.parse(raw) as PosImportState;
  if (state.version !== 1) throw new Error("Unsupported POS import storage version.");
  for (const kind of ["sales", "inventory"] as const) {
    const value = state[kind];
    if (value === null) continue;
    if (!value || value.kind !== kind || value.source !== POS_SOURCE || !Array.isArray(value.rows)
      || typeof value.fileName !== "string" || !Number.isFinite(Date.parse(value.importedAt))) {
      throw new Error("Saved POS import data is incomplete.");
    }
    // Canonical quoting can expand an otherwise valid 2 MB uploaded file.
    const preview = previewPosCsv(datasetCsv(kind, value.rows), value.fileName, kind, products, 6 * 1024 * 1024);
    if (!preview.canImport) throw new Error("Saved POS import data failed validation.");
    value.rows = preview.rows;
  }
  return state;
}

export function applyPosState(products: Product[], state: PosImportState): Product[] {
  const sales = state.sales ? summarizeRows("sales", state.sales.rows, products) : null;
  const salesById = new Map(sales?.impacts.map((p) => [p.productId, p]));
  const stockById = new Map(state.inventory?.rows.map((r) => [r.productId, r]));
  return products.map((product) => {
    const p = { ...product };
    const usage = salesById.get(p.productId);
    const stock = stockById.get(p.productId);
    if (usage && state.sales && sales) {
      const latestSale = state.sales.rows.filter((r) => r.productId === p.productId).sort((a, b) => b.date.localeCompare(a.date))[0];
      p.averageDailyUsage = usage.averageDailyUsage;
      p.weeklyUsage = usage.weeklyUsage;
      p.posData = {
        salesFileName: state.sales.fileName, salesImportedAt: state.sales.importedAt,
        dateFrom: sales.dateFrom!, dateTo: sales.dateTo!, windowFrom: sales.windowFrom!,
        coveredDays: usage.coveredDays, latestSevenTotal: usage.latestSevenTotal,
        retailUnitPrice: latestSale?.retailUnitPrice ?? undefined, retailPriceDate: latestSale?.date,
      };
    }
    if (stock && state.inventory) {
      p.currentStock = stock.quantity;
      p.posData = {
        ...p.posData, inventoryFileName: state.inventory.fileName,
        inventoryImportedAt: state.inventory.importedAt, inventoryAsOf: stock.date,
      };
    }
    return p;
  });
}

export function makeDataset(kind: PosImportKind, fileName: string, rows: PosRow[]): PosDataset {
  return { kind, fileName, rows, source: POS_SOURCE, importedAt: new Date().toISOString() };
}
