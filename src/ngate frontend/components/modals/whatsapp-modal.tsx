import { useEffect, useState } from "react";
import { Check, CheckCircle2, Copy, ExternalLink } from "lucide-react";
import { ModalShell } from "./modal-shell";
import { useModal } from "./modal-context";
import { useLatestQuotationRequest, useMarkQuotationSent, useProduct, useRecordWhatsAppOpened } from "@/hooks/use-ngate";
import { useNotify } from "@/components/shared/toast";
import { buildQuotationMessage, whatsappComposeUrl } from "@/lib/whatsapp";
import type { RfqSupplierStatus } from "@/data";

export const RFQ_STATUS_LABEL: Record<RfqSupplierStatus, [tone: string, label: string]> = {
  prepared: ["", "Message ready · not sent"],
  "whatsapp-opened": ["orange", "WhatsApp opened · not confirmed"],
  "marked-sent": ["green", "Marked as sent by you"],
};

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

/** One card per supplier: Copy, Open WhatsApp, Mark as sent. NGate never sends messages itself. */
export function WhatsAppModal({ productId, rfqId, focusSupplierId }: { productId: string; rfqId: string; focusSupplierId?: string }) {
  const { close } = useModal();
  const notify = useNotify();
  const { data: product } = useProduct(productId);
  const { data: rfq } = useLatestQuotationRequest(productId);
  const opened = useRecordWhatsAppOpened();
  const markSent = useMarkQuotationSent();
  const [texts, setTexts] = useState<Record<string, string>>({});

  const request = rfq && rfq.rfqId === rfqId ? rfq : null;

  useEffect(() => {
    if (!product || !request) return;
    setTexts((prev) => {
      const next = { ...prev };
      for (const s of request.suppliers)
        if (next[s.supplierId] == null)
          next[s.supplierId] = buildQuotationMessage({
            supplierName: s.supplierName,
            productName: product.productName,
            quantity: request.requestedQuantity,
            unit: product.stockUnit,
            deliveryDate: request.requestedDeliveryDate,
          });
      return next;
    });
  }, [product, request]);

  useEffect(() => {
    if (focusSupplierId) setTimeout(() => document.getElementById(`wa-card-${focusSupplierId}`)?.scrollIntoView({ block: "nearest" }), 60);
  }, [focusSupplierId, request]);

  const supplierList = request?.suppliers ?? [];

  return (
    <ModalShell
      wide
      title="WhatsApp Messages"
      description="One message per supplier. Copy it or open WhatsApp, then press Send yourself."
      onClose={close}
      footer={
        <div className="modal-foot">
          <span className="hint" style={{ marginRight: "auto" }}>NGate cannot see WhatsApp. Use "Mark as sent" after you send.</span>
          <button className="btn primary" onClick={close} data-testid="button-done-whatsapp">Done</button>
        </div>
      }
    >
      {!request || !product ? (
        <div className="skel" style={{ height: 260 }} />
      ) : (
        <div className="wa-cards">
          {supplierList.map((s) => {
            const text = texts[s.supplierId] ?? "";
            const [tone, label] = RFQ_STATUS_LABEL[s.status];
            return (
              <article key={s.supplierId} id={`wa-card-${s.supplierId}`} className={`wa-card ${focusSupplierId === s.supplierId ? "focus" : ""}`} data-testid={`card-whatsapp-${s.supplierId}`}>
                <div className="wa-card-head">
                  <strong>{s.supplierName}</strong>
                  <span className={`tag ${tone}`} data-testid={`status-rfq-${s.supplierId}`}>{label}</span>
                </div>
                <label className="sr-only" htmlFor={`wa-text-${s.supplierId}`}>Message for {s.supplierName}</label>
                <textarea
                  id={`wa-text-${s.supplierId}`}
                  className="wa-message"
                  value={text}
                  onChange={(e) => setTexts((t) => ({ ...t, [s.supplierId]: e.target.value }))}
                  data-testid={`input-whatsapp-${s.supplierId}`}
                />
                <div className="wa-card-actions">
                  <button
                    className="btn sm outline"
                    onClick={async () => {
                      const ok = await copyText(text);
                      if (!ok) (document.getElementById(`wa-text-${s.supplierId}`) as HTMLTextAreaElement | null)?.select();
                      notify(ok ? `Message for ${s.supplierName} copied.` : "Select the message and copy it manually.");
                    }}
                    data-testid={`button-copy-${s.supplierId}`}
                  >
                    <Copy size={14} /> Copy
                  </button>
                  <button
                    className="btn sm outline"
                    onClick={() => {
                      const popup = window.open(whatsappComposeUrl(text), "_blank", "noopener");
                      opened.mutate({ rfqId: request.rfqId, supplierId: s.supplierId });
                      notify(popup === null ? "If WhatsApp did not open, allow pop-ups or use Copy." : `WhatsApp opened. Choose ${s.supplierName} and press Send there.`);
                    }}
                    data-testid={`button-open-whatsapp-${s.supplierId}`}
                  >
                    <ExternalLink size={14} /> Open WhatsApp
                  </button>
                  {s.status === "marked-sent" ? (
                    <span className="sent-ok"><CheckCircle2 size={15} /> Sent (your confirmation)</span>
                  ) : (
                    <button
                      className="btn sm primary"
                      disabled={markSent.isPending}
                      onClick={() => markSent.mutate({ rfqId: request.rfqId, supplierId: s.supplierId }, { onSuccess: () => notify(`${s.supplierName} marked as sent.`), onError: (e) => notify(e.message) })}
                      data-testid={`button-mark-sent-${s.supplierId}`}
                    >
                      <Check size={14} /> I sent it — mark as sent
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </ModalShell>
  );
}
