import { Link } from "wouter";
import { ScrollText } from "lucide-react";
import { ErrorState, PageHead, Skeleton } from "@/components/shared/bits";
import { useActivity } from "@/hooks/use-ngate";
import { dataSource } from "@/data";
import { dateTime } from "@/lib/format";
import { InfoTip } from "@/components/shared/info-tip";

export default function ActivityPage() {
  const { data: entries, isLoading, isError, error, refetch } = useActivity();

  return (
    <>
      <PageHead
        eyebrow="YOUR RECORDS"
        title="Activity History"
        right={
          <span className="save-status" data-testid="status-activity-storage">
            <span className="save-dot" aria-hidden />
            {dataSource === "mock" ? "Saved in this browser" : "Saved to database"}
            <InfoTip label="Where this is saved">
              {dataSource === "mock"
                ? "Demo mode: this history is stored only in this browser."
                : "Your RFQs, quotations, purchase orders and approvals are saved to your signed-in NGate account on the server. POS sales and stock imports stay in this browser only."}
            </InfoTip>
          </span>
        }
      />
      {isError ? (
        <ErrorState message={error?.message} onRetry={() => refetch()} />
      ) : (
        <div className="surface table-panel">
          <div className="table-head">
            <div>
              <h3 className="title-row">Your recent activity<InfoTip>{dataSource === "mock" ? "This demo history is stored only in this browser." : "History from your NGate account."}</InfoTip></h3>
            </div>
            <div className="activity-counts" data-testid="text-activity-counts">
              <span className="tag">{entries?.length ?? 0} actions</span>
            </div>
          </div>
          <div className="scroll-area history-scroll">
            {isLoading || !entries ? (
              <div style={{ padding: 20, display: "grid", gap: 10 }}>
                {[0, 1, 2, 3].map((i) => <Skeleton key={i} h={40} />)}
              </div>
            ) : entries.length === 0 ? (
              <div className="empty">
                <ScrollText size={32} />
                <h3>No activity yet</h3>
                <p>Ask suppliers for new prices to see your actions here.</p>
                <Link href="/purchasing" className="btn sm outline" data-testid="link-activity-start">Find a product</Link>
              </div>
            ) : (
              <table className="data-table history-table">
                <thead>
                  <tr><th>Time</th><th>Action</th><th>Status</th><th>Product</th><th>Reference</th><th>Done by</th><th>Details</th></tr>
                </thead>
                <tbody>
                  {entries.map((a) => (
                    <tr key={a.eventId} data-testid={`row-activity-${a.eventId}`}>
                      <td data-label="Time">{dateTime(a.timestamp)}</td>
                      <td data-label="Action" className="cell-strong">{a.action}</td>
                      <td data-label="Status"><span className="tag">{a.status}</span></td>
                      <td data-label="Product">{a.productName ?? "—"}</td>
                      <td data-label="Reference">{[a.rfqId, a.poNumber, a.supplierId].filter(Boolean).join(" · ") || "—"}</td>
                      <td data-label="Done by">{a.actor}</td>
                      <td data-label="Details">{a.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </>
  );
}
