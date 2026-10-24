import type { Product, PurchaseOrder, QuotationRequest, SupplierQuote } from "@/data/types";
import { money, plural, qtyText, roundMoney } from "./format";

/**
 * Explainable inventory maths. Pure functions, deterministic.
 *
 *   daysOfCover            = currentStock / averageDailyUsage
 *   stockout risk          = daysOfCover < supplierLeadTimeDays
 *   targetStock            = averageDailyUsage × (leadTimeDays + safetyStockDays)
 *   suggestedOrderQuantity = max(0, ceil(targetStock − currentStock))
 *   overstock limit        = averageDailyUsage × overstockCoverageDays
 *   excessQuantity         = max(0, floor(currentStock − overstock limit))
 *   excessValue            = excessQuantity × lastPurchasePrice
 *   usage trend %          = (thisWeek − previousWeek) / previousWeek × 100
 *
 * When averageDailyUsage is missing, no cover or reorder quantity is predicted.
 */

export interface InventorySettings {
  safetyStockDays: number;
  overstockCoverageDays: number;
  /** Usage growth (%) week on week that counts as "demand increasing". */
  demandIncreasePct: number;
  /** Price rise (%) between the last two purchases from a supplier that triggers an alert. */
  priceIncreasePct: number;
}

export const DEFAULT_SETTINGS: InventorySettings = {
  safetyStockDays: 2,
  overstockCoverageDays: 7,
  demandIncreasePct: 20,
  priceIncreasePct: 5,
};

export type StockStatus = "stockout-risk" | "reorder-recommended" | "below-reorder" | "overstock" | "no-usage-data" | "zero-demand" | "ok";

export interface InventoryInsight {
  product: Product;
  hasUsageData: boolean;
  zeroDemand: boolean;
  daysOfCover: number | null;
  leadTimeDays: number;
  stockoutRisk: boolean;
  belowReorderLevel: boolean;
  needsReplenishment: boolean;
  targetStock: number | null;
  suggestedOrderQuantity: number | null;
  excessQuantity: number;
  excessValue: number;
  usageTrendPct: number | null;
  /** Latest vs previous purchase price from the same supplier. */
  priceChange: { supplierName: string; previous: number; latest: number; pct: number } | null;
  status: StockStatus;
  /** One plain-English sentence explaining the status with real numbers. */
  explanation: string;
}

export function insightFor(p: Product, s: InventorySettings = DEFAULT_SETTINGS): InventoryInsight {
  const u = p.averageDailyUsage;
  const hasUsage = u != null && Number.isFinite(u) && u >= 0;
  const zeroDemand = hasUsage && u === 0;
  const positiveUsage = hasUsage && u! > 0;
  const lead = p.supplierLeadTimeDays;
  const unit = p.stockUnit;

  const daysOfCover = positiveUsage ? p.currentStock / u! : null;
  const stockoutRisk = daysOfCover != null && daysOfCover < lead;
  const belowReorderLevel = p.currentStock <= p.reorderLevel;
  const targetStock = hasUsage ? u! * (lead + s.safetyStockDays) : null;
  const suggested = targetStock != null ? Math.max(0, Math.ceil(targetStock - p.currentStock - 1e-9)) : null;
  const excessQuantity = positiveUsage ? Math.max(0, Math.floor(p.currentStock - u! * s.overstockCoverageDays + 1e-9)) : 0;
  const excessValue = roundMoney(excessQuantity * p.lastPurchasePrice);

  const wk = p.weeklyUsage;
  const usageTrendPct = wk && wk.previousWeek > 0 ? ((wk.thisWeek - wk.previousWeek) / wk.previousWeek) * 100 : null;

  let priceChange: InventoryInsight["priceChange"] = null;
  const latest = p.purchaseHistory[0];
  if (latest) {
    const prev = p.purchaseHistory.slice(1).find((r) => r.supplierId === latest.supplierId);
    if (prev && prev.unitPrice > 0)
      priceChange = { supplierName: latest.supplierName, previous: prev.unitPrice, latest: latest.unitPrice, pct: ((latest.unitPrice - prev.unitPrice) / prev.unitPrice) * 100 };
  }

  // A static threshold remains informative, but must not override a known demand-based quantity.
  const needsReplenishment = (suggested ?? 0) > 0 || (!hasUsage && belowReorderLevel);
  const status: StockStatus = !hasUsage ? "no-usage-data" : zeroDemand ? "zero-demand" : stockoutRisk ? "stockout-risk" : needsReplenishment ? "reorder-recommended" : excessQuantity > 0 ? "overstock" : "ok";

  const cover = daysOfCover != null ? plural(Number(qtyText(daysOfCover)), "day") : "";
  let explanation: string;
  switch (status) {
    case "zero-demand":
      explanation = "Recorded average demand is 0 per day (confirmed zero sales in the covered window). No demand-based replenishment is recommended; this is not missing data. Stock depletion cannot be expressed as a finite number of days.";
      break;
    case "reorder-recommended":
      explanation = `Reorder recommended: ${plural(suggested!, unit)} to reach ${plural(targetStock!, unit)} including ${s.safetyStockDays} safety days. Stock covers about ${cover}, so it is not currently a stockout-before-delivery risk (${plural(lead, "day")} lead time).`;
      break;
    case "stockout-risk":
      explanation = `Current stock is expected to last about ${cover}, but the usual supplier needs ${plural(lead, "day")} to deliver.`;
      break;
    case "overstock":
      explanation = `${plural(p.currentStock, unit)} in stock covers about ${cover}. About ${plural(excessQuantity, unit)} (${money(excessValue)}) is more than ${s.overstockCoverageDays} days of use.`;
      break;
    case "no-usage-data":
      explanation = "Insufficient usage data to estimate stock coverage.";
      break;
    default:
      explanation = `Stock lasts about ${cover}. Delivery takes ${plural(lead, "day")}.`;
  }

  return {
    product: p,
    hasUsageData: hasUsage,
    zeroDemand,
    daysOfCover,
    leadTimeDays: lead,
    stockoutRisk,
    belowReorderLevel,
    needsReplenishment,
    targetStock,
    suggestedOrderQuantity: suggested,
    excessQuantity,
    excessValue,
    usageTrendPct,
    priceChange,
    status,
    explanation,
  };
}

