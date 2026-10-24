import type { Product, QuotationLineItemExtraction } from "@/data";
import { requiresPackMultiplier, stockUnitIdentity } from "./supplier-document-evidence";

export interface ParsedPackConversion {
  outerUnit: string;
  explicitOuterUnit: string | null;
  innerUnit: string | null;
  unitsPerOuter: number;
  innerSizeMl: number | null;
  sourceText: string;
}

export type PackConversionStatus =
  | "not-required"
  | "unsupported"
  | "incompatible"
  | "catalogue-confirmation-required"
  | "compatible";

export interface PackConversionAssessment {
  status: PackConversionStatus;
  conversion: ParsedPackConversion | null;
  normalizedUnitPrice: number | null;
  equivalentQuantity: number | null;
  cataloguePackDescription: string | null;
  reason: string | null;
}

const OUTER_WORD = "(?:cartons?|ctns?|cases?|boxes?|crates?|trays?|packs?|bundles?)";
const INNER_WORD = "(?:bottles?|btls?|cans?|tins?|pieces?|pcs?|units?|each|items?|bars?)";
const VOLUME_WORD = "(?:ml|millilit(?:er|re)s?|l|lit(?:er|re)s?)";

function volumeMl(amount: string, unit: string): number {
  const numericAmount = Number(amount);
  return /^l|^lit/i.test(unit) ? numericAmount * 1000 : numericAmount;
}

