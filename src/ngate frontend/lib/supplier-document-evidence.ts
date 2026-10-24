import evidence from "../../../../lib/supplier-document-evidence.json";
import master from "../../../../lib/supplier-master.json";
import type { SupplierQuote } from "../data/types";

export const SUPPLIER_DOCUMENT_EVIDENCE = evidence;
export const pendingSuppliers = master.filter((s) => s.active === false);
const groups = evidence.groups as Record<string, string[]>;

/** Product-group evidence is NOT a confirmed pack conversion or an active quotation. */
export function documentLinesFor(productId: string) {
  return evidence.documents.flatMap((document) => {
    const index = groups[document.group].indexOf(productId);
    if (index < 0) return [];
    const [description, quotedQuantity, quotedUnit, unitPriceRm, itemDiscount, lineTotalRm] = document.items[index];
    return [{ ...document, description: String(description), quotedQuantity: Number(quotedQuantity),
      quotedUnit: String(quotedUnit), unitPriceRm: Number(unitPriceRm), itemDiscount: String(itemDiscount),
      lineTotalRm: Number(lineTotalRm), minimumOrderQuantity: null, confirmedDeliveryDate: null, packMappingConfirmed: false }];
  });
}

export function documentedSupplierProduct(productId: string, supplierId: string): boolean {
  return documentLinesFor(productId).some((line) => line.supplierId === supplierId);
}

export function activeDocumentedSupplier(productId: string, supplierId: string): boolean {
  return master.some((s) => s.supplierId === supplierId && s.active !== false) && documentedSupplierProduct(productId, supplierId);
}

/** Identity comparison only strips plural suffixes; it does not infer pack equivalence. */
export const stockUnitIdentity = (unit: string) => {
  const token = unit.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliases: Record<string, string> = {
    ctn: "carton", ctns: "carton", cartons: "carton",
    bt: "bottle", btl: "bottle", btls: "bottle", bottles: "bottle",
    pcs: "piece", pc: "piece", pieces: "piece",
    ea: "each",
  };
  return aliases[token] ?? token.replace(/s$/, "");
};

const OUTER_PACK_UNITS = new Set(["carton", "case", "box", "crate", "tray", "pack", "bundle"]);
const INDIVIDUAL_STOCK_UNITS = new Set(["bottle", "can", "tin", "piece", "pc", "unit", "each", "item", "bar"]);

/** These pairs need a verified quantity multiplier; a one-to-one note is never enough. */
export function requiresPackMultiplier(quotedUnit: string | null | undefined, stockUnit: string | null | undefined): boolean {
  return OUTER_PACK_UNITS.has(stockUnitIdentity(quotedUnit ?? "")) &&
    INDIVIDUAL_STOCK_UNITS.has(stockUnitIdentity(stockUnit ?? ""));
}

export function compatibleQuote(quote: SupplierQuote, stockUnit: string): boolean {
  const unitMatches = !!quote.quotedUnit && !!stockUnit &&
    stockUnitIdentity(quote.quotedUnit) === stockUnitIdentity(stockUnit);
  const explicitOneToOneReview = quote.unitConversionConfirmed === true &&
    !!quote.unitConversionNote?.trim() &&
    !requiresPackMultiplier(quote.quotedUnit, stockUnit);
  const conversion = quote.packConversionEvidence;
  const verifiedPackConversion = requiresPackMultiplier(quote.quotedUnit, stockUnit)
    && !!conversion
    && Number.isInteger(conversion.unitsPerOuter) && conversion.unitsPerOuter > 1
    && stockUnitIdentity(conversion.outerUnit) === stockUnitIdentity(quote.quotedUnit ?? "")
    && stockUnitIdentity(conversion.innerUnit) === stockUnitIdentity(stockUnit)
    && Number.isFinite(conversion.innerSizeMl) && conversion.innerSizeMl > 0
    && Number.isFinite(conversion.originalUnitPrice) && conversion.originalUnitPrice > 0
    && Number.isFinite(conversion.normalizedUnitPrice) && conversion.normalizedUnitPrice > 0
    && (conversion.cataloguePackStatus === "catalogue-match" || conversion.cataloguePackStatus === "owner-confirmed")
    && Math.abs(conversion.normalizedUnitPrice * conversion.unitsPerOuter - conversion.originalUnitPrice) < 0.000001
    && Math.abs(conversion.originalUnitPrice - quote.unitPrice) < 0.000001
    && quote.normalizedUnitPrice != null
    && Math.abs(quote.normalizedUnitPrice - conversion.normalizedUnitPrice) < 0.000001;
  return quote.reviewConfirmed === true && quote.packUomConfirmed === true &&
    (unitMatches || explicitOneToOneReview || verifiedPackConversion) &&
    (activeDocumentedSupplier(quote.productId, quote.supplierId) ||
      quote.supplierProductRelationshipConfirmed === true);
}
