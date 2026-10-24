import { useEffect, useLayoutEffect, useRef, useState, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Small green "i" marker that reveals an explanation on hover or keyboard focus. */
export function InfoTip({ children, label = "More information" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  const cancelHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };
  const hideSoon = () => {
    cancelHide();
    hideTimer.current = setTimeout(() => setOpen(false), 160);
  };

  useEffect(() => () => cancelHide(), []);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const tooltipWidth = Math.min(280, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left - 8, window.innerWidth - tooltipWidth - 8));
    const roomBelow = window.innerHeight - rect.bottom;
    const above = roomBelow < 130 && rect.top > 150;
    setPosition({ top: above ? rect.top - 8 : rect.bottom + 8, left, above });

    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("keydown", onEscape);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onEscape);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  return (
    <>
      <span
        ref={triggerRef}
        className="info-tip-trigger"
        role="note"
        tabIndex={0}
        aria-label={label}
        aria-describedby={id}
        onPointerEnter={() => { cancelHide(); setOpen(true); }}
        onPointerLeave={hideSoon}
        onFocus={(e) => {
          if (e.currentTarget.matches(":focus-visible")) setOpen(true);
        }}
        onBlur={() => {
          cancelHide();
          setOpen(false);
        }}
        data-testid="button-info-tip"
      >
        i
      </span>
      {open && position && createPortal(
        <span
          className={`info-tip-pop${position.above ? " above" : ""}`}
          id={id}
          role="tooltip"
          style={{ top: position.top, left: position.left, transform: position.above ? "translateY(-100%)" : undefined }}
          onPointerEnter={() => { cancelHide(); setOpen(true); }}
          onPointerLeave={hideSoon}
        >
          {children}
        </span>,
        document.body,
      )}
    </>
  );
}
