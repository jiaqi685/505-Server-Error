/**
 * NGate domain types. These are the shapes the UI understands.
 * Any backend adapter (mock or HTTP) must return data in these shapes.
 * See API_CONTRACT.md at the artifact root for the matching JSON.
 */
import type { PosProvenance } from "./pos/types";

/* ---------- Suppliers & products ---------- */

export interface Supplier {
  supplierId: string;
  supplierName: string;
  /** Optional WhatsApp number in international format, digits only (e.g. "60123456789"). */
  whatsappNumber?: string | null;
}

/** A supplier that sells a given product, with its usual delivery time for that product. */
export interface ProductSupplier {
  supplierId: string;
  supplierName: string;
  /** Null until a supplier has stated a delivery commitment. */
  leadTimeDays: number | null;
  /** Owner-scoped line review may activate only this exact product/supplier pair. */
  eligibilitySource?: "catalogue" | "verified-reference";
}

export interface PurchaseRecord {
  purchaseId: string;
  supplierId: string;
  supplierName: string;
  unitPrice: number;
  quantity: number;
  /** yyyy-mm-dd */
  purchaseDate: string;
}

export interface Product {
  /** Optional provenance for browser-only synthetic POS overlays. */
  posData?: PosProvenance;
  productId: string;
  /** Optional source SKU; productId remains the catalogue-code fallback. */
  sku?: string;
  productName: string;
  /** Short name used in headlines and buttons, e.g. "Fragrant Rice". */
  shortName: string;
  category: string;
  /** Singular unit, e.g. "pack". The UI pluralises with "s". */
  stockUnit: string;
  /** Catalogue pack description when the backend has one; null/undefined is not inferred. */
  packSize?: string | null;
  currentStock: number;
  /** Average units used per day. null = not enough usage data to estimate. */
  averageDailyUsage: number | null;
  /** Units used in the previous and current week (demo data), for trend %. */
  weeklyUsage?: { previousWeek: number; thisWeek: number } | null;
  /** Restock when stock falls to this level. */
  reorderLevel: number;
  preferredSupplierId: string;
  /** Lead time of the preferred supplier. */
  supplierLeadTimeDays: number;
  /** Latest price paid (newest purchase record). */
  lastPurchasePrice: number;
  /** Newest first. */
  purchaseHistory: PurchaseRecord[];
  suppliers: ProductSupplier[];
  /** yyyy-mm-dd of the earliest-expiring stock, if tracked. */
  expiryDate?: string | null;
  /** Extra search terms, e.g. Malay names ("beras", "susu"). */
  keywords?: string[];
}

/* ---------- Quotation requests (RFQ) ---------- */

/**
 * Per-supplier contact status. Opening WhatsApp is NOT proof of sending:
 * "marked-sent" only happens when the owner confirms it themselves.
 */
export type RfqSupplierStatus = "prepared" | "whatsapp-opened" | "marked-sent";

export interface RfqSupplier {
  supplierId: string;
  supplierName: string;
  status: RfqSupplierStatus;
  whatsappOpenedAt?: string | null;
  markedSentAt?: string | null;
}

export interface QuotationRequest {
  rfqId: string;
  productId: string;
  requestedQuantity: number;
  /** yyyy-mm-dd (Asia/Kuala_Lumpur) */
  requestedDeliveryDate: string;
  suppliers: RfqSupplier[];
  /** ISO timestamp */
  createdAt: string;
}

export interface CreateQuotationRequestInput {
  productId: string;
  requestedQuantity: number;
  requestedDeliveryDate: string;
  supplierIds: string[];
}

/* ---------- Supplier quotations ---------- */

/** Where the quote values came from. */
export type QuoteSource = "document-upload" | "manual" | "demo-example";

export type LeadTimeBasis = "working-days" | "calendar-days" | "unknown";
export interface QuotationEvidence {
  /** Separately confirmed by a human; old extraction-review flags are not pack verification. */
  packUomConfirmed?: boolean;
  /** Explicitly verified supplier commitment, never an estimated date. */
  deliveryDateConfirmed?: boolean;
  deliveryConfirmationSource?: "document" | "supplier-contact" | null;
  deliveryConfirmationNote?: string | null;
  /** Original extracted date, retained separately from later owner confirmation. */
  documentQuotedDeliveryDate?: string | null;
  leadTimeBasis?: LeadTimeBasis;
  leadTimeText?: string | null;
  quotedSupplierName?: string | null;
  quotedProductName?: string | null;
  quotedUnit?: string | null;
  packDescription?: string | null;
  confidence?: string;
  needsHumanReview?: boolean;
  reviewConfirmed?: boolean;
  supplierOverrideConfirmed?: boolean;
  /** Human-confirmed one-to-one equivalence; never authorizes an outer-pack-to-item conversion. */
  unitConversionConfirmed?: boolean;
  unitConversionNote?: string | null;
}

