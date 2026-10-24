import assert from "node:assert/strict";
import test from "node:test";
import { RequestQuotationUploadUrlBody } from "@workspace/api-zod";
import { inputs } from "./procurement-contracts";

test("quotation upload contract accepts PNG and continues to reject unsupported image types", () => {
  assert.equal(RequestQuotationUploadUrlBody.safeParse({ name: "quote.png", size: 128, contentType: "image/png" }).success, true);
  assert.equal(RequestQuotationUploadUrlBody.safeParse({ name: "quote.gif", size: 128, contentType: "image/gif" }).success, false);
});

test("connected procurement contracts accept an unknown MOQ and owner-recorded PO send details", () => {
  assert.equal(inputs["save-quote"].shape.minimumOrderQuantity.safeParse(null).success, true);
  assert.equal(inputs["mark-po-sent"].safeParse({
    poNumber: "PO-20261023-123456",
    method: "WhatsApp",
    sentAt: "2026-10-23T10:00:00.000Z",
    notes: null,
  }).success, true);
  assert.equal(inputs["mark-po-sent"].safeParse({
    poNumber: "PO-20261023-123456",
    method: "Automated",
    sentAt: "not-a-date",
  }).success, false);
});

test("multi-product reference contracts preserve line quantities as evidence, never MOQ", () => {
  const line = {
    lineItemId: "line-001",
    description: "Premium Fragrant Rice 5kg",
    sku: "RICE-5",
    unit: "bag",
    packSpecification: "5 kg bag",
    quotedQuantity: 8,
    unitPrice: 32.4,
    itemDiscount: null,
    lineTotal: 259.2,
  };
  const imported = inputs["import-quotation-document"].safeParse({
    documentId: "doc-001",
    documentName: "quote.pdf",
    documentPath: "/objects/private/doc-001",
    fingerprint: "a".repeat(64),
    quotedSupplierName: "FreshChoice Trading Sdn. Bhd.",
    quotationDateText: "21 October",
    validityText: "14 days",
    deliveryWording: "2 working days",
    conditionalDiscounts: ["5% above RM500"],
    notes: [],
    items: [line],
  });
  assert.equal(imported.success, true);
  assert.equal(inputs["import-quotation-document"].safeParse({
    documentId: "doc-001",
    documentName: "quote.pdf",
    documentPath: "/objects/private/doc-001",
    fingerprint: "a".repeat(64),
    quotedSupplierName: null,
    quotationDateText: null,
    validityText: null,
    deliveryWording: null,
    conditionalDiscounts: [],
    notes: [],
    items: [{ ...line, minimumOrderQuantity: 8 }],
  }).success, false);
  assert.equal(inputs["link-price-reference"].safeParse({ referenceId: "REF-1", rfqId: "RFQ-1", confirmLink: false }).success, false);
});
