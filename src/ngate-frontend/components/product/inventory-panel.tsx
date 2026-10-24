import { CalendarClock, Clock, Gauge, Package, ShoppingCart, Truck } from "lucide-react";
import type { Product, SupplierQuote } from "@/data";
import { PosFreshnessNote, RiceSpecificationNote } from "@/components/pos/pos-quality-notes";
import type { InventoryInsight, InventorySettings } from "@/lib/inventory";
import { daysBetween, money, plural, prettyDate, qtyText, todayLocal } from "@/lib/format";
import { POS_SOURCE } from "@/data/pos/types";
import { StatusTag } from "@/components/shared/bits";

/** Inventory facts with the formulas shown, so every number can be checked. */
export function InventoryPanel({ product: p, insight: i, settings, quotes }: { product: Product; insight: InventoryInsight; settings: InventorySettings; quotes?: SupplierQuote[] }) {
  const unit = p.stockUnit;
  const u = p.averageDailyUsage;
  const expiresIn = p.expiryDate ? daysBetween(todayLocal(), p.expiryDate) : null;
  return (
    <section className="surface panel-pad inventory-panel" aria-label="Stock insight" data-testid="panel-inventory">
      <div className="section-head" style={{ marginBottom: 6 }}>
        <h2>Stock insight</h2>
        <StatusTag status={i.status} />
      </div>
      <p className="action-explain" data-testid="text-inventory-explanation">{i.explanation}</p>
      <dl className="fact-grid">
        <div><dt><Package size={15} /> {p.posData?.inventoryAsOf ? "Stock at snapshot" : "Current stock (demo)"}</dt><dd>{plural(p.currentStock, unit)}</dd></div>
        <div><dt><Gauge size={15} /> Average daily usage</dt><dd>{u != null ? `${qtyText(u)} ${unit}s/day` : "No data"}</dd></div>
        <div>
          <dt><Clock size={15} /> Stock cover</dt>
          <dd data-testid="text-days-cover">{i.zeroDemand ? "No depletion at 0/day" : i.daysOfCover != null ? `${plural(Number(qtyText(i.daysOfCover)), "day")}` : "Unknown"}</dd>
          {i.daysOfCover != null && <small>{p.currentStock} ÷ {qtyText(u!)} per day</small>}
        </div>
        <div><dt><Truck size={15} /> Preferred supplier lead time</dt><dd>{plural(i.leadTimeDays, "day")}</dd></div>
        <div>
          <dt><ShoppingCart size={15} /> Suggested order</dt>
          <dd data-testid="text-suggested-order">{i.suggestedOrderQuantity != null ? plural(i.suggestedOrderQuantity, unit) : "—"}</dd>
          {i.targetStock != null && (
            <small>{qtyText(u!)} × ({i.leadTimeDays} + {settings.safetyStockDays} safety days) − {p.currentStock}</small>
          )}
        </div>
        <div>
          <dt><CalendarClock size={15} /> Earliest expiry</dt>
          <dd>{p.expiryDate ? prettyDate(p.expiryDate) : "Not tracked"}</dd>
          {expiresIn != null && <small>{expiresIn <= 0 ? "Expired or expiring today" : `in ${plural(expiresIn, "day")}`}</small>}
        </div>
      </dl>
      {i.excessQuantity > 0 && (
        <p className="hint">Overstock: {plural(i.excessQuantity, unit)} above {settings.overstockCoverageDays} days of use, about {money(i.excessValue)} at the last price paid.</p>
      )}
      {p.posData && (p.posData.salesFileName || p.posData.inventoryFileName) && (
        <div className="pos-prov" data-testid="text-pos-provenance">
          <strong>{POS_SOURCE}</strong>
          {p.posData.salesFileName && (
            <div>
              Sales: {p.posData.salesFileName}
              {p.posData.dateFrom && p.posData.dateTo && <> · {prettyDate(p.posData.dateFrom)} – {prettyDate(p.posData.dateTo)}</>}
              {p.posData.coveredDays != null && <> · {plural(p.posData.coveredDays, "day")} covered</>}
              <br />
              {p.posData.latestSevenTotal != null
                ? <>Average daily usage = {qtyText(p.posData.latestSevenTotal)} sold in latest 7 days{p.posData.windowFrom ? ` (from ${prettyDate(p.posData.windowFrom)})` : ""} ÷ 7</>
                : <>Latest 7 days incomplete, so usage is unknown (gaps are not counted as zero).</>}
            </div>
          )}
          {p.posData.inventoryFileName && <div>Stock snapshot: {p.posData.inventoryFileName}{p.posData.inventoryAsOf ? ` · as of ${prettyDate(p.posData.inventoryAsOf)}` : ""} · Historical count, not verified real-time stock.</div>}
        </div>
      )}
      <PosFreshnessNote salesDate={p.posData?.dateTo} inventoryDate={p.posData?.inventoryAsOf} />
      <RiceSpecificationNote product={p} quotes={quotes} />
      {!i.hasUsageData && <p className="hint">Insufficient usage data to estimate stock coverage. Enter a quantity yourself when requesting quotations.</p>}
    </section>
  );
}

export function SupplierList({ product: p, onRequestQuote }: { product: Product; onRequestQuote: (supplierId: string) => void }) {
  return (
    <section className="surface panel-pad" aria-label="Suppliers">
      <div className="section-head" style={{ marginBottom: 6 }}>
        <h2>Suppliers</h2>
        <span className="subtext">{plural(p.suppliers.length, "supplier")}</span>
      </div>
      {p.suppliers.map((s) => {
        const last = p.purchaseHistory.find((h) => h.supplierId === s.supplierId);
        return (
          <div className="queue-row" key={s.supplierId} data-testid={`row-supplier-${s.supplierId}`}>
            <div style={{ minWidth: 0 }}>
              <div className="item-name">
                {s.supplierName} {s.supplierId === p.preferredSupplierId && <span className="tag">Usual supplier</span>}
              </div>
              <div className="item-sub">
                {s.leadTimeDays == null ? "Delivery timing not confirmed" : `Usually delivers in ${plural(s.leadTimeDays, "day")}`}
                {last ? ` · last paid ${money(last.unitPrice)} on ${prettyDate(last.purchaseDate)}` : " · no past purchases"}
              </div>
            </div>
            <button className="btn sm outline" onClick={() => onRequestQuote(s.supplierId)} data-testid={`button-quote-supplier-${s.supplierId}`}>Ask price</button>
          </div>
        );
      })}
    </section>
  );
}
