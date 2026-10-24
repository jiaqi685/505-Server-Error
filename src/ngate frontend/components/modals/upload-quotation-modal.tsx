import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, ExternalLink, FileText, Save, Upload } from "lucide-react";
import { ModalShell } from "./modal-shell";
import { useModal } from "./modal-context";
import { useNotify } from "@/components/shared/toast";
import { useLatestQuotationRequest, useProduct, useSaveSupplierQuotation, useSupplierQuotes } from "@/hooks/use-ngate";
import { uploadAndExtractQuotation } from "@/data/document-upload";
import type { ExtractedQuotation, LeadTimeBasis, QuotationEvidence } from "@/data";
import { isValidDate, prettyDate, todayLocal } from "@/lib/format";
import { matchingRfqSupplierId, quotationReview } from "@/lib/quotation-review";
import { preserveExtractedDraftOnSupplierSwitch, quotationEditorFields, quotationEditorKey } from "@/lib/procurement-safety";

type DocumentReference = Pick<ExtractedQuotation, "documentId" | "documentName" | "documentPath">;

export function UploadQuotationModal({ productId, rfqId, supplierId: initialSupplier }: { productId: string; rfqId: string; supplierId?: string }) {
  const { close } = useModal();
  const notify = useNotify();
  const { data: product } = useProduct(productId);
  const { data: rfq } = useLatestQuotationRequest(productId);
  const { data: quotes } = useSupplierQuotes(rfqId);
  const save = useSaveSupplierQuotation();
  const today = todayLocal();

  const request = rfq && rfq.rfqId === rfqId ? rfq : null;
  const [supplierId, setSupplierId] = useState(initialSupplier ?? "");
  const [step, setStep] = useState<"upload" | "review">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const [price, setPrice] = useState("");
  const [moq, setMoq] = useState("");
  const [multiple, setMultiple] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [documentRef, setDocumentRef] = useState<DocumentReference | null>(null);
  const [extraction, setExtraction] = useState<(QuotationEvidence & { unitPrice?: number | null }) | null>(null);
  const [leadDays, setLeadDays] = useState("");
  const [leadBasis, setLeadBasis] = useState<LeadTimeBasis>("unknown");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [packUomConfirmed, setPackUomConfirmed] = useState(false);
  const [overrideConfirmed, setOverrideConfirmed] = useState(false);
  const [draftTransferredFrom, setDraftTransferredFrom] = useState<string | null>(null);
  const [replaceExistingConfirmed, setReplaceExistingConfirmed] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [deliveryStatus, setDeliveryStatus] = useState<"confirmed" | "lead-only" | "none">("none");
  const [deliveryConfirmed, setDeliveryConfirmed] = useState(false);
  const [confirmationNote, setConfirmationNote] = useState("");
  const [documentDate, setDocumentDate] = useState<string | null>(null);
  const initialized = useRef("");
  const preserveDraftRef = useRef(false);

  useEffect(() => {
    if (supplierId || !request) return;
    const replied = new Set((quotes ?? []).map((q) => q.supplierId));
    setSupplierId(request.suppliers.find((s) => !replied.has(s.supplierId))?.supplierId ?? request.suppliers[0]?.supplierId ?? "");
  }, [request, quotes, supplierId]);

  const existing = quotes?.find((q) => q.supplierId === supplierId);
  const editorKey = quotationEditorKey(rfqId, supplierId, existing?.quoteId);
  useEffect(() => {
    if (initialized.current === editorKey) return;
    if (preserveDraftRef.current && preserveExtractedDraftOnSupplierSwitch(documentRef?.documentId, extraction)) {
      initialized.current = editorKey;
      preserveDraftRef.current = false;
      return;
    }
    initialized.current = editorKey;
    const fields = quotationEditorFields(existing);
    setFile(fields.file); setUploadError(fields.uploadError);
    setPrice(fields.price); setMoq(fields.moq); setMultiple(fields.multiple);
    setDate(fields.date); setLeadDays(fields.leadDays); setLeadBasis(fields.leadBasis);
    setExtraction(fields.extraction); setReviewConfirmed(fields.reviewConfirmed); setOverrideConfirmed(fields.overrideConfirmed);
    setPackUomConfirmed(fields.packUomConfirmed);
    setDraftTransferredFrom(null);
    setReplaceExistingConfirmed(false);
    setDeliveryStatus(fields.deliveryStatus); setDeliveryConfirmed(fields.deliveryConfirmed);
    setConfirmationNote(fields.confirmationNote); setDocumentDate(fields.documentDate); setNotes(fields.notes);
    setStep(fields.step); setDocumentRef(fields.documentRef);
  }, [editorKey]);

  const unit = product?.stockUnit ?? "unit";
  const nPrice = Number(price);
  const nMoq = moq.trim() ? Number(moq) : null;
  const nMultiple = multiple ? Number(multiple) : null;
  const nLeadDays = leadDays.trim() ? Number(leadDays) : null;
  const selectedSupplierName = request?.suppliers.find((s) => s.supplierId === supplierId)?.supplierName ?? "";
  const review = product && extraction ? quotationReview(extraction, selectedSupplierName, product, supplierId) : null;
  const documentSupplierId = matchingRfqSupplierId(extraction?.quotedSupplierName, request?.suppliers ?? []);
  const switchSupplier = (nextSupplierId: string) => {
    if (nextSupplierId === supplierId) return;
    if (preserveExtractedDraftOnSupplierSwitch(documentRef?.documentId, extraction)) {
      preserveDraftRef.current = true;
      setDraftTransferredFrom((source) => source ?? supplierId);
      setReplaceExistingConfirmed(false);
      // Supplier identity review was for the previous selection. Keep extracted fields, but require fresh human confirmation.
      setReviewConfirmed(false);
      setPackUomConfirmed(false);
      setOverrideConfirmed(false);
    }
    setSupplierId(nextSupplierId);
  };
  const errors: string[] = [];
  if (!(price.trim() && Number.isFinite(nPrice) && nPrice > 0)) errors.push("Enter a price greater than zero.");
  if (nMoq != null && !(Number.isInteger(nMoq) && nMoq > 0)) errors.push("Minimum order must be a whole number above zero.");
  if (multiple && !(Number.isInteger(nMultiple) && (nMultiple ?? 0) > 0)) errors.push("Order multiple must be a whole number above zero.");
  if (date && !isValidDate(date)) errors.push("Delivery date is not valid.");
  if (date && isValidDate(date) && date < today) errors.push("Delivery date is in the past.");
  if (deliveryStatus === "confirmed" && !date) errors.push("Choose the exact date promised by the supplier.");
  if (deliveryStatus === "confirmed" && !deliveryConfirmed) errors.push("Confirm that the supplier promised this exact date.");
  const fromDocument = !!documentRef && !!date && documentDate === date;
  if (nLeadDays != null && (!Number.isInteger(nLeadDays) || nLeadDays < 0)) errors.push("Lead time must be a non-negative whole number.");
  if (!supplierId) errors.push("Select a supplier.");
  if (documentRef && review?.supplierMismatch && !overrideConfirmed) errors.push("Confirm the supplier mismatch override or choose the correct supplier.");
  if (documentRef && !reviewConfirmed) errors.push("Verify the extracted values, supplier, SKU and pack size before saving.");
  if (draftTransferredFrom && existing && !replaceExistingConfirmed) errors.push("Confirm before replacing the selected supplier's existing quotation.");

  const readDocument = async () => {
    if (!file || !request || !product) return notify("Choose a PDF, JPG, or PNG quotation first.");
    setReading(true);
    setUploadError("");
    try {
      const result = await uploadAndExtractQuotation(file, {
        supplierName: request.suppliers.find((s) => s.supplierId === supplierId)?.supplierName ?? "",
        productName: product.productName,
        stockUnit: product.stockUnit,
        requestedDeliveryDate: request.requestedDeliveryDate,
      });
      setPrice(result.unitPrice == null ? "" : String(result.unitPrice));
      setMoq(result.minimumOrderQuantity == null ? "" : String(result.minimumOrderQuantity));
      setMultiple(result.orderMultiple == null ? "" : String(result.orderMultiple));
      // Preserve an actual quoted date only. Working days are not calendar-day promises.
      setDate(result.quotedDeliveryDate ?? "");
      setDocumentDate(result.quotedDeliveryDate ?? null);
      setDeliveryStatus(result.quotedDeliveryDate ? "confirmed" : result.leadTimeDays != null ? "lead-only" : "none");
      setDeliveryConfirmed(false);
      setConfirmationNote("");
      setLeadDays(result.leadTimeDays == null ? "" : String(result.leadTimeDays));
      setLeadBasis(result.leadTimeBasis ?? "unknown");
      setExtraction(result);
      setDraftTransferredFrom(null);
      setReplaceExistingConfirmed(false);
      setReviewConfirmed(false);
      setPackUomConfirmed(false);
      setOverrideConfirmed(false);
      setNotes(result.notes);
      setDocumentRef({ documentId: result.documentId, documentName: result.documentName, documentPath: result.documentPath });
      setStep("review");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not read this quotation.";
      setUploadError(`${message} You can use Enter manually below.`);
      notify(message);
    } finally {
      setReading(false);
    }
  };

  const enterManually = () => {
    if (existing && documentRef && !file) {
      setStep("review");
      return;
    }
    setPrice(existing ? String(existing.unitPrice) : "");
    setMoq(existing ? String(existing.minimumOrderQuantity) : "");
    setMultiple(existing?.orderMultiple ? String(existing.orderMultiple) : "");
    setDate(existing?.quotedDeliveryDate ?? "");
    setDocumentRef(null);
    setExtraction(null);
    setDraftTransferredFrom(null);
    setReplaceExistingConfirmed(false);
    setLeadDays(existing?.leadTimeDays == null ? "" : String(existing.leadTimeDays));
    setLeadBasis(existing?.leadTimeBasis ?? "unknown");
    setDeliveryStatus(existing?.quotedDeliveryDate ? "confirmed" : existing?.leadTimeDays != null ? "lead-only" : "none");
    setDeliveryConfirmed(false);
    setConfirmationNote("");
    setDocumentDate(null);
    setUploadError("");
    setNotes(["Enter the quotation details manually and check them before saving."]);
    setStep("review");
  };

  const submit = () => {
    if (errors.length) return notify(errors[0]);
    save.mutate(
      {
        rfqId,
        supplierId,
        unitPrice: Math.round(nPrice * 100) / 100,
        minimumOrderQuantity: nMoq,
        orderMultiple: nMultiple,
        leadTimeDays: deliveryStatus === "none" ? null : nLeadDays,
        leadTimeBasis: deliveryStatus === "none" ? "unknown" : leadBasis,
        leadTimeText: extraction?.leadTimeText ?? null,
        quotedSupplierName: extraction?.quotedSupplierName ?? null,
        quotedProductName: extraction?.quotedProductName ?? null,
        quotedUnit: extraction?.quotedUnit ?? (reviewConfirmed ? unit : null),
        packDescription: extraction?.packDescription ?? null,
        confidence: extraction?.confidence,
        needsHumanReview: documentRef ? false : undefined,
        reviewConfirmed,
        packUomConfirmed,
        supplierOverrideConfirmed: documentRef ? overrideConfirmed : undefined,
        quotedDeliveryDate: deliveryStatus === "confirmed" ? date : null,
        deliveryDateConfirmed: deliveryStatus === "confirmed" && deliveryConfirmed,
        deliveryConfirmationSource: deliveryStatus === "confirmed" ? fromDocument ? "document" : "supplier-contact" : null,
        deliveryConfirmationNote: deliveryStatus === "confirmed" && !fromDocument ? confirmationNote.trim() : null,
        documentQuotedDeliveryDate: documentDate,
        source: documentRef ? "document-upload" : existing?.source === "demo-example" ? "demo-example" : "manual",
        documentId: documentRef?.documentId ?? null,
        documentName: documentRef?.documentName ?? null,
        documentPath: documentRef?.documentPath ?? null,
      },
      {
        onSuccess: (quote) => {
          notify(`${quote.supplierName}'s quotation ${existing ? "updated" : "saved"}. Comparison updated.`);
          close();
          setTimeout(() => document.getElementById("analysis")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
        },
        onError: (error) => notify(error.message),
      },
    );
  };

  const supplierName = request?.suppliers.find((s) => s.supplierId === supplierId)?.supplierName ?? "";

  return (
    <ModalShell
      title={existing ? `Edit ${supplierName}'s Quotation` : "Upload Supplier Quotation"}
      description="Upload a PDF, JPG, or PNG. NGate reads the price, minimum order and delivery details for you to check."
      onClose={close}
      wide
      footer={
        step === "upload" ? (
          <div className="modal-foot">
            <button className="btn" onClick={enterManually} disabled={reading} data-testid="button-enter-quote-manually">Enter manually</button>
            <button className="btn primary" onClick={readDocument} disabled={!supplierId || !file || reading} data-testid="button-read-quotation">
              <Upload size={15} /> {reading ? "Uploading and reading…" : "Upload and read"} <ArrowRight size={15} />
            </button>
          </div>
        ) : (
          <div className="modal-foot">
            <button className="btn" onClick={() => setStep("upload")} data-testid="button-back-to-upload"><ArrowLeft size={15} /> {existing || documentRef ? "Replace document" : "Upload document"}</button>
            <button className="btn primary" onClick={submit} disabled={errors.length > 0 || save.isPending} data-testid="button-save-quote">
              <Save size={15} /> {save.isPending ? "Saving…" : existing ? "Save changes" : "Save Quotation"}
            </button>
          </div>
        )
      }
    >
      {!request || !product ? (
        <div className="skel" style={{ height: 220 }} />
      ) : (
        <>
          <div className="field">
            <label htmlFor="quote-supplier">Supplier</label>
            <select
              id="quote-supplier"
              value={supplierId}
              disabled={reading}
              onChange={(event) => {
                switchSupplier(event.target.value);
              }}
              data-testid="select-quote-supplier"
            >
              {request.suppliers.map((supplier) => (
                <option key={supplier.supplierId} value={supplier.supplierId}>
                  {supplier.supplierName}{quotes?.some((quote) => quote.supplierId === supplier.supplierId) ? " (quotation recorded)" : ""}
                </option>
              ))}
            </select>
          </div>
          {documentRef && review?.supplierMismatch && (
            <div className="quote-supplier-mismatch" role="alert" data-testid="quotation-supplier-mismatch">
              <div className="quote-supplier-mismatch__title">
                <AlertTriangle size={19} aria-hidden="true" />
                <strong>This quotation appears to belong to a different supplier.</strong>
              </div>
              <div className="quote-supplier-mismatch__identities">
                <div className="quote-supplier-mismatch__identity">
                  <span className="quote-supplier-mismatch__label">Selected supplier</span>
                  <span className="quote-supplier-mismatch__value">{selectedSupplierName || "Not selected"}</span>
                </div>
                <div className="quote-supplier-mismatch__identity">
                  <span className="quote-supplier-mismatch__label">Document supplier</span>
                  <span className="quote-supplier-mismatch__value">{extraction?.quotedSupplierName?.trim() || "Not identified"}</span>
                </div>
              </div>
              {documentSupplierId ? (
                <>
                  <p className="quote-supplier-mismatch__explanation">The selected supplier and document supplier do not match. Please verify the original quotation.</p>
                  <button type="button" className="btn sm quote-supplier-mismatch__action" onClick={() => switchSupplier(documentSupplierId)} data-testid="button-select-document-supplier">
                    Select {request.suppliers.find((s) => s.supplierId === documentSupplierId)?.supplierName}
                  </button>
                </>
              ) : extraction?.quotedSupplierName?.trim() ? (
                <p className="quote-supplier-mismatch__explanation">The document supplier is not included in this RFQ. Check the original quotation before continuing. No supplier will be assigned automatically.</p>
              ) : (
                <p className="quote-supplier-mismatch__explanation">The quotation does not identify a supplier. Check the original quotation before continuing.</p>
              )}
              <p className="quote-supplier-mismatch__reminder">Saving still requires human verification.</p>
            </div>
          )}
          {uploadError && <p className="validation-msg" role="alert" data-testid="text-quotation-upload-error">{uploadError}</p>}

          {step === "upload" ? (
            <div className="field" style={{ marginTop: 14 }}>
              <label htmlFor="quotation-file">Quotation file</label>
              <label className="quotation-file-picker" htmlFor="quotation-file">
                <FileText size={25} />
                <strong>{file?.name ?? "Choose a PDF, JPG, or PNG"}</strong>
                <span>Private upload · maximum 8 MB</span>
                <input
                  id="quotation-file"
                  className="quotation-file-input"
                  type="file"
                  accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                  disabled={reading}
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  data-testid="input-quotation-file"
                />
              </label>
              <span className="subtle-hint">Only the quote fields are extracted. Check every value before saving.</span>
            </div>
          ) : (
            <>
              <div className="parser-badge" data-testid="text-parser-method">
                <FileText size={14} /> {supplierName} · {existing ? "Edited · " : ""}{documentRef ? "Gemini extracted" : "Manual"} · {reviewConfirmed && packUomConfirmed ? "Human reviewed" : "Check before saving"}
              </div>
              {draftTransferredFrom && existing && (
                <label className="checkbox-row" data-testid="replace-existing-quote-warning">
                  <input type="checkbox" checked={replaceExistingConfirmed} onChange={(e) => setReplaceExistingConfirmed(e.target.checked)} />
                  This RFQ already has a quotation for {selectedSupplierName}. I understand that saving will replace it with the extracted document originally selected for {request.suppliers.find((s) => s.supplierId === draftTransferredFrom)?.supplierName}.
                </label>
              )}
              <p className="subtle-hint">{product.productName}{extraction?.packDescription ? ` · ${extraction.packDescription}` : ""} · {deliveryStatus === "confirmed" && date ? `${prettyDate(date)} — ${deliveryConfirmed ? "confirmed" : "verify supplier promise"}` : deliveryStatus === "lead-only" ? `${leadDays || "—"} ${leadBasis === "working-days" ? "working" : leadBasis === "calendar-days" ? "calendar" : ""} days — date not confirmed` : "Delivery information not provided"}</p>
              {documentRef && (
                <a className="quotation-source-link" href={`/api/storage${documentRef!.documentPath}`} target="_blank" rel="noreferrer">
                  <FileText size={15} /> {documentRef.documentName} <ExternalLink size={13} />
                </a>
              )}
              {notes.length > 0 && <details className="quote-details"><summary>Extraction notes</summary>{notes.map((note) => <p key={note}>{note}</p>)}</details>}
              {documentRef && review && (
                <div className="inline-warning quote-identity-review" role="alert" data-testid="quotation-identity-review">
                  <strong>Verify pack size · Check price and product</strong>
                  <details className="quote-details"><summary>Show evidence and warnings</summary>
                    <div>Document supplier: {extraction?.quotedSupplierName ?? "Not verified"} · Product: {extraction?.quotedProductName ?? "Not verified"} · Unit: {extraction?.quotedUnit ?? "Not verified"} · Pack: {extraction?.packDescription ?? "Not verified"} · Confidence: {extraction?.confidence ?? "unknown"}</div>
                    {review.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                  </details>
                  {review.supplierMismatch && <label className="checkbox-row"><input type="checkbox" checked={overrideConfirmed} onChange={(e) => setOverrideConfirmed(e.target.checked)} data-testid="checkbox-supplier-override" /> I explicitly confirm this document belongs to {selectedSupplierName}, overriding the document supplier mismatch.</label>}
                </div>
              )}
              <div className="modal-grid">
                <div className="field">
                  <label htmlFor="quote-price">Price per {unit} (RM)</label>
                  <input id="quote-price" type="number" inputMode="decimal" step="0.01" min="0.01" value={price} onChange={(event) => setPrice(event.target.value)} data-testid="input-reply-price" />
                </div>
                <div className="field">
                  <label htmlFor="quote-moq">Minimum order ({unit}s)</label>
                  <input id="quote-moq" type="number" inputMode="numeric" step="1" min="1" value={moq} onChange={(event) => setMoq(event.target.value)} data-testid="input-reply-moq" />
                  {!moq.trim() && <span className="subtle-hint">MOQ not stated in quotation. Confirm with supplier before final comparison.</span>}
                </div>
                <details className="field quote-details">
                  <summary>More options</summary>
                  <label htmlFor="quote-multiple">Order multiple (optional)</label>
                  <input id="quote-multiple" type="number" inputMode="numeric" step="1" min="1" value={multiple} onChange={(event) => setMultiple(event.target.value)} />
                  {!multiple.trim() && <p className="subtle-hint">Order multiple not stated in quotation; confirm with supplier if applicable.</p>}
                  {extraction?.leadTimeText && <p>Original wording: {extraction.leadTimeText}</p>}
                  {documentDate && <p>Original document date: {prettyDate(documentDate)} (retained as evidence).</p>}
                  <p>Historical buying prices: {product.purchaseHistory.slice(0, 4).map((purchase) => `${purchase.supplierName} RM ${purchase.unitPrice.toFixed(2)} on ${prettyDate(purchase.purchaseDate.slice(0, 10))}`).join("; ") || "No recorded purchases"}. Pack equivalence is unverified; no historical values are changed.</p>
                  {existing && <p>Received {prettyDate(existing.receivedAt.slice(0, 10))}. Editing never changes an approved PO or its quote snapshot.</p>}
                </details>
                <div className="field">
                  <label htmlFor="quote-delivery-status">Delivery status</label>
                  <select id="quote-delivery-status" value={deliveryStatus} data-testid="select-delivery-status" onChange={(e) => {
                    const value = e.target.value as typeof deliveryStatus;
                    setDeliveryStatus(value);
                    setDeliveryConfirmed(false);
                    if (value !== "confirmed") setDate("");
                    if (value === "none") { setLeadDays(""); setLeadBasis("unknown"); }
                  }}>
                    <option value="confirmed">Confirmed delivery date</option>
                    <option value="lead-only">Lead time only — date unconfirmed</option>
                    <option value="none">No delivery information</option>
                  </select>
                </div>
                {deliveryStatus !== "none" && <div className="field">
                  <label htmlFor="quote-lead-days">Lead time stated (optional)</label>
                  <input id="quote-lead-days" type="number" min="0" step="1" value={leadDays} onChange={(e) => setLeadDays(e.target.value)} data-testid="input-quote-lead-days" />
                  <select aria-label="Lead time basis" value={leadBasis} onChange={(e) => setLeadBasis(e.target.value as LeadTimeBasis)} data-testid="select-quote-lead-basis">
                    <option value="unknown">Basis unknown — confirm</option><option value="calendar-days">Calendar days</option><option value="working-days">Working days — date unconfirmed</option>
                  </select>
                  {extraction?.leadTimeText && <span className="subtle-hint">Original wording: {extraction.leadTimeText}</span>}
                  {leadBasis === "working-days" && <span className="subtle-hint">No promised date is calculated. Confirm weekends/public holidays and delivery with the supplier.</span>}
                </div>}
                {deliveryStatus === "confirmed" && <div className="field">
                  <label htmlFor="quote-date">Supplier-promised delivery date</label>
                  <input id="quote-date" type="date" min={today} value={date} onChange={(event) => { setDate(event.target.value); setDeliveryConfirmed(false); }} data-testid="input-reply-date" />
                  <span className="subtle-hint">
                    {date && isValidDate(date) ? `${prettyDate(date)} · requested ${prettyDate(request.requestedDeliveryDate)}` : "Leave empty if the supplier did not state delivery."}
                  </span>
                  <label className="quote-confirmation-row">
                    <input id="quote-delivery-confirmed" type="checkbox" checked={deliveryConfirmed} onChange={(e) => setDeliveryConfirmed(e.target.checked)} data-testid="checkbox-delivery-confirmed" />
                    <span className="quote-confirmation-text">I verified the supplier promised this exact date{fromDocument ? " in the original document" : " separately (not a calculated estimate)"}.</span>
                  </label>
                  {!fromDocument && <><label htmlFor="delivery-confirmation-note">Supplier confirmation evidence (optional)</label><textarea id="delivery-confirmation-note" maxLength={500} value={confirmationNote} onChange={(e) => setConfirmationNote(e.target.value)} placeholder="How and when the supplier confirmed this date" data-testid="input-delivery-confirmation-note" /></>}
                </div>}
              </div>
              {deliveryStatus !== "confirmed" && <p className="pos-note warn">{deliveryStatus === "lead-only" ? "Lead time only — delivery date unconfirmed. No exact date is inferred; this offer cannot be automatically recommended." : "Delivery unconfirmed — save allowed, but this offer cannot be automatically recommended."}</p>}
              <p className="subtle-hint">Quoted quantity is not MOQ. Confirm MOQ separately. Conditional and full-order discounts are excluded from this item's comparison.</p>
              <section className="quote-confirmations" aria-labelledby="quote-confirmations-title">
                <h3 id="quote-confirmations-title" className="quote-confirmations__title">Human verification</h3>
                <label className="quote-confirmation-row">
                  <input id="quote-confirmation-review" type="checkbox" checked={reviewConfirmed} onChange={(e) => setReviewConfirmed(e.target.checked)} data-testid="checkbox-quotation-reviewed" />
                  <span className="quote-confirmation-text">I checked the price, MOQ, delivery wording, and supplier identity against the original quotation.</span>
                </label>
                <label className="quote-confirmation-row">
                  <input id="quote-confirmation-pack-uom" type="checkbox" checked={packUomConfirmed} onChange={(e) => setPackUomConfirmed(e.target.checked)} data-testid="checkbox-pack-uom-confirmed" />
                  <span className="quote-confirmation-text">
                    I separately confirmed the same catalogue SKU, compatible pack size, and stock unit.
                    <span className="quote-confirmation-note">No carton, set, or multi-bar pack conversion is assumed.</span>
                  </span>
                </label>
              </section>
              {!packUomConfirmed && <p className="pos-note warn">Pack/UOM unconfirmed — save allowed, but comparison and quotation-linked PO preparation are blocked.</p>}
              {errors.length > 0 && <div className="validation-msg" role="alert"><strong>Before saving</strong><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}
            </>
          )}
        </>
      )}
    </ModalShell>
  );
}
