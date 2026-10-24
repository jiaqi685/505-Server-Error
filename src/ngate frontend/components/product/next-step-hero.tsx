import { ArrowRight, Check, FileText, FileUp, MessageSquareText, Scale } from "lucide-react";
import type { StepKey } from "@/lib/workflow";

type Stage = StepKey | "done";

const COPY: Record<Stage, { badge: string; title: string; text: string; button: string; hint: string; icon: typeof Check }> = {
  prepared: {
    badge: "NEXT STEP · REQUEST QUOTATIONS",
    title: "Ask your suppliers for today's prices",
    text: "Old prices may have changed. Prepare one WhatsApp message per supplier, then record their replies here.",
    button: "Request Quotation",
    hint: "You confirm product, quantity, delivery date and suppliers first.",
    icon: MessageSquareText,
  },
  replies: {
    badge: "NEXT STEP · RECORD REPLIES",
    title: "Upload a supplier quotation",
    text: "Upload the quotation as a PDF, JPG, or PNG. NGate reads the offer details for you to review and correct.",
    button: "Upload Quotation",
    hint: "The original file stays private to your account.",
    icon: FileUp,
  },
  compared: {
    badge: "NEXT STEP · ONE MORE QUOTATION",
    title: "Record another quotation to compare",
    text: "One offer is recorded. Add at least one more so NGate can compare total cost, extra stock and delivery.",
    button: "Upload Quotation",
    hint: "The comparison below is already calculated for the offers you have.",
    icon: FileUp,
  },
  po: {
    badge: "NEXT STEP · CHOOSE A SUPPLIER",
    title: "Offers compared — choose who to buy from",
    text: "The comparison ranks suppliers that can deliver on time by total purchasing cost, including extra stock from minimum orders.",
    button: "Review Comparison",
    hint: "Change the quantity or date below to see the ranking update.",
    icon: Scale,
  },
  approved: {
    badge: "NEXT STEP · APPROVAL",
    title: "Your PO draft is waiting for approval",
    text: "Review the draft in My Orders. Approve it, download it, then send it to the supplier yourself.",
    button: "Open My Orders",
    hint: "NGate never sends purchase orders.",
    icon: FileText,
  },
  done: {
    badge: "COMPLETED",
    title: "PO approved",
    text: "This purchase is approved. Send the PO to the supplier yourself, or start a new quotation request.",
    button: "Start New Quotation",
    hint: "Previous requests stay in Activity.",
    icon: Check,
  },
};

export function NextStepHero({ stage, onAction }: { stage: Stage; onAction: () => void }) {
  const c = COPY[stage];
  const Icon = c.icon;
  return (
    <>
      <section className="supplier-action-hero" aria-label="Next step in purchasing">
        <div className="supplier-action-copy">
          <span className="supplier-action-badge">{c.badge}</span>
          <h2>{c.title}</h2>
          <p>{c.text}</p>
        </div>
        <div className="supplier-action-control">
          <button className="supplier-hero-button" onClick={onAction} data-testid="button-next-step">
            <Icon size={19} />
            <span>{c.button}</span>
            <ArrowRight size={20} />
          </button>
          <small>{c.hint}</small>
        </div>
      </section>
      <div className="mobile-next-action" aria-label="Next purchasing step">
        <span>YOUR NEXT STEP</span>
        <button onClick={onAction} data-testid="button-mobile-next-step">
          {c.button} <ArrowRight size={18} />
        </button>
      </div>
    </>
  );
}
