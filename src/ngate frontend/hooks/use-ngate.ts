import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/data";
import type { ConfirmSupplierQuotationDocumentInput, CreatePurchaseOrderInput, CreateQuotationRequestInput, ImportSupplierQuotationDocumentInput, LinkSupplierPriceReferenceInput, LogActivityInput, MarkPurchaseOrderSentInput, ReviewSupplierPriceReferenceInput, SaveSupplierQuotationInput, VerifySupplierPriceReferenceInput } from "@/data";

export const ngateKeys = {
  all: ["ngate"] as const,
  dashboard: () => ["ngate", "dashboard"] as const,
  products: (query: string) => ["ngate", "products", query] as const,
  product: (id: string) => ["ngate", "product", id] as const,
  purchases: (id: string) => ["ngate", "purchases", id] as const,
  latestRfq: (productId: string) => ["ngate", "latest-rfq", productId] as const,
  quotes: (rfqId: string) => ["ngate", "quotes", rfqId] as const,
  quotationDocuments: () => ["ngate", "quotation-documents"] as const,
  priceReferences: (productId: string) => ["ngate", "price-references", productId] as const,
  orders: () => ["ngate", "orders"] as const,
  activity: () => ["ngate", "activity"] as const,
};

/** Every write can affect dashboard counts, statuses and activity, so refresh everything. */
function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ngateKeys.all });
}

/* ---------- Dashboard & products ---------- */

export function useDashboardData() {
  return useQuery({ queryKey: ngateKeys.dashboard(), queryFn: () => api.getDashboardData() });
}

export function useProducts(query = "") {
  const q = query.trim();
  return useQuery({ queryKey: ngateKeys.products(q), queryFn: () => api.getProducts(q), placeholderData: keepPreviousData });
}

export function useProduct(id: string | undefined) {
  return useQuery({ queryKey: ngateKeys.product(id ?? ""), queryFn: () => api.getProductDetails(id!), enabled: !!id });
}

export function usePurchaseHistory(id: string | undefined) {
  return useQuery({ queryKey: ngateKeys.purchases(id ?? ""), queryFn: () => api.getPurchaseHistory(id!), enabled: !!id });
}

/* ---------- Quotations ---------- */

export function useLatestQuotationRequest(productId: string | undefined) {
  return useQuery({ queryKey: ngateKeys.latestRfq(productId ?? ""), queryFn: () => api.getLatestQuotationRequest(productId!), enabled: !!productId });
}

export function useSupplierQuotes(rfqId: string | undefined | null) {
  return useQuery({ queryKey: ngateKeys.quotes(rfqId ?? ""), queryFn: () => api.getSupplierQuotes(rfqId!), enabled: !!rfqId });
}

export function useSupplierQuotationDocuments() {
  return useQuery({ queryKey: ngateKeys.quotationDocuments(), queryFn: () => api.getSupplierQuotationDocuments() });
}

export function useImportSupplierQuotationDocument() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: ImportSupplierQuotationDocumentInput) => api.importSupplierQuotationDocument(input),
    onSuccess: invalidate,
  });
}

export function useConfirmSupplierQuotationDocument() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: ConfirmSupplierQuotationDocumentInput) => api.confirmSupplierQuotationDocument(input),
    onSuccess: invalidate,
  });
}

export function useSupplierPriceReferences(productId: string | undefined) {
  return useQuery({
    queryKey: ngateKeys.priceReferences(productId ?? ""),
    queryFn: () => api.getSupplierPriceReferences(productId!),
    enabled: !!productId,
  });
}

export function useReviewSupplierPriceReference() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (input: ReviewSupplierPriceReferenceInput) => api.reviewSupplierPriceReference(input), onSuccess: invalidate });
}

export function useVerifySupplierPriceReferences() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: VerifySupplierPriceReferenceInput) => api.verifySupplierPriceReferences(input),
    onSuccess: invalidate,
  });
}

export function useLinkSupplierPriceReference() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (input: LinkSupplierPriceReferenceInput) => api.linkSupplierPriceReference(input), onSuccess: invalidate });
}

export function useCreateQuotationRequest() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (input: CreateQuotationRequestInput) => api.createQuotationRequest(input), onSuccess: invalidate });
}

export function useRecordWhatsAppOpened() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (v: { rfqId: string; supplierId: string }) => api.recordWhatsAppOpened(v.rfqId, v.supplierId), onSuccess: invalidate });
}

export function useMarkQuotationSent() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (v: { rfqId: string; supplierId: string }) => api.markQuotationSent(v.rfqId, v.supplierId), onSuccess: invalidate });
}

export function useSaveSupplierQuotation() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (input: SaveSupplierQuotationInput) => api.saveSupplierQuotation(input), onSuccess: invalidate });
}

export function useLoadExampleQuotes() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (rfqId: string) => api.loadExampleQuotes(rfqId), onSuccess: invalidate });
}

/* ---------- Purchase orders ---------- */

export function usePurchaseOrders() {
  return useQuery({ queryKey: ngateKeys.orders(), queryFn: () => api.getPurchaseOrders() });
}

export function useCreatePurchaseOrderDraft() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (input: CreatePurchaseOrderInput) => api.createPurchaseOrderDraft(input), onSuccess: invalidate });
}

export function useApprovePurchaseOrder() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (poNumber: string) => api.approvePurchaseOrder(poNumber), onSuccess: invalidate });
}

export function useMarkPurchaseOrderSent() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (input: MarkPurchaseOrderSentInput) => api.markPurchaseOrderSent(input), onSuccess: invalidate });
}

/* ---------- Activity ---------- */

export function useActivity() {
  return useQuery({ queryKey: ngateKeys.activity(), queryFn: () => api.getActivityHistory() });
}

export function useLogActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LogActivityInput) => api.logActivity(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ngateKeys.activity() }),
  });
}
