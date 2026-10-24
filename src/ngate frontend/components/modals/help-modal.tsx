import { ArrowRight } from "lucide-react";
import { ModalShell } from "./modal-shell";
import { useModal } from "./modal-context";

export function HelpModal() {
  const { close } = useModal();
  return (
    <ModalShell
      title="How to Use NGate"
      description="From stock alert to purchase order draft in four steps."
      onClose={close}
      footer={
        <div className="modal-foot">
          <button className="btn primary" onClick={close} data-testid="button-close-help">
            Close <ArrowRight size={15} />
          </button>
        </div>
      }
    >
      <div className="modal-note" style={{ marginBottom: 16 }}>
        <strong>1. Check what needs buying</strong>
        <p>Home shows the most urgent product and why, using stock, daily usage and supplier lead time.</p>
        <strong>2. Request Quotation</strong>
        <p>Confirm quantity, delivery date and suppliers. Copy each message or open WhatsApp, press Send yourself, then tap "Mark as sent".</p>
        <strong>3. Upload Supplier Quotation</strong>
        <p>Upload a PDF, JPG, or PNG quotation. NGate reads price, minimum order and delivery for you to check before saving.</p>
        <strong>4. Compare and Prepare PO</strong>
        <p>Suppliers that deliver on time are ranked by total cost, including extra stock from stated minimum orders. If an MOQ is not stated, confirm it before relying on the comparison. Generate a PO draft, then approve, send it yourself, and record that action in My Orders.</p>
        <hr />
        <small>NGate never sends WhatsApp messages or purchase orders automatically. In Demo Mode, example replies and approvals are saved only in this browser.</small>
      </div>
    </ModalShell>
  );
}