/** Server-created audit evidence for converting a quoted outer pack to stock units. */
export interface PackConversionEvidence {
  sourceText: string;
  outerUnit: string;
  innerUnit: string;
  unitsPerOuter: number;
  innerSizeMl: number;
  originalUnitPrice: number;
  normalizedUnitPrice: number;
  quotedQuantity: number | null;
  equivalentQuantity: number | null;
  originalLineTotal: number | null;
  cataloguePackStatus: "catalogue-match" | "owner-confirmed";
  cataloguePackDescription: string | null;
  reviewedAt: string;
}

export interface SupplierQuote extends QuotationEvidence {
  quoteId: string;
  rfqId: string;
  productId: string;
  supplierId: string;
  supplierName: string;
  /** Original printed price per quoted unit (for example RM14/carton). */
  unitPrice: number;
  /** Server-verified price per catalogue stock unit (for example RM0.5833/bottle). */
  normalizedUnitPrice?: number | null;
  packConversionEvidence?: PackConversionEvidence | null;
  /** Last price paid to this supplier; null when unknown. */
  previousUnitPrice: number | null;
  minimumOrderQuantity: number | null;
  /** Supplier only sells in multiples of this (e.g. cartons of 6). Optional. */
  orderMultiple?: number | null;
  /** Days from the quotation date until delivery. */
  leadTimeDays: number | null;
  /** yyyy-mm-dd. Takes priority over leadTimeDays when given. */
  quotedDeliveryDate: string | null;
  source: QuoteSource;
  documentId?: string | null;
  documentName?: string | null;
  documentPath?: string | null;
  /** Server-derived after verifying the exact owner-scoped product/supplier pair. */
  supplierProductRelationshipConfirmed?: boolean;
  /** Original printed line evidence is retained separately from the actionable unit price. */
  sourceLineEvidence?: {
    referenceId: string;
    lineItemId: string;
    quotedQuantity: number | null;
    itemDiscount: string | null;
    lineTotal: number | null;
    conditionalDiscounts: string[];
    reviewEvidence: SupplierPriceReference["reviewEvidence"];
    packConversionEvidence?: PackConversionEvidence | null;
  };
  /** ISO timestamp the quotation was recorded. */
  receivedAt: string;
  updatedAt?: string;
}

export interface SaveSupplierQuotationInput extends QuotationEvidence {
  rfqId: string;
  supplierId: string;
  unitPrice: number;
  minimumOrderQuantity: number | null;
  orderMultiple?: number | null;
  leadTimeDays: number | null;
  quotedDeliveryDate: string | null;
  source: QuoteSource;
  documentId?: string | null;
  documentName?: string | null;
  documentPath?: string | null;
}

/** Values read from an uploaded supplier document, for the owner to review. */
export interface ExtractedQuotation extends QuotationEvidence {
  method: "ai";
  unitPrice: number | null;
  minimumOrderQuantity: number | null;
  orderMultiple?: number | null;
  leadTimeDays: number | null;
  quotedDeliveryDate: string | null;
  notes: string[];
  documentId?: string;
  documentName?: string;
  documentPath?: string;
}

/** Document-level extraction for the centralized, multi-product quotation review. */
export interface QuotationLineItemExtraction {
  lineItemId: string;
  description: string | null;
  sku: string | null;
  unit: string | null;
  packSpecification: string | null;
  /** Printed quantity only; never treated as MOQ. */
  quotedQuantity: number | null;
  unitPrice: number | null;
  itemDiscount: string | null;
  lineTotal: number | null;
}

export interface MultiProductQuotationExtraction {
  documentId: string;
  documentName: string;
  documentPath: string;
  fingerprint: string;
  quotedSupplierName: string | null;
  quotationDateText: string | null;
  validityText: string | null;
  deliveryWording: string | null;
  conditionalDiscounts: string[];
  items: QuotationLineItemExtraction[];
  notes: string[];
  needsHumanReview: true;
}

