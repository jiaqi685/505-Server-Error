import { Check } from "lucide-react";
import { ModalShell } from "./modal-shell";
import { useModal } from "./modal-context";
import { money, plural } from "@/lib/format";

interface Props {
  productId: string;
  productName: string;
  excessQuantity: number;
  unit: string;
  excessValue: number;
  overstockCoverageDays: number;
}

export function OverstockNoticeModal({ productName, excessQuantity, unit, excessValue, overstockCoverageDays }: Props) {
  const { close } = useModal();

  return (
    <ModalShell
      title="Overstock reminder"
      description={`${productName} is above the current ${overstockCoverageDays}-day stock target.`}
      onClose={close}
      footer={
        <div className="modal-foot">
          <button className="btn primary" onClick={close} data-testid="button-dismiss-overstock">
            <Check size={15} /> Got it
          </button>
        </div>
      }
    >
      <div className="modal-note">
        <strong>{plural(excessQuantity, unit)} above target</strong>
        <p style={{ marginBottom: 0 }}>Estimated excess value: {money(excessValue)}. This reminder will only appear once for this product in this browser.</p>
      </div>
    </ModalShell>
  );
}
