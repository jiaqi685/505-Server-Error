import type { QuotationRequest, SupplierQuote } from "../data/types";

/** A new request follows the current POS signal, never a prior request's saved quantity. */
export function newRfqDefaultQuantity(suggestedOrderQuantity: number | null | undefined, reorderLevel: number): number {
  return Number.isSafeInteger(suggestedOrderQuantity) && suggestedOrderQuantity! > 0
    ? suggestedOrderQuantity! : reorderLevel;
}

/** A supplier switch may retain parsed quotation evidence, but a blank editor must reset. */
export function preserveExtractedDraftOnSupplierSwitch(documentId: string | null | undefined, extraction: unknown): boolean {
  return !!documentId && !!extraction;
}

/** A comparison is not an amendment to a persisted RFQ. */
export function comparisonPoQuantity(request: Pick<QuotationRequest, "requestedQuantity" | "requestedDeliveryDate">, scenarioDate: string): number | null {
  return scenarioDate === request.requestedDeliveryDate ? request.requestedQuantity : null;
}

/** Same-quote refetches must not overwrite unsaved edits; supplier/RFQ switches must reset even without a quote. */
export function quotationEditorKey(rfqId: string, supplierId: string, quoteId?: string): string {
  return JSON.stringify([rfqId, supplierId, quoteId ?? null]);
}

/** Complete hydration, including explicit blank values for suppliers with no quote. */
export function quotationEditorFields(quote?: SupplierQuote) {
  return {
    file: null,
    uploadError: "",
    price: quote ? String(quote.unitPrice) : "",
    moq: quote?.minimumOrderQuantity == null ? "" : String(quote.minimumOrderQuantity),
    multiple: quote?.orderMultiple ? String(quote.orderMultiple) : "",
    date: quote?.quotedDeliveryDate ?? "",
    leadDays: quote?.leadTimeDays == null ? "" : String(quote.leadTimeDays),
    leadBasis: quote?.leadTimeBasis ?? "unknown",
    extraction: quote ?? null,
    reviewConfirmed: quote?.reviewConfirmed === true,
    packUomConfirmed: quote?.packUomConfirmed === true,
    overrideConfirmed: quote?.supplierOverrideConfirmed === true,
    deliveryStatus: (quote?.quotedDeliveryDate ? "confirmed" : quote?.leadTimeDays != null ? "lead-only" : "none") as "confirmed" | "lead-only" | "none",
    deliveryConfirmed: quote?.deliveryDateConfirmed === true,
    confirmationNote: quote?.deliveryConfirmationNote ?? "",
    documentDate: quote?.documentQuotedDeliveryDate ?? null,
    notes: [] as string[],
    step: (quote ? "review" : "upload") as "review" | "upload",
    documentRef: quote?.documentId && quote.documentName && quote.documentPath
      ? { documentId: quote.documentId, documentName: quote.documentName, documentPath: quote.documentPath } : null,
  };
}
