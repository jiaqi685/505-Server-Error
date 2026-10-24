import type { SupplierQuote } from "@/data/types";
import { compatibleQuote } from "./supplier-document-evidence";
import { daysBetween, isValidDate, money, plural, roundMoney, todayLocal } from "./format";

/**
 * Deterministic supplier ranking. Pure function, no UI and no AI:
 * money and quantities are always calculated here, never guessed.
 *
 *   actualOrderQuantity = max(requestedQuantity, MOQ), rounded up to the order multiple
 *   totalPurchaseCost   = actualOrderQuantity × unitPrice
 *   excessQuantity      = actualOrderQuantity − requestedQuantity
 *   excessInventoryCost = excessQuantity × unitPrice
 *   priceChange%        = (unitPrice − previousUnitPrice) / previousUnitPrice × 100
 *
 * Ranking: suppliers that can meet the requested delivery date come first,
 * ordered by total purchase cost, then excess quantity, then earlier delivery.
 * Suppliers that are late or have an unknown delivery date are never recommended.
 */

export type DeliveryStatus = "on-time" | "late" | "unknown";

export interface RankingInput {
  requestedQuantity: number;
  /** yyyy-mm-dd */
  requestedDeliveryDate: string;
  unit?: string;
  /** Price increase (%) that counts as significant. */
  significantIncreasePct?: number;
  /** Business-local date, injectable for repeatable tests. */
  today?: string;
}

export interface QuoteAnalysis {
  quote: SupplierQuote;
  actualOrderQuantity: number;
  totalPurchaseCost: number;
  excessQuantity: number;
  excessInventoryCost: number;
  priceChangePct: number | null;
  significantIncrease: boolean;
  /** yyyy-mm-dd or null when the supplier gave no delivery information. */
  estimatedDeliveryDate: string | null;
  delivery: DeliveryStatus;
  /** Days later than requested (only when late). */
  daysLate: number;
  eligible: boolean;
  compatibilityConfirmed: boolean;
  /** 1-based rank. Eligible suppliers first. */
  rank: number;
  recommended: boolean;
  reasons: string[];
}

export interface RankingResult {
  rows: QuoteAnalysis[];
  recommended: QuoteAnalysis | null;
  /** Shown when no supplier can be recommended. */
  noRecommendationReason: string | null;
  summary: string[];
}

export function actualOrderQuantity(requested: number, moq: number | null, multiple?: number | null): number {
  let q = Math.max(requested, moq ?? requested);
  if (multiple && multiple > 1) q = Math.ceil(q / multiple) * multiple;
  return q;
}

function leastCommonMultiple(a: number, b: number): number {
  const gcd = (x: number, y: number): number => y ? gcd(y, x % y) : x;
  return Math.abs(a * b) / gcd(a, b);
}

export function quotePackMultiplier(quote: SupplierQuote): number | null {
  const conversion = quote.packConversionEvidence;
  return conversion && Number.isInteger(conversion.unitsPerOuter) && conversion.unitsPerOuter > 1
    ? conversion.unitsPerOuter
    : null;
}

export function actualOrderQuantityForQuote(requested: number, quote: SupplierQuote): number {
  const multiple = quote.orderMultiple && quote.orderMultiple > 1 ? quote.orderMultiple : 1;
  const packMultiplier = quotePackMultiplier(quote) ?? 1;
  return actualOrderQuantity(requested, quote.minimumOrderQuantity, leastCommonMultiple(multiple, packMultiplier));
}

export function normalizedQuoteUnitPrice(quote: SupplierQuote, stockUnit: string): number | null {
  if (!compatibleQuote(quote, stockUnit)) return null;
  return quote.normalizedUnitPrice ?? quote.unitPrice;
}

/** Computes totals from whole outer packs at their original quoted price when applicable. */
export function quoteTotalForQuantity(quote: SupplierQuote, quantity: number): number {
  const conversion = quote.packConversionEvidence;
  if (conversion) {
    if (quantity % conversion.unitsPerOuter !== 0) return Number.NaN;
    return roundMoney((quantity / conversion.unitsPerOuter) * conversion.originalUnitPrice);
  }
  return roundMoney(quantity * quote.unitPrice);
}

export function priceChangePct(unitPrice: number, previous: number | null | undefined): number | null {
  if (previous == null || !(previous > 0)) return null;
  return ((unitPrice - previous) / previous) * 100;
}