export interface SupplierPriceReference extends QuotationLineItemExtraction {
  referenceId: string;
  documentId: string;
  documentName: string;
  documentPath: string;
  quotedSupplierName: string | null;
  quotationDateText: string | null;
  validityText: string | null;
  deliveryWording: string | null;
  conditionalDiscounts: string[];
  productId: string | null;
  supplierId: string | null;
  status: "pending" | "verified" | "linked";
  supplierIdentityConfirmed: boolean;
  supplierOverrideConfirmed: boolean;
  productMatchConfirmed: boolean;
  packUomConfirmed: boolean;
  priceConfirmed: boolean;
  unitConversionConfirmed: boolean;
  unitConversionNote: string | null;
  reviewConfirmed?: boolean;
  reviewEvidence: {
    supplierId: string;
    supplierName: string;
    productId: string;
    productName: string;
    quotedUnit: string | null;
    catalogueUnit: string;
    quotedPackSpecification: string | null;
    cataloguePackSize: string | null;
    quotedUnitPrice: number;
    reviewedAt: string;
  } | null;
  packConversionEvidence?: PackConversionEvidence | null;
  verifiedAt: string | null;
  linkedRfqId: string | null;
  createdAt: string;
}

export interface SupplierQuotationDocument {
  documentId: string;
  documentName: string;
  documentPath: string;
  fingerprint: string;
  quotedSupplierName: string | null;
  quotationDateText: string | null;
  validityText: string | null;
  deliveryWording: string | null;
  confirmedSupplierId: string | null;
  supplierIdentityConfirmed: boolean;
  supplierOverrideConfirmed: boolean;
  supplierConfirmedAt: string | null;
  conditionalDiscounts: string[];
  notes: string[];
  createdAt: string;
  items: SupplierPriceReference[];
}

export interface ImportSupplierQuotationDocumentInput extends Omit<MultiProductQuotationExtraction, "needsHumanReview"> {}
export interface ReviewSupplierPriceReferenceInput {
  referenceId: string;
  productId: string | null;
  unitConversionConfirmed?: boolean;
  unitConversionNote?: string | null;
}
export interface ConfirmSupplierQuotationDocumentInput {
  documentId: string;
  supplierId: string;
  supplierIdentityConfirmed: true;
  supplierOverrideConfirmed: boolean;
}
export interface VerifySupplierPriceReferenceInput {
  documentId: string;
  references: Array<{
    referenceId: string;
    productId: string;
    unitConversionConfirmed?: boolean;
    unitConversionNote?: string | null;
    cataloguePackConfirmed?: boolean;
  }>;
}
export interface LinkSupplierPriceReferenceInput {
  referenceId: string;
  rfqId: string;
  confirmLink: true;
}

/* ---------- Purchase orders ---------- */

export type PurchaseOrderStatus = "draft" | "approved";
export type PurchaseOrderSentMethod = "WhatsApp" | "Email" | "Phone" | "Other";

export interface MarkPurchaseOrderSentInput {
  poNumber: string;
  method: PurchaseOrderSentMethod;
  /** ISO timestamp, supplied by the owner after sending outside NGate. */
  sentAt: string;
  notes?: string | null;
}

export interface PurchaseOrder {
  poNumber: string;
  productId: string;
  productName: string;
  supplierId: string;
  supplier: string;
  rfqId?: string | null;
  quoteId?: string | null;
  qty: number;
  unit: string;
  unitPrice: number;
  total: number;
  /** Outer pack details for a verified converted quote; qty remains in stock units. */
  orderPackCount?: number | null;
  orderPackUnit?: string | null;
  orderPackMultiplier?: number | null;
  orderPackExtraQuantity?: number | null;
  quoteSnapshot?: SupplierQuote | null;
  status: PurchaseOrderStatus;
  /** ISO timestamp */
  preparedAt: string;
  approvedAt?: string | null;
  /** Approval status stays separate from owner-recorded supplier dispatch. */
  sentStatus?: "sent";
  markedSentAt?: string | null;
  markedSentMethod?: PurchaseOrderSentMethod | null;
  sentNotes?: string | null;
}

export interface CreatePurchaseOrderInput {
  productId: string;
  supplierId: string;
  qty: number;
  unitPrice: number;
  rfqId?: string | null;
  quoteId?: string | null;
  /** Explicitly checked by the owner when drafting from historical prices. */
  historicalPriceConfirmed?: boolean;
}

/* ---------- Activity ---------- */

export interface ActivityEntry {
  eventId: string;
  /** ISO timestamp */
  timestamp: string;
  action: string;
  /** Short state after the action, e.g. "Not sent", "Pending approval". */
  status: string;
  actor: string;
  details: string;
  productId?: string | null;
  productName?: string | null;
  supplierId?: string | null;
  rfqId?: string | null;
  poNumber?: string | null;
}

export type LogActivityInput = Omit<ActivityEntry, "eventId" | "timestamp" | "actor"> & { actor?: string };

/* ---------- Dashboard ---------- */

/** Raw data the dashboard needs. Insights are calculated in src/lib/inventory.ts. */
export interface DashboardData {
  products: Product[];
  /** Latest quotation request per product. */
  quotationRequests: QuotationRequest[];
  quotes: SupplierQuote[];
  purchaseOrders: PurchaseOrder[];
}
