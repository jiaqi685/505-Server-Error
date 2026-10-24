import type { ExtractedQuotation, Product, RfqSupplier } from "@/data/types";
import { supplierDisplayName, supplierIdentity } from "./supplier-master";

const identity = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Exact normalized company identity only; filenames and fuzzy aliases are never used. */
export function matchingRfqSupplierId(documentSupplierName: string | null | undefined, suppliers: Pick<RfqSupplier, "supplierId" | "supplierName">[]): string | undefined {
  if (!documentSupplierName?.trim()) return undefined;
  const documentIdentity = supplierIdentity(documentSupplierName);
  return suppliers.find((supplier) => supplierIdentity(supplier.supplierName) === documentIdentity)?.supplierId;
}

/** No inferred supplier aliases, SKU conversion, or price rewriting. */
export function quotationReview(result: Partial<ExtractedQuotation>, supplierName: string, product: Product, supplierId?: string) {
  const selectedName = supplierId ? supplierDisplayName(supplierId, supplierName) : supplierName;
  const supplierMismatch = !!result.quotedSupplierName && (!supplierIdentity(result.quotedSupplierName) || supplierIdentity(result.quotedSupplierName) !== supplierIdentity(selectedName));
  const warnings: string[] = [];
  if (supplierMismatch) warnings.push(`Supplier mismatch: document says "${result.quotedSupplierName}", but "${selectedName}" is selected. Change the selection or explicitly confirm an override.`);
  if (!result.quotedSupplierName) warnings.push("Document supplier identity is unverified. Confirm it against the original file.");
  if (result.quotedProductName && !identity(result.quotedProductName).includes(identity(product.productName)))
    warnings.push(`Product mismatch: document says "${result.quotedProductName}". Confirm the catalogue SKU ${product.productId}.`);
  if (result.quotedUnit && ![product.stockUnit, `${product.stockUnit}s`].includes(result.quotedUnit.toLowerCase()))
    warnings.push(`Unit mismatch: document says "${result.quotedUnit}", catalogue uses "${product.stockUnit}". No automatic conversion is performed.`);
  if (product.productId === "premium-fragrant-rice")
    warnings.push(`Rice pack weight is not verified in the catalogue${result.packDescription ? `; document states "${result.packDescription}"` : ""}. Confirm the same SKU/pack before comparing per-bag prices.`);
  if (result.unitPrice != null && product.posData?.retailUnitPrice != null && result.unitPrice > product.posData.retailUnitPrice)
    warnings.push(`Supplier price exceeds the imported POS selling price (RM ${product.posData.retailUnitPrice.toFixed(2)}). Review pack size, date and margin; no historical data has been corrected.`);
  return { supplierMismatch, warnings };
}