export function estimatedDelivery(q: Pick<SupplierQuote, "quotedDeliveryDate" | "deliveryDateConfirmed" | "deliveryConfirmationSource" | "deliveryConfirmationNote" | "documentQuotedDeliveryDate">, today = todayLocal()): string | null {
  const verified = q.deliveryDateConfirmed === true &&
    (q.deliveryConfirmationSource === "document" && q.documentQuotedDeliveryDate === q.quotedDeliveryDate ||
     q.deliveryConfirmationSource === "supplier-contact");
  if (verified && isValidDate(q.quotedDeliveryDate) && q.quotedDeliveryDate >= today) return q.quotedDeliveryDate;
  return null;
}

function pctText(p: number): string {
  return `${Math.abs(p).toFixed(Math.abs(p) < 10 ? 1 : 0)}%`;
}

export function rankSupplierQuotes(quotes: SupplierQuote[], input: RankingInput): RankingResult {
  const unit = input.unit ?? "unit";
  const threshold = input.significantIncreasePct ?? 10;
  const req = Math.max(0, Math.floor(input.requestedQuantity));

  const rows: QuoteAnalysis[] = quotes.map((quote) => {
    const compatibilityConfirmed = compatibleQuote(quote, input.unit ?? quote.quotedUnit ?? "");
    const qty = compatibilityConfirmed
      ? actualOrderQuantityForQuote(req, quote)
      : actualOrderQuantity(req, quote.minimumOrderQuantity, quote.orderMultiple);
    const excess = Math.max(0, qty - req);
    const eta = estimatedDelivery(quote, input.today);
    const delivery: DeliveryStatus = !eta || !isValidDate(input.requestedDeliveryDate) ? "unknown" : eta <= input.requestedDeliveryDate ? "on-time" : "late";
    const comparisonPrice = compatibilityConfirmed
      ? normalizedQuoteUnitPrice(quote, input.unit ?? quote.quotedUnit ?? "") ?? quote.unitPrice
      : quote.unitPrice;
    const change = compatibilityConfirmed ? priceChangePct(comparisonPrice, quote.previousUnitPrice) : null;
    const total = compatibilityConfirmed ? quoteTotalForQuantity(quote, qty) : 0;
    return {
      quote,
      actualOrderQuantity: qty,
      totalPurchaseCost: total,
      excessQuantity: excess,
      excessInventoryCost: roundMoney(excess * comparisonPrice),
      priceChangePct: change,
      significantIncrease: change != null && change >= threshold,
      estimatedDeliveryDate: eta,
      delivery,
      daysLate: delivery === "late" && eta ? daysBetween(input.requestedDeliveryDate, eta) : 0,
      compatibilityConfirmed,
      eligible: delivery === "on-time" && compatibilityConfirmed && quote.minimumOrderQuantity != null,
      rank: 0,
      recommended: false,
      reasons: [],
    };
  });

  const order = (a: QuoteAnalysis, b: QuoteAnalysis) =>
    Number(b.eligible) - Number(a.eligible) ||
    Number(b.compatibilityConfirmed) - Number(a.compatibilityConfirmed) ||
    (a.compatibilityConfirmed
      ? a.totalPurchaseCost - b.totalPurchaseCost
      : a.quote.supplierName.localeCompare(b.quote.supplierName)) ||
    a.excessQuantity - b.excessQuantity ||
    (a.estimatedDeliveryDate ?? "9999").localeCompare(b.estimatedDeliveryDate ?? "9999") ||
    a.quote.supplierName.localeCompare(b.quote.supplierName);
  rows.sort(order);
  rows.forEach((r, i) => (r.rank = i + 1));

  const eligible = rows.filter((r) => r.eligible);
  const recommended = req > 0 ? (eligible[0] ?? null) : null;
  if (recommended) recommended.recommended = true;

  const cheapestEligible = eligible[0]?.totalPurchaseCost;
  for (const r of rows) {
    const pts: string[] = [];
    if (!r.compatibilityConfirmed) pts.push("Not comparable: confirm compatible SKU, pack and stock UOM, and a document-supported supplier relationship.");
    if (r.priceChangePct != null) {
      if (r.priceChangePct > 0.05) pts.push(`Price increased ${pctText(r.priceChangePct)} from last purchase (${money(r.quote.previousUnitPrice!)}).`);
      else if (r.priceChangePct < -0.05) pts.push(`Price ${pctText(r.priceChangePct)} lower than last purchase (${money(r.quote.previousUnitPrice!)}).`);
      else pts.push("Same price as last purchase.");
    } else pts.push("No previous price to compare.");

    if (r.quote.minimumOrderQuantity == null) {
      pts.push("MOQ not stated — confirm with supplier before final comparison. The displayed quantity and total are provisional.");
    } else if (r.excessQuantity > 0) {
      pts.push(`${r.quote.packConversionEvidence ? "Whole-pack size" : "MOQ"} requires ${plural(r.excessQuantity, `extra ${unit}`)} (must buy ${r.actualOrderQuantity}).`);
      pts.push(`${money(r.excessInventoryCost)} tied up in excess inventory.`);
    } else pts.push(`Covers the ${plural(req, unit)} you need with no extra stock.`);
    if (r.compatibilityConfirmed && r.quote.packConversionEvidence) {
      const conversion = r.quote.packConversionEvidence;
      pts.push(
        `Quoted ${money(conversion.originalUnitPrice)}/${conversion.outerUnit}; normalized to RM ${conversion.normalizedUnitPrice.toFixed(6)} per ${unit}. Buy ${r.actualOrderQuantity / conversion.unitsPerOuter} whole ${conversion.outerUnit}(s).`,
      );
    }

    if (r.delivery === "on-time") pts.push("Meets requested delivery date.");
    else if (r.delivery === "late") pts.push(`Delivery ${plural(r.daysLate, "day")} later than requested.`);
    else pts.push("Delivery unconfirmed — verify with supplier.");

    if (r.recommended) pts.push(eligible.length > 1 ? "Lowest total purchasing cost among suppliers that meet the date." : "Only supplier that meets the requested date.");
    else if (r.eligible && cheapestEligible != null && r.totalPurchaseCost > cheapestEligible)
      pts.push(`${money(roundMoney(r.totalPurchaseCost - cheapestEligible))} more than the recommended supplier.`);
    r.reasons = pts;
  }

  let noRecommendationReason: string | null = null;
  if (!rows.length) noRecommendationReason = "No supplier replies recorded yet.";
  else if (req <= 0) noRecommendationReason = "Enter the quantity you need to compare suppliers.";
  else if (!recommended && rows.some((r) => !r.compatibilityConfirmed))
    noRecommendationReason = "Confirm compatible SKU, pack and stock UOM and a supported supplier relationship before recommending a supplier.";
  else if (!recommended && rows.some((r) => r.delivery === "on-time" && r.compatibilityConfirmed && r.quote.minimumOrderQuantity == null))
    noRecommendationReason = "Supplier MOQ is not stated. Confirm the minimum order before final comparison.";
  else if (!recommended)
    noRecommendationReason = rows.some((r) => r.delivery === "late")
      ? "No supplier can meet the requested delivery date. Choose a later date or ask suppliers about faster delivery."
      : "No supplier can be recommended until a delivery date is confirmed.";

  const summary: string[] = [];
  if (recommended) {
    summary.push(
      recommended.quote.packConversionEvidence
        ? `${recommended.quote.supplierName}: ${recommended.actualOrderQuantity / recommended.quote.packConversionEvidence.unitsPerOuter} ${recommended.quote.packConversionEvidence.outerUnit}(s) = ${plural(recommended.actualOrderQuantity, unit)}; total ${money(recommended.totalPurchaseCost)}.`
        : `${recommended.quote.supplierName}: ${plural(recommended.actualOrderQuantity, unit)} × ${money(recommended.quote.unitPrice)} = ${money(recommended.totalPurchaseCost)}.`,
    );
    const runnerUp = eligible[1];
    if (runnerUp) summary.push(`${money(roundMoney(runnerUp.totalPurchaseCost - recommended.totalPurchaseCost))} lower quoted total than ${runnerUp.quote.supplierName}; pack equivalence still needs verification.`);
    if (recommended.excessQuantity > 0) summary.push(`Includes ${plural(recommended.excessQuantity, `extra ${unit}`)} because of the minimum order.`);
  }
  const late = rows.filter((r) => r.delivery !== "on-time");
  if (late.length) summary.push(`Not recommended because of delivery: ${late.map((r) => r.quote.supplierName).join(", ")}.`);

  return { rows, recommended, noRecommendationReason, summary };
}
