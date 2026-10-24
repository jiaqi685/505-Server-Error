import { useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, RotateCcw, Upload } from "lucide-react";
import { ErrorState, PageHead, Skeleton } from "@/components/shared/bits";
import { useConfirmPosImport, usePosImportState, usePreviewPosImport, useResetPosImport } from "@/hooks/use-pos-import";
import { useProducts } from "@/hooks/use-ngate";
import { useSettings } from "@/hooks/use-settings";
import { POS_MAX_BYTES, POS_SOURCE, POS_ACCEPTED_STORE_IDS, type PosDataset, type PosImportKind, type PosPreview } from "@/data/pos/types";
import { insightFor } from "@/lib/inventory";
import { PosFreshnessNote } from "@/components/pos/pos-quality-notes";
import { dateTime, prettyDate, qtyText } from "@/lib/format";

const PAGE = 25;
const COLS: Record<PosImportKind, string[]> = {
  sales: ["date", "store_id", "product_id", "product_name", "stock_unit", "quantity_sold", "retail_unit_price_rm", "gross_sales_rm", "data_origin"],
  inventory: ["as_of_date", "store_id", "product_id", "product_name", "stock_unit", "current_stock", "data_origin"],
};
const LABEL: Record<PosImportKind, string> = { sales: "Daily sales", inventory: "Stock snapshot" };

