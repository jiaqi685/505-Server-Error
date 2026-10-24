import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { Check, Circle, Download, Eye, Package } from "lucide-react";
import { ErrorState, PageHead, Skeleton } from "@/components/shared/bits";
import { useModal } from "@/components/modals/modal-context";
import { useNotify } from "@/components/shared/toast";
import { useApprovePurchaseOrder, useMarkPurchaseOrderSent, usePurchaseOrders } from "@/hooks/use-ngate";
import { usePoActions } from "@/hooks/use-po-actions";
import type { PurchaseOrder } from "@/data";
import { APP_NAME } from "@/lib/brand";
import { dateTime, money } from "@/lib/format";
import { isConnectedMode } from "@/data";
import { poStatusLabel } from "@/lib/po-document";
import { historicalSupplierLabel } from "@/lib/supplier-master";

type SentFormState = { poNumber: string; method: "WhatsApp" | "Email" | "Phone" | "Other"; sentAt: string; notes: string };

function businessLocalNow(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function Tracking({ o }: { o: PurchaseOrder }) {
  const steps: [string, boolean][] = [
    ["PO prepared", true],
    ["Approved", o.status === "approved"],
    ["Sent to supplier", o.sentStatus === "sent" || !!o.markedSentAt],
  ];
  return (
    <div className="tracking-steps">
      {steps.map(([label, done]) => (
        <span key={label} className={`tracking-step ${done ? "done" : ""}`}>
          <span className="tracking-circle">{done ? <Check size={12} /> : <Circle size={10} />}</span>
          {label}
        </span>
      ))}
    </div>
  );
}

export default function OrdersPage() {
  const { data: orders, isLoading, isError, error, refetch } = usePurchaseOrders();
  const approve = useApprovePurchaseOrder();
  const markSent = useMarkPurchaseOrderSent();
  const { open } = useModal();
  const notify = useNotify();
  const { download } = usePoActions();
  const [sentForm, setSentForm] = useState<SentFormState | null>(null);

  const waiting = orders?.filter((o) => o.status === "draft").length ?? 0;
  const approved = orders?.filter((o) => o.status === "approved" && o.sentStatus !== "sent" && !o.markedSentAt).length ?? 0;
  const sent = orders?.filter((o) => o.sentStatus === "sent" || !!o.markedSentAt).length ?? 0;

  const markApproved = (po: string) =>
    approve.mutate(po, {
      onSuccess: () => notify(`${po} ${isConnectedMode ? "approval saved in Flask SQLite" : "marked approved (Demo)"}. Still not sent.`),
      onError: (e) => notify(e.message),
    });

  const recordSent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sentForm) return;
    const sentDate = new Date(`${sentForm.sentAt}:00+08:00`);
    if (!sentForm.sentAt || Number.isNaN(sentDate.getTime())) return notify("Choose a valid sent date and time.");
    markSent.mutate({
      poNumber: sentForm.poNumber,
      method: sentForm.method,
      sentAt: sentDate.toISOString(),
      notes: sentForm.notes.trim() || null,
    }, {
      onSuccess: () => {
        notify(`${sentForm.poNumber} marked as sent. NGate did not send it.`);
        setSentForm(null);
      },
      onError: (e) => notify(e.message),
    });
  };

  return (
    <>
      <PageHead
        eyebrow="PURCHASE ORDER DRAFTS"
        title="My Orders"
        info="View and download purchase orders. Nothing is sent automatically."
        right={<span className="tag orange">{isConnectedMode ? "Flask SQLite · manual send only" : "Local demo · manual send only"}</span>}
      />
      <div className="summary-grid">
        <div className="surface"><small>Waiting for Approval</small><strong data-testid="text-count-waiting">{waiting}</strong></div>
        <div className="surface"><small>Approved · Not Sent</small><strong data-testid="text-count-approved">{approved}</strong></div>
        <div className="surface"><small>POs Manually Marked as Sent</small><strong data-testid="text-count-sent">{sent}</strong></div>
      </div>

      {isError ? (
        <ErrorState message={error?.message} onRetry={() => refetch()} />
      ) : (
        <div className="surface orders-panel">
          {isLoading || !orders ? (
            <div style={{ padding: "18px 0", display: "grid", gap: 14 }}>
              <Skeleton h={130} />
              <Skeleton h={130} />
            </div>
          ) : orders.length === 0 ? (
            <div className="empty">
              <Package size={34} />
              <h3>No PO drafts yet</h3>
              <p>Go to Purchasing, compare supplier offers, and choose Prepare PO.</p>
              <Link href="/purchasing" className="btn primary" data-testid="link-open-purchasing">Open Purchasing</Link>
            </div>
          ) : (
            [...orders].reverse().map((o) => {
              const st = poStatusLabel(o);
              const draft = o.status === "draft";
              const isSent = o.sentStatus === "sent" || !!o.markedSentAt;
              return (
                <div className="order-tracking-card" key={o.poNumber} data-testid={`card-po-${o.poNumber}`}>
                  <div className="order-track-top">
                    <div>
                      <h3>{o.poNumber} · {o.productName}</h3>
                      <p>{historicalSupplierLabel(o.supplierId, o.supplier)} · {o.qty} {o.unit}s × {money(o.unitPrice)} = <strong>{money(o.total)}</strong></p>
                      {o.orderPackCount != null && o.orderPackUnit && o.orderPackMultiplier && <p className="table-sub">
                        {o.orderPackCount} {o.orderPackUnit}s ({o.orderPackMultiplier} {o.unit}s each)
                        {o.orderPackExtraQuantity != null && o.orderPackExtraQuantity > 0
                          ? ` · ${o.orderPackExtraQuantity} extra ${o.unit}s vs RFQ` : ""}
                      </p>}
                      <p className="table-sub">Prepared {dateTime(o.preparedAt)}{o.rfqId ? ` · from ${o.rfqId}` : " · from past purchase price"}</p>
                    </div>
                    <span className={`tag ${st.tone}`} data-testid={`status-po-${o.poNumber}`}>{st.label}</span>
                  </div>
                  <Tracking o={o} />
                  <div className="order-next">
                    <div>
                      <strong>{draft ? "Ready for review — not yet approved" : isSent ? "Sent manually — recorded by account owner" : "Approved — not yet sent"}</strong>
                      <p>
                        {draft
                          ? `Review the PO, download it, and obtain approval before sending it outside ${APP_NAME}.`
                          : isSent
                            ? `Recorded ${o.markedSentAt ? dateTime(o.markedSentAt) : "as sent"}${o.markedSentMethod ? ` via ${o.markedSentMethod}` : ""}. ${APP_NAME} did not transmit it.`
                            : `Download the approved PO and send it using your business process. ${APP_NAME} does not send it.`}
                      </p>
                    </div>
                    <div className="po-actions">
                      <button className="btn primary sm" onClick={() => open({ type: "po-view", poNumber: o.poNumber })} data-testid={`button-view-po-${o.poNumber}`}>
                        <Eye size={14} /> View PO
                      </button>
                      <button className="btn sm outline" onClick={() => download(o)} data-testid={`button-download-po-${o.poNumber}`}>
                        <Download size={14} /> Download PDF
                      </button>
                      {draft && (
                        <button className="btn sm outline" disabled={approve.isPending} onClick={() => markApproved(o.poNumber)} data-testid={`button-approve-po-${o.poNumber}`}>
                          {isConnectedMode ? "Approve PO" : "Demo Approval"}
                        </button>
                      )}
                      {!draft && !isSent && (
                        <button
                          className="btn sm outline"
                          onClick={() => setSentForm({ poNumber: o.poNumber, method: "WhatsApp", sentAt: businessLocalNow(), notes: "" })}
                          data-testid={`button-mark-po-sent-${o.poNumber}`}
                        >
                          Mark as sent
                        </button>
                      )}
                    </div>
                  </div>
                  {sentForm?.poNumber === o.poNumber && (
                    <form className="record-sent-form" onSubmit={recordSent} data-testid={`form-mark-po-sent-${o.poNumber}`}>
                      <strong>Record supplier dispatch</strong>
                      <p>This records a send you already completed. NGate will not send the PO.</p>
                      <div className="record-sent-fields">
                        <label>Method
                          <select value={sentForm.method} onChange={(event) => setSentForm({ ...sentForm, method: event.target.value as SentFormState["method"] })}>
                            <option>WhatsApp</option><option>Email</option><option>Phone</option><option>Other</option>
                          </select>
                        </label>
                        <label>Date and time sent
                          <input type="datetime-local" required value={sentForm.sentAt} onChange={(event) => setSentForm({ ...sentForm, sentAt: event.target.value })} />
                        </label>
                      </div>
                      <label>Notes or reference (optional)
                        <textarea maxLength={500} value={sentForm.notes} onChange={(event) => setSentForm({ ...sentForm, notes: event.target.value })} placeholder="Optional message reference or context" />
                      </label>
                      <div className="record-sent-actions">
                        <button type="button" className="btn sm outline" onClick={() => setSentForm(null)}>Cancel</button>
                        <button type="submit" className="btn sm primary" disabled={markSent.isPending}>{markSent.isPending ? "Saving…" : "Save as sent"}</button>
                      </div>
                    </form>
                  )}
                  <div className="disclaimer">{isConnectedMode ? "Approval and manual sent details are saved in Flask SQLite. NGate does not contact suppliers." : "Approvals and sent records are local demo actions. NGate does not contact suppliers."}</div>
                </div>
              );
            })
          )}
        </div>
      )}

      <div className="analysis-note">
        <b>What happens next?</b> Generate a PO → View / Download → Get approval → Send it yourself using your own company process. {APP_NAME} will never send a PO without a separate sending integration and your permission.
      </div>
    </>
  );
}
