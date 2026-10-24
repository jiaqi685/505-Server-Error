import type { PurchaseOrder, QuotationRequest, SupplierQuote } from "@/data/types";

/**
 * Purchasing progress for one quotation request. A step is only "done"
 * when the action really happened — opening WhatsApp never counts as sending.
 */
export type StepKey = "prepared" | "replies" | "compared" | "po" | "approved";
export type StepState = "done" | "current" | "todo";

export interface ProgressStep {
  key: StepKey;
  label: string;
  state: StepState;
  note: string;
}

export function purchasingProgress(rfq: QuotationRequest | null, quotes: SupplierQuote[], orders: PurchaseOrder[]): { steps: ProgressStep[]; current: StepKey | null } {
  const replies = rfq ? quotes.filter((q) => q.rfqId === rfq.rfqId) : [];
  const total = rfq?.suppliers.length ?? 0;
  const po = rfq ? [...orders].reverse().find((o) => o.rfqId === rfq.rfqId) : undefined;
  const opened = rfq?.suppliers.filter((s) => s.status !== "prepared").length ?? 0;
  const sent = rfq?.suppliers.filter((s) => s.status === "marked-sent").length ?? 0;
  const needForCompare = Math.min(2, Math.max(1, total));

  const done: Record<StepKey, boolean> = {
    prepared: !!rfq,
    replies: replies.length > 0,
    compared: replies.length >= needForCompare,
    po: !!po,
    approved: po?.status === "approved",
  };
  const notes: Record<StepKey, string> = {
    prepared: !rfq ? "Not started" : sent ? `${sent} of ${total} marked sent by you` : opened ? `WhatsApp opened for ${opened} · sending not verified` : "Message ready · not sent",
    replies: rfq ? `${replies.length} of ${total} recorded` : "",
    compared: done.compared ? `${replies.length} offer${replies.length !== 1 ? "s" : ""} compared` : replies.length ? "Need another quotation" : "",
    po: po ? `${po.poNumber} · ${po.status === "approved" ? "approved" : "pending approval"}` : "",
    approved: po?.status === "approved" ? "Owner approved · not sent" : "",
  };
  const labels: Record<StepKey, string> = {
    prepared: "Quotation Prepared",
    replies: "Supplier Quotations Recorded",
    compared: "Offers Compared",
    po: "PO Draft Generated",
    approved: "Approved",
  };
  const order: StepKey[] = ["prepared", "replies", "compared", "po", "approved"];
  const current = order.find((k) => !done[k]) ?? null;
  return {
    current,
    steps: order.map((key) => ({ key, label: labels[key], note: key === "approved" && po?.status === "approved" ? notes.approved : notes[key], state: done[key] ? "done" : key === current ? "current" : "todo" })),
  };
}