/** Lower = more urgent. */
function urgency(i: InventoryInsight): number {
  if (i.stockoutRisk) return (i.daysOfCover ?? 0) / Math.max(1, i.leadTimeDays);
  if (i.needsReplenishment) return 10 + i.product.currentStock / Math.max(1, i.targetStock ?? i.product.reorderLevel);
  return 100;
}

export function sortByUrgency(list: InventoryInsight[]): InventoryInsight[] {
  return [...list].sort((a, b) => urgency(a) - urgency(b) || a.product.productName.localeCompare(b.product.productName));
}

/* ---------- Dashboard alerts ---------- */

export type AlertKind = "stockout-risk" | "below-reorder" | "overstock" | "demand-up" | "price-up" | "no-usage-data";

export interface ProductAlert {
  kind: AlertKind;
  productId: string;
  productName: string;
  title: string;
  explanation: string;
  tone: "red" | "orange" | "green" | "blue";
  actionLabel: string;
  /** Data behind the alert is demo/example data. */
  demoData?: boolean;
}

export function alertsFor(i: InventoryInsight, s: InventorySettings = DEFAULT_SETTINGS): ProductAlert[] {
  const p = i.product;
  const base = { productId: p.productId, productName: p.productName };
  const out: ProductAlert[] = [];
  if (i.stockoutRisk)
    out.push({ ...base, kind: "stockout-risk", title: "May run out before delivery", explanation: i.explanation, tone: "red", actionLabel: "Review suppliers" });
  else if (i.needsReplenishment)
    out.push({ ...base, kind: "below-reorder", title: i.hasUsageData ? "Reorder recommended" : "Review stock — usage unknown", explanation: i.explanation, tone: "orange", actionLabel: "Request quotation" });
  if (i.excessQuantity > 0)
    out.push({ ...base, kind: "overstock", title: "Overstock risk", explanation: i.status === "overstock" ? i.explanation : `${plural(i.excessQuantity, p.stockUnit)} more than ${s.overstockCoverageDays} days of use.`, tone: "orange", actionLabel: "Buy less next time" });
  if (i.usageTrendPct != null && i.usageTrendPct >= s.demandIncreasePct)
    out.push({
      ...base,
      kind: "demand-up",
      title: "Demand increasing",
      explanation: `Used ${p.weeklyUsage!.thisWeek} ${p.stockUnit}s this week vs ${p.weeklyUsage!.previousWeek} last week (+${i.usageTrendPct.toFixed(0)}%).`,
      tone: "green",
      actionLabel: "Check stock plan",
      demoData: true,
    });
  if (i.priceChange && i.priceChange.pct >= s.priceIncreasePct)
    out.push({
      ...base,
      kind: "price-up",
      title: "Supplier price increase",
      explanation: `${i.priceChange.supplierName} charged ${money(i.priceChange.latest)} last time, up ${i.priceChange.pct.toFixed(1)}% from ${money(i.priceChange.previous)}.`,
      tone: "orange",
      actionLabel: "Compare suppliers",
    });
  return out;
}

/* ---------- Dashboard KPIs ---------- */

export interface DashboardModel {
  insights: InventoryInsight[];
  top: InventoryInsight | null;
  otherAlerts: ProductAlert[];
  lowStockCount: number;
  pendingQuotationCount: number;
  poDraftCount: number;
}

/** An RFQ is pending while at least one contacted supplier has no recorded quotation and no PO was created from it. */
export function isRfqPending(r: QuotationRequest, quotes: SupplierQuote[], orders: PurchaseOrder[]): boolean {
  if (orders.some((o) => o.rfqId === r.rfqId)) return false;
  const replied = new Set(quotes.filter((q) => q.rfqId === r.rfqId).map((q) => q.supplierId));
  return r.suppliers.some((s) => !replied.has(s.supplierId));
}

export function buildDashboard(
  products: Product[],
  requests: QuotationRequest[],
  quotes: SupplierQuote[],
  orders: PurchaseOrder[],
  s: InventorySettings = DEFAULT_SETTINGS,
): DashboardModel {
  const insights = sortByUrgency(products.map((p) => insightFor(p, s)));
  const top = insights[0]?.needsReplenishment ? insights[0] : null;
  const rank: Record<AlertKind, number> = { "stockout-risk": 0, "below-reorder": 1, "price-up": 2, "demand-up": 3, overstock: 4, "no-usage-data": 5 };
  const otherAlerts = insights
    .flatMap((i) => alertsFor(i, s))
    .filter((a) => !(top && a.productId === top.product.productId && (a.kind === "stockout-risk" || a.kind === "below-reorder")))
    .sort((a, b) => rank[a.kind] - rank[b.kind]);
  return {
    insights,
    top,
    otherAlerts,
    lowStockCount: insights.filter((i) => i.needsReplenishment).length,
    pendingQuotationCount: requests.filter((r) => isRfqPending(r, quotes, orders)).length,
    poDraftCount: orders.filter((o) => o.status === "draft").length,
  };
}
