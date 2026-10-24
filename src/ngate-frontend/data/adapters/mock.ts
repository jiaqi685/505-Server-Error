import type { NGateApi } from "../api";
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
  ReviewSupplierPriceReferenceInput,
  Product,
  PurchaseOrder,
  PurchaseRecord,
  QuotationRequest,
  SaveSupplierQuotationInput,
  SupplierQuote,
  SupplierPriceReference,
  SupplierQuotationDocument,
  VerifySupplierPriceReferenceInput,
} from "../types";
import { buildSeedProducts, exampleQuotation } from "../seed";
import { OWNER_ACTOR, SYSTEM_ACTOR } from "@/lib/brand";
import { poTotal, validatePoInput } from "@/lib/costs";
import { presentSupplierNames } from "@/lib/supplier-master";
import { activeDocumentedSupplier, compatibleQuote } from "@/lib/supplier-document-evidence";
import { isValidDate, money, prettyDate, todayLocal } from "@/lib/format";
import { previewPosCsv } from "../pos/preview";
import { applyPosState, datasetCsv, emptyPosState, loadPosState, makeDataset, POS_STORAGE_KEY } from "../pos/storage";
import { POS_MAX_BYTES, type PosImportKind, type PosImportState, type PosPreview } from "../pos/types";
import { productSearchScore, rankProductsBySearch } from "@/lib/product-search";

/**
 * Standalone demo adapter. Product data comes from seed.ts; RFQs, quotes, POs
 * and activity are saved in this browser's localStorage (NOT a database).
 * Flask currently provides a separate read-only diagnostic, not connected procurement.
 */

export function matchesQuery(p: Product, query: string): boolean {
  return productSearchScore(p, query) > 0;
}

interface MockState {
  requests: QuotationRequest[];
  quotes: SupplierQuote[];
  orders: PurchaseOrder[];
  activity: ActivityEntry[];
  seq: { rfq: number; po: number; quote: number; event: number };
}

export const STORAGE_KEY = "ngate-demo-state-v3";
const emptyState = (): MockState => ({ requests: [], quotes: [], orders: [], activity: [], seq: { rfq: 0, po: 100, quote: 0, event: 0 } });

function loadState(key = STORAGE_KEY): MockState {
  try {
    if (typeof localStorage === "undefined") return emptyState();
    const raw = localStorage.getItem(key);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as Partial<MockState>;
    return { ...emptyState(), ...parsed, seq: { ...emptyState().seq, ...(parsed.seq ?? {}) } };
  } catch {
    return emptyState();
  }
}

export class MockAdapter implements NGateApi {
  private ownerId = "anonymous";
  private storageKey = `${STORAGE_KEY}:anonymous`;
  private state: MockState;
  private products: Product[] = buildSeedProducts();
  private posState: PosImportState = emptyPosState();
  private posLoadError: string | null = null;
  private posPreviews = new WeakMap<PosPreview, string>();
  constructor(private readonly latencyMs = 180, private readonly posOnly = false) {
    this.state = posOnly ? emptyState() : loadState(this.storageKey);
  }

  /* ---------- helpers ---------- */

