import { createContext, useContext, useState, type ReactNode } from "react";

export type ModalState =
  | { type: "rfq"; productId: string; supplierId?: string }
  | { type: "whatsapp"; productId: string; rfqId: string; supplierId?: string }
  | { type: "upload-quotation"; productId: string; rfqId: string; supplierId?: string }
  | { type: "po-quote"; productId: string; quoteId: string; requestedQuantity: number }
  | { type: "po-history"; productId: string; purchaseId: string }
  | { type: "po-view"; poNumber: string }
  | { type: "overstock-notice"; productId: string; productName: string; excessQuantity: number; unit: string; excessValue: number; overstockCoverageDays: number }
  | { type: "help" };

interface ModalApi {
  modal: ModalState | null;
  open: (m: ModalState) => void;
  close: () => void;
}

const ModalContext = createContext<ModalApi>({ modal: null, open: () => {}, close: () => {} });

export function ModalProvider({ children }: { children: ReactNode }) {
  const [modal, setModal] = useState<ModalState | null>(null);
  return <ModalContext.Provider value={{ modal, open: setModal, close: () => setModal(null) }}>{children}</ModalContext.Provider>;
}

export function useModal() {
  return useContext(ModalContext);
}
