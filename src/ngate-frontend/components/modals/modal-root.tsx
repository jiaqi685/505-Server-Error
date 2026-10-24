import { useModal } from "./modal-context";
import { RfqModal } from "./rfq-modal";
import { WhatsAppModal } from "./whatsapp-modal";
import { UploadQuotationModal } from "./upload-quotation-modal";
import { PreparePoModal } from "./prepare-po-modal";
import { PoViewModal } from "./po-view-modal";
import { HelpModal } from "./help-modal";
import { OverstockNoticeModal } from "./overstock-notice-modal";

export function ModalRoot() {
  const { modal } = useModal();
  if (!modal) return null;
  switch (modal.type) {
    case "rfq":
      return <RfqModal key={`rfq-${modal.productId}-${modal.supplierId ?? ""}`} productId={modal.productId} supplierId={modal.supplierId} />;
    case "whatsapp":
      return <WhatsAppModal key={`wa-${modal.rfqId}`} productId={modal.productId} rfqId={modal.rfqId} focusSupplierId={modal.supplierId} />;
    case "upload-quotation":
      return <UploadQuotationModal key={`quote-${modal.rfqId}-${modal.supplierId ?? ""}`} productId={modal.productId} rfqId={modal.rfqId} supplierId={modal.supplierId} />;
    case "po-quote":
      return <PreparePoModal key={`poq-${modal.quoteId}`} productId={modal.productId} source="quote" quoteId={modal.quoteId} requestedQuantity={modal.requestedQuantity} />;
    case "po-history":
      return <PreparePoModal key={`poh-${modal.purchaseId}`} productId={modal.productId} source="history" purchaseId={modal.purchaseId} />;
    case "po-view":
      return <PoViewModal key={modal.poNumber} poNumber={modal.poNumber} />;
    case "overstock-notice":
      return <OverstockNoticeModal key={`overstock-${modal.productId}`} {...modal} />;
    case "help":
      return <HelpModal />;
  }
}
