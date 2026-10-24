import type { PurchaseOrder } from "@/data";
import { BUSINESS_NAME } from "@/lib/brand";
import { money, shortDate } from "@/lib/format";
import { historicalSupplierLabel } from "@/lib/supplier-master";

export function PoSheet({ order: o }: { order: PurchaseOrder }) {
  const draft = o.status === "draft";
  const packConversion = o.quoteSnapshot?.packConversionEvidence;
  return (
    <section className="po-sheet" data-testid={`sheet-po-${o.poNumber}`}>
      <div className="po-sheet-top">
        <strong>{BUSINESS_NAME}</strong>
        <span className="tag orange">{draft ? "PO Draft — Pending Approval" : "Approved (Demo) — Not Sent"}</span>
      </div>
      <h2>PURCHASE ORDER</h2>
      <div className="po-info">
        <div><small>PO number</small><strong>{o.poNumber}</strong></div>
        <div><small>Date prepared</small><strong>{shortDate(o.preparedAt)}</strong></div>
        <div><small>Supplier</small><strong>{historicalSupplierLabel(o.supplierId, o.supplier)}</strong></div>
        <div><small>Requested by</small><strong>{BUSINESS_NAME}</strong></div>
        {o.rfqId && <div><small>Quotation reference</small><strong>{o.rfqId}</strong></div>}
      </div>
      <table>
        <thead>
          <tr><th>Product</th><th>Quantity</th><th>Unit price</th><th>Amount</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>{o.productName}</td>
            <td>
              {o.qty} {o.unit}s
              {o.orderPackCount != null && o.orderPackUnit && o.orderPackMultiplier && <small>
                {o.orderPackCount} {o.orderPackUnit}s × {o.orderPackMultiplier} {o.unit}s each
                {o.orderPackExtraQuantity != null && o.orderPackExtraQuantity > 0
                  ? ` · ${o.orderPackExtraQuantity} extra vs RFQ` : ""}
              </small>}
            </td>
            <td>
              {packConversion ? `RM ${o.unitPrice.toFixed(6)} / ${o.unit}` : money(o.unitPrice)}
              {packConversion && <small>
                Original quote: {money(packConversion.originalUnitPrice)} / {packConversion.outerUnit}
              </small>}
            </td>
            <td>{money(o.total)}</td>
          </tr>
        </tbody>
      </table>
      <div className="po-grand">TOTAL: {money(o.total)}</div>
      <p className="po-important">{draft ? "Pending approval. Do not send this draft as a confirmed order." : "Approved in this demo. Not yet sent to the supplier."}</p>
      <small>This PO is generated from sample data. No message or inventory update has been made.</small>
    </section>
  );
}
