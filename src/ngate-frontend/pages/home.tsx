import { Link } from "wouter";
import { AlertTriangle, ArrowRight, FileText, Gauge, Package, TrendingUp, Truck } from "lucide-react";
import { ErrorState, KpiCard, PageHead, PageSkeleton, StatusTag } from "@/components/shared/bits";
import { ProductIcon } from "@/components/shared/product-icon";
import { PosSourceStrip } from "@/components/pos/pos-source-strip";
import { InfoTip } from "@/components/shared/info-tip";
import { useDashboardData } from "@/hooks/use-ngate";
import { setSettings, useSettings } from "@/hooks/use-settings";
import { OWNER, BUSINESS_NAME } from "@/lib/brand";
import { buildDashboard, type ProductAlert } from "@/lib/inventory";
import { plural, timeOfDayGreeting } from "@/lib/format";

const ALERT_ICON: Record<ProductAlert["kind"], typeof AlertTriangle> = {
  "stockout-risk": AlertTriangle,
  "below-reorder": Package,
  overstock: TrendingUp,
  "demand-up": TrendingUp,
  "price-up": AlertTriangle,
  "no-usage-data": Gauge,
};

export default function HomePage() {
  const { data, isLoading, isError, error, refetch } = useDashboardData();
  const settings = useSettings();
  if (isLoading) return <PageSkeleton />;
  if (isError || !data) return <ErrorState message={error?.message} onRetry={() => refetch()} />;

  const d = buildDashboard(data.products, data.quotationRequests, data.quotes, data.purchaseOrders, settings);
  // Low-stock products already appear in the low-stock list above, so skip their repeat alerts here.
  const visibleAlerts = d.otherAlerts.filter(
    (alert) => alert.kind !== "overstock" && alert.kind !== "stockout-risk" && alert.kind !== "below-reorder",
  );
  const top = d.top;
  const leadInsight = top ?? d.insights[0] ?? null;
  const leadInsightSupplier = leadInsight?.product.suppliers.find((s) => s.supplierId === leadInsight.product.preferredSupplierId)?.supplierName;
  const velocityInsight = d.insights
    .filter((i) => (i.product.weeklyUsage?.previousWeek ?? 0) > 0)
    .sort((a, b) => {
      const aUsage = a.product.weeklyUsage!;
      const bUsage = b.product.weeklyUsage!;
      return bUsage.thisWeek / bUsage.previousWeek - aUsage.thisWeek / aUsage.previousWeek;
    })[0] ?? null;
  const velocityUsage = velocityInsight?.product.weeklyUsage;

  return (
    <>
      <PageHead
        eyebrow="YOUR BUSINESS TODAY"
        title={`${timeOfDayGreeting()}, ${OWNER.firstName}`}
        sub={`${BUSINESS_NAME} — Purchasing Overview`}
        right={<Link href="/supplier-quotations" className="btn sm outline" data-testid="link-home-upload-quotation"><FileText size={14} /> Upload Quotation</Link>}
      />

      <PosSourceStrip testId="pos-source-home" />

      <div className="kpi-grid">
        <KpiCard
          icon={<Package size={18} />}
          tone={d.lowStockCount ? "red" : ""}
          title="Low-Stock Items"
          value={String(d.lowStockCount)}
          desc={<a className="link-btn" href="#low-stock-list">See item details</a>}
          testId="kpi-low-stock"
        />
        <KpiCard
          icon={<TrendingUp size={18} />}
          tone="amber"
          title="Sales Velocity"
          value={velocityUsage ? `${(velocityUsage.thisWeek / velocityUsage.previousWeek).toFixed(1)}×` : "—"}
          desc={velocityInsight ? `${velocityInsight.product.shortName} vs last week` : "Not enough weekly usage history"}
          testId="kpi-sales-velocity"
        />
        <KpiCard
          icon={<Truck size={18} />}
          tone="purple"
          title="Supplier Lead Time"
          value={leadInsight ? plural(leadInsight.leadTimeDays, "day") : "—"}
          desc={leadInsight ? `${leadInsightSupplier ?? "Preferred supplier"} · ${leadInsight.product.shortName}` : "No supplier data"}
          testId="kpi-supplier-lead-time"
        />
      </div>

      <section className="surface low-stock-overview" id="low-stock-list" aria-labelledby="low-stock-title" data-testid="low-stock-list">
        <div className="section-head">
          <div>
            <h2 id="low-stock-title" className="title-row">
              Low-stock items ({d.lowStockCount})
              <InfoTip>These products are at or below their reorder level, or may run out before delivery.</InfoTip>
            </h2>
          </div>
        </div>
        {d.insights.filter((i) => i.needsReplenishment).length === 0 ? (
          <p className="subtext">No products currently need replenishment.</p>
        ) : (
          <div className="low-stock-grid">
            {d.insights.filter((i) => i.needsReplenishment).map((i) => {
              const product = i.product;
              return (
                <article className="low-stock-item" key={product.productId} data-testid={`low-stock-item-${product.productId}`}>
                  <div className="low-stock-item-head">
                    <ProductIcon productId={product.productId} />
                    <div className="low-stock-name">
                      <strong>{product.productName}</strong>
                      <StatusTag status={i.status} />
                    </div>
                  </div>
                  <dl className="low-stock-facts">
                    <div><dt>{product.posData?.inventoryAsOf ? "Stock at snapshot" : "Stock (demo)"}</dt><dd>{plural(product.currentStock, product.stockUnit)}</dd></div>
                    <div><dt>Supplier lead time</dt><dd>{plural(i.leadTimeDays, "day")}</dd></div>
                    <div><dt>Suggested order</dt><dd>{i.suggestedOrderQuantity != null ? plural(i.suggestedOrderQuantity, product.stockUnit) : "Check usage first"}</dd></div>
                  </dl>
                  <Link href={`/purchasing/${product.productId}`} className="btn sm outline" data-testid={`link-low-stock-${product.productId}`}>
                    Review suppliers <ArrowRight size={13} />
                  </Link>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <div className="dash-grid">
        <section>
          <div className="surface panel-pad recent">
            <div className="section-head">
              <div>
                <h2 className="title-row">Other products to review<InfoTip>Calculated from stock, usage and purchase history.</InfoTip></h2>
              </div>
              <Link href="/purchasing" className="link-btn" data-testid="link-all-products">All products <ArrowRight size={13} className="inline-ico" /></Link>
            </div>
            {visibleAlerts.length === 0 ? (
              <p className="subtext">Nothing else needs attention right now.</p>
            ) : (
              visibleAlerts.map((a) => {
                const Icon = ALERT_ICON[a.kind];
                return (
                  <div className="queue-row" key={`${a.productId}-${a.kind}`} data-testid={`row-alert-${a.productId}-${a.kind}`}>
                    <div className="queue-left">
                      <ProductIcon productId={a.productId} />
                      <div style={{ minWidth: 0 }}>
                        <div className="item-name">
                          {a.productName} <span className={`tag ${a.tone}`}><Icon size={12} /> {a.title}</span>
                          {a.demoData && <span className="tag">Demo usage data</span>}
                        </div>
                        <div className="item-sub">{a.explanation}</div>
                      </div>
                    </div>
                    <div className="queue-right">
                      <Link href={`/purchasing/${a.productId}`} className="btn sm outline" data-testid={`link-alert-${a.productId}-${a.kind}`}>
                        {a.actionLabel} <ArrowRight size={13} />
                      </Link>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <aside className="stack">
          <div className="surface right-card">
            <h3>Inventory settings</h3>
            <div className="settings-row">
              <label htmlFor="safety-days">Safety stock</label>
              <select id="safety-days" value={settings.safetyStockDays} onChange={(e) => setSettings({ safetyStockDays: Number(e.target.value) })} data-testid="select-safety-days">
                {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{plural(n, "day")}</option>)}
              </select>
            </div>
            <div className="settings-row">
              <label htmlFor="overstock-days">Overstock after</label>
              <select id="overstock-days" value={settings.overstockCoverageDays} onChange={(e) => setSettings({ overstockCoverageDays: Number(e.target.value) })} data-testid="select-overstock-days">
                {[5, 7, 10, 14].map((n) => <option key={n} value={n}>{n} days of use</option>)}
              </select>
            </div>
          </div>
          <div className="surface right-card">
            <h3>Need help?</h3>
            <Link href="/purchasing" className="btn outline" style={{ marginTop: 12 }} data-testid="link-help-find-product">
              Open Purchasing <ArrowRight size={14} />
            </Link>
          </div>
        </aside>
      </div>
    </>
  );
}
