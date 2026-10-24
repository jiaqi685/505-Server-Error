export type ProductSelectionSource = "auto" | "manual" | "saved" | "none";

export interface ResettableQuotationLineDraft {
  productId: string;
  productSelectionSource: ProductSelectionSource;
  selected: boolean;
  unitConversionConfirmed: boolean;
  unitConversionNote: string;
  cataloguePackConfirmed?: boolean;
}

export interface ExpandableQuotationLineDraft extends ResettableQuotationLineDraft {
  expanded: boolean;
}

/** Re-evaluate only untouched automatic assignments when asynchronous catalogue data arrives. */
export function reconcileAutomaticProductAssignment<T extends ResettableQuotationLineDraft>(
  draft: T,
  suggestedProductId: string | null,
): T {
  if (draft.productSelectionSource === "manual" || draft.productSelectionSource === "saved") return draft;
  const productId = suggestedProductId ?? "";
  const productSelectionSource: ProductSelectionSource = productId ? "auto" : "none";
  if (draft.productId === productId && draft.productSelectionSource === productSelectionSource) return draft;
  return {
    ...draft,
    productId,
    productSelectionSource,
    selected: false,
    unitConversionConfirmed: false,
    unitConversionNote: "",
    cataloguePackConfirmed: false,
  };
}

/** Keep each line's draft isolated while switching the visible review target. */
export function switchQuotationReviewLine<T extends ExpandableQuotationLineDraft>(
  current: Record<string, T>,
  referenceIds: string[],
  activeReferenceId: string,
  createDraft: (referenceId: string) => T,
): Record<string, T> {
  const next = { ...current };
  for (const referenceId of referenceIds) {
    const draft = next[referenceId] ?? createDraft(referenceId);
    next[referenceId] = {
      ...draft,
      selected: false,
      expanded: referenceId === activeReferenceId,
    };
  }
  return next;
}

/** Changing product invalidates the line's prior selection and pack/unit evidence. */
export function resetLineAfterProductChange<T extends ResettableQuotationLineDraft>(
  draft: T,
  productId: string,
): T {
  return {
    ...draft,
    productId,
    productSelectionSource: "manual",
    selected: false,
    unitConversionConfirmed: false,
    unitConversionNote: "",
    cataloguePackConfirmed: false,
  };
}

/** Changing document supplier invalidates only the pending line's confirmations. */
export function resetLineAfterSupplierChange<T extends ResettableQuotationLineDraft>(draft: T): T {
  return {
    ...draft,
    selected: false,
    unitConversionConfirmed: false,
    unitConversionNote: "",
    cataloguePackConfirmed: false,
  };
}
