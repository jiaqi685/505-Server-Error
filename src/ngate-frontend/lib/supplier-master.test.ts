import assert from "node:assert/strict";
import test from "node:test";
import { buildSeedProducts, SUPPLIERS } from "../data/seed";
import { historicalSupplierLabel, presentSupplierNames, supplierDisplayName } from "./supplier-master";
import { quotationReview } from "./quotation-review";
import { buildQuotationMessage } from "./whatsapp";

const rice = buildSeedProducts().find((p) => p.productId === "premium-fragrant-rice")!;
const freshChoice = "FreshChoice Trading Sdn. Bhd.";

test("verified master registers A-E with unchanged IDs; F-I remain pending", () => {
  assert.deepEqual(SUPPLIERS.map((s) => s.supplierId), ["SUP-A", "SUP-B", "SUP-C", "SUP-D", "SUP-E"]);
  assert.equal(SUPPLIERS[0].supplierName, "DailyMart Grocery Wholesale Sdn. Bhd.");
  assert.equal(SUPPLIERS[1].supplierName, freshChoice);
  assert.equal(SUPPLIERS[2].supplierName, "ValueStock Supply Sdn. Bhd.");
  assert.equal(SUPPLIERS[3].supplierName, "QuickBuy FMCG Distribution Sdn. Bhd.");
  assert.equal(SUPPLIERS[4].supplierName, "HappyMart Wholesale Sdn. Bhd.");
  assert.equal(supplierDisplayName("SUP-A", "Bintang Wholesale"), "Bintang Wholesale");
});

test("patch display normalization recognizes legacy placeholders but preserves conflicting company identities", () => {
  assert.equal(supplierDisplayName("SUP-B", " supplier   b "), freshChoice);
  assert.equal(supplierDisplayName("SUP-B", "FRESHCHOICE TRADING SDN.BHD."), freshChoice);
  assert.equal(supplierDisplayName("SUP-B", "Another Registered Company"), "Another Registered Company");
  assert.equal(supplierDisplayName("SUP-D", "Supplier D"), "QuickBuy FMCG Distribution Sdn. Bhd.");
  assert.equal(supplierDisplayName("SUP-E", "Supplier E"), "HappyMart Wholesale Sdn. Bhd.");
});

test("FreshChoice quotation matches Supplier B after harmless typography and Sdn. Bhd. variations", () => {
  for (const name of ["FreshChoice Trading SDN. BHD.", " freshchoice   trading sdn bhd ", "FRESHCHOICE TRADING SDN.BHD.", "FreshChoice Trading", "FreshChoice-Trading S.D.N. B.H.D."]) {
    assert.equal(quotationReview({ quotedSupplierName: name }, freshChoice, rice).supplierMismatch, false, name);
  }
  for (const name of ["Bintang Wholesale", "FreshChoice Wholesale Sdn. Bhd.", "Supplier B", "???"]) {
    const review = quotationReview({ quotedSupplierName: name }, freshChoice, rice);
    assert.equal(review.supplierMismatch, true, name);
    assert.match(review.warnings.join(" "), /explicitly confirm an override/);
  }
  assert.match(quotationReview({}, freshChoice, rice).warnings.join(" "), /identity is unverified/);
});

test("presentation updates legacy RFQs, quotations and activity without mutating saved purchases or PO snapshots", () => {
  const snapshot = {
    rfq: { suppliers: [{ supplierId: "SUP-B", supplierName: "Supplier B" }] },
    quote: { supplierId: "SUP-B", supplierName: "Supplier B", quotedSupplierName: "FreshChoice Trading SDN. BHD." },
    purchases: [{ supplierId: "SUP-B", supplierName: "Supplier B", qty: 50, unitPrice: 9.9, purchaseDate: "2026-09-29" }],
    order: { supplierId: "SUP-B", supplier: "Supplier B", status: "approved", total: 954, quoteSnapshot: { supplierId: "SUP-B", supplierName: "Supplier B" } },
    activity: { details: "Supplier B: RM31.80 · Supplier D unchanged" },
  };
  const original = JSON.stringify(snapshot);
  const display = presentSupplierNames(snapshot);
  assert.equal(display.rfq.suppliers[0].supplierName, freshChoice);
  assert.equal(display.quote.supplierName, freshChoice);
  assert.equal(display.quote.quotedSupplierName, snapshot.quote.quotedSupplierName, "Original document identity is not rewritten");
  assert.equal(display.purchases[0].supplierName, freshChoice);
  assert.deepEqual({ ...display.purchases[0], supplierName: "Supplier B" }, snapshot.purchases[0]);
  assert.deepEqual(display.order, snapshot.order, "Approved PO and its snapshot are not projected or overwritten");
  assert.match(historicalSupplierLabel(display.order.supplierId, display.order.supplier), /FreshChoice Trading.*recorded as Supplier B/);
  assert.equal(display.activity.details, `${freshChoice}: RM31.80 · QuickBuy FMCG Distribution Sdn. Bhd. unchanged`);
  assert.equal(JSON.stringify(snapshot), original, "No input purchase/history record may be mutated");
  assert.deepEqual(presentSupplierNames(display), display, "Projection is idempotent");
  assert.match(buildQuotationMessage({
    supplierName: display.rfq.suppliers[0].supplierName, productName: rice.productName,
    quantity: 17, unit: "bag", deliveryDate: "2099-10-30",
  }), /^Hi FreshChoice Trading Sdn\. Bhd\.,/);
});
