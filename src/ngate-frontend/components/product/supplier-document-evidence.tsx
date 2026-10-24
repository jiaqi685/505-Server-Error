import type { Product } from "@/data";
import { documentLinesFor, documentedSupplierProduct, pendingSuppliers, stockUnitIdentity } from "@/lib/supplier-document-evidence";
import { supplierDisplayName } from "@/lib/supplier-master";

export function SupplierDocumentEvidence({ product: p }: { product: Product }) {
  const lines = documentLinesFor(p.productId);
  const unsupported = [...new Set(p.purchaseHistory.filter((h) => !documentedSupplierProduct(p.productId, h.supplierId)).map((h) => h.supplierName))];
  return (
    <section className="surface" style={{ padding: 18, marginTop: 19 }} data-testid="supplier-document-evidence">
      <strong>Supplier document evidence — not active quotations</strong>
      <p className="subtle-hint">All 66 document lines have unknown MOQ and unconfirmed pack mapping. Quoted quantities are not MOQ. Working-day ranges are not promised delivery dates. Conditional discounts are excluded from single-item comparisons.</p>
      {unsupported.length > 0 && <p className="validation-msg" data-testid="unsupported-historical-suppliers">Historical synthetic suppliers not supported for this product by these PDFs: {unsupported.join(", ")}. Purchases are retained; these links are excluded from new RFQ choices.</p>}
      <details>
        <summary>Review this product's document candidates and pending suppliers</summary>
        {lines.map((line) => <div className="modal-note" key={line.supplierId} style={{ marginTop: 10 }}>
          <strong>{supplierDisplayName(line.supplierId, `Supplier ${line.supplierId.slice(-1)}`)}</strong> · {line.supplierId} / {line.documentCode} / {line.quotationNumber}
          {pendingSuppliers.some((s) => s.supplierId === line.supplierId) && <strong> · Pending — not selectable</strong>}
          <p>{line.description} · document unit: {line.quotedUnit}; catalogue stock unit: {p.stockUnit}.
            {stockUnitIdentity(line.quotedUnit) !== stockUnitIdentity(p.stockUnit) ? " Unit mismatch — no automatic conversion." : " Pack/SKU still needs human confirmation."}</p>
          <p>Illustrative quoted quantity: {line.quotedQuantity} (not MOQ). MOQ: unknown. Delivery: {line.deliveryWording}; calendar date: unconfirmed.</p>
          <p>Discount evidence: {line.discountPolicy}{line.itemDiscount ? `; printed item discount ${line.itemDiscount}` : ""}. Not automatically applied.</p>
        </div>)}
        <p className="subtle-hint">Pending import, not registered or selectable: {pendingSuppliers.map((s) => `${s.supplierId} — ${s.supplierName}`).join("; ")}. New pack/stock-unit relationships must be confirmed first.</p>
        <p className="subtle-hint">Existing supplier lead-time and inventory figures remain historical demo estimates, not delivery commitments from these documents. No document price has been imported as an RFQ quotation.</p>
      </details>
    </section>
  );
}
