import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, ArrowUpFromLine, Check, CircleHelp, ExternalLink, FileText, Link2, ShieldCheck } from "lucide-react";
import { PageHead } from "@/components/shared/bits";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNotify } from "@/components/shared/toast";
import { isConnectedMode, type ImportSupplierQuotationDocumentInput, type Product, type SupplierPriceReference, type SupplierQuotationDocument } from "@/data";
import { uploadAndExtractMultiProductQuotation } from "@/data/document-upload";
import {
  useConfirmSupplierQuotationDocument,
  useImportSupplierQuotationDocument,
  useLatestQuotationRequest,
  useLinkSupplierPriceReference,
  useProducts,
  useReviewSupplierPriceReference,
  useSupplierQuotationDocuments,
  useVerifySupplierPriceReferences,
} from "@/hooks/use-ngate";
import { matchQuotationLineToProduct } from "@/lib/quotation-line-matching";
import { requiresPackMultiplier } from "@/lib/supplier-document-evidence";
import { assessPackConversion } from "@/lib/quotation-pack-conversion";
import { SUPPLIER_MASTER, supplierIdentity } from "@/lib/supplier-master";
import {
  reconcileAutomaticProductAssignment,
  resetLineAfterProductChange,
  resetLineAfterSupplierChange,
  switchQuotationReviewLine,
  type ResettableQuotationLineDraft,
} from "@/lib/supplier-quotation-review-state";
import "./supplier-quotations.css";

type LineDraft = ResettableQuotationLineDraft & {
  expanded: boolean;
  linkConfirmed: boolean;
};

function normaliseUnit(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/s$/, "");
}

function money(value: number | null) {
  return value === null || !Number.isFinite(value) ? "Not stated" : `RM ${value.toFixed(2)}`;
}

function fileDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Saved quotation" : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function suggestedSupplierId(name: string | null | undefined) {
  if (!name) return "";
  return SUPPLIER_MASTER.find((supplier) =>
    supplierIdentity(supplier.supplierName) === supplierIdentity(name),
  )?.supplierId ?? "";
}

function defaultDraft(reference: SupplierPriceReference, products: Product[]): LineDraft {
  const suggestion = matchQuotationLineToProduct(reference, products);
  const automaticProduct = suggestion.autoAssignable ? suggestion.product : null;
  return {
    productId: reference.productId ?? automaticProduct?.productId ?? "",
    productSelectionSource: reference.productId ? "saved" : automaticProduct ? "auto" : "none",
    selected: false,
    unitConversionConfirmed: Boolean(reference.unitConversionConfirmed),
    unitConversionNote: reference.unitConversionNote ?? "",
    cataloguePackConfirmed: false,
    expanded: false,
    linkConfirmed: false,
  };
}

function FieldValue({ label, children }: { label: string; children: ReactNode }) {
  return <div className="sq-evidence-value"><span>{label}</span><strong>{children || "Not stated"}</strong></div>;
}

function LinkRfqControl({ reference, onError, onSuccess }: {
  reference: SupplierPriceReference;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}) {
  const rfqQuery = useLatestQuotationRequest(reference.productId ?? undefined);
  const linkMutation = useLinkSupplierPriceReference();
  const [confirmed, setConfirmed] = useState(false);
  const rfq = rfqQuery.data;

  if (!reference.productId) return <span className="sq-inline-note">Assign a product before linking to an RFQ.</span>;
  return (
    <div className="sq-link-rfq">
      {rfqQuery.isLoading ? <span className="sq-inline-note">Checking for an open RFQ…</span>
        : rfqQuery.isError ? <span className="sq-inline-note">RFQ details could not be loaded.</span>
          : !rfq ? <span className="sq-inline-note">No RFQ is available for this product yet.</span>
            : <>
              <label className="sq-check sq-link-confirm">
                <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} data-testid={`checkbox-confirm-link-${reference.referenceId}`} />
                Link this verified reference to RFQ {rfq.rfqId}
              </label>
              <button
                className="sq-action"
                disabled={!isConnectedMode || !confirmed || linkMutation.isPending}
                onClick={() => linkMutation.mutate({ referenceId: reference.referenceId, rfqId: rfq.rfqId, confirmLink: true }, {
                  onSuccess: () => { setConfirmed(false); onSuccess("Verified price reference linked to the RFQ."); },
                  onError: (error) => onError(error.message || "The reference could not be linked."),
                })}
                data-testid={`button-link-rfq-${reference.referenceId}`}
              >
                <Link2 size={13} /> {linkMutation.isPending ? "Linking…" : "Link to RFQ"}
              </button>
            </>}
    </div>
  );
}

