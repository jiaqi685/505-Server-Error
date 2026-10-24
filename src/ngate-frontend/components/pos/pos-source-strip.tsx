import { useEffect, useId, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowRight, ChevronDown, FileSpreadsheet } from "lucide-react";
import { usePosImportState } from "@/hooks/use-pos-import";
import type { PosDataset } from "@/data/pos/types";
import { POS_SOURCE } from "@/data/pos/types";
import { dateTime, daysBetween, prettyDate, todayLocal } from "@/lib/format";
import { POS_FRESHNESS_LIMIT_DAYS } from "@/lib/pos-quality";
import { buildSeedProducts } from "@/data/seed";

const CATALOGUE_SIZE = 22;
const catalogue = buildSeedProducts().map((product) => ({ id: product.productId, name: product.productName }));

function shortName(name: string, max = 26) {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot) : "";
  return `${name.slice(0, max - ext.length - 1)}…${ext}`;
}
function shortDay(date?: string) {
  if (!date) return "—";
  const p = prettyDate(date).split(" ");
  return p.length === 3 ? `${p[0]} ${p[1]}` : date;
}
function summarise(ds: PosDataset | null | undefined) {
  if (!ds) return null;
  const dates = ds.rows.map((r) => r.date).filter(Boolean).sort();
  return {
    from: dates[0],
    to: dates[dates.length - 1],
    coverage: new Set(ds.rows.map((r) => r.productId)).size,
  };
}
function ageOf(date: string | undefined, today: string): number | null {
  if (!date) return null;
  const n = daysBetween(date, today);
  return Number.isFinite(n) ? n : null;
}
function ageLabel(age: number | null) {
  if (age == null) return "No data";
  if (age < 0) return "Future-dated";
  if (age === 0) return "Current";
  return age === 1 ? "1 day old" : `${age} days old`;
}

