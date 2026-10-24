import type { PurchaseOrder } from "@/data";
import { useNotify } from "@/components/shared/toast";
import { useLogActivity } from "./use-ngate";
import { downloadBlob, poPdfBlob, poPrintHtml } from "@/lib/po-document";

/** Local-only PO document actions. Nothing here contacts a supplier. */
export function usePoActions() {
  const notify = useNotify();
  const log = useLogActivity();

  const download = (o: PurchaseOrder) => {
    downloadBlob(poPdfBlob(o), `${o.poNumber}.pdf`);
    log.mutate({ action: "PO PDF downloaded", status: o.status === "draft" ? "Pending approval · not sent" : "Approved · not sent", productId: o.productId, productName: o.productName, supplierId: o.supplierId, rfqId: o.rfqId, poNumber: o.poNumber, details: `${o.poNumber}.pdf · supplier not contacted` }, { onError: (e) => notify(`PDF downloaded, but its activity could not be saved: ${e.message}`) });
    notify("PDF downloaded. The PO was not sent to any supplier.");
  };

  const print = (o: PurchaseOrder) => {
    const w = window.open("", "_blank");
    if (!w) {
      notify("Allow pop-ups to print or save as PDF.");
      return;
    }
    w.document.write(poPrintHtml(o));
    w.document.close();
    w.focus();
    w.print();
  };

  return { download, print };
}