  private save() {
    if (this.posOnly) return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.state));
    } catch {
      /* storage unavailable: keep in memory */
    }
  }

  setOwnerId(ownerId: string) {
    if (!ownerId || ownerId === this.ownerId) return;
    this.save();
    this.ownerId = ownerId;
    this.storageKey = `${STORAGE_KEY}:${ownerId}`;
    this.state = this.posOnly ? emptyState() : loadState(this.storageKey);
    this.restorePosData();
  }

  private get posStorageKey() { return `${POS_STORAGE_KEY}:${this.ownerId}`; }

  private restorePosData() {
    try {
      this.posState = loadPosState(this.posStorageKey, buildSeedProducts());
      this.posLoadError = null;
    } catch {
      this.posState = emptyPosState();
      this.posLoadError = "Saved POS data could not be restored. Original demo estimates are shown. Reset POS data or import a valid CSV to recover.";
    }
    this.products = applyPosState(buildSeedProducts(), this.posState);
  }

  getPosImportState(): Promise<PosImportState> {
    if (this.posLoadError) return this.fail(this.posLoadError);
    return this.respond(this.posState);
  }

  async previewPosImport(file: File, kind: PosImportKind): Promise<PosPreview> {
    if (file.size > POS_MAX_BYTES) throw new Error("CSV files must be no larger than 2 MB.");
    const owner = this.ownerId;
    const text = await file.text();
    if (owner !== this.ownerId) throw new Error("The signed-in account changed. Select the CSV again.");
    const preview = previewPosCsv(text, file.name, kind, buildSeedProducts());
    this.posPreviews.set(preview, owner);
    return preview;
  }

  confirmPosImport(preview: PosPreview): Promise<PosImportState> {
    if (this.posPreviews.get(preview) !== this.ownerId) return this.fail("Select and preview this CSV in your current account before confirming.");
    if (!preview.canImport) return this.fail("Fix all rejected rows before importing. No data was changed.");
    // Revalidate instead of trusting preview UI flags or values.
    const checked = previewPosCsv(datasetCsv(preview.kind, preview.rows), preview.fileName, preview.kind, buildSeedProducts(), 6 * 1024 * 1024);
    if (!checked.canImport) return this.fail("The preview no longer passes validation. Select the CSV again.");
    const next = { ...this.posState, [checked.kind]: makeDataset(checked.kind, checked.fileName, checked.rows) };
    return this.persistPosData(next, {
      action: "Synthetic POS CSV imported",
      status: "Demo data · replaced",
      details: `${checked.fileName} · ${checked.kind === "sales" ? "Daily sales" : "Stock snapshot"} · ${checked.rows.length} rows · ${checked.impacts.length} products · ${checked.dateFrom} to ${checked.dateTo}. Synthetic POS Demo Data; no live POS connection.`,
    });
  }

  resetPosImport(kind?: PosImportKind): Promise<PosImportState> {
    return this.persistPosData(kind ? { ...this.posState, [kind]: null } : emptyPosState(), {
      action: "Synthetic POS import reset",
      status: "Demo estimates restored",
      details: `${kind === "sales" ? "Sales import" : kind === "inventory" ? "Stock snapshot" : "Sales and stock imports"} removed. Existing RFQs, quotations and purchase orders were kept.`,
    });
  }

  private persistPosData(next: PosImportState, activity: LogActivityInput): Promise<PosImportState> {
    try {
      localStorage.setItem(this.posStorageKey, JSON.stringify(next));
    } catch {
      return this.fail("Browser storage is unavailable or full. No import was applied. Free some space and try again.");
    }
    this.posState = next;
    this.posLoadError = null;
    this.products = applyPosState(buildSeedProducts(), next);
    // Append an audit event without clearing any existing business workflow state.
    this.pushLog(activity);
    this.save();
    return this.respond(next);
  }

  private respond<T>(value: T): Promise<T> {
    const copy = value === undefined ? value : presentSupplierNames(JSON.parse(JSON.stringify(value)) as T);
    return new Promise((resolve) => setTimeout(() => resolve(copy), this.latencyMs));
  }

  private fail(message: string): Promise<never> {
    return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), this.latencyMs));
  }

  private product(id: string) {
    return this.products.find((p) => p.productId === id);
  }

  private rfq(id: string) {
    return this.state.requests.find((r) => r.rfqId === id);
  }

  private latestRfq(productId: string) {
    return [...this.state.requests].reverse().find((r) => r.productId === productId);
  }

  private pushLog(input: LogActivityInput): ActivityEntry {
    this.state.seq.event += 1;
    const entry: ActivityEntry = {
      eventId: `EVT-${String(this.state.seq.event).padStart(5, "0")}`,
      timestamp: new Date().toISOString(),
      actor: input.actor ?? OWNER_ACTOR,
      ...input,
    };
    if (!this.posOnly) this.state.activity.push(entry);
    return entry;
  }

  private quoteFor(rfq: QuotationRequest, supplierId: string, v: Omit<SaveSupplierQuotationInput, "rfqId" | "supplierId">): SupplierQuote {
    const p = this.product(rfq.productId)!;
    const sup = p.suppliers.find((s) => s.supplierId === supplierId)!;
    const previous = p.purchaseHistory.find((h) => h.supplierId === supplierId)?.unitPrice ?? null;
    this.state.seq.quote += 1;
    return {
      quoteId: `QT-${String(this.state.seq.quote).padStart(4, "0")}`,
      rfqId: rfq.rfqId,
      productId: p.productId,
      supplierId,
      supplierName: sup.supplierName,
      unitPrice: v.unitPrice,
      previousUnitPrice: previous,
      minimumOrderQuantity: v.minimumOrderQuantity,
      orderMultiple: v.orderMultiple ?? null,
      leadTimeDays: v.leadTimeDays,
      leadTimeBasis: v.leadTimeBasis,
      leadTimeText: v.leadTimeText,
      quotedSupplierName: v.quotedSupplierName,
      quotedProductName: v.quotedProductName,
      quotedUnit: v.quotedUnit,
      packDescription: v.packDescription,
      reviewConfirmed: v.reviewConfirmed,
      packUomConfirmed: v.packUomConfirmed,
      deliveryDateConfirmed: v.deliveryDateConfirmed,
      deliveryConfirmationSource: v.deliveryConfirmationSource,
      deliveryConfirmationNote: v.deliveryConfirmationNote,
      documentQuotedDeliveryDate: v.documentQuotedDeliveryDate,
      supplierOverrideConfirmed: v.supplierOverrideConfirmed,
      confidence: v.confidence,
      needsHumanReview: v.needsHumanReview,
      quotedDeliveryDate: v.quotedDeliveryDate,
      source: v.source,
      documentId: v.documentId ?? null,
      documentName: v.documentName ?? null,
      documentPath: v.documentPath ?? null,
      receivedAt: new Date().toISOString(),
    };
  }

  private upsertQuote(q: SupplierQuote) {
    this.state.quotes = this.state.quotes.filter((x) => !(x.rfqId === q.rfqId && x.supplierId === q.supplierId));
    this.state.quotes.push(q);
  }

  /* ---------- dashboard & products ---------- */

  getDashboardData(): Promise<DashboardData> {
    const latest = this.products.map((p) => this.latestRfq(p.productId)).filter((r): r is QuotationRequest => !!r);
    return this.respond({ products: this.products, quotationRequests: latest, quotes: this.state.quotes, purchaseOrders: this.state.orders });
  }

  getProducts(query = ""): Promise<Product[]> {
    return this.respond(rankProductsBySearch(this.products, query));
  }

  getProductDetails(productId: string): Promise<Product | null> {
    return this.respond(this.product(productId) ?? null);
  }

  getPurchaseHistory(productId: string): Promise<PurchaseRecord[]> {
    return this.respond(this.product(productId)?.purchaseHistory ?? []);
  }

  /* ---------- quotation requests ---------- */

  getLatestQuotationRequest(productId: string): Promise<QuotationRequest | null> {
    return this.respond(this.latestRfq(productId) ?? null);
  }

  createQuotationRequest(input: CreateQuotationRequestInput): Promise<QuotationRequest> {
    if (!input.supplierIds.every((sid) => activeDocumentedSupplier(input.productId, sid)))
      return this.fail("Supplier/product relationship is not supported by verified documents or is pending pack/UOM review.");
    const p = this.product(input.productId);
    if (!p) return this.fail("Product not found.");
    const qty = input.requestedQuantity;
    if (!Number.isInteger(qty) || qty <= 0) return this.fail("Enter a whole quantity greater than zero.");
    if (!isValidDate(input.requestedDeliveryDate) || input.requestedDeliveryDate < todayLocal()) return this.fail("Choose a delivery date from today onwards.");
    const suppliers = p.suppliers.filter((s) => input.supplierIds.includes(s.supplierId));
    if (!suppliers.length) return this.fail("Choose at least one supplier.");
    this.state.seq.rfq += 1;
    const req: QuotationRequest = {
      rfqId: `RFQ-${String(this.state.seq.rfq).padStart(4, "0")}`,
      productId: p.productId,
      requestedQuantity: qty,
      requestedDeliveryDate: input.requestedDeliveryDate,
      suppliers: suppliers.map((s) => ({ supplierId: s.supplierId, supplierName: s.supplierName, status: "prepared" })),
      createdAt: new Date().toISOString(),
    };
    this.state.requests.push(req);
    this.pushLog({
      action: "Quotation message prepared",
      status: "Not sent",
      productId: p.productId,
      productName: p.productName,
      rfqId: req.rfqId,
      details: `${qty} ${p.stockUnit}s · delivery ${prettyDate(req.requestedDeliveryDate)} · for ${suppliers.map((s) => s.supplierName).join(", ")}`,
    });
    this.save();
    return this.respond(req);
  }

  recordWhatsAppOpened(rfqId: string, supplierId: string): Promise<QuotationRequest> {
    const req = this.rfq(rfqId);
    const s = req?.suppliers.find((x) => x.supplierId === supplierId);
    if (!req || !s) return this.fail("Quotation request not found.");
    if (s.status === "prepared") s.status = "whatsapp-opened";
    s.whatsappOpenedAt = new Date().toISOString();
    const p = this.product(req.productId)!;
    this.pushLog({
      action: "WhatsApp chat opened",
      status: "Sending not verified",
      productId: p.productId,
      productName: p.productName,
      supplierId,
      rfqId,
      details: `Prefilled message for ${s.supplierName}. NGate cannot confirm it was sent.`,
    });
    this.save();
    return this.respond(req);
  }

  markQuotationSent(rfqId: string, supplierId: string): Promise<QuotationRequest> {
    const req = this.rfq(rfqId);
    const s = req?.suppliers.find((x) => x.supplierId === supplierId);
    if (!req || !s) return this.fail("Quotation request not found.");
    s.status = "marked-sent";
    s.markedSentAt = new Date().toISOString();
    const p = this.product(req.productId)!;
    this.pushLog({
      action: "Marked as sent by owner",
      status: "Owner confirmed",
      productId: p.productId,
      productName: p.productName,
      supplierId,
      rfqId,
      details: `Owner confirmed the quotation request to ${s.supplierName} was sent in WhatsApp.`,
    });
    this.save();
    return this.respond(req);
  }

  /* ---------- quotations ---------- */

  saveSupplierQuotation(input: SaveSupplierQuotationInput): Promise<SupplierQuote> {
    const req = this.rfq(input.rfqId);
    if (!req) return this.fail("Quotation request not found.");
    if (!req.suppliers.some((s) => s.supplierId === input.supplierId)) return this.fail("This supplier is not part of the quotation request.");
    if (!(Number.isFinite(input.unitPrice) && input.unitPrice > 0)) return this.fail("Price must be a positive number.");
    if (input.minimumOrderQuantity != null && !(Number.isInteger(input.minimumOrderQuantity) && input.minimumOrderQuantity > 0)) return this.fail("Minimum order must be a whole number above zero.");
    if (input.quotedDeliveryDate && !isValidDate(input.quotedDeliveryDate)) return this.fail("Delivery date is not valid.");
    const q = this.quoteFor(req, input.supplierId, input);
    const previous = this.state.quotes.find((quote) => quote.rfqId === req.rfqId && quote.supplierId === input.supplierId);
    if (previous) {
      q.quoteId = previous.quoteId;
      q.receivedAt = previous.receivedAt;
      q.updatedAt = new Date().toISOString();
    }
    this.upsertQuote(q);
    const p = this.product(req.productId)!;
    this.pushLog({
      action: previous ? "Supplier quotation updated" : "Supplier quotation recorded",
      status: input.source === "demo-example" ? "Example data" : "Quotation recorded",
      productId: p.productId,
      productName: p.productName,
      supplierId: q.supplierId,
      rfqId: req.rfqId,
      details: `${q.supplierName}: ${money(q.unitPrice)} per ${p.stockUnit} · MOQ ${q.minimumOrderQuantity ?? "not stated"}${q.quotedDeliveryDate ? ` · delivery ${prettyDate(q.quotedDeliveryDate)}` : q.leadTimeDays != null ? ` · ${q.leadTimeDays} day(s)` : " · delivery unknown"}`,
    });
    this.save();
    return this.respond(q);
  }

  getSupplierQuotes(rfqId: string): Promise<SupplierQuote[]> {
    return this.respond(this.state.quotes.filter((q) => q.rfqId === rfqId));
  }

  getSupplierQuotationDocuments(): Promise<SupplierQuotationDocument[]> {
    return this.respond([]);
  }

  importSupplierQuotationDocument(_input: ImportSupplierQuotationDocumentInput): Promise<SupplierQuotationDocument> {
    return Promise.reject(new Error("Multi-product quotation import requires Connected Procurement so the document and line items are saved in Flask SQLite."));
  }

  confirmSupplierQuotationDocument(_input: ConfirmSupplierQuotationDocumentInput): Promise<SupplierQuotationDocument> {
    return Promise.reject(new Error("Supplier identity confirmation requires Connected Procurement."));
  }

  getSupplierPriceReferences(_productId: string): Promise<SupplierPriceReference[]> {
    return this.respond([]);
  }

  reviewSupplierPriceReference(_input: ReviewSupplierPriceReferenceInput): Promise<SupplierPriceReference> {
    return Promise.reject(new Error("Supplier price-reference review requires Connected Procurement."));
  }

  verifySupplierPriceReferences(_input: VerifySupplierPriceReferenceInput): Promise<SupplierPriceReference[]> {
    return Promise.reject(new Error("Supplier price-reference verification requires Connected Procurement."));
  }

  linkSupplierPriceReference(_input: LinkSupplierPriceReferenceInput): Promise<SupplierQuote> {
    return Promise.reject(new Error("Linking a price reference to an RFQ requires Connected Procurement."));
  }

  loadExampleQuotes(rfqId: string): Promise<SupplierQuote[]> {
    const req = this.rfq(rfqId);
    if (!req) return this.fail("Quotation request not found.");
    const p = this.product(req.productId)!;
    const have = new Set(this.state.quotes.filter((q) => q.rfqId === rfqId).map((q) => q.supplierId));
    const added: SupplierQuote[] = [];
    for (const s of req.suppliers) {
      if (have.has(s.supplierId)) continue;
      const example = exampleQuotation(p, s.supplierId);
      const q = this.quoteFor(req, s.supplierId, {
        unitPrice: example.unitPrice,
        minimumOrderQuantity: example.minimumOrderQuantity,
        leadTimeDays: example.leadTimeDays,
        quotedDeliveryDate: example.quotedDeliveryDate,
        source: "demo-example",
        orderMultiple: example.orderMultiple,
      });
      this.upsertQuote(q);
      added.push(q);
    }
    if (added.length)
      this.pushLog({
        action: `${added.length} example quotation${added.length === 1 ? "" : "s"} loaded`,
        status: "Demo data",
        actor: SYSTEM_ACTOR,
        productId: p.productId,
        productName: p.productName,
        rfqId,
        details: added.map((q) => `${q.supplierName}: ${money(q.unitPrice)}, MOQ ${q.minimumOrderQuantity}`).join("; ") + ". Illustrative data, not real supplier quotations.",
      });
    this.save();
    return this.respond(added);
  }

  /* ---------- purchase orders ---------- */

  getPurchaseOrders(): Promise<PurchaseOrder[]> {
    return this.respond(this.state.orders);
  }

  createPurchaseOrderDraft(input: CreatePurchaseOrderInput): Promise<PurchaseOrder> {
    const p = this.product(input.productId);
    if (!p) return this.fail("Product not found.");
    const sup = p.suppliers.find((s) => s.supplierId === input.supplierId);
    if (!sup) return this.fail("Supplier not found for this product.");
    if (!Number.isInteger(input.qty) || input.qty < 1 || !Number.isFinite(input.unitPrice) || input.unitPrice <= 0)
      return this.fail("Please check the quantity and price.");
    if (input.rfqId) {
      const request = this.state.requests.find((r) => r.rfqId === input.rfqId && r.productId === input.productId);
      if (!request) return this.fail("RFQ not found for this product.");
      const check = validatePoInput(input.qty, input.unitPrice, 1, request.requestedQuantity);
      if (!check.valid) return this.fail(check.message);
    }
    if (input.quoteId) {
      const q = this.state.quotes.find((x) => x.quoteId === input.quoteId);
      if (!q || q.supplierId !== input.supplierId) return this.fail("The selected quotation has changed. Reopen Prepare PO.");
      if (!compatibleQuote(q, p.stockUnit)) return this.fail("Confirm compatible SKU, pack and stock UOM before preparing a quotation-linked PO.");
      if (q.minimumOrderQuantity != null && input.qty < q.minimumOrderQuantity) return this.fail(`${sup.supplierName}'s minimum order is ${q.minimumOrderQuantity}.`);
    }
    this.state.seq.po += 1;
    const o: PurchaseOrder = {
      poNumber: `PO-${String(this.state.seq.po).padStart(4, "0")}`,
      productId: p.productId,
      productName: p.productName,
      supplierId: sup.supplierId,
      supplier: sup.supplierName,
      rfqId: input.rfqId ?? null,
      quoteId: input.quoteId ?? null,
      qty: input.qty,
      unit: p.stockUnit,
      unitPrice: input.unitPrice,
      total: poTotal(input.qty, input.unitPrice),
      status: "draft",
      preparedAt: new Date().toISOString(),
    };
    this.state.orders.push(o);
    this.pushLog({
      action: "PO draft generated",
      status: "Pending approval · not sent",
      productId: p.productId,
      productName: p.productName,
      supplierId: sup.supplierId,
      rfqId: o.rfqId,
      poNumber: o.poNumber,
      details: `${o.poNumber} · ${o.supplier} · ${o.qty} × ${money(o.unitPrice)} = ${money(o.total)}`,
    });
    this.save();
    return this.respond(o);
  }

  approvePurchaseOrder(poNumber: string): Promise<PurchaseOrder> {
    const o = this.state.orders.find((x) => x.poNumber === poNumber);
    if (!o) return this.fail("PO not found.");
    if (o.status === "draft") {
      o.status = "approved";
      o.approvedAt = new Date().toISOString();
      this.pushLog({
        action: "PO approved (Demo Approval)",
        status: "Approved · not sent",
        productId: o.productId,
        productName: o.productName,
        supplierId: o.supplierId,
        rfqId: o.rfqId,
        poNumber,
        details: `${poNumber} approved in local demo. Not sent to ${o.supplier}.`,
      });
      this.save();
    }
    return this.respond(o);
  }

  markPurchaseOrderSent(input: MarkPurchaseOrderSentInput): Promise<PurchaseOrder> {
    const o = this.state.orders.find((order) => order.poNumber === input.poNumber);
    if (!o) return this.fail("PO not found.");
    if (o.status !== "approved") return this.fail("Only an approved PO can be marked as sent.");
    if (o.sentStatus === "sent" || o.markedSentAt) return this.respond(o);
    if (!(["WhatsApp", "Email", "Phone", "Other"] as const).includes(input.method)) return this.fail("Choose a valid sent method.");
    const sentAt = new Date(input.sentAt);
    if (Number.isNaN(sentAt.getTime())) return this.fail("Choose a valid sent date and time.");
    o.sentStatus = "sent";
    o.markedSentAt = sentAt.toISOString();
    o.markedSentMethod = input.method;
    o.sentNotes = input.notes?.trim() || null;
    this.pushLog({
      action: "PO marked as sent",
      status: "Owner recorded send",
      productId: o.productId,
      productName: o.productName,
      supplierId: o.supplierId,
      rfqId: o.rfqId,
      poNumber: o.poNumber,
      details: `${o.poNumber} manually recorded as sent to ${o.supplier} via ${input.method}. NGate did not transmit it.${o.sentNotes ? ` Note: ${o.sentNotes}` : ""}`,
    });
    this.save();
    return this.respond(o);
  }

  /* ---------- activity ---------- */

  getActivityHistory(): Promise<ActivityEntry[]> {
    return this.respond([...this.state.activity].reverse());
  }

  logActivity(input: LogActivityInput): Promise<ActivityEntry> {
    const entry = this.pushLog(input);
    this.save();
    return this.respond(entry);
  }
}
