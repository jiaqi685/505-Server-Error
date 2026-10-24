import type { Product } from "../types";

export type PosImportKind = "sales" | "inventory";
export const POS_SOURCE = "Synthetic POS Demo Data";
export const POS_STORE_ID = "krukkruk";
/** Explicit aliases for this one fictional store, not arbitrary multi-store input. */
export const POS_ACCEPTED_STORE_IDS: readonly string[] = [POS_STORE_ID, "KRUKKRUK_MINI_MART_DEMO"];
export const POS_MAX_BYTES = 2 * 1024 * 1024;

export interface PosRow {
  rowNumber: number;
  date: string;
  storeId: string;
  productId: string;
  productName: string;
  stockUnit: string;
  quantity: number;
  retailUnitPrice: number | null;
  grossSales: number | null;
  dataOrigin: string;
}

export interface PosIssue {
  rowNumber: number;
  message: string;
}

export interface PosProductImpact {
  productId: string;
  productName: string;
  stockUnit: string;
  coveredDays: number;
  weeklyCoveredDays: number;
  latestSevenTotal: number | null;
  averageDailyUsage: number | null;
  weeklyUsage: Product["weeklyUsage"];
  currentStock: number | null;
}

export interface PosPreview {
  kind: PosImportKind;
  fileName: string;
  totalRows: number;
  uniqueProducts: number;
  matchedProducts: number;
  rejectedRows: number;
  dateFrom: string | null;
  dateTo: string | null;
  windowFrom: string | null;
  rows: PosRow[];
  issues: PosIssue[];
  warnings: string[];
  impacts: PosProductImpact[];
  canImport: boolean;
}

export interface PosDataset {
  kind: PosImportKind;
  fileName: string;
  importedAt: string;
  source: typeof POS_SOURCE;
  rows: PosRow[];
}

export interface PosImportState {
  version: 1;
  sales: PosDataset | null;
  inventory: PosDataset | null;
}

export interface PosProvenance {
  retailUnitPrice?: number;
  retailPriceDate?: string;
  salesFileName?: string;
  salesImportedAt?: string;
  dateFrom?: string;
  dateTo?: string;
  windowFrom?: string;
  coveredDays?: number;
  latestSevenTotal?: number | null;
  inventoryFileName?: string;
  inventoryImportedAt?: string;
  inventoryAsOf?: string;
}
