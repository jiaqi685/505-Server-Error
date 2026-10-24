import { useMemo, useState } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import type { Product, QuotationRequest, SupplierQuote } from "@/data";
import { QtyStepper } from "@/components/shared/qty-stepper";
import { money, plural, prettyDate } from "@/lib/format";
import { rankSupplierQuotes } from "@/lib/supplier-ranking";
import { InfoTip } from "@/components/shared/info-tip";
import { useModal } from "@/components/modals/modal-context";
import { comparisonPoQuantity } from "@/lib/procurement-safety";

interface Props {
  product: Product;
  request: QuotationRequest;
  quotes: SupplierQuote[];
  significantIncreasePct: number;
  onChoose: (quoteId: string, requestedQuantity: number) => void;
}

/**
 * Supplier comparison. Ranking is recalculated on every change of quantity or date
 * (src/lib/supplier-ranking.ts) — nothing is hardcoded.
 */
export function SupplierAnalysis({ product: p, request, quotes, significantIncreasePct, onChoose }: Props) {
  const { open } = useModal();
  const [qty, setQty] = useState(String(request.requestedQuantity));
  const [date, setDate] = useState(request.requestedDeliveryDate);
  const nQty = Number(qty);
  const qtyOk = Number.isInteger(nQty) && nQty > 0;
  const unit = p.stockUnit;

  const result = useMemo(
    () => rankSupplierQuotes(quotes, { requestedQuantity: qtyOk ? nQty : 0, requestedDeliveryDate: date, unit, significantIncreasePct }),
    [quotes, nQty, qtyOk, date, unit, significantIncreasePct],
  );
  const changed = nQty !== request.requestedQuantity || date !== request.requestedDeliveryDate;
  const poQuantity = comparisonPoQuantity(request, date);

  return (
    <section id="analysis" className="surface table-panel" style={{ marginTop: 19 }} aria-label="Supplier comparison">
      <div className="table-head">
        <div>
          <h3 className="title-row">Compare supplier offers<InfoTip>Ranked by total purchasing cost among suppliers that meet your date. Minimum orders are included.</InfoTip></h3>
        </div>
        <span className="tag green">{plural(quotes.length, "offer")}</span>
      </div>

      <div className="whatif">
        <div className="field">
          <label htmlFor="cmp-qty">What-if quantity ({unit}s)</label>
          <QtyStepper id="cmp-qty" value={qty} min={1} unit={unit} onChange={setQty} />
        </div>
        <div className="field">
          <label htmlFor="cmp-date">What-if deadline</label>
          <input id="cmp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-compare-date" />
        </div>
        {changed && (
          <button className="btn sm" onClick={() => { setQty(String(request.requestedQuantity)); setDate(request.requestedDeliveryDate); }} data-testid="button-reset-whatif">
            <RotateCcw size={14} /> Reset to request
          </button>
        )}
      </div>
      <p className="subtle-hint" style={{ margin: "0 19px 12px" }}>
        What-if scenarios only — the saved RFQ remains {request.requestedQuantity} {unit}s needed by {prettyDate(request.requestedDeliveryDate)}. PO preparation uses the saved RFQ, not the scenario.
        {poQuantity == null && " Reset the deadline to the saved RFQ date before preparing a PO."}
      </p>

      <p className="subtle-hint" style={{ margin: "0 19px 12px" }}>Conditional/order-level discounts excluded. Prices are comparable only after compatible SKU, pack and stock UOM are human-confirmed.</p>
      {result.recommended ? (
        <div className="recommend-box" data-testid="text-recommendation">
          <strong>Recommended: {result.recommended.quote.supplierName}</strong>
          <ul className="reason-points">
            {result.summary.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </div>
      ) : (
        <div className="inline-warning" style={{ margin: "0 19px 12px" }} data-testid="text-no-recommendation">
          <AlertTriangle size={16} /> <span>{result.noRecommendationReason} Use Edit to review supplier commitments.</span>
        </div>
      )}

      <div className="scroll-area analysis-scroll">
        <table className="data-table analysis-table">
          <thead>
            <tr>
              <th>Supplier</th><th>Price per {unit}</th><th>Min order</th><th>You must buy</th><th>Total cost</th><th>Delivery</th><th>Why</th><th>Choose</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.quote.quoteId} className={r.recommended ? "best" : !r.eligible ? "riskiest" : ""} data-testid={`row-quote-${r.quote.supplierId}`}>
                <td data-label="Supplier">
                  <span className="cell-strong">#{r.rank} {r.quote.supplierName}</span>
                  {r.recommended && <div><span className="tag green" style={{ marginTop: 6 }}>Recommended</span></div>}
                  {r.quote.source === "demo-example" && <div className="table-sub">Example Supplier Quotation</div>}
                  {r.quote.source === "document-upload" && <div className="table-sub">Gemini AI Extracted · {r.quote.reviewConfirmed ? "Human reviewed" : "Needs Human Verification"}</div>}
                  <button className="link-btn" onClick={() => open({ type: "upload-quotation", productId: p.productId, rfqId: request.rfqId, supplierId: r.quote.supplierId })} data-testid={`button-edit-comparison-${r.quote.supplierId}`}>Edit</button>
                </td>
                <td data-label={`Price per ${unit}`} className="cell-strong">
                  {r.quote.packConversionEvidence
                    ? r.compatibilityConfirmed && r.quote.normalizedUnitPrice != null
                      ? <>RM {r.quote.normalizedUnitPrice.toFixed(6)} <span className="table-sub">per {unit}</span></>
                      : <span className="text-warn">Needs review</span>
                    : money(r.quote.unitPrice)}
                  {r.quote.packConversionEvidence && <div className="table-sub">
                    Original quote: {money(r.quote.packConversionEvidence.originalUnitPrice)} per {r.quote.packConversionEvidence.outerUnit}
                  </div>}
                  {r.priceChangePct != null && Math.abs(r.priceChangePct) >= 0.05 && (
                    <div className={`table-sub ${r.significantIncrease ? "text-warn" : ""}`}>{r.priceChangePct > 0 ? "+" : ""}{r.priceChangePct.toFixed(1)}% vs last</div>
                  )}
                </td>
                <td data-label="Min order">{r.quote.minimumOrderQuantity == null ? "Not stated" : plural(r.quote.minimumOrderQuantity, unit)}</td>
                <td data-label="You must buy" data-testid={`text-actual-qty-${r.quote.supplierId}`}>
                  {r.quote.packConversionEvidence && r.compatibilityConfirmed
                    ? <>{plural(r.actualOrderQuantity, unit)} ({r.actualOrderQuantity / r.quote.packConversionEvidence.unitsPerOuter} {r.quote.packConversionEvidence.outerUnit}s)</>
                    : r.quote.minimumOrderQuantity == null ? "Quantity provisional until MOQ confirmed" : plural(r.actualOrderQuantity, unit)}
                  {r.excessQuantity > 0 && r.compatibilityConfirmed && <div className="table-sub text-warn">
                    {r.excessQuantity} extra {unit}s · {money(r.excessInventoryCost)}
                  </div>}
                  {r.quote.minimumOrderQuantity == null && <div className="table-sub text-warn">MOQ not stated — confirm with supplier</div>}
                </td>
                <td data-label="Total cost" className="cell-strong" data-testid={`text-total-${r.quote.supplierId}`}>
                  {!r.compatibilityConfirmed ? "Verify SKU / pack / UOM"
                    : r.quote.minimumOrderQuantity == null
                      ? <>{money(r.totalPurchaseCost)} <div className="table-sub text-warn">Provisional until MOQ is confirmed</div></>
                      : money(r.totalPurchaseCost)}
                </td>
                <td data-label="Delivery">
                  {r.estimatedDeliveryDate ? prettyDate(r.estimatedDeliveryDate) : "Delivery unconfirmed"}
                  {!r.estimatedDeliveryDate && r.quote.quotedDeliveryDate && <div className="table-sub">Recorded {prettyDate(r.quote.quotedDeliveryDate)} — promise needs re-verification</div>}
                  <div className={`table-sub ${r.delivery !== "on-time" ? "text-warn" : ""}`}>
                    {r.delivery === "on-time" ? "Supplier promise verified" : r.delivery === "late" ? `${plural(r.daysLate, "day")} late` : "Verify with supplier"}
                  </div>
                </td>
                <td data-label="Why" className="reason-cell">
                  <div>{r.delivery === "unknown" ? "Delivery unconfirmed." : r.delivery === "late" ? "Misses needed-by date." : "Verified date meets request."}</div>
                  <div>{r.quote.minimumOrderQuantity == null ? "MOQ is not stated; order quantity and total are provisional." : r.excessQuantity > 0 ? `${r.excessQuantity} extra ${unit}s · ${money(r.excessInventoryCost)} tied up.` : "No extra stock required."}</div>
                  <details><summary>Why?</summary><ul className="reason-points">{r.reasons.map((pt) => <li key={pt}>{pt}</li>)}</ul></details>
                </td>
                <td data-label="Choose">
                  <button className={`btn sm ${r.recommended ? "primary" : "outline"}`} disabled={!qtyOk || poQuantity == null || !r.compatibilityConfirmed} onClick={() => { if (poQuantity != null && r.compatibilityConfirmed) onChoose(r.quote.quoteId, poQuantity); }} data-testid={`button-quote-po-${r.quote.supplierId}`}>
                    Prepare PO
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="disclaimer" style={{ padding: "0 19px 17px" }}>
        Total cost = max(quantity needed, minimum order) × price. Suppliers with late or unknown delivery are never recommended. Extra stock is a waste risk — check expiry before buying.
        Pack equivalence remains unverified; quoted totals are not proof of savings. Preparing a PO is an explicit owner decision, not automatic sending.
      </div>
    </section>
  );
}
