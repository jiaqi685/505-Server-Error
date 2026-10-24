import type { ReactNode } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowRight, Check } from "lucide-react";
import { InfoTip } from "./info-tip";
import type { StockStatus } from "@/lib/inventory";
import type { ProgressStep } from "@/lib/workflow";

export function PageHead({ eyebrow, title, sub, info, right }: { eyebrow: string; title: ReactNode; sub?: string; info?: ReactNode; right?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="page-title" data-testid="text-page-title">
          {title}
          {info && <InfoTip label="About this page">{info}</InfoTip>}
        </h1>
        {sub && <p className="subtext">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function KpiCard({ icon, title, value, desc, tone = "", testId }: { icon: ReactNode; title: string; value: string; desc: ReactNode; tone?: "" | "amber" | "purple" | "red"; testId?: string }) {
  return (
    <article className="surface kpi">
      <div className="kpi-top">
        <h3>{title}</h3>
        <div className={`ico-bg ${tone}`}>{icon}</div>
      </div>
      <div className="kpi-metric" data-testid={testId}>{value}</div>
      <div className="kpi-desc">{desc}</div>
    </article>
  );
}

const STATUS_TAG: Record<StockStatus, [string, string]> = {
  "stockout-risk": ["red", "Stockout risk"],
  "reorder-recommended": ["orange", "Reorder recommended"],
  "zero-demand": ["blue", "Zero demand recorded"],
  "below-reorder": ["orange", "Low stock"],
  overstock: ["orange", "Overstock"],
  "no-usage-data": ["", "No usage data"],
  ok: ["green", "Stock OK"],
};

export function StatusTag({ status }: { status: StockStatus }) {
  const [tone, label] = STATUS_TAG[status];
  return <span className={`tag ${tone}`} style={{ marginTop: 7 }} data-testid="status-stock">{label}</span>;
}

/** Five-step purchasing progress. Only real actions mark a step done. */
export function ProgressTracker({ steps }: { steps: ProgressStep[] }) {
  return (
    <ol className="progress-tracker" aria-label="Purchasing progress">
      {steps.map((s, i) => (
        <li key={s.key} className={`pt-step ${s.state}`} aria-current={s.state === "current" ? "step" : undefined} data-testid={`progress-${s.key}`}>
          <span className="pt-dot">{s.state === "done" ? <Check size={14} /> : i + 1}</span>
          <span className="pt-text">
            <strong>{s.label}</strong>
            {s.note && <small>{s.note}</small>}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function Skeleton({ h = 18, w = "100%", style }: { h?: number; w?: number | string; style?: React.CSSProperties }) {
  return <div className="skel" style={{ height: h, width: w, ...style }} aria-hidden="true" />;
}

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton h={14} w={140} style={{ marginBottom: 12 }} />
      <Skeleton h={34} w="45%" style={{ marginBottom: 10 }} />
      <Skeleton h={14} w="60%" style={{ marginBottom: 26 }} />
      <div className="kpi-grid">
        <Skeleton h={118} />
        <Skeleton h={118} />
        <Skeleton h={118} />
      </div>
      <Skeleton h={260} />
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="surface error-box" role="alert">
      <AlertTriangle size={26} />
      <h3>Something went wrong</h3>
      <p className="subtext">{message ?? "We could not load this information."}</p>
      {onRetry && (
        <button className="btn outline" style={{ marginTop: 14 }} onClick={onRetry} data-testid="button-retry">
          Try again
        </button>
      )}
    </div>
  );
}

export function LinkArrow({ href, children, testId }: { href: string; children: ReactNode; testId: string }) {
  return (
    <Link href={href} className="link-btn" data-testid={testId}>
      {children} <ArrowRight size={13} className="inline-ico" />
    </Link>
  );
}
