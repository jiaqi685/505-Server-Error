import { useEffect, useId, useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import type { Product, SupplierQuote } from "@/data/types";
import { freshnessMessages, riceSpecificationReview } from "@/lib/pos-quality";
import { money, prettyDate, todayLocal } from "@/lib/format";

export function PosFreshnessNote({ salesDate, inventoryDate }: { salesDate?: string; inventoryDate?: string }) {
  const [today, setToday] = useState(todayLocal);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(todayLocal()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const warnings = freshnessMessages(salesDate, inventoryDate, today);
  if (!warnings.length) return null;
  return <span className="pos-note warn" style={{ display: "block" }} role="note" data-testid="pos-freshness-warning">{warnings.map((w) => <span style={{ display: "block" }} key={w}>{w}</span>)}</span>;
}

export function RiceSpecificationNote({ product, quotes = [] }: { product: Product; quotes?: SupplierQuote[] }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (product.productId !== "premium-fragrant-rice") return null;
  const review = riceSpecificationReview(product, quotes);
  const priceFlag = review.belowExamplePrice || review.belowRecordedPrice;
  return (
    <div className="pos-prov spec-review" data-testid="rice-specification-review">
      <div className="spec-head">
        <strong>Product specification</strong>
        <button type="button" className="link-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} data-testid="button-rice-spec-details">
          Details <ChevronDown size={13} className={`inline-ico chev${open ? " up" : ""}`} aria-hidden />
        </button>
      </div>
      <ul className="spec-facts">
        <li data-testid="text-spec-sku"><span>SKU</span><b className="ok">Matched</b></li>
        <li data-testid="text-spec-pack"><span>Pack size</span><b className="warn">Needs verification</b></li>
        <li data-testid="text-spec-price"><span>Price anomaly</span><b className={priceFlag ? "warn" : ""}>{priceFlag ? "Review needed" : "None flagged"}</b></li>
      </ul>
      <p className="spec-caution">
        <AlertTriangle size={13} aria-hidden /> <span>Bag weights are unverified, so bag prices are not directly comparable. Confirm pack size with the supplier before ordering.</span>
      </p>
      {open && (
        <div className="spec-details" id={id}>
          <div><b>Catalogue SKU:</b> {review.sku}. Stock unit: {review.stockUnit}. Pack weight (kg per bag) and barcode: not recorded. No kg-to-bag conversion is assumed.</div>
          <div><b>POS selling price:</b> {review.retail == null ? "No POS price imported" : `${money(review.retail)} / bag (${review.retailDate ? prettyDate(review.retailDate) : "date unknown"})`}. Selling prices are not supplier buying prices.</div>
          <div><b>Past purchases (unchanged):</b> {review.historical.map((r) => `${r.supplierName} ${money(r.unitPrice)} / bag on ${prettyDate(r.purchaseDate)}`).join("; ")}.</div>
          <div><b>Demo quotation examples</b> (not confirmed current prices): {review.examples.map((q) => `${q.supplierName} ${money(q.unitPrice)} / bag`).join("; ")}.</div>
          {review.quotes.length > 0 && <div><b>Recorded quotations (unchanged):</b> {review.quotes.map((q) => `${q.supplierName} ${money(q.unitPrice)} / bag`).join("; ")}.</div>}
          {priceFlag && <div><b>Why review:</b> the POS selling price is below at least one {review.belowRecordedPrice ? "recorded supplier quotation" : "demo quotation example"}. Because pack sizes may differ, this is not evidence of a loss or margin problem — check SKU, pack size and quote date with the supplier.</div>}
          <div>No prices, specifications, past purchases or quotations were changed.</div>
        </div>
      )}
    </div>
  );
}
