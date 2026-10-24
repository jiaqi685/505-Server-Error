import type { NGateApi } from "../api";
import { rankProductsBySearch } from "@/lib/product-search";
import type {
  ActivityEntry,
  ConfirmSupplierQuotationDocumentInput,
  CreatePurchaseOrderInput,
  CreateQuotationRequestInput,
  DashboardData,
  LogActivityInput,
  MarkPurchaseOrderSentInput,
  ImportSupplierQuotationDocumentInput,
  LinkSupplierPriceReferenceInput,
  Product,
  PurchaseOrder,
  PurchaseRecord,
  QuotationRequest,
  SaveSupplierQuotationInput,
  ReviewSupplierPriceReferenceInput,
  SupplierPriceReference,
  SupplierQuote,
  SupplierQuotationDocument,
  VerifySupplierPriceReferenceInput,
} from "../types";

/**
 * Authenticated, read-only Flask catalogue bridge. Procurement is deliberately
 * unavailable until Flask has per-user ownership and a tested write contract.
 * Never send guessed frontend procurement requests to an unowned SQLite store.
 */
export class HttpAdapter implements NGateApi {
  constructor(private readonly baseUrl: string) {
    if (!baseUrl.startsWith("/") || baseUrl.startsWith("//") || /[?#]/.test(baseUrl))
      throw new Error("Flask browser access requires the same-origin authenticated /api proxy, not a direct Flask URL.");
  }

  private unavailable<T>(): Promise<T> {
    return Promise.reject(new Error("Flask procurement is not connected: only authenticated catalogue reads are available. Use VITE_DATA_SOURCE=mock for RFQs, quotations, orders and activity."));
  }

  protected async request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
        ...init,
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      });
    } catch {
      throw new Error("Cannot reach the NGate server. Check your connection and try again.");
    }
    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try {
        const body = (await res.json()) as { detail?: unknown; message?: string; error?: string };
        if (typeof body.detail === "string") message = body.detail;
        else if (body.message) message = body.message;
        else if (body.error) message = body.error;
      } catch {
        /* non-JSON error body */
      }
      const err = new Error(message) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return (await res.json()) as T;
  }

  /** GET that resolves to null on 404. */
  private async maybe<T>(path: string): Promise<T | null> {
    try {
      return await this.request<T>(path);
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
  }

  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
  }

  getDashboardData(): Promise<DashboardData> {
    return this.unavailable();
  }

  async getProducts(query = ""): Promise<Product[]> {
    const body = await this.request<{ products?: { product: Product }[] }>("/integrations/flask/products");
    if (!Array.isArray(body.products) || body.products.some((entry) => !entry?.product?.productId || !Array.isArray(entry.product.suppliers) || !Array.isArray(entry.product.purchaseHistory) || !("weeklyUsage" in entry.product))) {
      throw new Error("Flask product mapping returned an invalid catalogue envelope.");
    }
    const products = body.products.map((entry) => entry.product);
    return rankProductsBySearch(products, query);
  }

  async getProductDetails(productId: string): Promise<Product | null> {
    return (await this.getProducts()).find((p) => p.productId === productId) ?? null;
  }

  async getPurchaseHistory(productId: string): Promise<PurchaseRecord[]> {
    return (await this.getProductDetails(productId))?.purchaseHistory ?? [];
  }

  async getLatestQuotationRequest(productId: string): Promise<QuotationRequest | null> {
    return this.unavailable();
  }

  /** Must NOT send WhatsApp messages. */
  createQuotationRequest(input: CreateQuotationRequestInput): Promise<QuotationRequest> {
    return this.unavailable();
  }

  recordWhatsAppOpened(rfqId: string, supplierId: string): Promise<QuotationRequest> {
    return this.unavailable();
  }

  markQuotationSent(rfqId: string, supplierId: string): Promise<QuotationRequest> {
    return this.unavailable();
  }

  saveSupplierQuotation(input: SaveSupplierQuotationInput): Promise<SupplierQuote> {
    return this.unavailable();
  }

  getSupplierQuotes(rfqId: string): Promise<SupplierQuote[]> {
    return this.unavailable();
  }

  getSupplierQuotationDocuments(): Promise<SupplierQuotationDocument[]> {
    return this.unavailable();
  }

  importSupplierQuotationDocument(_input: ImportSupplierQuotationDocumentInput): Promise<SupplierQuotationDocument> {
    return this.unavailable();
  }

  confirmSupplierQuotationDocument(_input: ConfirmSupplierQuotationDocumentInput): Promise<SupplierQuotationDocument> {
    return this.unavailable();
  }

  getSupplierPriceReferences(_productId: string): Promise<SupplierPriceReference[]> {
    return this.unavailable();
  }

  reviewSupplierPriceReference(_input: ReviewSupplierPriceReferenceInput): Promise<SupplierPriceReference> {
    return this.unavailable();
  }

  verifySupplierPriceReferences(_input: VerifySupplierPriceReferenceInput): Promise<SupplierPriceReference[]> {
    return this.unavailable();
  }

  linkSupplierPriceReference(_input: LinkSupplierPriceReferenceInput): Promise<SupplierQuote> {
    return this.unavailable();
  }

  loadExampleQuotes(_rfqId: string): Promise<SupplierQuote[]> {
    return Promise.reject(new Error("Example quotations are only available in Demo Mode."));
  }

  getPurchaseOrders(): Promise<PurchaseOrder[]> {
    return this.unavailable();
  }

  /** Must NOT dispatch the PO to the supplier. */
  createPurchaseOrderDraft(input: CreatePurchaseOrderInput): Promise<PurchaseOrder> {
    return this.unavailable();
  }

  approvePurchaseOrder(poNumber: string): Promise<PurchaseOrder> {
    return this.unavailable();
  }

  markPurchaseOrderSent(_input: MarkPurchaseOrderSentInput): Promise<PurchaseOrder> {
    return this.unavailable();
  }

  getActivityHistory(): Promise<ActivityEntry[]> {
    return this.unavailable();
  }

  logActivity(input: LogActivityInput): Promise<ActivityEntry> {
    return this.unavailable();
  }
}
