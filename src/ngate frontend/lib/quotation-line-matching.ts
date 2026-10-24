import type { Product, QuotationLineItemExtraction } from "@/data";

export type ProductMatchConfidence = "high" | "medium" | "low" | "none";

export interface PendingCatalogueItemProposal {
  proposedName: string;
  quotedSku: string | null;
  quotedUnit: string | null;
  quotedPackSpecification: string | null;
  identifiedFamily: string;
  reason: string;
}

export interface QuotationLineProductMatch {
  /** Best catalogue product only when its identity does not conflict with the quote. */
  product: Product | null;
  /** Family-level candidate, retained for explanation when an exact item cannot be assigned. */
  familyProduct: Product | null;
  confidence: ProductMatchConfidence;
  score: number;
  /** Product identification is separate from unit, SKU and pack compatibility. */
  autoAssignable: boolean;
  identityCompatible: boolean;
  unitCompatible: boolean;
  skuCompatible: boolean;
  packCompatible: boolean;
  purchaseCompatible: boolean;
  issue: string | null;
  pendingCatalogueItem: PendingCatalogueItemProposal | null;
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function tokens(value: string): Set<string> {
  return new Set(value.split(" ").filter((part) => part.length > 1));
}

type MilkFlavor = "original" | "strawberry" | "chocolate";

function milkFlavor(value: string): MilkFlavor | null {
  const text = normalize(value);
  if (/\b(strawber\w*|strawbeerry|susu strawberi)\b/.test(text)) return "strawberry";
  if (/\b(chocolate|coklat)\b/.test(text)) return "chocolate";
  if (/\b(original|plain)\b/.test(text)) return "original";
  return null;
}

function isMilkText(value: string): boolean {
  return /\b(milk|susu|uht|uth)\b/.test(normalize(value));
}

function packMeasures(value: string | null | undefined): Set<string> {
  const result = new Set<string>();
  const text = (value ?? "").normalize("NFKC").toLowerCase();
  const pattern = /(\d+(?:\.\d+)?)\s*(ml|cl|l|mg|kg|g)\b/g;
  for (const match of text.matchAll(pattern)) {
    const amount = Number(match[1]);
    const unit = match[2];
    const base = unit === "l" ? amount * 1000
      : unit === "cl" ? amount * 10
        : unit === "kg" ? amount * 1000
          : unit === "mg" ? amount / 1000
            : amount;
    const family = ["ml", "cl", "l"].includes(unit) ? "volume-ml" : "mass-g";
    result.add(`${family}:${base}`);
  }
  return result;
}

function packCounts(value: string | null | undefined): Set<number> {
  const result = new Set<number>();
  const pattern = /\b(\d+)\s*[-]?\s*(?:x|×|pcs?|pieces?|packets?|packs?|bottles?|cartons?|cans?|sachets?|units?)\b/g;
  for (const match of (value ?? "").normalize("NFKC").toLowerCase().matchAll(pattern)) {
    result.add(Number(match[1]));
  }
  return result;
}

function hasConflictingPackSpecification(line: QuotationLineItemExtraction, product: Product): boolean {
  const quotedText = `${line.description ?? ""} ${line.packSpecification ?? ""}`;
  const catalogueText = `${product.packSize ?? ""} ${product.productName}`;
  const quotedMeasures = packMeasures(quotedText);
  const catalogueMeasures = packMeasures(catalogueText);
  const quotedCounts = packCounts(quotedText);
  const catalogueCounts = packCounts(catalogueText);
  return (quotedMeasures.size > 0 && catalogueMeasures.size > 0
      && ![...quotedMeasures].some((measure) => catalogueMeasures.has(measure)))
    || (quotedCounts.size > 0 && catalogueCounts.size > 0
      && ![...quotedCounts].some((count) => catalogueCounts.has(count)));
}

function packSpecificationCompatible(line: QuotationLineItemExtraction, product: Product): boolean {
  const quotedText = `${line.description ?? ""} ${line.packSpecification ?? ""}`;
  const catalogueText = `${product.packSize ?? ""} ${product.productName}`;
  const quotedMeasures = packMeasures(quotedText);
  const catalogueMeasures = packMeasures(catalogueText);
  const quotedCounts = packCounts(quotedText);
  const catalogueCounts = packCounts(catalogueText);
  const measureMatch = quotedMeasures.size === 0 && catalogueMeasures.size === 0
    || quotedMeasures.size > 0 && catalogueMeasures.size > 0
      && [...quotedMeasures].some((measure) => catalogueMeasures.has(measure));
  const countMatch = quotedCounts.size === 0 && catalogueCounts.size === 0
    || quotedCounts.size > 0 && catalogueCounts.size > 0
      && [...quotedCounts].some((count) => catalogueCounts.has(count));
  return measureMatch && countMatch;
}

function identityIssue(line: QuotationLineItemExtraction, product: Product): string | null {
  const lineText = [line.description, line.sku, line.packSpecification].filter(Boolean).join(" ");
  const productText = [product.productName, product.shortName, ...(product.keywords ?? [])].join(" ");
  if (isMilkText(lineText) && isMilkText(productText)) {
    const requestedFlavor = milkFlavor(lineText);
    if (requestedFlavor && milkFlavor(productText) !== requestedFlavor) {
      return "The printed milk flavour does not match this catalogue product.";
    }
  }

  const powderDetergent = /\b(laundry\s+)?detergent\s+(powder|powdered)\b|\b(powder|powdered)\s+(laundry\s+)?detergent\b/.test(normalize(lineText));
  const bottleDetergent = product.productId === "laundry-detergent"
    && normalize(product.stockUnit) === "bottle";
  if (powderDetergent && bottleDetergent) {
    return "The quotation is for detergent powder, while the catalogue item is a bottle. Keep this as a pending catalogue item.";
  }

  const sku = normalize(line.sku);
  const productCodes = [product.sku, product.productId].map(normalize).filter(Boolean);
  if (sku && !productCodes.includes(sku)) {
    return "The printed SKU is not recorded for this catalogue product.";
  }

  if (hasConflictingPackSpecification(line, product)) {
    return "The printed pack specification conflicts with the catalogue specification.";
  }
  return null;
}

function scoreProduct(line: QuotationLineItemExtraction, product: Product): number {
  const sku = normalize(line.sku);
  const productCodes = [product.sku, product.productId].map(normalize).filter(Boolean);
  if (sku && productCodes.includes(sku)) return 1;

  const description = normalize(line.description);
  if (!description) return 0;
  const names = [product.productName, product.shortName, ...(product.keywords ?? [])].map(normalize).filter(Boolean);
  if (names.includes(description)) return 0.96;
  if (names.some((name) => description.includes(name) || name.includes(description))) return 0.86;

  const descriptionTokens = tokens(description);
  const productTokens = tokens(names.join(" "));
  if (!descriptionTokens.size || !productTokens.size) return 0;
  const overlap = [...descriptionTokens].filter((token) => productTokens.has(token)).length;
  const similarity = overlap / Math.max(descriptionTokens.size, productTokens.size);
  return similarity >= 0.7 ? 0.7 + similarity * 0.15 : similarity * 0.7;
}

export function matchQuotationLineToProduct(
  line: QuotationLineItemExtraction,
  products: Product[],
): QuotationLineProductMatch {
  const ranked = products
    .map((product) => ({ product, score: scoreProduct(line, product), issue: identityIssue(line, product) }))
    .sort((a, b) => b.score - a.score);
  const familyBest = ranked[0];
  const safeRanked = ranked.filter((entry) => !entry.issue);
  const best = safeRanked[0];
  const familyCandidateThreshold = 0.55;
  const score = best?.score && best.score >= familyCandidateThreshold ? best.score
    : familyBest?.score && familyBest.score >= familyCandidateThreshold ? familyBest.score : 0;
  const hasFamilyTie = Boolean(
    familyBest && familyBest.score >= familyCandidateThreshold
      && ranked[1] && familyBest.score - ranked[1].score < 0.025,
  );
  const hasSafeTie = Boolean(
    best && best.score >= familyCandidateThreshold
      && safeRanked[1] && best.score - safeRanked[1].score < 0.025,
  );
  const ambiguous = hasSafeTie || (!best || best.score < 0.4) && hasFamilyTie;
  const familyProduct = hasFamilyTie || !familyBest || familyBest.score < familyCandidateThreshold ? null : familyBest.product;
  const safeProduct = !best || best.score < familyCandidateThreshold || hasSafeTie ? null : best.product;
  const issue = safeProduct
    ? null
    : hasFamilyTie ? "More than one catalogue product is a plausible match."
      : familyBest?.issue ?? null;
  const confidence: ProductMatchConfidence = ambiguous ? "low" : score >= 0.86 ? "high"
    : score >= 0.65 ? "medium"
      : score >= 0.4 ? "low" : "none";
  const normalizeUnit = (unit: string | null | undefined) => normalize(unit).replace(/s$/, "");
  const unitCompatible = Boolean(safeProduct && line.unit && normalizeUnit(line.unit) === normalizeUnit(safeProduct.stockUnit));
  const quotedSku = normalize(line.sku);
  const catalogueSku = normalize(safeProduct?.sku);
  const skuCompatible = safeProduct
    ? quotedSku
      ? [safeProduct.sku, safeProduct.productId].map(normalize).includes(quotedSku)
      : !catalogueSku
    : false;
  const packCompatible = Boolean(safeProduct && packSpecificationCompatible(line, safeProduct));
  const autoAssignable = Boolean(safeProduct && confidence === "high");
  const identityCompatible = Boolean(safeProduct);
  const pendingCatalogueItem = !safeProduct && familyProduct && issue ? {
    proposedName: line.description?.trim() || line.sku?.trim() || "Unmatched catalogue item",
    quotedSku: line.sku?.trim() || null,
    quotedUnit: line.unit?.trim() || null,
    quotedPackSpecification: line.packSpecification?.trim() || null,
    identifiedFamily: familyProduct.productName,
    reason: issue,
  } : null;

  return {
    product: safeProduct,
    familyProduct: safeProduct ?? familyProduct,
    confidence,
    score,
    autoAssignable,
    identityCompatible,
    unitCompatible,
    skuCompatible,
    packCompatible,
    purchaseCompatible: Boolean(safeProduct && confidence === "high" && unitCompatible && skuCompatible && packCompatible),
    issue: issue ?? (!unitCompatible && safeProduct ? "The quoted unit differs from the catalogue stock unit."
      : !skuCompatible && safeProduct ? "The quotation SKU cannot be verified against catalogue data."
        : !packCompatible && safeProduct ? "The quoted pack specification is not confirmed against the catalogue."
          : null),
    pendingCatalogueItem,
  };
}
