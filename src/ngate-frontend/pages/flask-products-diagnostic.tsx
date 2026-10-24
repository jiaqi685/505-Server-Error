import { useGetFlaskProducts } from "@workspace/api-client-react";
import { FlaskConical, RefreshCw } from "lucide-react";
import "./flask-products-diagnostic.css";

function getHttpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

export default function FlaskProductsDiagnosticPage() {
  const { data, error, isError, isFetching, isLoading, refetch } = useGetFlaskProducts({
    query: { queryKey: ["flask-products-diagnostic"], retry: false },
  });
  const statusCode = isError ? getHttpStatus(error) : data ? 200 : undefined;

  return (
    <section className="flask-diagnostic" aria-labelledby="flask-diagnostic-title">
      <header className="flask-diagnostic__header">
        <div className="flask-diagnostic__icon" aria-hidden="true"><FlaskConical size={21} /></div>
        <div>
          <p className="eyebrow">DEVELOPMENT DIAGNOSTIC</p>
          <h1 id="flask-diagnostic-title">Flask Demo Data</h1>
          <p className="flask-diagnostic__intro">
            Read-only Flask copy of the Mini Mart demo catalogue. The main presentation app remains in Mock Mode.
          </p>
        </div>
        <button className="btn sm outline flask-diagnostic__refresh" onClick={() => void refetch()} disabled={isFetching}>
          <RefreshCw size={15} className={isFetching ? "flask-diagnostic__spinning" : ""} />
          {isFetching ? "Checking…" : "Refresh"}
        </button>
      </header>

      <div className={`flask-diagnostic__status ${isError ? "is-error" : data ? "is-connected" : ""}`} role="status" aria-live="polite">
        <span className="flask-diagnostic__status-dot" />
        <strong>{isLoading ? "Checking Flask catalogue…" : isError ? "Connection failed" : "Read-only catalogue available"}</strong>
        {statusCode !== undefined && <span>HTTP {statusCode}</span>}
        {data && <span>{data.count} products returned</span>}
      </div>

      {isError && (
        <div className="flask-diagnostic__error" role="alert">
          <strong>Could not load Flask Demo Data.</strong>
          <span>{error instanceof Error ? error.message : "The products request failed."}</span>
          {statusCode === 401 && <span>Sign in with an authenticated NGate session, then refresh this page.</span>}
        </div>
      )}

      {data && (
        <>
          <div className="flask-diagnostic__source">
            <span>Data source</span>
            <strong>{data.dataSource}</strong>
            <span className="flask-diagnostic__source-detail">Source: {data.sourceDataSource}</span>
          </div>
          <div className="flask-diagnostic__table-wrap">
            <table className="flask-diagnostic__table">
              <thead>
                <tr><th>Product name</th><th>Current stock</th><th>Unit</th><th>Flask product ID</th></tr>
              </thead>
              <tbody>
                {data.products.map(({ sourceProductId, product }) => (
                  <tr key={sourceProductId}>
                    <td>{product.productName}</td>
                    <td className="flask-diagnostic__stock">{product.currentStock}</td>
                    <td>{product.stockUnit}</td>
                    <td><code>{sourceProductId}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!isLoading && !isError && !data && <p className="flask-diagnostic__empty">No response received yet.</p>}
      <p className="flask-diagnostic__footnote">
        This page only reads the authenticated products endpoint. It does not change the main app’s mock data or create records.
      </p>
    </section>
  );
}
