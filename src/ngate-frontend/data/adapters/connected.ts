import { HttpAdapter } from "./http";
import { applyPosState } from "../pos/storage";
import { presentSupplierNames } from "@/lib/supplier-master";
import type { MockAdapter } from "./mock";
import type { ActivityEntry, ConfirmSupplierQuotationDocumentInput, CreatePurchaseOrderInput, CreateQuotationRequestInput, DashboardData, ImportSupplierQuotationDocumentInput, LinkSupplierPriceReferenceInput, LogActivityInput, MarkPurchaseOrderSentInput, QuotationRequest, ReviewSupplierPriceReferenceInput, SaveSupplierQuotationInput, SupplierPriceReference, SupplierQuote, SupplierQuotationDocument, VerifySupplierPriceReferenceInput, PurchaseOrder, Product } from "../types";

/** Procurement is exclusively server-backed; only the synthetic POS overlay is local. */
export class ConnectedAdapter extends HttpAdapter {
  private pendingKeys = new Map<string, string>();
  constructor(baseUrl: string, private readonly pos: MockAdapter) { super(baseUrl); }

  private async read<T>(operation: string, query: Record<string, string> = {}): Promise<T> {
    const params = new URLSearchParams(query).toString();
    return presentSupplierNames(await this.request<T>(`/integrations/flask/procurement/${operation}${params ? `?${params}` : ""}`));
  }

  private async write<T>(operation: string, input: unknown): Promise<T> {
    const signature = operation + JSON.stringify(input);
    const key = this.pendingKeys.get(signature) ?? crypto.randomUUID();
    this.pendingKeys.set(signature, key);
    try {
      const result = await this.request<T>(`/integrations/flask/procurement/${operation}`, {
        method: "POST", body: JSON.stringify(input),
        headers: { "X-NGate-Request": "procurement-v2", "Idempotency-Key": key },
      });
      this.pendingKeys.delete(signature);
      return presentSupplierNames(result);
    } catch (error) {
      // Retain the key for an ambiguous upstream timeout/retry. Never save locally.
      throw error;
    }
  }

  override async getProducts(query = ""): Promise<Product[]> {
    return applyPosState(presentSupplierNames(await super.getProducts(query)), await this.pos.getPosImportState());
  }
  override async getProductDetails(productId: string) {
    return (await this.getProducts()).find((p) => p.productId === productId) ?? null;
  }
  override async getDashboardData(): Promise<DashboardData> {
    const data = await this.read<DashboardData>("dashboard");
    return { ...data, products: applyPosState(data.products, await this.pos.getPosImportState()) };
  }
  override getLatestQuotationRequest(productId: string) { return this.read<QuotationRequest | null>("latest-rfq", { productId }); }
  override createQuotationRequest(input: CreateQuotationRequestInput) { return this.write<QuotationRequest>("create-rfq", input); }
  override recordWhatsAppOpened(rfqId: string, supplierId: string) { return this.write<QuotationRequest>("whatsapp-opened", { rfqId, supplierId }); }
  override markQuotationSent(rfqId: string, supplierId: string) { return this.write<QuotationRequest>("mark-sent", { rfqId, supplierId }); }
  override saveSupplierQuotation(input: SaveSupplierQuotationInput) { return this.write<SupplierQuote>("save-quote", input); }
  override getSupplierQuotes(rfqId: string) { return this.read<SupplierQuote[]>("quotes", { rfqId }); }
  override getSupplierQuotationDocuments() { return this.read<SupplierQuotationDocument[]>("quotation-documents"); }
  override importSupplierQuotationDocument(input: ImportSupplierQuotationDocumentInput) { return this.write<SupplierQuotationDocument>("import-quotation-document", input); }
  override confirmSupplierQuotationDocument(input: ConfirmSupplierQuotationDocumentInput) { return this.write<SupplierQuotationDocument>("confirm-quotation-supplier", input); }
  override getSupplierPriceReferences(productId: string) { return this.read<SupplierPriceReference[]>("price-references", { productId }); }
  override reviewSupplierPriceReference(input: ReviewSupplierPriceReferenceInput) { return this.write<SupplierPriceReference>("review-price-reference", input); }
  override verifySupplierPriceReferences(input: VerifySupplierPriceReferenceInput) { return this.write<SupplierPriceReference[]>("verify-price-references", input); }
  override linkSupplierPriceReference(input: LinkSupplierPriceReferenceInput) { return this.write<SupplierQuote>("link-price-reference", input); }
  override loadExampleQuotes(rfqId: string) { return this.write<SupplierQuote[]>("example-quotes", { rfqId, confirmSynthetic: true }); }
  override getPurchaseOrders() { return this.read<PurchaseOrder[]>("orders"); }
  override createPurchaseOrderDraft(input: CreatePurchaseOrderInput) { return this.write<PurchaseOrder>("create-po", input); }
  override approvePurchaseOrder(poNumber: string) { return this.write<PurchaseOrder>("approve-po", { poNumber }); }
  override markPurchaseOrderSent(input: MarkPurchaseOrderSentInput) { return this.write<PurchaseOrder>("mark-po-sent", input); }
  override getActivityHistory() { return this.read<ActivityEntry[]>("activity"); }
  override logActivity(input: LogActivityInput) { return this.write<ActivityEntry>("log-activity", input); }
}
