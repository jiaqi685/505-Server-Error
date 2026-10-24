import type {
  ActivityEntry,
  CreatePurchaseOrderInput,
  CreateQuotationRequestInput,
  DashboardData,
  LogActivityInput,
  MarkPurchaseOrderSentInput,
  ConfirmSupplierQuotationDocumentInput,
  ImportSupplierQuotationDocumentInput,
  LinkSupplierPriceReferenceInput,
  ReviewSupplierPriceReferenceInput,
  VerifySupplierPriceReferenceInput,
  SupplierPriceReference,
  SupplierQuotationDocument,
  Product,
  PurchaseOrder,
  PurchaseRecord,
  QuotationRequest,
  SaveSupplierQuotationInput,
  SupplierQuote,
} from "./types";

/**
 * Every data operation the NGate UI needs. Implement this interface to plug in
 * a purchasing backend. Connected Mode persists procurement in owner-scoped
 * Flask SQLite; Mock Mode remains a separate browser-only fallback.
 *
 * Safety contract: no method may send WhatsApp messages or purchase orders
 * to suppliers. Sending always stays a manual action by the owner.
 */
export interface NGateApi {
  getDashboardData(): Promise<DashboardData>;

  /** Search by product name, Malay keyword, category or supplier name. */
  getProducts(query?: string): Promise<Product[]>;
  getProductDetails(productId: string): Promise<Product | null>;
  getPurchaseHistory(productId: string): Promise<PurchaseRecord[]>;

  /** Latest quotation request (RFQ) for a product, or null. */
  getLatestQuotationRequest(productId: string): Promise<QuotationRequest | null>;
  /** Prepares quotation messages. Does NOT send anything. */
  createQuotationRequest(input: CreateQuotationRequestInput): Promise<QuotationRequest>;
  /** The owner opened the WhatsApp compose screen. This is NOT proof of sending. */
  recordWhatsAppOpened(rfqId: string, supplierId: string): Promise<QuotationRequest>;
  /** The owner confirms they pressed Send in WhatsApp themselves. */
  markQuotationSent(rfqId: string, supplierId: string): Promise<QuotationRequest>;

  /** Saves (or replaces) a supplier's quotation for an RFQ. */
  saveSupplierQuotation(input: SaveSupplierQuotationInput): Promise<SupplierQuote>;
  getSupplierQuotes(rfqId: string): Promise<SupplierQuote[]>;
  getSupplierQuotationDocuments(): Promise<SupplierQuotationDocument[]>;
  importSupplierQuotationDocument(input: ImportSupplierQuotationDocumentInput): Promise<SupplierQuotationDocument>;
  confirmSupplierQuotationDocument(input: ConfirmSupplierQuotationDocumentInput): Promise<SupplierQuotationDocument>;
  getSupplierPriceReferences(productId: string): Promise<SupplierPriceReference[]>;
  reviewSupplierPriceReference(input: ReviewSupplierPriceReferenceInput): Promise<SupplierPriceReference>;
  verifySupplierPriceReferences(input: VerifySupplierPriceReferenceInput): Promise<SupplierPriceReference[]>;
  linkSupplierPriceReference(input: LinkSupplierPriceReferenceInput): Promise<SupplierQuote>;
  /** Demo only: records example quotations for suppliers without a saved quote. */
  loadExampleQuotes(rfqId: string): Promise<SupplierQuote[]>;

  getPurchaseOrders(): Promise<PurchaseOrder[]>;
  /** Creates a DRAFT PO (pending approval). Never dispatched to the supplier. */
  createPurchaseOrderDraft(input: CreatePurchaseOrderInput): Promise<PurchaseOrder>;
  /** Demo approval. Still not sent. Real approval must be authorised by the backend. */
  approvePurchaseOrder(poNumber: string): Promise<PurchaseOrder>;
  /** Records a send the owner already completed outside NGate. */
  markPurchaseOrderSent(input: MarkPurchaseOrderSentInput): Promise<PurchaseOrder>;

  /** Newest first. */
  getActivityHistory(): Promise<ActivityEntry[]>;
  logActivity(input: LogActivityInput): Promise<ActivityEntry>;
}