export default function PosImportPage() {
  const state = usePosImportState();
  const preview = usePreviewPosImport();
  const confirm = useConfirmPosImport();
  const reset = useResetPosImport();
  const { data: products } = useProducts("");
  const settings = useSettings();
  const [kind, setKind] = useState<PosImportKind>("sales");
  const [pv, setPv] = useState<PosPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [page, setPage] = useState(0);
  const [askReset, setAskReset] = useState<PosImportKind | "all" | null>(null);
  const reqId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = preview.isPending || confirm.isPending || reset.isPending;

  function switchKind(k: PosImportKind) {
    if (k === kind) return;
    reqId.current++;
    setKind(k); setPv(null); setErr(null); setMsg(null); setPage(0);
  }

  async function handleFile(file: File | undefined) {
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    const id = ++reqId.current;
    setPv(null); setErr(null); setMsg(null); setPage(0);
    if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") { setErr("Please choose a .csv file."); return; }
    if (file.size > POS_MAX_BYTES) { setErr("File is larger than 2 MB. Please split or trim it."); return; }
    try {
      const result = await preview.mutateAsync({ file, kind });
      if (id === reqId.current) setPv(result);
    } catch (e) {
      if (id === reqId.current) setErr(e instanceof Error ? e.message : "Could not read this file.");
    }
  }

  async function doConfirm() {
    if (!pv || !pv.canImport || pv.kind !== kind) return;
    setErr(null);
    try {
      await confirm.mutateAsync(pv);
      setMsg(`${LABEL[pv.kind]} from ${pv.fileName} imported. It replaces any earlier ${pv.kind === "sales" ? "sales" : "snapshot"} import.`);
      setPv(null);
    } catch (e) { setErr(e instanceof Error ? e.message : "Import failed. Nothing was changed."); }
  }

  async function doReset(target: PosImportKind | "all") {
    setErr(null);
    try {
      await reset.mutateAsync(target === "all" ? undefined : target);
      setAskReset(null); setPv(null);
      setMsg(target === "all" ? "All POS imports removed. Products use the built-in demo estimates again." : `${LABEL[target]} import removed.`);
    } catch (e) { setErr(e instanceof Error ? e.message : "Reset failed."); }
  }

  function onDrop(e: DragEvent) { e.preventDefault(); setOver(false); if (!busy) handleFile(e.dataTransfer.files?.[0]); }
  function onKey(e: KeyboardEvent) { if ((e.key === "Enter" || e.key === " ") && !busy) { e.preventDefault(); inputRef.current?.click(); } }

  const rejected = new Set(pv?.issues.map((i) => i.rowNumber) ?? []);
  const rows = pv?.rows ?? [];
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const anyImported = !!(state.data?.sales || state.data?.inventory);

  return (
    <div className="pos-page">
      <PageHead eyebrow="DATA SOURCES" title="Import POS Data" sub={`Upload ${POS_SOURCE} as CSV, check the preview, then confirm.`} />

      <div className="pos-grid">
        <section className="surface panel-pad" aria-labelledby="pos-upload-title">
          <h2 id="pos-upload-title" className="sr-only">Upload a CSV file</h2>
          <div className="pos-tabs" role="tablist" aria-label="File type">
            {(["sales", "inventory"] as const).map((k) => (
              <button key={k} role="tab" aria-selected={kind === k} disabled={busy} onClick={() => switchKind(k)} data-testid={`tab-pos-${k}`}>{LABEL[k]}</button>
            ))}
          </div>

          <div
            className={`pos-drop ${over ? "over" : ""}`}
            role="button" tabIndex={0} aria-disabled={busy}
            aria-label={`Choose or drop a ${LABEL[kind].toLowerCase()} CSV file`}
            onClick={() => !busy && inputRef.current?.click()} onKeyDown={onKey}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
            data-testid="dropzone-pos"
          >
            <Upload size={26} aria-hidden />
            <strong>{preview.isPending ? "Reading file…" : `Choose ${LABEL[kind].toLowerCase()} CSV`}</strong>
            <small>Click, press Enter, or drag a file here · CSV up to 2 MB</small>
          </div>
          <input
            ref={inputRef} type="file" accept=".csv,text/csv" hidden
            onChange={(e) => handleFile(e.target.files?.[0])}
            data-testid={kind === "sales" ? "upload-pos-sales" : "upload-pos-inventory"}
          />

          <div className="pos-cols">
            Expected columns: {COLS[kind].map((c) => <code key={c}>{c}</code>).reduce<ReactNode[]>((a, c, i) => (i ? [...a, " ", c] : [c]), [])}
            <ul className="pos-rules">
              <li><code>store_id</code> must be <code>{POS_ACCEPTED_STORE_IDS[0]}</code> or <code>{POS_ACCEPTED_STORE_IDS[1]}</code> (the supplied synthetic dataset).</li>
              <li><code>stock_unit</code> must match the catalogue unit (singular or plural is fine).</li>
              <li><code>data_origin</code> must contain "synthetic" or "demo".</li>
              {kind === "sales" ? (
                <>
                  <li>One daily total per product per date, including days with 0 sold. Missing days count as unknown, not zero.</li>
                  <li>Usage needs all of the latest 7 days for a product; otherwise usage stays unknown.</li>
                  <li>Importing sales never changes stock counts.</li>
                </>
              ) : (
                <li>All rows must share the same <code>as_of_date</code>. A snapshot sets stock directly and never deducts sales.</li>
              )}
              <li>A new import replaces the earlier file of the same type. Products not in the file keep their demo estimates.</li>
            </ul>
          </div>
          <p className="pos-note" data-testid="text-pos-no-change">Nothing changes until you press Confirm Import. Previewing a file is read-only.</p>
          {err && <p className="pos-note err" role="alert" data-testid="text-pos-error"><AlertTriangle size={14} className="inline-ico" /> {err}</p>}
          {msg && <p className="pos-note ok" role="status" data-testid="text-pos-success"><CheckCircle2 size={14} className="inline-ico" /> {msg}</p>}
        </section>

        <aside className="surface panel-pad" aria-labelledby="pos-status-title" data-testid="pos-import-status">
          <h2 id="pos-status-title" style={{ marginTop: 0 }}>Current data source</h2>
          {state.isLoading ? <Skeleton h={80} /> : state.isError ? <ErrorState message={state.error?.message} onRetry={() => state.refetch()} /> : (
            <>
              <DatasetBlock label="Daily sales" ds={state.data?.sales ?? null} kind="sales" busy={busy} onReset={() => setAskReset("sales")} />
              <DatasetBlock label="Stock snapshot" ds={state.data?.inventory ?? null} kind="inventory" busy={busy} onReset={() => setAskReset("inventory")} />
              <button className="btn outline" disabled={busy || !anyImported} onClick={() => setAskReset("all")} data-testid="button-reset-pos-import">
                <RotateCcw size={14} /> Reset to Demo Data
              </button>
            </>
          )}
          {state.isError && (
            <button className="btn outline" disabled={busy} onClick={() => setAskReset("all")} data-testid="button-reset-pos-import">
              <RotateCcw size={14} /> Reset to Demo Data
            </button>
          )}
          {askReset && (
            <div className="pos-note warn" role="alertdialog" aria-label="Confirm reset" data-testid="dialog-pos-reset">
              {askReset === "all" ? "Remove all POS imports and return to built-in demo estimates?" : `Remove the ${LABEL[askReset].toLowerCase()} import?`} RFQs, quotes, purchase orders and activity history are kept.
              <div className="pos-actions">
                <button className="btn sm primary" disabled={reset.isPending} onClick={() => doReset(askReset)} data-testid="button-confirm-pos-reset">{reset.isPending ? "Resetting…" : "Yes, reset"}</button>
                <button className="btn sm" disabled={reset.isPending} onClick={() => setAskReset(null)} data-testid="button-cancel-pos-reset">Cancel</button>
              </div>
            </div>
          )}
          <p className="pos-note">Future integration with compatible POS APIs can automate data synchronization.</p>
          <p className="subtext" style={{ fontSize: 12 }}>NGate is not connected to any POS system. Files are demo data processed in this browser.</p>
        </aside>
      </div>

      {preview.isPending && <section className="surface panel-pad"><Skeleton h={22} w="40%" /><div style={{ height: 12 }} /><Skeleton h={160} /></section>}

      {pv && pv.kind === kind && !preview.isPending && (
        <section className="surface panel-pad" aria-labelledby="pos-preview-title" data-testid="pos-import-preview">
          <div className="section-head">
            <h2 id="pos-preview-title"><FileSpreadsheet size={17} className="inline-ico" /> Preview · {LABEL[pv.kind]}</h2>
            <span className={`tag ${pv.canImport ? "green" : "red"}`} data-testid="status-pos-can-import">{pv.canImport ? "Ready to import" : "Cannot import"}</span>
          </div>
          <dl className="pos-meta">
            <dt>Source</dt><dd>{POS_SOURCE}</dd>
            <dt>File</dt><dd data-testid="text-pos-filename">{pv.fileName}</dd>
            <dt>Type</dt><dd>{LABEL[pv.kind]}</dd>
            <dt>{pv.kind === "sales" ? "Date range" : "As of"}</dt><dd>{pv.dateFrom ? (pv.dateTo && pv.dateTo !== pv.dateFrom ? `${prettyDate(pv.dateFrom)} – ${prettyDate(pv.dateTo)}` : prettyDate(pv.dateFrom)) : "—"}</dd>
            {pv.kind === "sales" && <><dt>Latest 7-day window</dt><dd>{pv.windowFrom && pv.dateTo ? `${prettyDate(pv.windowFrom)} – ${prettyDate(pv.dateTo)}` : "—"}</dd></>}
          </dl>
          <PosFreshnessNote salesDate={pv.kind === "sales" ? pv.dateTo ?? undefined : undefined} inventoryDate={pv.kind === "inventory" ? pv.dateTo ?? undefined : undefined} />
          <dl className="pos-stats">
            <div className="pos-stat"><dt>TOTAL ROWS</dt><dd data-testid="text-pos-total-rows">{pv.totalRows}</dd></div>
            <div className="pos-stat"><dt>UNIQUE PRODUCTS</dt><dd>{pv.uniqueProducts}</dd></div>
            <div className="pos-stat"><dt>MATCHED</dt><dd>{pv.matchedProducts}</dd></div>
            <div className={`pos-stat ${pv.rejectedRows ? "bad" : ""}`}><dt>REJECTED ROWS</dt><dd data-testid="text-pos-rejected">{pv.rejectedRows}</dd></div>
          </dl>
          {pv.issues.length > 0 && (
            <div className="pos-note err">
              <strong>Rejected rows — fix these in the file and upload again. The whole file is held back.</strong>
              <ul className="pos-issues">{pv.issues.map((i, n) => <li key={n}><b>{i.rowNumber > 0 ? `Row ${i.rowNumber}` : "File"}:</b> {i.message}</li>)}</ul>
            </div>
          )}
          {pv.warnings.map((w, n) => <p key={n} className="pos-note warn">{w}</p>)}

          {pv.impacts.length > 0 && (
            <>
              <h3 className="pos-section-title">What changes per product</h3>
              <div className="pos-table-wrap">
                <table className="pos-table">
                  <thead><tr>
                    <th>Product</th>
                    {pv.kind === "sales" ? <><th className="num">Days covered</th><th className="num">Latest 7 days</th><th className="num">Avg / day</th><th className="num">Suggested order</th></> : <th className="num">New stock</th>}
                  </tr></thead>
                  <tbody>{pv.impacts.map((im) => {
                    const prod = products?.find((p) => p.productId === im.productId);
                    let sugg = "—";
                    if (pv.kind === "sales" && prod && im.averageDailyUsage != null) {
                      const ins = insightFor({ ...prod, averageDailyUsage: im.averageDailyUsage }, settings);
                      sugg = ins.suggestedOrderQuantity == null ? "—" : `${ins.suggestedOrderQuantity} ${im.stockUnit}`;
                    }
                    return (
                      <tr key={im.productId} data-testid={`row-pos-impact-${im.productId}`}>
                        <td>{im.productName}</td>
                        {pv.kind === "sales" ? (
                          <>
                            <td className="num">{im.coveredDays} ({im.weeklyCoveredDays}/7)</td>
                            <td className="num">{im.latestSevenTotal ?? "Unknown"}</td>
                            <td className="num">{im.averageDailyUsage != null ? qtyText(im.averageDailyUsage) : "Unknown"}</td>
                            <td className="num">{sugg}</td>
                          </>
                        ) : <td className="num">{im.currentStock ?? "—"} {im.stockUnit}</td>}
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
              {pv.kind === "sales" && <p className="subtext" style={{ fontSize: 12 }}>Avg / day = latest 7-day total ÷ 7. Suggested order <span className="pos-formula">= max(0, ceil(avg × (lead + {settings.safetyStockDays} safety days) − stock))</span>, using current stock.</p>}
            </>
          )}

          <h3 className="pos-section-title">Valid rows ({rows.length})</h3>
          <div className="pos-table-wrap">
            <table className="pos-table">
              <thead><tr>
                <th className="num">Row</th><th>Date</th><th>Store</th><th>Product ID</th><th>Name</th><th>Unit</th>
                <th className="num">{pv.kind === "sales" ? "Qty sold" : "Stock"}</th>
                {pv.kind === "sales" && <><th className="num">Unit RM</th><th className="num">Gross RM</th></>}
                <th>Origin</th>
              </tr></thead>
              <tbody>{shown.map((r) => (
                <tr key={r.rowNumber} className={rejected.has(r.rowNumber) ? "rej" : ""}>
                  <td className="num">{r.rowNumber}</td><td>{r.date}</td><td>{r.storeId}</td><td>{r.productId}</td><td>{r.productName}</td><td>{r.stockUnit}</td>
                  <td className="num">{r.quantity}</td>
                  {pv.kind === "sales" && <><td className="num">{r.retailUnitPrice?.toFixed(2) ?? "—"}</td><td className="num">{r.grossSales?.toFixed(2) ?? "—"}</td></>}
                  <td>{r.dataOrigin}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {rows.length > PAGE && (
            <div className="pos-pager">
              <span>Showing {page * PAGE + 1}–{Math.min(rows.length, (page + 1) * PAGE)} of {rows.length}</span>
              <div>
                <button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)} data-testid="button-pos-prev">Previous</button>
                <button className="btn sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} data-testid="button-pos-next">Next</button>
              </div>
            </div>
          )}

          <div className="pos-actions">
            <button className="btn primary" disabled={!pv.canImport || busy} onClick={doConfirm} data-testid="button-confirm-pos-import">
              <CheckCircle2 size={15} /> {confirm.isPending ? "Importing…" : "Confirm Import"}
            </button>
            <button className="btn" disabled={busy} onClick={() => { reqId.current++; setPv(null); }} data-testid="button-discard-pos-preview">Discard preview</button>
          </div>
          {!pv.canImport && <p className="pos-note err">This file cannot be imported. No data has changed.</p>}
        </section>
      )}

      <p className="subtext">Stock, supplier choices, quotations and purchase orders stay under your control. <Link href="/purchasing" className="link-btn">Open Purchasing</Link></p>
    </div>
  );
}

function DatasetBlock({ label, ds, kind, busy, onReset }: { label: string; ds: PosDataset | null; kind: PosImportKind; busy: boolean; onReset: () => void }) {
  const dates = ds?.rows.map((r) => r.date).sort() ?? [];
  return (
    <div className="pos-ds" data-testid={`status-pos-${kind}`}>
      <h4>{label} <span className={`tag ${ds ? "green" : ""}`}>{ds ? "Imported" : "Demo estimates"}</span></h4>
      {ds ? (
        <>
          <dl className="pos-meta">
            <dt>Source</dt><dd>{ds.source}</dd>
            <dt>File</dt><dd>{ds.fileName}</dd>
            <dt>{kind === "sales" ? "Dates" : "As of"}</dt><dd>{dates.length ? (dates[0] === dates[dates.length - 1] ? prettyDate(dates[0]) : `${prettyDate(dates[0])} – ${prettyDate(dates[dates.length - 1])}`) : "—"}</dd>
            <dt>Imported</dt><dd>{dateTime(ds.importedAt)}</dd>
          </dl>
          {kind === "inventory" && <p className="subtext">Historical count, not verified real-time stock.</p>}
          <PosFreshnessNote salesDate={kind === "sales" ? dates[dates.length - 1] : undefined} inventoryDate={kind === "inventory" ? dates[dates.length - 1] : undefined} />
          <button className="btn sm" style={{ marginTop: 8 }} disabled={busy} onClick={onReset} data-testid={`button-reset-pos-${kind}`}>Remove this import</button>
        </>
      ) : <p className="subtext" style={{ margin: 0, fontSize: 13 }}>No file imported.</p>}
    </div>
  );
}