/** Compact, progressive provenance strip for synthetic POS data. Ages come from data dates, never upload time. */
export function PosSourceStrip({ testId = "pos-source-strip" }: { testId?: string }) {
  const { data, error } = usePosImportState();
  const [open, setOpen] = useState(false);
  const [today, setToday] = useState(todayLocal);
  const detailsId = useId();
  useEffect(() => {
    const t = window.setInterval(() => setToday(todayLocal()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const sales = data?.sales;
  const inv = data?.inventory;
  const s = summarise(sales);
  const i = summarise(inv);
  const any = !!(sales || inv);
  const salesAge = ageOf(s?.to, today);
  const stockAge = ageOf(i?.to, today);
  const stale = (a: number | null) => a != null && (a > POS_FRESHNESS_LIMIT_DAYS || a < 0);

  // One concise caution line; details hold the rest.
  const cautions: string[] = [];
  if (any && (!sales || !inv)) {
    cautions.push(`${!sales ? "Sales file" : "Stock snapshot"} missing — that side uses built-in demo estimates.`);
  }
  if (sales && inv && s?.to && i?.to && s.to !== i.to) {
    cautions.push(`Dates don't match: sales end ${shortDay(s.to)}, stock counted ${shortDay(i.to)}.`);
  }
  if (stale(salesAge) && stale(stockAge) && salesAge === stockAge) {
    cautions.push(`Sales and stock snapshot are ${ageLabel(salesAge).toLowerCase()}. Recheck stock before ordering.`);
  } else {
    if (stale(stockAge)) cautions.push(`Stock snapshot is ${ageLabel(stockAge).toLowerCase()}. Recount before ordering.`);
    if (stale(salesAge)) cautions.push(`Sales data is ${ageLabel(salesAge).toLowerCase()}.`);
  }

  const overallAge = any ? Math.max(salesAge ?? -Infinity, stockAge ?? -Infinity) : null;
  const future = [salesAge, stockAge].some((age) => age != null && age < 0);
  const status = !any ? "No data" : future ? "Future-dated" : (!sales || !inv) ? "Partial" : s?.to !== i?.to ? "Dates differ" : ageLabel(overallAge === -Infinity ? null : overallAge);
  const statusTone = !any ? "" : stale(salesAge) || stale(stockAge) || !sales || !inv ? "warn" : "ok";

  if (error) {
    return (
      <div className="pos-strip is-error" role="note" data-testid={testId}>
        <AlertTriangle size={15} aria-hidden />
        <span className="pos-strip-main"><strong>POS import unavailable:</strong> {error.message}</span>
        <Link href="/pos-import" className="link-btn pos-strip-link" data-testid={`link-${testId}-import`}>Manage import <ArrowRight size={13} className="inline-ico" /></Link>
      </div>
    );
  }

  return (
    <div className={`pos-strip${open ? " is-open" : ""}`} role="note" data-testid={testId}>
      <div className="pos-strip-row">
        <FileSpreadsheet size={15} aria-hidden />
        <span className="pos-strip-main">
          <span className="pos-chip-label">{any ? "Synthetic POS demo" : "Built-in demo estimates"}</span>
          {any ? (
            <>
              <span className="pos-strip-fact" data-testid={`text-${testId}-sales`}>
                <b>Sales:</b> {sales ? <>{shortName(sales.fileName)} <span className="muted">{shortDay(s?.from)}–{shortDay(s?.to)}</span></> : <span className="muted">not imported</span>}
              </span>
              <span className="pos-strip-fact" data-testid={`text-${testId}-stock`}>
                <b>Stock:</b> {inv ? <>snapshot {shortDay(i?.to)}</> : <span className="muted">not imported</span>}
              </span>
            </>
          ) : (
            <span className="pos-strip-fact muted">No POS file imported yet.</span>
          )}
          <span className={`pos-status ${statusTone}`} data-testid={`status-${testId}-freshness`}>{status}</span>
        </span>
        <span className="pos-strip-actions">
          {any && (
            <button
              type="button"
              className="link-btn pos-strip-toggle"
              aria-expanded={open}
              aria-controls={detailsId}
              onClick={() => setOpen((v) => !v)}
              data-testid={`button-${testId}-details`}
            >
              Details <ChevronDown size={13} className={`inline-ico chev${open ? " up" : ""}`} aria-hidden />
            </button>
          )}
          <Link href="/pos-import" className="link-btn pos-strip-link" data-testid={`link-${testId}-import`}>
            {any ? "Manage import" : "Import POS data"} <ArrowRight size={13} className="inline-ico" />
          </Link>
        </span>
      </div>

      {cautions.length > 0 && (
        <p className="pos-strip-caution" data-testid="pos-freshness-warning">
          <AlertTriangle size={13} aria-hidden /> <span>{cautions.join(" ")}</span>
        </p>
      )}

      {open && any && (
        <div className="pos-strip-details" id={detailsId} data-testid={`details-${testId}`}>
          <dl className="pos-detail-grid">
            <div>
              <dt>Sales file</dt>
              <dd>
                {sales ? <>
                  <span className="mono">{sales.fileName}</span>
                  <small>{prettyDate(s?.from)} to {prettyDate(s?.to)} · imported {dateTime(sales.importedAt)}</small>
                  <small>Coverage {s?.coverage}/{CATALOGUE_SIZE} products · data age {ageLabel(salesAge).toLowerCase()}</small>
                </> : <small>Not imported. Demand uses built-in demo estimates.</small>}
              </dd>
            </div>
            <div>
              <dt>Stock snapshot</dt>
              <dd>
                {inv ? <>
                  <span className="mono">{inv.fileName}</span>
                  <small>Counted {prettyDate(i?.to)} · imported {dateTime(inv.importedAt)}</small>
                  <small>Coverage {i?.coverage}/{CATALOGUE_SIZE} products · data age {ageLabel(stockAge).toLowerCase()}</small>
                </> : <small>Not imported. Stock uses built-in demo estimates.</small>}
              </dd>
            </div>
          </dl>
          <ul className="pos-detail-list">
            <li>Origin: {POS_SOURCE} — artificial files for demonstration, not live till sales.</li>
            <li>Freshness limit: {POS_FRESHNESS_LIMIT_DAYS} day, measured from the dates inside the files, not the upload time.</li>
            <li>Stock is a historical count, not verified real-time stock.</li>
            {sales && <li>Missing sales products: {catalogue.filter((product) => !sales.rows.some((row) => row.productId === product.id)).map((product) => product.name).join(", ") || "None"}. Unsupported rows cannot be imported; see validation on Manage import.</li>}
            {inv && <li>Missing stock products: {catalogue.filter((product) => !inv.rows.some((row) => row.productId === product.id)).map((product) => product.name).join(", ") || "None"}.</li>}
            <li>Products missing from a file keep that field's built-in demo estimate{(s && s.coverage < CATALOGUE_SIZE) || (i && i.coverage < CATALOGUE_SIZE) ? ` (${[s && s.coverage < CATALOGUE_SIZE ? `${CATALOGUE_SIZE - s.coverage} without sales` : "", i && i.coverage < CATALOGUE_SIZE ? `${CATALOGUE_SIZE - i.coverage} without stock` : ""].filter(Boolean).join(", ")})` : ""}.</li>
          </ul>
          <Link href="/pos-import" className="btn sm outline" data-testid={`link-${testId}-manage`}>Replace or reset files</Link>
        </div>
      )}
    </div>
  );
}
