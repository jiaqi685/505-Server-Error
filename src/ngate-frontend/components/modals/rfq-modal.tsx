import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { ModalShell } from "./modal-shell";
import { useModal } from "./modal-context";
import { QtyStepper } from "@/components/shared/qty-stepper";
import { useCreateQuotationRequest, useProducts } from "@/hooks/use-ngate";
import { useSettings } from "@/hooks/use-settings";
import { useNotify } from "@/components/shared/toast";
import { addDays, plural, prettyDate, todayLocal } from "@/lib/format";
import { validateRfqInput } from "@/lib/costs";
import { insightFor } from "@/lib/inventory";
import { newRfqDefaultQuantity } from "@/lib/procurement-safety";

export function RfqModal({ productId, supplierId }: { productId: string; supplierId?: string }) {
  const { open, close } = useModal();
  const notify = useNotify();
  const [, navigate] = useLocation();
  const settings = useSettings();
  const { data: products } = useProducts("");
  const create = useCreateQuotationRequest();

  const [pid, setPid] = useState(productId);
  const [qty, setQty] = useState("");
  const [date, setDate] = useState("");
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const initFor = useRef<string | null>(null);
  const today = todayLocal();

  const product = products?.find((p) => p.productId === pid);

  useEffect(() => {
    if (!product || initFor.current === product.productId) return;
    initFor.current = product.productId;
    const same = product.productId === productId;
    const chosen = same && supplierId ? product.suppliers.filter((s) => s.supplierId === supplierId).map((s) => s.supplierId) : product.suppliers.map((s) => s.supplierId);
    const suggested = insightFor(product, settings).suggestedOrderQuantity;
    setQty(String(newRfqDefaultQuantity(suggested, product.reorderLevel)));
    const knownLeads = product.suppliers
      .filter((s) => chosen.includes(s.supplierId) && s.leadTimeDays != null)
      .map((s) => s.leadTimeDays!);
    const minLead = knownLeads.length ? Math.min(...knownLeads) : null;
    setDate(minLead == null ? "" : addDays(today, minLead));
    setSuppliers(chosen);
  }, [product, productId, supplierId, settings, today]);

  const error = product ? validateRfqInput(Number(qty), date, suppliers, today) : "Loading";
  const tooSoon = product?.suppliers.filter((s) =>
    suppliers.includes(s.supplierId) && date && s.leadTimeDays != null && addDays(today, s.leadTimeDays) > date,
  ) ?? [];

  const submit = () => {
    if (!product || error) {
      notify(error ?? "Check the form.");
      return;
    }
    create.mutate(
      { productId: product.productId, requestedQuantity: Number(qty), requestedDeliveryDate: date, supplierIds: suppliers },
      {
        onSuccess: (req) => {
          navigate(`/purchasing/${product.productId}`);
          open({ type: "whatsapp", productId: product.productId, rfqId: req.rfqId });
        },
        onError: (e) => notify(e.message),
      },
    );
  };

  const toggle = (id: string, checked: boolean) => setSuppliers((s) => (checked ? Array.from(new Set([...s, id])) : s.filter((x) => x !== id)));

  return (
    <ModalShell
      title="Request Quotation"
      description="Prepare a WhatsApp message for each supplier. Nothing is sent automatically."
      onClose={close}
      footer={
        <div className="modal-foot">
          <button className="btn outline" onClick={close} data-testid="button-cancel-rfq">Cancel</button>
          <button className="btn primary" onClick={submit} disabled={!!error || create.isPending} data-testid="button-prepare-messages">
            {create.isPending ? "Preparing…" : "Prepare Messages"} <ArrowRight size={15} />
          </button>
        </div>
      }
    >
      {!product ? (
        <div className="skel" style={{ height: 220 }} />
      ) : (
        <div className="form-grid">
          <div className="field wide">
            <label htmlFor="rfq-product">Product</label>
            <select id="rfq-product" value={pid} onChange={(e) => setPid(e.target.value)} data-testid="select-rfq-product">
              {products?.map((p) => <option key={p.productId} value={p.productId}>{p.productName}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="rfq-qty">How many do you need? ({product.stockUnit}s)</label>
            <QtyStepper id="rfq-qty" value={qty} min={1} unit={product.stockUnit} onChange={setQty} />
          </div>
          <div className="field">
            <label htmlFor="rfq-date">When do you need it?</label>
            <div className="date-wrap">
              <input id="rfq-date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-rfq-date" />
            </div>
            <span className="subtle-hint">{date ? `${prettyDate(date)}. ` : ""}{suppliers.some((id) => product.suppliers.find((s) => s.supplierId === id)?.leadTimeDays == null) ? "Requested date only; at least one selected supplier has no confirmed delivery timing." : "Default uses the fastest known supplier lead time."}</span>
          </div>
          <div className="field wide">
            <div className="field-title">Suppliers to contact</div>
            {product.suppliers.length === 0 && <p className="validation-msg">No current document-supported supplier relationship is ready for this product. Historical purchases remain available. Review the supplier document evidence and pack/UOM first.</p>}
            <div className="supplier-checks">
              {product.suppliers.map((s) => (
                <label key={s.supplierId} className="supplier-choice">
                  <input type="checkbox" checked={suppliers.includes(s.supplierId)} onChange={(e) => toggle(s.supplierId, e.target.checked)} data-testid={`checkbox-supplier-${s.supplierId}`} />{" "}
                  {s.supplierName} <small className="muted-small">· {s.leadTimeDays == null ? "delivery timing unknown" : `usually ${plural(s.leadTimeDays, "day")}`}</small>
                </label>
              ))}
            </div>
          </div>
          {tooSoon.length > 0 && (
            <div className="field wide">
              <div className="inline-warning" role="status" data-testid="warning-lead-time">
                <AlertTriangle size={16} />
                <span>
                  <strong>{tooSoon.map((s) => s.supplierName).join(", ")}:</strong> Requested delivery is earlier than this supplier's usual lead time. Please confirm availability.
                </span>
              </div>
            </div>
          )}
          {error && error !== "Loading" && <p className="validation-msg field wide">{error}</p>}
        </div>
      )}
    </ModalShell>
  );
}
