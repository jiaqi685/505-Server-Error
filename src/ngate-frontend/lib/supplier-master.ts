import master from "../../../../lib/supplier-master.json";
import { activeDocumentedSupplier } from "./supplier-document-evidence";

export const SUPPLIER_MASTER = master;

/** Only known legacy labels are replaced. Never overwrite an unrelated company identity. */
export function supplierDisplayName(supplierId: string, recordedName: string): string {
  const supplier = master.find((s) => s.supplierId === supplierId && s.verified);
  return supplier && [supplierIdentity(supplier.legacyName), supplierIdentity(supplier.supplierName)].includes(supplierIdentity(recordedName))
    ? supplier.supplierName : recordedName;
}

/** Exact identity after harmless typography/legal-suffix normalization; no fuzzy aliases. */
export function supplierIdentity(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").replace(/sdnbhd$/, "");
}

export function historicalSupplierLabel(supplierId: string, recordedName: string): string {
  const current = supplierDisplayName(supplierId, recordedName);
  return current === recordedName ? current : `${current} (recorded as ${recordedName})`;
}

/** Read-only presentation overlay. Stored history, extracted evidence and PO snapshots stay untouched. */
export function presentSupplierNames<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => presentSupplierNames(item)) as T;
  if (!value || typeof value !== "object") return value;
  const result = { ...value } as Record<string, unknown>;
  for (const [key, item] of Object.entries(result)) {
    if (key !== "quoteSnapshot") result[key] = presentSupplierNames(item);
  }
  if (typeof result.supplierId === "string" && typeof result.supplierName === "string")
    result.supplierName = supplierDisplayName(result.supplierId, result.supplierName);
  // Filter NEW-contact choices only. Keep stored relationships, RFQs and purchase history intact.
  if (typeof result.productId === "string" && Array.isArray(result.purchaseHistory) && Array.isArray(result.suppliers)) {
    const productId = result.productId;
    result.suppliers = result.suppliers.filter((s: { supplierId: string; eligibilitySource?: string }) =>
      activeDocumentedSupplier(productId, s.supplierId) || s.eligibilitySource === "verified-reference");
    const suppliers = result.suppliers as { supplierId: string }[];
    if (!suppliers.some((s) => s.supplierId === result.preferredSupplierId))
      result.preferredSupplierId = suppliers[0]?.supplierId ?? "";
  }
  if (typeof result.details === "string")
    result.details = result.details.replace(/\bSupplier [A-I]\b/g, (label) => master.find((s) => s.verified && s.legacyName === label)?.supplierName ?? label);
  return result as T;
}
