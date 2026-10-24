import { Check, FileUp, FlaskConical, MessageSquareText, Pencil } from "lucide-react";
import type { Product, QuotationRequest, SupplierQuote } from "@/data";
import { ProgressTracker } from "@/components/shared/bits";
import { RFQ_STATUS_LABEL } from "@/components/modals/whatsapp-modal";
import { money, plural, prettyDate } from "@/lib/format";
import type { ProgressStep } from "@/lib/workflow";
import { estimatedDelivery } from "@/lib/supplier-ranking";

interface Props {
  product: Product;
  request: QuotationRequest;
  suggestedOrderQuantity: number | null;
  quotes: SupplierQuote[];
  steps: ProgressStep[];
  demoMode: boolean;
  loadingExamples: boolean;
  markingSent: boolean;
  onOpenMessages: (supplierId?: string) => void;
  onMarkSent: (supplierId: string) => void;
  onUploadQuotation: (supplierId?: string) => void;
  onLoadExamples: () => void;
  onNewRequest: () => void;
}

export function RfqPanel(props: Props) {
  const { product: p, request, quotes, steps } = props;
  const suggestion = props.suggestedOrderQuantity;
  const quantityDiffersFromSuggestion = Number.isSafeInteger(suggestion) && suggestion! > 0 && suggestion !== request.requestedQuantity;
  const missing = request.suppliers.filter((s) => !quotes.some((q) => q.supplierId === s.supplierId)).length;
  return (
    <section className="surface panel-pad rfq-panel" id="rfq-stage" aria-label="Quotation request progress">
      <div className="section-head" style={{ marginBottom: 4 }}>
        <div>
          <h2>Quotation request {request.rfqId}</h2>
          <p className="subtext">
            {plural(request.requestedQuantity, p.stockUnit)} · needed by {prettyDate(request.requestedDeliveryDate)}
          </p>
        </div>
        <div className="row-action">
          <button className="btn sm outline" onClick={() => props.onOpenMessages()} data-testid="button-open-messages"><MessageSquareText size={14} /> WhatsApp messages</button>
          {!quantityDiffersFromSuggestion && <button className="btn sm" onClick={props.onNewRequest} data-testid="button-new-rfq">New request</button>}
        </div>
      </div>

      {quantityDiffersFromSuggestion && (
        <div role="status" data-testid="rfq-suggested-quantity-notice" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, margin: "12px 0", padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(73, 102, 65, .22)", background: "rgba(73, 102, 65, .07)" }}>
          <span>Current POS suggests {plural(suggestion!, p.stockUnit)}. This saved RFQ remains {plural(request.requestedQuantity, p.stockUnit)}.</span>
          <button className="btn sm" onClick={props.onNewRequest} data-testid="button-new-rfq">New request</button>
        </div>
      )}

      <ProgressTracker steps={steps} />

      <div className="rfq-suppliers">
        {request.suppliers.map((s) => {
          const q = quotes.find((x) => x.supplierId === s.supplierId);
          const [tone, label] = RFQ_STATUS_LABEL[s.status];
          return (
            <div className="rfq-supplier-row" key={s.supplierId} data-testid={`row-rfq-supplier-${s.supplierId}`}>
              <div style={{ minWidth: 0 }}>
                <div className="item-name">
                  {s.supplierName} <span className={`tag ${tone}`}>{label}</span>
                  {q && <span className="tag green">Quotation recorded</span>}
                  {q?.source === "demo-example" && <span className="tag">Example quotation</span>}
                </div>
                <div className="item-sub">
                  {q
                    ? `${money(q.unitPrice)} per ${p.stockUnit} · min ${q.minimumOrderQuantity == null ? "not stated (confirm with supplier)" : q.minimumOrderQuantity} · ${estimatedDelivery(q) ? `confirmed ${prettyDate(q.quotedDeliveryDate)}` : "delivery unconfirmed"}`
                    : "Waiting for quotation"}
                </div>
              </div>
              <div className="row-action">
                <button className="btn sm outline" onClick={() => props.onOpenMessages(s.supplierId)} data-testid={`button-open-message-${s.supplierId}`}>Open message</button>
                {s.status !== "marked-sent" && (
                  <button className="btn sm outline" disabled={props.markingSent} onClick={() => props.onMarkSent(s.supplierId)} data-testid={`button-row-mark-sent-${s.supplierId}`}>
                    <Check size={14} /> Mark as sent
                  </button>
                )}
                <button className={`btn sm ${q ? "" : "primary"}`} onClick={() => props.onUploadQuotation(s.supplierId)} data-testid={`button-upload-quotation-${s.supplierId}`}>
                  {q ? <><Pencil size={14} /> Edit quotation</> : <><FileUp size={14} /> Upload quotation</>}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {props.demoMode && missing > 0 && (
        <div className="demo-examples">
          <FlaskConical size={16} />
          <span>No real supplier yet? Load example replies to try the comparison. They are clearly marked as examples.</span>
          <button className="btn sm outline" onClick={props.onLoadExamples} disabled={props.loadingExamples} data-testid="button-load-examples">
            {props.loadingExamples ? "Loading…" : `Load ${plural(missing, "example quotation")}`}
          </button>
        </div>
      )}
    </section>
  );
}