function uniqueVolumes(text: string): number[] {
  const values = [...text.matchAll(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${VOLUME_WORD})\\b`, "gi"))]
    .map((match) => volumeMl(match[1], match[2].toLowerCase()));
  return [...new Set(values)];
}

function canonicalUnitText(value: string | null | undefined): string {
  return stockUnitIdentity(value ?? "");
}

/** Extracts only explicit, deterministic carton/inner-unit multipliers from the source text. */
export function parseExplicitPackConversion(
  description: string | null | undefined,
  packSpecification: string | null | undefined,
  quotedUnit: string | null | undefined,
): ParsedPackConversion | null {
  const text = `${description ?? ""} ${packSpecification ?? ""}`.trim();
  if (!text || !quotedUnit) return null;
  if (/\b(?:or|and)\b.{0,8}[x×]?\s*\d+/i.test(text)) return null;
  const candidates: Array<{
    count: number;
    innerUnit: string | null;
    outerUnit: string | null;
    sizeMl: number | null;
    sourceText: string;
  }> = [];
  const add = (match: RegExpMatchArray, count: string, inner: string | undefined, outer: string | undefined, size?: string, sizeUnit?: string) => {
    const unitsPerOuter = Number(count);
    if (!Number.isSafeInteger(unitsPerOuter) || unitsPerOuter <= 1) return;
    candidates.push({
      count: unitsPerOuter,
      innerUnit: inner ? canonicalUnitText(inner) : null,
      outerUnit: outer ? canonicalUnitText(outer) : null,
      sizeMl: size && sizeUnit ? volumeMl(size, sizeUnit) : null,
      sourceText: match[0],
    });
  };

  const sizeFirst = /\b(\d+(?:\.\d+)?)\s*(ml|millilit(?:er|re)s?|l|lit(?:er|re)s?)\s*[x×]\s*(\d+)\s*(?:(bottles?|btls?|cans?|tins?|pieces?|pcs?|units?|each|items?|bars?)\b\s*)?(?:per\s*(cartons?|ctns?|cases?|boxes?|crates?|trays?|packs?|bundles?)\b)?/gi;
  for (const match of text.matchAll(sizeFirst)) add(match, match[3], match[4], match[5], match[1], match[2]);

  const countFirst = /\b(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(ml|millilit(?:er|re)s?|l|lit(?:er|re)s?)(?:\s*(bottles?|btls?|cans?|tins?|pieces?|pcs?|units?|each|items?|bars?)\b)?(?:\s*per\s*(cartons?|ctns?|cases?|boxes?|crates?|trays?|packs?|bundles?)\b)?/gi;
  for (const match of text.matchAll(countFirst)) add(match, match[1], match[4], match[5], match[2], match[3]);

  const ratio = new RegExp(`\\b(\\d+)\\s*(${INNER_WORD})\\s*(?:per|/)\\s*(${OUTER_WORD})\\b`, "gi");
  for (const match of text.matchAll(ratio)) add(match, match[1], match[2], match[3]);

  const equation = new RegExp(`\\b1\\s*(${OUTER_WORD})\\s*=\\s*(\\d+)\\s*(${INNER_WORD})\\b`, "gi");
  for (const match of text.matchAll(equation)) add(match, match[2], match[3], match[1]);

  if (!candidates.length) return null;
  const distinct = [...new Map(candidates.map((candidate) => [
    `${candidate.count}|${candidate.outerUnit ?? ""}|${candidate.innerUnit ?? ""}|${candidate.sizeMl ?? ""}`,
    candidate,
  ])).values()];
  const structuralKeys = new Set(distinct.map((candidate) => `${candidate.count}|${candidate.outerUnit ?? ""}`));
  if (structuralKeys.size !== 1) return null;
  const counts = new Set(distinct.map((candidate) => candidate.count));
  const explicitInnerUnits = new Set(distinct.map((candidate) => candidate.innerUnit).filter(Boolean));
  const explicitOuterUnits = new Set(distinct.map((candidate) => candidate.outerUnit).filter(Boolean));
  if (counts.size !== 1 || explicitInnerUnits.size > 1 || explicitOuterUnits.size > 1) return null;

  const volumes = uniqueVolumes(text);
  const candidateSizes = new Set(distinct.map((candidate) => candidate.sizeMl).filter((value): value is number => value !== null));
  if (volumes.length > 1 || candidateSizes.size > 1) return null;
  const innerSizeMl = candidateSizes.values().next().value ?? volumes[0] ?? null;
  const base = distinct[0];
  const explicitOuterUnit = [...explicitOuterUnits][0] ?? null;
  const quotedOuter = canonicalUnitText(quotedUnit);
  if (explicitOuterUnit && explicitOuterUnit !== quotedOuter) return null;
  return {
    outerUnit: quotedOuter,
    explicitOuterUnit,
    innerUnit: [...explicitInnerUnits][0] ?? null,
    unitsPerOuter: base.count,
    innerSizeMl,
    sourceText: base.sourceText,
  };
}

export function assessPackConversion(
  line: QuotationLineItemExtraction,
  product: Product,
): PackConversionAssessment {
  const cataloguePackDescription = product.packSize?.trim() || null;
  if (!requiresPackMultiplier(line.unit, product.stockUnit)) {
    return {
      status: "not-required",
      conversion: null,
      normalizedUnitPrice: null,
      equivalentQuantity: null,
      cataloguePackDescription,
      reason: null,
    };
  }

  const conversion = parseExplicitPackConversion(line.description, line.packSpecification, line.unit);
  const fail = (status: "unsupported" | "incompatible", reason: string): PackConversionAssessment => ({
    status, conversion, normalizedUnitPrice: null, equivalentQuantity: null, cataloguePackDescription, reason,
  });
  if (!conversion) {
    return fail("unsupported", "The quotation does not state one unambiguous multiplier and pack specification.");
  }
  if (conversion.innerUnit && conversion.innerUnit !== canonicalUnitText(product.stockUnit)) {
    return fail("incompatible", "The printed inner unit differs from the catalogue stock unit.");
  }
  if (!conversion.innerSizeMl) {
    return fail("unsupported", "The quotation does not state the inner bottle size needed to verify this SKU.");
  }

  const catalogueVolumes = uniqueVolumes(`${product.packSize ?? ""} ${product.productName}`);
  if (catalogueVolumes.length > 1) {
    return fail("unsupported", "The catalogue pack text contains more than one possible bottle size.");
  }
  if (catalogueVolumes.length === 1 && Math.abs(catalogueVolumes[0] - conversion.innerSizeMl) > 0.000001) {
    return fail("incompatible", `The quotation says ${conversion.innerSizeMl}ml per ${conversion.innerUnit ?? product.stockUnit}, but the catalogue specifies ${catalogueVolumes[0]}ml.`);
  }

  const price = line.unitPrice;
  const normalizedUnitPrice = price !== null && Number.isFinite(price) && price > 0
    ? price / conversion.unitsPerOuter
    : null;
  const equivalentQuantity = line.quotedQuantity !== null && Number.isSafeInteger(line.quotedQuantity)
    ? line.quotedQuantity * conversion.unitsPerOuter
    : null;
  const base = {
    conversion,
    normalizedUnitPrice,
    equivalentQuantity,
    cataloguePackDescription,
    reason: null,
  } as const;
  return {
    ...base,
    status: catalogueVolumes.length === 1 ? "compatible" : "catalogue-confirmation-required",
    reason: catalogueVolumes.length === 1
      ? null
      : "The catalogue bottle size is not stated; confirm this exact quoted size matches the stocked item.",
  };
}