export default function SupplierQuotationsPage() {
  const notify = useNotify();
  const fileRef = useRef<HTMLInputElement>(null);
  const supplierDraftDocumentRef = useRef("");
  const [activeDocumentId, setActiveDocumentId] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [isReading, setIsReading] = useState(false);
  const [lineDrafts, setLineDrafts] = useState<Record<string, LineDraft>>({});
  const [supplierId, setSupplierId] = useState("");
  const [supplierIdentityChecked, setSupplierIdentityChecked] = useState(false);
  const [supplierOverrideChecked, setSupplierOverrideChecked] = useState(false);
  const [supplierChangedNotice, setSupplierChangedNotice] = useState(false);
  const [reviewLineId, setReviewLineId] = useState("");
  const [matchPickerOpen, setMatchPickerOpen] = useState(false);
  const productsQ = useProducts();
  const documentsQ = useSupplierQuotationDocuments();
  const importDocument = useImportSupplierQuotationDocument();
  const confirmDocument = useConfirmSupplierQuotationDocument();
  const reviewPendingMutation = useReviewSupplierPriceReference();
  const verifyReferences = useVerifySupplierPriceReferences();
  const products = productsQ.data ?? [];
  const documents = documentsQ.data ?? [];
  const activeDocument: SupplierQuotationDocument | undefined = documents.find((document) => document.documentId === activeDocumentId) ?? documents[0];

  useEffect(() => {
    if (!activeDocument || supplierDraftDocumentRef.current === activeDocument.documentId) return;
    supplierDraftDocumentRef.current = activeDocument.documentId;
    setLineDrafts({});
    setReviewLineId("");
    setMatchPickerOpen(false);
    setSupplierId(activeDocument.confirmedSupplierId ?? suggestedSupplierId(activeDocument.quotedSupplierName));
    setSupplierIdentityChecked(Boolean(activeDocument.supplierIdentityConfirmed));
    setSupplierOverrideChecked(Boolean(activeDocument.supplierOverrideConfirmed));
    setSupplierChangedNotice(false);
  }, [activeDocument?.documentId]);

  useEffect(() => {
    if (!activeDocument || !productsQ.isSuccess) return;
    setLineDrafts((current) => {
      const next = { ...current };
      let changed = false;
      activeDocument.items.filter((item) => item.status === "pending").forEach((item) => {
        const existing = current[item.referenceId] ?? defaultDraft(item, []);
        const match = matchQuotationLineToProduct(item, products);
        const automaticId = match.autoAssignable ? match.product?.productId ?? null : null;
        const reconciled = reconcileAutomaticProductAssignment(existing, automaticId);
        if (!current[item.referenceId] || reconciled !== existing) {
          next[item.referenceId] = reconciled;
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [activeDocument?.documentId, activeDocument?.items, productsQ.isSuccess, productsQ.data]);

  const pendingItems = useMemo(() => activeDocument?.items.filter((item) => item.status === "pending") ?? [], [activeDocument]);
  const verifiedCount = activeDocument?.items.filter((item) => item.status === "verified" || item.status === "linked").length ?? 0;
  const selectedSupplier = SUPPLIER_MASTER.find((supplier) => supplier.supplierId === supplierId);
  const exactSupplierMatch = Boolean(activeDocument?.quotedSupplierName && selectedSupplier
    && supplierIdentity(activeDocument.quotedSupplierName) === supplierIdentity(selectedSupplier.supplierName));
  const supplierMismatch = Boolean(activeDocument?.quotedSupplierName && selectedSupplier && !exactSupplierMatch);
  const supplierUnknown = !activeDocument?.quotedSupplierName;
  const supplierIsConfirmed = Boolean(activeDocument?.supplierIdentityConfirmed && activeDocument.confirmedSupplierId === supplierId);
  const canConfirmSupplier = Boolean(
    isConnectedMode && supplierId && supplierIdentityChecked
    && ((!supplierMismatch && !supplierUnknown) || supplierOverrideChecked)
    && !confirmDocument.isPending,
  );

  const getDraft = (reference: SupplierPriceReference) => lineDrafts[reference.referenceId] ?? defaultDraft(reference, products);
  const updateDraft = (reference: SupplierPriceReference, patch: Partial<LineDraft>) => {
    setLineDrafts((current) => ({
      ...current,
      [reference.referenceId]: { ...(current[reference.referenceId] ?? defaultDraft(reference, products)), ...patch },
    }));
  };

  const matchForDraft = (reference: SupplierPriceReference, draft: LineDraft) => {
    void draft;
    return matchQuotationLineToProduct(reference, products);
  };

  const hasExplicitPrice = (reference: SupplierPriceReference) =>
    reference.unitPrice !== null && Number.isFinite(reference.unitPrice) && reference.unitPrice > 0;

  const isIdentityReady = (reference: SupplierPriceReference, draft: LineDraft) => {
    if (!draft.productId) return false;
    const match = matchForDraft(reference, draft);
    const conversionRequired = requiresPackMultiplier(reference.unit, match.product?.stockUnit);
    const conversion = conversionRequired && match.product ? assessPackConversion(reference, match.product) : null;
    const packReady = conversionRequired
      ? conversion?.status === "compatible"
        || conversion?.status === "catalogue-confirmation-required" && draft.cataloguePackConfirmed === true
      : match.packCompatible;
    return match.product?.productId === draft.productId
      && match.confidence === "high"
      && match.identityCompatible
      && match.skuCompatible
      && packReady;
  };

  const canVerifyLine = (reference: SupplierPriceReference, draft: LineDraft) => {
    const product = products.find((item) => item.productId === draft.productId);
    const unitMatches = Boolean(reference.unit && product?.stockUnit
      && normaliseUnit(reference.unit) === normaliseUnit(product.stockUnit));
    const conversionRequired = requiresPackMultiplier(reference.unit, product?.stockUnit);
    const conversion = conversionRequired && product ? assessPackConversion(reference, product) : null;
    const conversionReady = conversionRequired
      ? conversion?.status === "compatible"
        || conversion?.status === "catalogue-confirmation-required" && draft.cataloguePackConfirmed === true
      : unitMatches || Boolean(draft.unitConversionConfirmed && draft.unitConversionNote.trim());
    return reference.status === "pending"
      && isIdentityReady(reference, draft)
      && hasExplicitPrice(reference)
      && conversionReady
      && supplierIsConfirmed;
  };

  const canBulkVerifyLine = (reference: SupplierPriceReference, draft: LineDraft) =>
    canVerifyLine(reference, draft) && matchForDraft(reference, draft).purchaseCompatible;

  const openLineReview = (reference: SupplierPriceReference) => {
    setLineDrafts((current) => switchQuotationReviewLine(
      current,
      pendingItems.map((item) => item.referenceId),
      reference.referenceId,
      (referenceId) => {
        const item = pendingItems.find((pending) => pending.referenceId === referenceId);
        return item ? defaultDraft(item, products) : defaultDraft(reference, products);
      },
    ));
    setMatchPickerOpen(false);
    setReviewLineId(reference.referenceId);
  };

  const closeLineReview = () => {
    const reference = pendingItems.find((item) => item.referenceId === reviewLineId);
    if (reference) updateDraft(reference, { selected: false, expanded: false });
    setReviewLineId("");
    setMatchPickerOpen(false);
  };

  const activateDocument = (document: SupplierQuotationDocument) => {
    supplierDraftDocumentRef.current = document.documentId;
    setActiveDocumentId(document.documentId);
    setLineDrafts({});
    setReviewLineId("");
    setMatchPickerOpen(false);
    setSupplierId(document.confirmedSupplierId ?? suggestedSupplierId(document.quotedSupplierName));
    setSupplierIdentityChecked(Boolean(document.supplierIdentityConfirmed));
    setSupplierOverrideChecked(Boolean(document.supplierOverrideConfirmed));
    setSupplierChangedNotice(false);
  };

  const handleSupplierChange = (nextId: string) => {
    if (nextId === supplierId) return;
    setSupplierId(nextId);
    setSupplierIdentityChecked(false);
    setSupplierOverrideChecked(false);
    setSupplierChangedNotice(true);
    setLineDrafts((current) => {
      const next = { ...current };
      pendingItems.forEach((item) => {
        const draft = next[item.referenceId] ?? defaultDraft(item, products);
        next[item.referenceId] = resetLineAfterSupplierChange(draft);
      });
      return next;
    });
  };

  const handleFile = async (file?: File) => {
    if (!file) return;
    setUploadError("");
    if (!isConnectedMode) {
      setUploadError("Mock Mode is read-only for supplier quotation evidence. Switch to Connected Mode to upload, extract and save review records.");
      return;
    }
    setIsReading(true);
    try {
      const extraction = await uploadAndExtractMultiProductQuotation(file);
      const { needsHumanReview, ...persistable } = extraction;
      void needsHumanReview;
      importDocument.mutate(persistable as ImportSupplierQuotationDocumentInput, {
        onSuccess: () => {
          supplierDraftDocumentRef.current = extraction.documentId;
          setActiveDocumentId(extraction.documentId);
          setLineDrafts({});
          setReviewLineId("");
          setMatchPickerOpen(false);
          setSupplierId(suggestedSupplierId(extraction.quotedSupplierName));
          setSupplierIdentityChecked(false);
          setSupplierOverrideChecked(false);
          notify("Quotation document and extracted lines saved for review.");
        },
        onError: (error) => {
          const message = error.message || "The extracted document could not be saved.";
          setUploadError(/duplicate|already exists|fingerprint/i.test(message) ? `This document appears to be a duplicate. ${message}` : message);
        },
      });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "The quotation could not be read. Try another file.");
    } finally {
      setIsReading(false);
    }
  };

  const confirmSupplier = () => {
    if (!activeDocument || !canConfirmSupplier) return;
    confirmDocument.mutate({
      documentId: activeDocument.documentId,
      supplierId,
      supplierIdentityConfirmed: true,
      supplierOverrideConfirmed: supplierMismatch || supplierUnknown ? supplierOverrideChecked : false,
    }, {
      onSuccess: () => {
        setSupplierChangedNotice(false);
        notify("Supplier identity confirmed for this document.");
      },
      onError: (error) => setUploadError(error.message || "Supplier identity could not be confirmed."),
    });
  };

  const savePending = (reference: SupplierPriceReference) => {
    const draft = getDraft(reference);
    const product = products.find((item) => item.productId === draft.productId);
    const multiplierRequired = requiresPackMultiplier(reference.unit, product?.stockUnit);
    reviewPendingMutation.mutate({
      referenceId: reference.referenceId,
      productId: draft.productId || null,
      unitConversionConfirmed: !multiplierRequired && draft.unitConversionConfirmed,
      unitConversionNote: !multiplierRequired ? draft.unitConversionNote.trim() || null : null,
    }, {
      onSuccess: () => notify("Pending line review saved. The quotation line remains unverified."),
      onError: (error) => setUploadError(error.message || "Pending line review could not be saved."),
    });
  };

  const verifySelected = () => {
    if (!activeDocument || !supplierIsConfirmed) return;
    const references = pendingItems.filter((reference) => {
      const draft = getDraft(reference);
      return draft.selected && canVerifyLine(reference, draft);
    }).map((reference) => {
      const draft = getDraft(reference);
      return {
        referenceId: reference.referenceId,
        productId: draft.productId,
        unitConversionConfirmed: draft.unitConversionConfirmed,
        unitConversionNote: draft.unitConversionNote.trim() || null,
        cataloguePackConfirmed: draft.cataloguePackConfirmed === true,
      };
    });
    if (!references.length) {
      setUploadError("Select at least one high-confidence line with confirmed product, SKU, pack, price and unit evidence. Lines with unresolved conflicts must stay pending.");
      return;
    }
    verifyReferences.mutate({ documentId: activeDocument.documentId, references }, {
      onSuccess: () => {
        setLineDrafts((current) => {
          const next = { ...current };
          references.forEach(({ referenceId }) => {
            const draft = next[referenceId];
            if (draft) next[referenceId] = { ...draft, selected: false };
          });
          return next;
        });
        setReviewLineId("");
        setUploadError("");
        notify(`${references.length} selected ${references.length === 1 ? "line was" : "lines were"} verified.`);
      },
      onError: (error) => setUploadError(error.message || "Selected lines could not be verified."),
    });
  };

  const renderIssue = (reference: SupplierPriceReference, draft: LineDraft) => {
    const product = products.find((entry) => entry.productId === draft.productId);
    const match = matchForDraft(reference, draft);
    const unitMatches = Boolean(reference.unit && product?.stockUnit && normaliseUnit(reference.unit) === normaliseUnit(product.stockUnit));
    if (!draft.productId) return match.pendingCatalogueItem
      ? `Pending catalogue item: ${match.pendingCatalogueItem.reason}`
      : match.issue ?? "No high-confidence catalogue assignment";
    if (match.product?.productId !== draft.productId) return match.issue ?? "Selected product does not match the unique catalogue suggestion";
    if (!match.skuCompatible) return match.issue ?? "Quoted SKU is not verified against catalogue data";
    if (!reference.unit) return "Printed unit not stated";
    if (requiresPackMultiplier(reference.unit, product?.stockUnit) && product) {
      const conversion = assessPackConversion(reference, product);
      if (conversion.status === "unsupported" || conversion.status === "incompatible") return conversion.reason ?? "Pack conversion needs review";
      if (conversion.status === "catalogue-confirmation-required" && !draft.cataloguePackConfirmed)
        return "Confirm this quoted bottle size against the catalogue item";
    } else if (!match.packCompatible) return match.issue ?? "Quoted pack specification is not verified against the catalogue";
    if (!unitMatches && !(draft.unitConversionConfirmed && draft.unitConversionNote.trim()))
      if (!requiresPackMultiplier(reference.unit, product?.stockUnit)) return "Unit equivalence needs review";
    if (!hasExplicitPrice(reference)) return "Explicit unit price unavailable";
    if (!supplierIsConfirmed) return "Confirm document supplier first";
    return match.confidence === "high" ? "Ready for owner verification" : "Needs review: low-confidence match";
  };
  const reviewReference = pendingItems.find((reference) => reference.referenceId === reviewLineId);
  const reviewDraft = reviewReference ? getDraft(reviewReference) : undefined;
  const reviewProduct = reviewDraft ? products.find((entry) => entry.productId === reviewDraft.productId) : undefined;
  const reviewMatch = reviewReference && reviewDraft ? matchForDraft(reviewReference, reviewDraft) : undefined;
  const reviewUnitMatches = Boolean(reviewReference?.unit && reviewProduct?.stockUnit && normaliseUnit(reviewReference.unit) === normaliseUnit(reviewProduct.stockUnit));
  const reviewPackConversion = reviewReference && reviewProduct && requiresPackMultiplier(reviewReference.unit, reviewProduct.stockUnit)
    ? assessPackConversion(reviewReference, reviewProduct)
    : null;
  const reviewPriceAvailable = reviewReference ? hasExplicitPrice(reviewReference) : false;
  const reviewConversionReady = reviewPackConversion
    ? reviewPackConversion.status === "compatible"
      || reviewPackConversion.status === "catalogue-confirmation-required" && reviewDraft?.cataloguePackConfirmed === true
    : reviewUnitMatches || Boolean(reviewDraft?.unitConversionConfirmed && reviewDraft.unitConversionNote.trim());
  const reviewCanVerify = Boolean(reviewReference && reviewDraft && reviewDraft.expanded
    && isIdentityReady(reviewReference, reviewDraft) && reviewPriceAvailable && reviewConversionReady && supplierIsConfirmed);
  const bulkReadyCount = pendingItems.filter((reference) => canBulkVerifyLine(reference, getDraft(reference))).length;
  const selectedVerifyCount = pendingItems.filter((reference) => {
    const draft = getDraft(reference);
    return draft.selected && canVerifyLine(reference, draft);
  }).length;

  return (
    <main className="sq-page">
      <PageHead
        eyebrow="SUPPLIER EVIDENCE"
        title="Supplier quotations"
        sub="Review printed prices against your catalogue, one line at a time."
        right={
          <label className={`sq-upload-action ${!isConnectedMode || isReading || importDocument.isPending ? "disabled" : ""}`}
            data-testid="button-upload-quotation">
            {isReading ? <><span className="sq-spinner" /> Reading…</>
              : importDocument.isPending ? <><span className="sq-spinner" /> Saving…</>
                : <><ArrowUpFromLine size={17} aria-hidden="true" /> Upload quotation</>}
            <input ref={fileRef} className="sq-upload-input" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              disabled={!isConnectedMode || isReading || importDocument.isPending}
              onChange={(event) => { void handleFile(event.target.files?.[0]); event.currentTarget.value = ""; }}
              data-testid="input-supplier-quotation-file" />
          </label>
        }
      />

      {!isConnectedMode && <div className="sq-banner info" role="status" data-testid="status-mock-mode"><CircleHelp size={17} /><div><strong>Mock Mode · review is read-only.</strong> Uploads and review changes are not persisted. Switch to Connected Mode to keep quotation evidence.</div></div>}
      {uploadError && <div className="sq-banner error" role="alert" data-testid="status-quotation-error"><AlertCircle size={17} /><div><strong>Action could not be completed.</strong> {uploadError}</div></div>}
      {productsQ.isError && <div className="sq-banner error" role="alert"><AlertCircle size={17} /><div>Products could not be loaded for matching. <button className="sq-action" onClick={() => productsQ.refetch()} data-testid="button-retry-products">Retry</button></div></div>}
      {documentsQ.isError && <div className="sq-banner error" role="alert"><AlertCircle size={17} /><div>Saved quotation documents could not be read. <button className="sq-action" onClick={() => documentsQ.refetch()} data-testid="button-retry-documents">Retry</button></div></div>}

      <div className="sq-layout">
        <aside className="sq-doc-list" aria-label="Saved quotation documents">
          <div className="sq-section-heading"><h2>Saved documents</h2><span className="sq-count" data-testid="text-document-count">{documents.length}</span></div>
          {documentsQ.isLoading ? <div className="sq-doc-empty" aria-busy="true">Loading saved quotations…</div>
            : documents.length ? documents.map((document) => {
              const pending = document.items.filter((item) => item.status === "pending").length;
              const verified = document.items.filter((item) => item.status === "verified" || item.status === "linked").length;
              return <button key={document.documentId} className={`sq-doc-button ${activeDocument?.documentId === document.documentId ? "active" : ""}`}
                onClick={() => activateDocument(document)} data-testid={`button-open-document-${document.documentId}`}>
                <span className="sq-doc-name">{document.documentName}</span>
                <span className="sq-doc-meta"><span>{fileDate(document.createdAt)}</span><span>{document.items.length} lines</span></span>
                <span className="sq-doc-status">{verified} verified · {pending} pending</span>
              </button>;
            }) : <div className="sq-doc-empty">No saved quotations yet.</div>}
        </aside>

        <section className="sq-summary-panel" aria-label="Selected quotation summary">
          {documentsQ.isLoading ? <div className="sq-loading" aria-busy="true"><div className="sq-skeleton" /><div className="sq-skeleton" /><div className="sq-skeleton" /></div>
            : !activeDocument ? <div className="sq-loading">
              <div className="sq-upload-icon sq-empty-icon"><FileText size={19} /></div>
              <strong>No quotation selected</strong>
              <p className="sq-intro">Upload a quotation or select a saved document to review its lines.</p>
            </div> : <>
              <div className="sq-document-head">
                <div className="sq-document-title-row">
                  <div><span className="sq-summary-eyebrow">Selected quotation</span><h2>{activeDocument.documentName}</h2><p>Uploaded {fileDate(activeDocument.createdAt)}</p></div>
                  <a className="sq-original-link" href={`/api/storage${activeDocument.documentPath}`} target="_blank" rel="noreferrer" data-testid={`link-original-document-${activeDocument.documentId}`}>
                    <ExternalLink size={13} /> Open original
                  </a>
                </div>
                <div className="sq-document-facts">
                  <div className="sq-fact"><span>Supplier as printed</span><strong>{activeDocument.quotedSupplierName || "Not identified"}</strong></div>
                  <div className="sq-fact"><span>Catalogue supplier</span><strong>{selectedSupplier?.supplierName || "Not selected"}</strong></div>
                  <div className="sq-fact"><span>Quotation date text</span><strong>{activeDocument.quotationDateText || "Not stated"}</strong></div>
                  <div className="sq-fact"><span>Delivery wording</span><strong>{activeDocument.deliveryWording || "Not stated"}</strong></div>
                  <div className="sq-fact"><span>Total lines</span><strong>{activeDocument.items.length}</strong></div>
                  <div className="sq-fact"><span>Verified / linked</span><strong>{verifiedCount} of {activeDocument.items.length}</strong></div>
                </div>
                <div className="sq-summary-status">
                  <span className={`sq-status ${supplierIsConfirmed ? "verified" : "pending"}`} data-testid="status-document-supplier-summary">
                    {supplierIsConfirmed ? "Supplier confirmed" : "Supplier confirmation needed"}
                  </span>
                  {pendingItems.length > 0 && <span className="sq-summary-pending">{pendingItems.length} lines pending review</span>}
                </div>
              </div>

              <section className="sq-supplier-confirm" aria-label="Confirm supplier identity">
                <div className="sq-supplier-copy">
                  <span className="sq-step">DOCUMENT CHECK</span>
                  <h3>Confirm the supplier once</h3>
                  <p>Printed name: <strong>{activeDocument.quotedSupplierName || "Not identified on the document"}</strong>. A suggested match is never a confirmation.</p>
                  {supplierChangedNotice && <p className="sq-reset-note" role="status" data-testid="status-lines-need-review">Supplier changed. Pending line selections and unit-equivalence confirmations were cleared; review those lines again.</p>}
                </div>
                <div className="sq-supplier-controls">
                  <div className="sq-field">
                    <label htmlFor={`document-supplier-${activeDocument.documentId}`}>Catalogue supplier</label>
                    <select id={`document-supplier-${activeDocument.documentId}`} value={supplierId} onChange={(event) => handleSupplierChange(event.target.value)}
                      data-testid={`select-document-supplier-${activeDocument.documentId}`}>
                      <option value="">Choose supplier</option>
                      {SUPPLIER_MASTER.map((supplier) => <option key={supplier.supplierId} value={supplier.supplierId}>{supplier.supplierName}</option>)}
                    </select>
                  </div>
                  {supplierMismatch && <div className="sq-mismatch" role="status">Selected supplier differs from the printed name.
                    <label className="sq-check"><input type="checkbox" checked={supplierOverrideChecked} onChange={(event) => setSupplierOverrideChecked(event.target.checked)} data-testid="checkbox-supplier-override" /> I checked this mismatch and want to record the selected supplier.</label>
                  </div>}
                  {supplierUnknown && <div className="sq-mismatch" role="status">Supplier name is missing or unreadable.
                    <label className="sq-check"><input type="checkbox" checked={supplierOverrideChecked} onChange={(event) => setSupplierOverrideChecked(event.target.checked)} data-testid="checkbox-supplier-unknown-override" /> I checked the original and identified this supplier manually.</label>
                  </div>}
                  <label className="sq-check sq-identity-check">
                    <input type="checkbox" checked={supplierIsConfirmed || supplierIdentityChecked} disabled={supplierIsConfirmed}
                      onChange={(event) => setSupplierIdentityChecked(event.target.checked)} data-testid="checkbox-confirm-supplier-identity" />
                    I reviewed the original and confirm the supplier identity for every line in this document.
                  </label>
                  {supplierIsConfirmed
                    ? <div className="sq-confirmed-stamp" data-testid="status-supplier-confirmed"><Check size={14} /> Supplier confirmed for this document</div>
                    : <button className="sq-action primary" disabled={!canConfirmSupplier} onClick={confirmSupplier} data-testid="button-confirm-document-supplier">
                      <ShieldCheck size={14} /> {confirmDocument.isPending ? "Saving confirmation…" : "Confirm supplier"}
                    </button>}
                </div>
              </section>
              {(activeDocument.validityText || activeDocument.conditionalDiscounts.length > 0) && <details className="sq-extra-terms">
                <summary>Other extracted quotation terms</summary>
                <div>{activeDocument.validityText && <p><strong>Validity wording:</strong> {activeDocument.validityText}</p>}
                  {activeDocument.conditionalDiscounts.length > 0 && <p><strong>Conditional discount evidence:</strong> {activeDocument.conditionalDiscounts.join("; ")}</p>}
                  <small>Terms remain as printed; no adjusted price or delivery date is calculated.</small>
                </div>
              </details>}
            </>}
        </section>
      </div>

      {activeDocument && <section className="sq-table-section" aria-label="Quotation line summary">
        <div className="sq-lines-heading">
          <div>
            <h2>Quotation lines</h2>
            <span>Printed quantities are evidence only, not MOQ. Select compatible high-confidence lines, then verify them together.</span>
          </div>
          <div className="sq-bulk-controls">
            <span>{bulkReadyCount} line{bulkReadyCount === 1 ? "" : "s"} currently meet product, SKU, unit and pack checks.</span>
            <button className="sq-action primary" disabled={!isConnectedMode || !supplierIsConfirmed || !selectedVerifyCount || verifyReferences.isPending}
              onClick={verifySelected} data-testid={`button-bulk-verify-${activeDocument.documentId}`}>
              <ShieldCheck size={14} /> {verifyReferences.isPending ? "Verifying…" : `Verify selected (${selectedVerifyCount})`}
            </button>
            <span className="sq-table-count">{activeDocument.items.length} lines · {pendingItems.length} pending</span>
          </div>
        </div>
        {productsQ.isLoading ? <div className="sq-doc-empty">Loading catalogue suggestions…</div>
          : activeDocument.items.length ? <div className="sq-table-scroll">
            <table className="sq-summary-table">
              <thead><tr>
                <th scope="col">Original description</th>
                <th scope="col">Suggested product</th>
                <th scope="col">Unit</th>
                <th scope="col">Unit price</th>
                <th scope="col">Match / issue</th>
                <th scope="col"><span className="sq-sr-only">Line action</span></th>
              </tr></thead>
              <tbody>{activeDocument.items.map((reference) => {
                const suggestion = matchQuotationLineToProduct(reference, products);
                const draft = getDraft(reference);
                const product = products.find((entry) => entry.productId === draft.productId);
                const displayedProduct = product ?? suggestion.product;
                const draftMatch = matchForDraft(reference, draft);
                const unitMatches = Boolean(reference.unit && product?.stockUnit && normaliseUnit(reference.unit) === normaliseUnit(product.stockUnit));
                const hasPrice = hasExplicitPrice(reference);
                const bulkEligible = canBulkVerifyLine(reference, draft);
                const detail = reference.status === "pending" ? renderIssue(reference, draft) : reference.status === "linked" ? "Linked to RFQ" : "Verified reference";
                const issue = reference.status !== "pending" ? (reference.status === "linked" ? "RFQ linked" : "Verified")
                  : !draft.productId ? suggestion.pendingCatalogueItem ? "Pending Catalogue Item" : "Needs review"
                    : draftMatch.product?.productId !== draft.productId ? draftMatch.issue ?? "Needs Review: selected product does not match"
                      : !draftMatch.skuCompatible ? draftMatch.issue ?? "Needs Review: SKU not verified"
                        : !draftMatch.packCompatible ? draftMatch.issue ?? "Needs Review: pack specification not verified"
                    : !reference.unit ? "Unit not stated"
                      : !unitMatches && requiresPackMultiplier(reference.unit, displayedProduct?.stockUnit) ? "Needs review: pack multiplier required"
                        : !unitMatches && !(draft.unitConversionConfirmed && draft.unitConversionNote.trim()) ? "Unit conflict"
                        : !hasPrice ? "Price not stated"
                          : !supplierIsConfirmed ? "Confirm supplier"
                            : draftMatch.confidence !== "high" ? "Needs Review: low-confidence match"
                              : bulkEligible ? "Ready for bulk confirmation" : "Review line";
                return <tr key={reference.referenceId} data-testid={`row-quotation-line-${reference.referenceId}`}>
                  <td className="sq-table-description">{reference.description || "Description not readable"}{reference.sku && <small>SKU {reference.sku}</small>}</td>
                  <td>{displayedProduct
                    ? <><span className="sq-suggestion-label">{draft.productSelectionSource === "auto" ? "Auto-matched:" : reference.productId ? "Previously assigned:" : draft.productSelectionSource === "manual" ? "Selected:" : "Possible match:"}</span> {displayedProduct.productName}
                      <small>Stock unit: {displayedProduct.stockUnit} · Pack: {displayedProduct.packSize || "not stated"}</small></>
                    : suggestion.pendingCatalogueItem
                      ? <div className="sq-pending-proposal">
                        <span className="sq-proposal-label">Pending Catalogue Item</span>
                        <strong>{suggestion.pendingCatalogueItem.proposedName}</strong>
                        <small>Family: {suggestion.pendingCatalogueItem.identifiedFamily}. {suggestion.pendingCatalogueItem.reason}</small>
                      </div>
                      : suggestion.familyProduct
                        ? <><span className="sq-suggestion-label">Family identified, not assigned:</span> {suggestion.familyProduct.productName}</>
                        : "No safe catalogue match"}</td>
                  <td>{reference.unit || "Not stated"}{reference.packSpecification && <small>{reference.packSpecification}</small>}</td>
                  <td className="sq-price">{money(reference.unitPrice)}{reference.itemDiscount && <small>Discount: {reference.itemDiscount}</small>}</td>
                  <td className="sq-match-cell" title={detail}>
                    <span className={`sq-match-tag ${suggestion.confidence}`}>{suggestion.familyProduct && !suggestion.product ? `${suggestion.confidence} family match` : `${suggestion.confidence} match`}</span>
                    <span className={`sq-status ${reference.status}`}>{reference.status === "linked" ? "Linked" : reference.status === "verified" ? "Verified" : "Pending"}</span>
                    <small className="sq-issue">{issue}</small>
                  </td>
                  <td className="sq-row-action">{reference.status === "pending"
                    ? <>
                      {bulkEligible && <label className="sq-bulk-row-check">
                        <input type="checkbox" checked={draft.selected} disabled={!isConnectedMode || !supplierIsConfirmed}
                          onChange={(event) => updateDraft(reference, { selected: event.target.checked })}
                          aria-label={`Select ${reference.description || reference.lineItemId} for bulk verification`}
                          data-testid={`checkbox-bulk-line-${reference.referenceId}`} />
                        <span>Ready to verify</span>
                      </label>}
                      <button className="sq-action sq-review-toggle" onClick={() => openLineReview(reference)}
                        aria-expanded={reviewLineId === reference.referenceId} data-testid={`button-edit-line-${reference.referenceId}`}>Review</button>
                    </>
                    : reference.status === "verified"
                      ? <LinkRfqControl reference={reference} onError={setUploadError} onSuccess={notify} />
                      : <span className="sq-inline-note">RFQ {reference.linkedRfqId ?? "linked"}</span>}</td>
                </tr>;
              })}</tbody>
            </table>
          </div> : <div className="sq-doc-empty">No line items were extracted from this document.</div>}
      </section>}

      <Dialog open={Boolean(reviewReference && reviewDraft)} onOpenChange={(open) => { if (!open) closeLineReview(); }}>
        <DialogContent className="sq-dialog-content">
          {reviewReference && reviewDraft && <>
            <DialogHeader className="sq-dialog-header">
              <span className="sq-step">LINE REVIEW · {reviewReference.lineItemId}</span>
              <DialogTitle>Review this quotation line</DialogTitle>
              <DialogDescription>Check the printed evidence against the selected catalogue product before saving.</DialogDescription>
            </DialogHeader>
            <div className="sq-dialog-context">
              <span>Supplier: <strong>{selectedSupplier?.supplierName || "Not selected"}</strong>{supplierIsConfirmed ? " · confirmed for this document" : " · confirm in the document summary first"}</span>
              {activeDocument.deliveryWording && <span>Delivery wording: {activeDocument.deliveryWording}</span>}
            </div>
            <div className="sq-review-card-main sq-dialog-review-grid">
              <div className="sq-original-block">
                <span className="sq-column-label"><FileText size={13} /> Original quotation evidence</span>
                <p className="sq-original-description">{reviewReference.description || "Description not readable"}</p>
                <div className="sq-evidence-grid">
                  <FieldValue label="Printed SKU">{reviewReference.sku}</FieldValue>
                  <FieldValue label="Quoted unit">{reviewReference.unit}</FieldValue>
                  <FieldValue label="Pack specification">{reviewReference.packSpecification}</FieldValue>
                  <FieldValue label="Quoted quantity">{reviewReference.quotedQuantity === null ? null : `${reviewReference.quotedQuantity} (printed quantity)`}</FieldValue>
                  <FieldValue label="Unit price">{money(reviewReference.unitPrice)}</FieldValue>
                  <FieldValue label="Line total">{money(reviewReference.lineTotal)}</FieldValue>
                </div>
                {reviewReference.itemDiscount && <p className="sq-evidence-foot">Line discount evidence: {reviewReference.itemDiscount}</p>}
              </div>
              <div className="sq-editor">
                <div className="sq-match-intro">
                  <strong>Product identification</strong>
                  {reviewDraft.productId && reviewProduct
                    ? <div className="sq-auto-match">
                      <span><b>{reviewDraft.productSelectionSource === "auto" ? "Auto-matched:" : "Selected catalogue item:"}</b> {reviewProduct.productName}</span>
                      <button type="button" className="sq-secondary-action" onClick={() => setMatchPickerOpen((open) => !open)}
                        aria-expanded={matchPickerOpen} aria-controls={`match-picker-${reviewReference.referenceId}`}>
                        {matchPickerOpen ? "Close match options" : "Change match"}
                      </button>
                    </div>
                    : <div className="sq-auto-match">
                      <span>{reviewMatch?.familyProduct
                        ? `Product family identified: ${reviewMatch.familyProduct.productName}. Exact catalogue assignment is still pending.`
                        : "No safe automatic catalogue match. This line remains pending."}</span>
                      <button type="button" className="sq-secondary-action" onClick={() => setMatchPickerOpen((open) => !open)}
                        aria-expanded={matchPickerOpen} aria-controls={`match-picker-${reviewReference.referenceId}`}>
                        {matchPickerOpen ? "Close match options" : "Choose a match manually"}
                      </button>
                    </div>}
                  <span>Identifying a product does not verify its price, SKU, unit or pack compatibility.</span>
                </div>
                {matchPickerOpen && <div className="sq-field" id={`match-picker-${reviewReference.referenceId}`}>
                  <label htmlFor={`product-${reviewReference.referenceId}`}>Change catalogue assignment</label>
                  <select id={`product-${reviewReference.referenceId}`} value={reviewDraft.productId}
                    onChange={(event) => updateDraft(reviewReference, resetLineAfterProductChange(reviewDraft, event.target.value))}
                    data-testid={`select-product-${reviewReference.referenceId}`}>
                    <option value="">Keep pending / no catalogue assignment</option>
                    {products.map((entry) => <option key={entry.productId} value={entry.productId}>{entry.productName} · stock unit: {entry.stockUnit}</option>)}
                  </select>
                </div>}
                {reviewMatch?.pendingCatalogueItem && !reviewDraft.productId && <div className="sq-pending-proposal" role="status">
                  <span className="sq-proposal-label">Pending Catalogue Item proposal · not added to the catalogue</span>
                  <strong>{reviewMatch.pendingCatalogueItem.proposedName}</strong>
                  <dl>
                    <div><dt>Identified family</dt><dd>{reviewMatch.pendingCatalogueItem.identifiedFamily}</dd></div>
                    <div><dt>Printed SKU</dt><dd>{reviewMatch.pendingCatalogueItem.quotedSku || "Not stated"}</dd></div>
                    <div><dt>Quoted unit</dt><dd>{reviewMatch.pendingCatalogueItem.quotedUnit || "Not stated"}</dd></div>
                    <div><dt>Pack specification</dt><dd>{reviewMatch.pendingCatalogueItem.quotedPackSpecification || "Not stated"}</dd></div>
                  </dl>
                  <small>{reviewMatch.pendingCatalogueItem.reason} The original quotation evidence remains unchanged.</small>
                </div>}
                {reviewMatch?.issue && (!reviewPackConversion || reviewPackConversion.status === "unsupported" || reviewPackConversion.status === "incompatible")
                  && <div className="sq-mismatch" role="status">{reviewMatch.issue}</div>}
                <div className="sq-unit-compare">
                  <div><span>Printed unit</span><strong>{reviewReference.unit || "Not stated"}</strong></div>
                  <span className="sq-unit-arrow" aria-hidden="true">→</span>
                  <div><span>Catalogue stock unit and pack</span><strong>{reviewProduct ? `${reviewProduct.stockUnit}${reviewProduct.packSize ? ` · ${reviewProduct.packSize}` : ""}` : "Select a product"}</strong></div>
                </div>
                {!reviewUnitMatches && reviewProduct && reviewPackConversion
                  ? <div className={`sq-mismatch sq-pack-conversion sq-pack-conversion-${reviewPackConversion.status}`} role="status">
                    {reviewPackConversion.status === "compatible"
                      ? <strong>Pack conversion verified against catalogue specification</strong>
                      : reviewPackConversion.status === "catalogue-confirmation-required"
                        ? <strong>Pack conversion found — confirm the catalogue bottle size</strong>
                        : reviewPackConversion.status === "incompatible"
                          ? <strong>Pack specification conflict — keep this line pending</strong>
                          : <strong>Pack conversion is unclear — keep this line pending</strong>}
                    {reviewPackConversion.conversion && <span>
                      {reviewPackConversion.conversion.sourceText} · {reviewPackConversion.conversion.unitsPerOuter} {reviewProduct.stockUnit}s per {reviewPackConversion.conversion.outerUnit}
                      {reviewPackConversion.conversion.innerSizeMl ? ` · ${reviewPackConversion.conversion.innerSizeMl}ml each` : ""}
                      {reviewPackConversion.normalizedUnitPrice !== null
                        ? ` · ${money(reviewReference.unitPrice)} / ${reviewPackConversion.conversion.outerUnit} = RM ${reviewPackConversion.normalizedUnitPrice.toFixed(4)} / ${reviewProduct.stockUnit}`
                        : ""}
                      {reviewReference.quotedQuantity !== null && reviewPackConversion.equivalentQuantity !== null
                        ? ` · ${reviewReference.quotedQuantity} quoted ${reviewPackConversion.conversion.outerUnit}s = ${reviewPackConversion.equivalentQuantity} ${reviewProduct.stockUnit}s`
                        : ""}
                    </span>}
                    {reviewReference.lineTotal !== null && <span>Printed line total remains {money(reviewReference.lineTotal)}; the source price and quantity are unchanged.</span>}
                    {reviewPackConversion.reason && <span>{reviewPackConversion.reason}</span>}
                    {reviewPackConversion.status === "catalogue-confirmation-required" && <label className="sq-check">
                      <input type="checkbox" checked={reviewDraft.cataloguePackConfirmed === true}
                        onChange={(event) => updateDraft(reviewReference, { cataloguePackConfirmed: event.target.checked, selected: false })}
                        data-testid={`checkbox-catalogue-pack-${reviewReference.referenceId}`} />
                      I checked the catalogue item and confirm it is the same {reviewPackConversion.conversion?.innerSizeMl}ml {reviewProduct.stockUnit}.
                    </label>}
                  </div>
                  : !reviewUnitMatches && reviewProduct && <div className="sq-mismatch" role="status">
                    Printed unit and stock unit differ. Do not assume a conversion.
                    <label className="sq-check"><input type="checkbox" checked={reviewDraft.unitConversionConfirmed}
                      onChange={(event) => updateDraft(reviewReference, { unitConversionConfirmed: event.target.checked, selected: false })}
                      data-testid={`checkbox-unit-conversion-${reviewReference.referenceId}`} />
                      I confirmed these units are equivalent one-to-one for this exact pack.
                    </label>
                    <div className="sq-field sq-note-field">
                      <label htmlFor={`conversion-note-${reviewReference.referenceId}`}>Evidence for the one-to-one equivalence</label>
                      <textarea id={`conversion-note-${reviewReference.referenceId}`} value={reviewDraft.unitConversionNote}
                        onChange={(event) => updateDraft(reviewReference, { unitConversionNote: event.target.value, selected: false })}
                        placeholder="Describe the printed pack evidence you checked." data-testid={`textarea-unit-conversion-note-${reviewReference.referenceId}`} />
                    </div>
                  </div>}
                {!reviewProduct && <div className="sq-inline-alert">No exact catalogue product is assigned. Keep this line pending unless the printed product, SKU and pack can be matched safely.</div>}
                {!reviewPriceAvailable && <div className="sq-mismatch" role="status">No positive explicit unit price was extracted. This line can remain pending but cannot be verified as price evidence.</div>}
                <label className="sq-select-line sq-line-confirmation">
                  <input type="checkbox" checked={reviewDraft.selected} disabled={!reviewCanVerify || !isConnectedMode}
                    onChange={(event) => updateDraft(reviewReference, { selected: event.target.checked })}
                    data-testid={`checkbox-select-line-${reviewReference.referenceId}`} />
                  <span>I reviewed this line’s product, unit/pack and printed price.</span>
                </label>
                {!reviewCanVerify && <span className="sq-inline-note">{renderIssue(reviewReference, reviewDraft)}</span>}
                <div className="sq-line-actions">
                  <button className="sq-action" disabled={!isConnectedMode || reviewPendingMutation.isPending}
                    onClick={() => savePending(reviewReference)} data-testid={`button-save-pending-${reviewReference.referenceId}`}>
                    {reviewPendingMutation.isPending ? "Saving…" : "Save pending"}
                  </button>
                  <button className="sq-action primary" disabled={!isConnectedMode || !supplierIsConfirmed || !reviewCanVerify || !reviewDraft.selected || verifyReferences.isPending}
                    onClick={verifySelected} data-testid={`button-verify-selected-${activeDocument?.documentId}`}>
                    <ShieldCheck size={14} /> {verifyReferences.isPending ? "Verifying…" : `Verify selected (${selectedVerifyCount})`}
                  </button>
                </div>
              </div>
            </div>
          </>}
        </DialogContent>
      </Dialog>

      {/* Obsolete unfinished V10 duplicate dialog; excluded from rendered JSX.
            <button className="sq-action" disabled={!isConnectedMode || reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference && reviewReference.status !== "pending" || reviewReference && reviewReference.referenceId !== reviewLineId || reviewReference.status !== "pending"}
      */}
    </main>
  );
}
