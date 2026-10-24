import { ArrowRight, Download, Printer } from "lucide-react";
import { ModalShell } from "./modal-shell";
import { useModal } from "./modal-context";
import { PoSheet } from "@/components/orders/po-sheet";
import { usePurchaseOrders } from "@/hooks/use-ngate";
import { usePoActions } from "@/hooks/use-po-actions";

export function PoViewModal({ poNumber }: { poNumber: string }) {
  const { close } = useModal();
  const { data: orders, isLoading } = usePurchaseOrders();
  const { download, print } = usePoActions();
  const o = orders?.find((x) => x.poNumber === poNumber);

  return (
    <ModalShell
      title={`View ${poNumber}`}
      description="View or download this purchase order. No WhatsApp or email is sent."
      onClose={close}
      footer={
        <div className="modal-foot">
          <button className="btn primary" onClick={close} data-testid="button-close-po-preview">
            Close Preview <ArrowRight size={15} />
          </button>
        </div>
      }
    >
      {isLoading ? (
        <div className="skel" style={{ height: 320, margin: "15px 0" }} />
      ) : !o ? (
        <div className="empty"><h3>PO not found</h3></div>
      ) : (
        <>
          <PoSheet order={o} />
          <div className="po-preview-buttons" style={{ marginBottom: 14 }}>
            <button className="btn primary" onClick={() => download(o)} data-testid="button-download-po-preview">
              <Download size={15} /> Download PDF
            </button>
            <button className="btn outline" onClick={() => print(o)} data-testid="button-print-po">
              <Printer size={15} /> Print / Save as PDF
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}
