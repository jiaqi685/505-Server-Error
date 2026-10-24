/** Boundary checks for untrusted model output. No credentials, network, or database access. */
export function normaliseQuotation(data: Record<string, unknown>) {
  const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null;
  const number = (value: unknown, integer = false, zero = false) =>
    typeof value === "number" && Number.isFinite(value) && (zero ? value >= 0 : value > 0) && (!integer || Number.isInteger(value)) ? value : null;
  const leadTimeText = text(data.leadTimeText);
  const leadTimeBasis = /working|business|bekerja/i.test(leadTimeText ?? "") ? "working-days"
    : data.leadTimeBasis === "calendar-days" ? "calendar-days" : data.leadTimeBasis === "working-days" ? "working-days" : "unknown";
  const rawDate = text(data.quotedDeliveryDate);
  const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? new Date(`${rawDate}T00:00:00Z`) : null;
  const quotedDeliveryDate = data.deliveryDateExplicit === true && text(data.deliveryDateText) && date && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === rawDate ? rawDate : null;
  const unitPrice = number(data.unitPrice);
  const minimumOrderQuantity = number(data.minimumOrderQuantity, true);
  const notes = Array.isArray(data.notes) ? data.notes.filter((n): n is string => typeof n === "string").slice(0, 8).map((n) => n.slice(0, 500)) : [];
  if (unitPrice == null) notes.push("Price is missing or invalid; enter and verify it manually.");
  if (minimumOrderQuantity == null) notes.push("MOQ is missing or invalid; enter and verify it manually.");
  if (!quotedDeliveryDate) notes.push("No explicit promised delivery date was verified. Requested dates and lead-time estimates are not supplier promises.");
  if (leadTimeBasis === "working-days") notes.push("Working days are preserved as stated; no calendar-day delivery promise has been calculated. Confirm weekends and public holidays with the supplier.");
  return {
    unitPrice, minimumOrderQuantity,
    orderMultiple: number(data.orderMultiple, true),
    leadTimeDays: number(data.leadTimeDays, true, true),
    leadTimeBasis, leadTimeText, quotedDeliveryDate,
    quotedSupplierName: text(data.quotedSupplierName),
    quotedProductName: text(data.quotedProductName),
    quotedUnit: text(data.quotedUnit),
    packDescription: text(data.packDescription),
    confidence: ["low", "medium", "high"].includes(String(data.confidence)) ? String(data.confidence) : "unknown",
    needsHumanReview: true,
    notes,
  };
}

export interface MultiQuotationLine {
  lineItemId: string;
  description: string | null;
  sku: string | null;
  unit: string | null;
  packSpecification: string | null;
  quotedQuantity: number | null;
  unitPrice: number | null;
  itemDiscount: string | null;
  lineTotal: number | null;
}

export function normaliseMultiQuotation(data: Record<string, unknown>) {
  const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 500) : null;
  const amount = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1_000_000 ? value : null;
  const integer = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 1_000_000 ? value : null;
  const rawItems = Array.isArray(data.items) ? data.items.slice(0, 100) : [];
  const items: MultiQuotationLine[] = rawItems.map((value, index) => {
    const item = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return {
      lineItemId: `line-${String(index + 1).padStart(3, "0")}`,
      description: text(item.description),
      sku: text(item.sku),
      unit: text(item.unit),
      packSpecification: text(item.packSpecification),
      quotedQuantity: integer(item.quotedQuantity),
      unitPrice: amount(item.unitPrice),
      itemDiscount: typeof item.itemDiscount === "number" && Number.isFinite(item.itemDiscount)
        ? String(item.itemDiscount).slice(0, 100) : text(item.itemDiscount),
      lineTotal: amount(item.lineTotal),
    };
  });
  const conditionalDiscounts = Array.isArray(data.conditionalDiscounts)
    ? data.conditionalDiscounts.filter((value): value is string => typeof value === "string").slice(0, 20).map((value) => value.trim().slice(0, 500)).filter(Boolean)
    : [];
  const notes = Array.isArray(data.notes)
    ? data.notes.filter((value): value is string => typeof value === "string").slice(0, 12).map((value) => value.trim().slice(0, 500)).filter(Boolean)
    : [];
  if (items.length === 0) notes.push("No quotation line items were identified. Review the original document and enter items manually.");
  if (rawItems.length > 100) notes.push("Only the first 100 line items were retained for review.");
  return {
    quotedSupplierName: text(data.quotedSupplierName),
    quotationDateText: text(data.quotationDateText),
    validityText: text(data.validityText),
    deliveryWording: text(data.deliveryWording),
    conditionalDiscounts,
    items,
    notes,
    needsHumanReview: true as const,
  };
}
