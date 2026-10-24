import type { Product } from "@/data";
import { documentedSupplierProduct } from "@/lib/supplier-document-evidence";
import { money, plural, prettyDate } from "@/lib/format";
import { InfoTip } from "@/components/shared/info-tip";

interface Props {
  product: Product;
  onRequestQuote: (supplierId: string) => void;
  onPreparePo: (purchaseId: string) => void;
}

export function PurchaseHistoryTable({ product: p, onRequestQuote, onPreparePo }: Props) {
  return (
    <section className="surface table-panel">
      <div className="table-head">
        <div>
          <h3 className="title-row">Past purchases<InfoTip>Prices from past orders. They may have changed — confirm before ordering.</InfoTip></h3>
        </div>
        <span className="tag">{plural(p.purchaseHistory.length, "record")}</span>
      </div>
      <div className="scroll-area purchases-scroll">
        <table className="data-table purchases-table">
          <thead>
            <tr><th>Supplier</th><th>Price per {p.stockUnit}</th><th>Quantity</th><th>Date bought</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {p.purchaseHistory.map((r) => (
              <tr key={r.purchaseId} data-testid={`row-purchase-${r.purchaseId}`}>
                <td data-label="Supplier" className="cell-strong">{r.supplierName}<div className="table-sub">Historical synthetic seed · {documentedSupplierProduct(p.productId, r.supplierId) ? "pack/UOM unverified" : "not supported by current PDFs"}</div></td>
                <td data-label={`Price per ${p.stockUnit}`}>{money(r.unitPrice)}</td>
                <td data-label="Quantity">{plural(r.quantity, p.stockUnit)}</td>
                <td data-label="Date bought">{prettyDate(r.purchaseDate)}</td>
                <td data-label="Actions">
                  <div className="row-action">
                    <button className="btn sm outline" disabled={!documentedSupplierProduct(p.productId, r.supplierId)} onClick={() => onRequestQuote(r.supplierId)} data-testid={`button-request-quote-${r.purchaseId}`}>Request Quotation</button>
                    <button className="btn sm" onClick={() => onPreparePo(r.purchaseId)} data-testid={`button-history-po-${r.purchaseId}`}>Prepare PO</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
