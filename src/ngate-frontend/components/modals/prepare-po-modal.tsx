import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { ModalShell } from "./modal-shell";
import { useModal } from "./modal-context";
import { QtyStepper } from "@/components/shared/qty-stepper";
import { useNotify } from "@/components/shared/toast";
import { useCreatePurchaseOrderDraft, useLatestQuotationRequest, useProduct, useSupplierQuotes } from "@/hooks/use-ngate";
import { useSettings } from "@/hooks/use-settings";
import { validatePoInput, poTotal } from "@/lib/costs";
import { insightFor } from "@/lib/inventory";
import { money, plural, prettyDate } from "@/lib/format";
import { actualOrderQuantityForQuote, estimatedDelivery, priceChangePct, quoteTotalForQuantity } from "@/lib/supplier-ranking";
import { isConnectedMode } from "@/data";
import { compatibleQuote } from "@/lib/supplier-document-evidence";

type Props = { productId: string } & ({ source: "quote"; quoteId: string; requestedQuantity: number } | { source: "history"; purchaseId: string });

export function PreparePoModal(props: Props) {
  const { productId } = props;
  const { close } = useModal();
  const notify = useNotify();
  const [, navigate] = useLocation();
  const settings = useSettings();
  const { data: product } = useProduct(productId);
  const { data: rfq } = useLatestQuotationRequest(productId);
  const { data: quotes } = useSupplierQuotes(props.source === "quote" ? rfq?.rfqId : null);
  const create = useCreatePurchaseOrderDraft();

  const quote = props.source === "quote" ? (quotes?.find((q) => q.quoteId === props.quoteId) ?? null) : null;
  const record = props.source === "history" ? product?.purchaseHistory.find((h) => h.purchaseId === props.purchaseId) : undefined;
  const supplierId = quote?.supplierId ?? record?.supplierId ?? "";
  const supplierName = quote?.supplierName ?? record?.supplierName ?? "";
  const min = quote?.minimumOrderQuantity ?? 1;
  const packMultiplier = quote?.packConversionEvidence?.unitsPerOuter ?? null;
  const stepperMin = quote && rfq && packMultiplier
    ? actualOrderQuantityForQuote(Math.max(rfq.requestedQuantity, min), quote)
    : min;

  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [verified, setVerified] = useState(false);
  const initialized = useRef(false);
  const ready = !!product && (props.source === "quote" ? !!quote : !!record);

  useEffect(() => {
    if (!ready || initialized.current || !product) return;
    initialized.current = true;
    if (quote && props.source === "quote") {
      setQty(String(actualOrderQuantityForQuote(rfq!.requestedQuantity, quote)));
      setPrice(String(quote.normalizedUnitPrice ?? quote.unitPrice));
    } else if (record) {
      const s = insightFor(product, settings).suggestedOrderQuantity;
      setQty(String(s && s > 0 ? s : product.reorderLevel));
      setPrice(String(record.unitPrice));
    }
  }, [ready, product, quote, record, props, settings]);

  const nQty = Number(qty);
  const nPrice = Number(price);
  const requested = props.source === "quote" ? rfq?.requestedQuantity ?? null : null;
  const baseCheck = validatePoInput(nQty, nPrice, min, requested);
  const check = packMultiplier && Number.isInteger(nQty) && nQty > 0 && nQty % packMultiplier !== 0
    ? { valid: false, message: `Enter a whole number of ${quote?.packConversionEvidence?.outerUnit}s (${packMultiplier} ${product?.stockUnit}s per pack).` }
    : baseCheck;
  const total = quote?.packConversionEvidence && check.valid
    ? quoteTotalForQuantity(quote, nQty)
    : poTotal(nQty, nPrice);
  const quoteCompatible = !quote || compatibleQuote(quote, product?.stockUnit ?? "");
  const canSubmit = ready && check.valid && quoteCompatible && (props.source !== "history" || verified);
  const excess = requested != null && check.valid ? Math.max(0, nQty - requested) : 0;
  const change = quote ? priceChangePct(nPrice, quote.previousUnitPrice) : null;
  const eta = quote ? estimatedDelivery(quote) : null;

  const submit = () => {
    if (!product) return;
    if (!check.valid) return notify(check.message);
    if (!quoteCompatible) return notify("Review the quotation's compatible SKU, pack, stock UOM and supplier relationship first.");
    if (props.source === "history" && !verified) return notify("Confirm the current supplier price first.");
    create.mutate(
      { productId, supplierId, qty: nQty, unitPrice: nPrice, rfqId: quote?.rfqId ?? null, quoteId: quote?.quoteId ?? null, historicalPriceConfirmed: props.source === "history" && verified },
      {
        onSuccess: (o) => {
          close();
          navigate("/orders");
          window.scrollTo(0, 0);
          notify(o.status === "approved" ? `${o.poNumber} was already approved — not sent. No duplicate PO created.` : `${o.poNumber} draft ready — pending approval, not sent.`);
        },
        onError: (e) => notify(e.message),
      },
    );
  };

  return (
    <ModalShell
      title="Prepare PO"
      description="Edit the quantity and price, then generate a draft for review. This will NOT send anything to your supplier."
      onClose={close}
      footer={
        <div className="modal-foot">
          <button className="btn" onClick={close} data-testid="button-cancel-po">Cancel</button>
          <button className="btn primary" disabled={!canSubmit || create.isPending} onClick={submit} data-testid="button-generate-po">
            {create.isPending ? "Generating…" : "Generate Draft"} <ArrowRight size={15} />
          </button>
        </div>
      }
    >
      {!ready || !product ? (
        <div className="skel" style={{ height: 200 }} />
      ) : (
        <>
          <div className="modal-grid">
            <div className="field wide">
              <label>Supplier and product</label>
              <div className="modal-note"><strong>{supplierName}</strong> — {product.productName}</div>
              {quote && rfq && <div className="modal-note">Saved RFQ: {rfq.requestedQuantity} {product.stockUnit}s needed by {prettyDate(rfq.requestedDeliveryDate)}. What-if scenarios do not change this request. Partial orders are not supported.</div>}
            </div>
            <div className="field">
              <label htmlFor="po-qty">Quantity ({product.stockUnit}s)</label>
              <QtyStepper id="po-qty" value={qty} min={stepperMin} step={packMultiplier ?? 1} unit={product.stockUnit} onChange={setQty} />
            </div>
            <div className="field">
              <label htmlFor="po-price">Price per {product.stockUnit} (RM)</label>
              <input id="po-price" type="number" inputMode="decimal" step={packMultiplier ? "any" : "0.01"} min="0.01" value={price} readOnly={isConnectedMode && !!quote} onChange={(e) => setPrice(e.target.value)} data-testid="input-po-price" />
              {isConnectedMode && quote && <span className="subtle-hint">To change this offer, edit and verify the supplier quotation first.</span>}
            </div>
          </div>
          <div className="modal-summary">
            <span>Total cost</span>
            <strong data-testid="text-po-total">{check.valid ? money(total) : "—"}</strong>
          </div>
          <div className="validation-msg" aria-live="polite">{check.message}</div>
          {!quoteCompatible && <p className="validation-msg">Review the quotation's compatible SKU, pack, stock UOM and supplier relationship before preparing this PO.</p>}
          {excess > 0 && (
            <div className="inline-warning" style={{ marginTop: 10 }} data-testid="warning-po-excess">
              <AlertTriangle size={16} />
              <span>You asked for {requested}. This order has {plural(excess, `extra ${product.stockUnit}`)} ({money(poTotal(excess, nPrice))}){quote?.packConversionEvidence ? " because suppliers sell this line in whole packs." : " because of the minimum order."}</span>
            </div>
          )}
          {props.source === "history" && (
            <label className="supplier-choice" style={{ margin: "14px 0" }}>
              <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} data-testid="checkbox-po-verified" /> I checked this price with the supplier (past prices may have changed).
            </label>
          )}
          <div className="modal-note" style={{ marginTop: 12 }}>
            {quote ? (
              <>
                {quote.packConversionEvidence
                  ? <>Original quote: {money(quote.packConversionEvidence.originalUnitPrice)} per {quote.packConversionEvidence.outerUnit}; normalized RM {quote.packConversionEvidence.normalizedUnitPrice.toFixed(6)} per {product.stockUnit}. {packMultiplier ? `${nQty / packMultiplier} whole ${quote.packConversionEvidence.outerUnit}s = ${nQty} ${product.stockUnit}s.` : ""}</>
                  : <>Quoted: {money(quote.unitPrice)} per {product.stockUnit}</>}
                {" "}· minimum order {quote.minimumOrderQuantity == null ? "not stated — confirm with supplier" : quote.minimumOrderQuantity}
                {eta ? ` · ${quote?.quotedDeliveryDate ? "delivery offered" : "tentative calendar-day estimate"} ${prettyDate(eta)}` : " · delivery date unknown"}
                {change != null && Math.abs(change) >= 0.05 ? ` · ${change > 0 ? "+" : ""}${change.toFixed(1)}% vs last price paid` : ""}
                {quote.source === "demo-example" ? " · example quotation" : ""}
              </>
            ) : (
              `Previously paid: ${money(record?.unitPrice ?? 0)} per ${product.stockUnit} on ${record?.purchaseDate}.`
            )}
            <br />
            The PO will be saved as <strong>PO Draft — Pending Approval</strong>. It is not sent to the supplier.
          </div>
        </>
      )}
    </ModalShell>
  );
}
