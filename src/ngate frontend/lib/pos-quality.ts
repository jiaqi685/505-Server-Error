import type { Product, SupplierQuote } from "@/data/types";
import { exampleQuotation } from "@/data/seed";
import { todayLocal } from "./format";

/** Daily demo files are out of date when their measurement date is over one calendar day old. */
export const POS_FRESHNESS_LIMIT_DAYS = 1;
export function freshnessMessages(salesDate?: string, inventoryDate?: string, today = todayLocal()): string[] {
  const messages: string[] = [];
  for (const [label, date] of [["sales", salesDate], ["inventory snapshot", inventoryDate]] as const) {
    if (!date) continue;
    const age = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
    if (age < 0) messages.push(`Future-dated ${label}: ${date}. Check the file date before using these estimates.`);
    else if (age > POS_FRESHNESS_LIMIT_DAYS)
      messages.push(`Outdated ${label}: ${date} (${age} calendar days old; freshness limit ${POS_FRESHNESS_LIMIT_DAYS} day). ${label === "sales" ? "Recommendations use historical demand, not live sales." : "This is a historical count, not verified real-time stock. Recount before ordering."}`);
  }
  return messages;
}

/** A review only: never normalises pack sizes, rewrites supplier prices, or changes quotes. */
export function riceSpecificationReview(product: Product, quotes: SupplierQuote[] = []) {
  const examples = product.suppliers.map((s) => ({ supplierName: s.supplierName, unitPrice: exampleQuotation(product, s.supplierId).unitPrice }));
  const retail = product.posData?.retailUnitPrice ?? null;
  return {
    sku: product.productId,
    stockUnit: product.stockUnit,
    packWeight: null,
    retail,
    retailDate: product.posData?.retailPriceDate,
    historical: product.purchaseHistory,
    examples,
    quotes,
    belowExamplePrice: retail != null && examples.some((q) => retail < q.unitPrice),
    belowRecordedPrice: retail != null && quotes.some((q) => retail < q.unitPrice),
  };
}
