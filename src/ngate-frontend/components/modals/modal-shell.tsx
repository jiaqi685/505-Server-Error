import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";
import { InfoTip } from "@/components/shared/info-tip";

interface Props {
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
  warning?: string;
  footer: ReactNode;
  wide?: boolean;
}

export function ModalShell({ title, description, onClose, children, warning, footer, wide }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
      if (e.key === "Tab") {
        const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]') ?? []).filter((element) => element.getClientRects().length > 0);
        const first = elements[0], last = elements[elements.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); previous?.focus(); };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-head">
          <h2 id="modal-title" className="title-row">{title}<InfoTip label="About this step">{description}</InfoTip></h2>
          <button ref={closeRef} className="close" onClick={onClose} aria-label="Close dialog" data-testid="button-close-modal">
            <X size={22} />
          </button>
        </div>
        {children}
        {warning && (
          <div className="alert-text" style={{ marginTop: 16, display: "flex", gap: 7, alignItems: "flex-start" }}>
            <AlertTriangle size={14} style={{ flex: "none", marginTop: 2 }} /> <span>{warning}</span>
          </div>
        )}
        {footer}
      </div>
    </div>
  );
}
