import { z } from "@workspace/api-zod";

const id = z.string().min(1).max(200);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const quantity = z.number().int().positive().max(1_000_000);
const price = z.number().finite().positive().max(1_000_000);
const optionalText = z.string().max(500).nullable().optional();
const packConversionEvidence = z.object({
  sourceText: z.string().min(1).max(500),
  outerUnit: id,
  innerUnit: id,
  unitsPerOuter: quantity,
  innerSizeMl: price,
  originalUnitPrice: price,
  normalizedUnitPrice: price,
  quotedQuantity: quantity.nullable(),
  equivalentQuantity: quantity.nullable(),
  originalLineTotal: z.number().finite().min(0).max(1_000_000).nullable(),
  cataloguePackStatus: z.enum(["catalogue-match", "owner-confirmed"]),
  cataloguePackDescription: z.string().max(500).nullable(),
  reviewedAt: z.string(),
}).strict();
const evidence = {
  deliveryDateConfirmed: z.boolean().optional(),
  packUomConfirmed: z.boolean().optional(),
  deliveryConfirmationSource: z.enum(["document", "supplier-contact"]).nullable().optional(),
  deliveryConfirmationNote: optionalText,
  documentQuotedDeliveryDate: date.nullable().optional(),
  leadTimeBasis: z.enum(["working-days", "calendar-days", "unknown"]).optional(),
  leadTimeText: optionalText, quotedSupplierName: optionalText, quotedProductName: optionalText,
  quotedUnit: optionalText, packDescription: optionalText, confidence: z.string().max(500).optional(),
  needsHumanReview: z.boolean().optional(), reviewConfirmed: z.boolean().optional(),
  supplierOverrideConfirmed: z.boolean().optional(),
  unitConversionConfirmed: z.boolean().optional(), unitConversionNote: optionalText,
};
const quoteValues = {
  rfqId: id, supplierId: id, unitPrice: price, minimumOrderQuantity: quantity.nullable(),
  normalizedUnitPrice: price.nullable().optional(),
  packConversionEvidence: packConversionEvidence.nullable().optional(),
  orderMultiple: quantity.nullable().optional(), leadTimeDays: z.number().int().min(0).max(3650).nullable(),
  quotedDeliveryDate: date.nullable(), source: z.enum(["document-upload", "manual", "demo-example"]),
  documentId: optionalText, documentName: optionalText, documentPath: optionalText, ...evidence,
};
const quotationLine = z.object({
  lineItemId: z.string().regex(/^line-\d{3}$/),
  description: optionalText,
  sku: optionalText,
  unit: optionalText,
  packSpecification: optionalText,
  quotedQuantity: quantity.nullable(),
  unitPrice: z.number().finite().min(0).max(1_000_000).nullable(),
  itemDiscount: optionalText,
  lineTotal: z.number().finite().min(0).max(1_000_000).nullable(),
}).strict();
const reviewEvidence = z.object({
  supplierId: id, supplierName: id, productId: id, productName: id,
  quotedUnit: optionalText, catalogueUnit: id, quotedPackSpecification: optionalText,
  cataloguePackSize: optionalText, quotedUnitPrice: price, reviewedAt: z.string(),
}).strict();
const reference = z.object({
  ...quotationLine.shape,
  referenceId: id, documentId: id, documentName: id, documentPath: id,
  quotedSupplierName: optionalText, quotationDateText: optionalText, validityText: optionalText, deliveryWording: optionalText,
  conditionalDiscounts: z.array(z.string().max(500)), productId: id.nullable(), supplierId: id.nullable(), supplierName: id.nullable(),
  status: z.enum(["pending", "verified", "linked"]), supplierIdentityConfirmed: z.boolean(),
  supplierOverrideConfirmed: z.boolean(), productMatchConfirmed: z.boolean(), packUomConfirmed: z.boolean(), priceConfirmed: z.boolean(),
  unitConversionConfirmed: z.boolean(), unitConversionNote: optionalText, reviewConfirmed: z.boolean().optional(),
  reviewEvidence: reviewEvidence.nullable(), packConversionEvidence: packConversionEvidence.nullable(),
  verifiedAt: optionalText, linkedRfqId: id.nullable(), createdAt: z.string(),
}).strict();
const quotationDocument = z.object({
  documentId: id, documentName: id, documentPath: id, fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  quotedSupplierName: optionalText, quotationDateText: optionalText, validityText: optionalText, deliveryWording: optionalText,
  confirmedSupplierId: id.nullable(), supplierIdentityConfirmed: z.boolean(), supplierOverrideConfirmed: z.boolean(),
  supplierConfirmedAt: optionalText,
  conditionalDiscounts: z.array(z.string().max(500)), notes: z.array(z.string().max(500)),
  createdAt: z.string(), items: z.array(reference),
}).strict();
const importQuotationDocument = z.object({
  documentId: id, documentName: id, documentPath: id, fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  quotedSupplierName: optionalText, quotationDateText: optionalText, validityText: optionalText, deliveryWording: optionalText,
  conditionalDiscounts: z.array(z.string().max(500)).max(20), notes: z.array(z.string().max(500)).max(12),
  items: z.array(quotationLine).min(1).max(100),
}).strict();
const contact = z.object({ rfqId: id, supplierId: id }).strict();
export const inputs = {
  "create-rfq": z.object({ productId: id, requestedQuantity: quantity, requestedDeliveryDate: date, supplierIds: z.array(id).min(1).max(20) }).strict(),
  "whatsapp-opened": contact, "mark-sent": contact,
  "mark-po-sent": z.object({
    poNumber: id,
    method: z.enum(["WhatsApp", "Email", "Phone", "Other"]),
    sentAt: z.string().datetime({ offset: true }),
    notes: z.string().max(500).nullable().optional(),
  }).strict(),
  "save-quote": z.object(quoteValues).strict(),
  "import-quotation-document": importQuotationDocument,
  "confirm-quotation-supplier": z.object({
    documentId: id, supplierId: id, supplierIdentityConfirmed: z.literal(true), supplierOverrideConfirmed: z.boolean(),
  }).strict(),
  "review-price-reference": z.object({
    referenceId: id, productId: id.nullable(), unitConversionConfirmed: z.boolean().optional(),
    unitConversionNote: optionalText,
  }).strict(),
  "verify-price-references": z.object({
    documentId: id,
    references: z.array(z.object({
      referenceId: id, productId: id, unitConversionConfirmed: z.boolean().optional(),
      unitConversionNote: optionalText, cataloguePackConfirmed: z.boolean().optional(),
    }).strict()).min(1).max(100),
  }).strict(),
  "link-price-reference": z.object({ referenceId: id, rfqId: id, confirmLink: z.literal(true) }).strict(),
  "example-quotes": z.object({ rfqId: id, confirmSynthetic: z.literal(true) }).strict(),
  "create-po": z.object({ productId: id, supplierId: id, qty: quantity, unitPrice: price, rfqId: id.nullable().optional(), quoteId: id.nullable().optional(), historicalPriceConfirmed: z.boolean().optional() }).strict(),
  "approve-po": z.object({ poNumber: id }).strict(),
  "log-activity": z.object({ action: id, status: id, details: z.string().max(2000), actor: optionalText, productId: optionalText, productName: optionalText, supplierId: optionalText, rfqId: optionalText, poNumber: optionalText }).strict(),
};
export const rfq = z.object({
  rfqId: id, productId: id, requestedQuantity: quantity, requestedDeliveryDate: date, createdAt: z.string(),
  suppliers: z.array(z.object({ supplierId: id, supplierName: id, status: z.enum(["prepared", "whatsapp-opened", "marked-sent"]), whatsappOpenedAt: optionalText, markedSentAt: optionalText })),
});
export const quote = z.object({
  ...quoteValues, quoteId: id, productId: id, supplierName: id, previousUnitPrice: price.nullable(),
  supplierProductRelationshipConfirmed: z.boolean().optional(),
  sourceLineEvidence: z.object({
    referenceId: id, lineItemId: z.string().regex(/^line-\d{3}$/),
    quotedQuantity: quantity.nullable(), itemDiscount: optionalText,
    lineTotal: z.number().finite().min(0).max(1_000_000).nullable(),
    conditionalDiscounts: z.array(z.string().max(500)),
    reviewEvidence: reviewEvidence.nullable(),
    packConversionEvidence: packConversionEvidence.nullable().optional(),
  }).strict().optional(),
  receivedAt: z.string(), updatedAt: z.string().optional(),
});
export const po = z.object({
  poNumber: id, productId: id, productName: id, supplierId: id, supplier: id, rfqId: id.nullable().optional(), quoteId: id.nullable().optional(),
  qty: quantity, unit: id, unitPrice: price, total: z.number().finite().positive(), status: z.enum(["draft", "approved"]), preparedAt: z.string(), approvedAt: optionalText,
  orderPackCount: quantity.nullable().optional(), orderPackUnit: optionalText,
  orderPackMultiplier: quantity.nullable().optional(),
  orderPackExtraQuantity: z.number().int().min(0).max(1_000_000).nullable().optional(),
  quoteSnapshot: quote.nullable().optional(),
  sentStatus: z.literal("sent").optional(), markedSentAt: optionalText,
  markedSentMethod: z.enum(["WhatsApp", "Email", "Phone", "Other"]).nullable().optional(), sentNotes: optionalText,
});
export const activity = z.object({
  eventId: id, timestamp: z.string(), action: id, status: id, actor: id, details: z.string(),
  productId: optionalText, productName: optionalText, supplierId: optionalText, rfqId: optionalText, poNumber: optionalText,
});
export const state = z.object({ quotationRequests: z.array(rfq), quotes: z.array(quote), purchaseOrders: z.array(po) });
export const outputs = {
  dashboard: state, "latest-rfq": rfq.nullable(), quotes: z.array(quote), orders: z.array(po), activity: z.array(activity),
  "quotation-documents": z.array(quotationDocument), "price-references": z.array(reference),
  "import-quotation-document": quotationDocument, "confirm-quotation-supplier": quotationDocument,
  "review-price-reference": reference, "verify-price-references": z.array(reference), "link-price-reference": quote,
  "create-rfq": rfq, "whatsapp-opened": rfq, "mark-sent": rfq, "save-quote": quote,
  "example-quotes": z.array(quote), "create-po": po, "approve-po": po, "log-activity": activity,
  "mark-po-sent": po,
};
export const readQueries = {
  dashboard: z.object({}).strict(), "latest-rfq": z.object({ productId: id }).strict(),
  quotes: z.object({ rfqId: id }).strict(), "quotation-documents": z.object({}).strict(),
  "price-references": z.object({ productId: id }).strict(), orders: z.object({}).strict(), activity: z.object({}).strict(),
};
