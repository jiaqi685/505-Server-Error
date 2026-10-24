import { useState } from "react";
import { AlertCircle, ExternalLink, FileText, Link2, ShieldCheck } from "lucide-react";
import { useNotify } from "@/components/shared/toast";
import type { SupplierPriceReference } from "@/data";
import { isConnectedMode } from "@/data";
import { useLatestQuotationRequest, useLinkSupplierPriceReference, useSupplierPriceReferences } from "@/hooks/use-ngate";

function formatMoney(value: number | null) {
  return value === null || !Number.isFinite(value) ? "Not stated" : `RM ${value.toFixed(2)}`;
}

function ReferenceStatus({ reference }: { reference: SupplierPriceReference }) {
  if (reference.status === "linked") return <span className="spr-status linked">Linked to RFQ</span>;
  if (reference.status === "verified") return <span className="spr-status verified"><ShieldCheck size={12} /> Verified reference</span>;
  return <span className="spr-status pending">Pending review</span>;
}

export function SupplierPriceReferences({ productId }: { productId: string }) {
  const notify = useNotify();
  const [error, setError] = useState("");
  const refsQ = useSupplierPriceReferences(productId);
  const rfqQ = useLatestQuotationRequest(productId);
  const linkReference = useLinkSupplierPriceReference();
  const references = refsQ.data ?? [];
  const rfq = rfqQ.data ?? null;

  const requestLink = (reference: SupplierPriceReference) => {
    if (!isConnectedMode) {
      setError("Mock Mode cannot save RFQ links. Switch to Connected Mode to link a verified reference.");
      return;
    }
    if (!rfq || reference.status !== "verified" || !reference.supplierId || !rfq.suppliers.some((entry) => entry.supplierId === reference.supplierId)) return;
    const confirmed = window.confirm(`Link the verified ${reference.quotedSupplierName ?? "supplier"} reference to this product's current RFQ? This records your explicit selection; it does not change the quoted price.`);
    if (!confirmed) return;
    setError("");
    linkReference.mutate({ referenceId: reference.referenceId, rfqId: rfq.rfqId, confirmLink: true }, {
      onSuccess: () => notify("Verified price reference linked to the current RFQ."),
      onError: (reason) => setError(reason.message || "The reference could not be linked."),
    });
  };

  return (
    <section className="surface spr-panel" aria-label="Supplier price references">
      <style>{`
        .spr-panel { padding: 20px; margin-top: 18px; }
        .spr-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:5px; }
        .spr-heading h2 { margin:0; font-size:17px; letter-spacing:-.025em; }
        .spr-heading-mark { display:grid; place-items:center; width:34px; height:34px; border-radius:10px; color:#496447; background:#edf2e7; }
        .spr-sub { margin:0 0 15px; color:hsl(var(--muted-foreground)); font-size:12px; line-height:1.55; }
        .spr-alert { margin:10px 0; padding:10px 12px; border:1px solid #e4c6bb; border-radius:9px; color:#7a3f32; background:#fbefeb; font-size:11px; line-height:1.5; }
        .spr-ref { padding:14px 0; border-top:1px solid hsl(var(--border)); }
        .spr-ref-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
        .spr-ref-head strong { display:block; font-size:13px; line-height:1.4; }
        .spr-meta { margin-top:3px; color:hsl(var(--muted-foreground)); font-size:11px; }
        .spr-status { display:inline-flex; align-items:center; gap:4px; padding:4px 8px; border-radius:99px; color:#725c2f; background:#f5eedb; font-size:10px; font-weight:800; white-space:nowrap; }
        .spr-status.verified { color:#426145; background:#e9f2e5; }
        .spr-status.linked { color:#455f67; background:#e9f0f0; }
        .spr-details { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:9px; margin:12px 0; }
        .spr-detail { min-width:0; padding:8px 9px; border-radius:8px; background:hsl(var(--muted)); }
        .spr-detail span { display:block; margin-bottom:3px; color:hsl(var(--muted-foreground)); font-size:9px; }
        .spr-detail strong { display:block; overflow-wrap:anywhere; font-size:11px; line-height:1.4; }
        .spr-evidence { margin:0 0 10px; color:hsl(var(--muted-foreground)); font-size:10px; line-height:1.5; }
        .spr-link { display:inline-flex; align-items:center; gap:6px; color:#466145; font-size:11px; font-weight:750; }
        .spr-link-action { display:inline-flex; align-items:center; gap:6px; min-height:34px; padding:0 10px; border:1px solid #3f5e44; border-radius:8px; color:#fff; background:#3f5e44; font:inherit; font-size:10px; font-weight:750; cursor:pointer; }
        .spr-link-action:disabled { opacity:.5; cursor:not-allowed; }
        .spr-empty { padding:18px 12px; border:1px dashed hsl(var(--border)); border-radius:10px; color:hsl(var(--muted-foreground)); font-size:12px; line-height:1.55; text-align:center; }
        .spr-skel { height:12px; margin:9px 0; border-radius:99px; background:#edf1e8; }
        @media(max-width:560px) { .spr-details { grid-template-columns:repeat(2,minmax(0,1fr)); } .spr-ref-head { flex-direction:column; } }
      `}</style>
      <div className="spr-heading"><div><h2>Supplier price references</h2></div><div className="spr-heading-mark"><FileText size={16} /></div></div>
      <p className="spr-sub">Document evidence stays separate from RFQ quotations. Pending references are not ranked offers; only verified evidence can be explicitly linked.</p>
      {error && <div className="spr-alert" role="alert"><AlertCircle size={13} style={{ verticalAlign: "middle", marginRight: 5 }} />{error}</div>}
      {refsQ.isLoading || rfqQ.isLoading ? (
        <div aria-busy="true"><div className="spr-skel" /><div className="spr-skel" style={{ width: "72%" }} /><div className="spr-skel" style={{ width: "48%" }} /></div>
      ) : refsQ.isError ? (
        <div className="spr-empty">Saved references could not be loaded. <button className="spr-link-action" onClick={() => refsQ.refetch()}>Retry</button></div>
      ) : references.length ? references.map((reference) => {
        const eligible = Boolean(rfq && reference.status === "verified" && reference.supplierId && rfq.suppliers.some((entry) => entry.supplierId === reference.supplierId));
        return (
          <article className="spr-ref" key={reference.referenceId} data-testid={`card-price-reference-${reference.referenceId}`}>
            <div className="spr-ref-head">
              <div>
                <strong>{reference.description || "Quotation line"}</strong>
                <div className="spr-meta">{reference.quotedSupplierName || "Supplier not identified"}{reference.quotationDateText ? ` · ${reference.quotationDateText}` : ""}</div>
              </div>
              <ReferenceStatus reference={reference} />
            </div>
            <div className="spr-details">
              <div className="spr-detail"><span>Explicit unit price</span><strong>{formatMoney(reference.unitPrice)}</strong></div>
              <div className="spr-detail"><span>Document unit</span><strong>{reference.unit || "Not stated"}</strong></div>
              <div className="spr-detail"><span>Pack as printed</span><strong>{reference.packSpecification || "Not stated"}</strong></div>
            </div>
            <p className="spr-evidence">
              {reference.quotedQuantity !== null && <>Printed quantity: {reference.quotedQuantity} (not MOQ). </>}
              {reference.itemDiscount && <>Discount evidence: {reference.itemDiscount}. Not applied to this price reference. </>}
              {reference.deliveryWording && <>Delivery wording: {reference.deliveryWording}</>}
              {reference.validityText && <> {reference.deliveryWording ? "· " : ""}Validity text: {reference.validityText}</>}
            </p>
            <a className="spr-link" href={`/api/storage${reference.documentPath}`} target="_blank" rel="noreferrer" data-testid={`link-reference-document-${reference.referenceId}`}>
              <ExternalLink size={12} /> Open source document
            </a>
            {reference.status === "linked" && <div className="spr-meta" style={{ marginTop: 8 }}>Linked to RFQ {reference.linkedRfqId || "recorded"}</div>}
            {eligible && (
              <div style={{ marginTop: 11 }}>
                <button className="spr-link-action" disabled={!isConnectedMode || linkReference.isPending} onClick={() => requestLink(reference)} data-testid={`button-link-reference-${reference.referenceId}`}>
                  <Link2 size={13} /> {linkReference.isPending ? "Linking…" : "Link to current RFQ"}
                </button>
                {!isConnectedMode && <div className="spr-meta">Available in Connected Mode only; no link will be saved in Mock Mode.</div>}
              </div>
            )}
            {reference.status === "pending" && <div className="spr-meta" style={{ marginTop: 8 }}>Awaiting owner verification. This is not a ranked quote.</div>}
          </article>
        );
      }) : (
        <div className="spr-empty">No saved quotation references for this product. Reviewed lines from Supplier quotations will appear here.</div>
      )}
    </section>
  );
}

export default SupplierPriceReferences;
