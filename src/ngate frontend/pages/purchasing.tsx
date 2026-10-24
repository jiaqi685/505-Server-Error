import { useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Search } from "lucide-react";
import { ErrorState, PageHead, Skeleton, StatusTag } from "@/components/shared/bits";
import { PosSourceStrip } from "@/components/pos/pos-source-strip";
import { ProductIcon } from "@/components/shared/product-icon";
import { useProducts } from "@/hooks/use-ngate";
import { useSettings } from "@/hooks/use-settings";
import { insightFor } from "@/lib/inventory";
import { plural, qtyText } from "@/lib/format";

export default function PurchasingPage() {
  const [query, setQuery] = useState("");
  const settings = useSettings();
  const { data: found, isLoading, isError, error, refetch } = useProducts(query);

  return (
    <>
      <PageHead eyebrow="PURCHASING" title="Purchasing" info="Find a product, request quotations, compare suppliers and prepare a PO." />
      <PosSourceStrip testId="pos-source-purchasing" />
      <div className="surface search-panel">
        <label className="eyebrow" htmlFor="product-search" style={{ display: "block" }}>SEARCH PRODUCTS OR SUPPLIERS</label>
        <div className="search-wrap">
          <Search size={19} />
          <input
            id="product-search"
            autoComplete="off"
            type="search"
            placeholder="Search by product or supplier name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search by product or supplier name"
            data-testid="input-product-search"
          />
        </div>
        <div className="hint">Try "rice", "milk", "shampoo" or "FreshChoice".</div>
      </div>

      <div className="section-head">
        <h2>{query.trim() ? "Products found" : "All products"}</h2>
        <span className="subtext" data-testid="text-product-count">{found ? plural(found.length, "product") : "Loading"}</span>
      </div>

      {isError ? (
        <ErrorState message={error?.message} onRetry={() => refetch()} />
      ) : isLoading || !found ? (
        <div className="products">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} h={92} />)}
        </div>
      ) : (
        <div className="products">
          {found.length ? (
            found.map((p) => {
              const i = insightFor(p, settings);
              return (
                <Link key={p.productId} href={`/purchasing/${p.productId}?from=purchasing`} className="product-card" data-testid={`card-product-${p.productId}`}>
                  <ProductIcon productId={p.productId} size={50} />
                  <div style={{ minWidth: 0 }}>
                    <h3>{p.productName}</h3>
                    <p>
                      {plural(p.currentStock, p.stockUnit)} in stock
                      {i.daysOfCover != null ? ` · lasts ~${plural(Number(qtyText(i.daysOfCover)), "day")}` : ""} · {p.suppliers.map((s) => s.supplierName).join(", ")}
                    </p>
                    <StatusTag status={i.status} />
                  </div>
                  <span className="arrow"><ArrowRight size={18} /></span>
                </Link>
              );
            })
          ) : (
            <div className="surface empty" style={{ gridColumn: "1/-1" }}>
              <Search size={30} />
              <h3>No products found</h3>
              <p>Try another word, like a supplier name.</p>
              <button className="btn sm outline" onClick={() => setQuery("")} data-testid="button-clear-search">Clear search</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
