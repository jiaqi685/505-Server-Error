import { useEffect } from "react";
import { useLocation, Link, useParams, useSearch } from "wouter";
import { ArrowLeft, Check, CornerDownRight, PackageX } from "lucide-react";
import { ErrorState, PageHead, PageSkeleton, ProgressTracker } from "@/components/shared/bits";
import { NextStepHero } from "@/components/product/next-step-hero";
import { InventoryPanel, SupplierList } from "@/components/product/inventory-panel";
import { PurchaseHistoryTable } from "@/components/product/purchase-history-table";
import { RfqPanel } from "@/components/product/rfq-panel";
import { SupplierAnalysis } from "@/components/product/supplier-analysis";
import { SupplierDocumentEvidence } from "@/components/product/supplier-document-evidence";
import { SupplierPriceReferences } from "@/components/product/supplier-price-references";
import { useModal } from "@/components/modals/modal-context";
import { useNotify } from "@/components/shared/toast";
import { isDemoMode } from "@/data";
import { useLatestQuotationRequest, useLoadExampleQuotes, useMarkQuotationSent, useProduct, usePurchaseOrders, useSupplierQuotes } from "@/hooks/use-ngate";
import { useSettings } from "@/hooks/use-settings";
import { insightFor } from "@/lib/inventory";
import { claimOverstockReminder } from "@/lib/overstock-alert";
import { purchasingProgress } from "@/lib/workflow";

function scrollToId(id: string) {
  setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 90);
}

export default function ProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const fromHome = new URLSearchParams(useSearch()).get("from") === "home";
  const fromPurchasing = new URLSearchParams(useSearch()).get("from") === "purchasing";
  const [, navigate] = useLocation();
  const { open } = useModal();
  const notify = useNotify();
  const settings = useSettings();

  const productQ = useProduct(productId);
  const rfqQ = useLatestQuotationRequest(productId);
  const rfq = rfqQ.data ?? null;
  const quotesQ = useSupplierQuotes(rfq?.rfqId);
  const quotes = quotesQ.data ?? [];
  const { data: orders } = usePurchaseOrders();
  const examples = useLoadExampleQuotes();
  const markSent = useMarkQuotationSent();

  useEffect(() => {
    const product = productQ.data;
    if (!fromPurchasing || !product) return;

    const currentInsight = insightFor(product, settings);
    if (currentInsight.excessQuantity <= 0 || !claimOverstockReminder(product.productId)) return;

    open({
      type: "overstock-notice",
      productId: product.productId,
      productName: product.productName,
      excessQuantity: currentInsight.excessQuantity,
      unit: product.stockUnit,
      excessValue: currentInsight.excessValue,
      overstockCoverageDays: settings.overstockCoverageDays,
    });
  }, [fromPurchasing, productQ.data, settings, open]);

  if (productQ.isLoading || rfqQ.isLoading) return <PageSkeleton />;
  if (productQ.isError) return <ErrorState message={productQ.error?.message} onRetry={() => productQ.refetch()} />;
  const p = productQ.data;
  if (!p)
    return (
      <div className="surface empty">
        <PackageX size={34} />
        <h3>Product not found</h3>
        <p>It may have been removed. Pick another product.</p>
        <Link href="/purchasing" className="btn primary" data-testid="link-back-to-products">Open Purchasing</Link>
      </div>
    );

  const insight = insightFor(p, settings);
  const progress = purchasingProgress(rfq, quotes, orders ?? []);
  const rfqPo = rfq ? [...(orders ?? [])].reverse().find((o) => o.rfqId === rfq.rfqId) : undefined;
  const stage = progress.current ?? "done";

  const newRequest = () => open({ type: "rfq", productId: p.productId });
  const uploadQuotation = (supplierId?: string) => rfq && open({ type: "upload-quotation", productId: p.productId, rfqId: rfq.rfqId, supplierId });

  const onNext = () => {
    if (stage === "prepared" || stage === "done") newRequest();
    else if (stage === "replies" || stage === "compared") uploadQuotation();
    else if (stage === "po") scrollToId("analysis");
    else navigate("/orders");
  };

  return (
    <>
      <PageHead eyebrow="PURCHASING" title={p.productName} sub={p.category} />
      <Link href="/purchasing" className="back" style={{ display: "inline-flex", alignItems: "center", gap: 6 }} data-testid="link-back-products">
        <ArrowLeft size={14} /> Back to product list
      </Link>
      {fromHome && (
        <div className="top-content-alert">
          <span className="pill-action"><CornerDownRight size={14} /> Opened from Home</span>
          <span>This product needs attention.</span>
        </div>
      )}

      <NextStepHero stage={stage} onAction={onNext} />

      <div className="detail-grid">
        <InventoryPanel product={p} insight={insight} settings={settings} quotes={quotes} />
        <SupplierList product={p} onRequestQuote={(supplierId) => open({ type: "rfq", productId: p.productId, supplierId })} />
      </div>

      {rfq ? (
        <RfqPanel
          product={p}
          request={rfq}
          suggestedOrderQuantity={insight.suggestedOrderQuantity}
          quotes={quotes}
          steps={progress.steps}
          demoMode={isDemoMode}
          loadingExamples={examples.isPending}
          markingSent={markSent.isPending}
          onOpenMessages={(supplierId) => open({ type: "whatsapp", productId: p.productId, rfqId: rfq.rfqId, supplierId })}
          onMarkSent={(supplierId) => markSent.mutate({ rfqId: rfq.rfqId, supplierId }, { onError: (e) => notify(e.message) })}
          onUploadQuotation={uploadQuotation}
          onLoadExamples={() =>
            examples.mutate(rfq.rfqId, {
              onSuccess: (got) => {
                notify(`${got.length} example repl${got.length === 1 ? "y" : "ies"} recorded. Comparison updated.`);
                scrollToId("analysis");
              },
              onError: (e) => notify(e.message),
            })
          }
          onNewRequest={newRequest}
        />
      ) : (
        <section className="surface panel-pad" aria-label="Purchasing progress">
          <h2 style={{ marginBottom: 10 }}>Purchasing progress</h2>
          <ProgressTracker steps={progress.steps} />
        </section>
      )}

      <SupplierDocumentEvidence product={p} />
      {rfq && quotes.length > 0 && (
        <SupplierAnalysis
          key={`${rfq.rfqId}`}
          product={p}
          request={rfq}
          quotes={quotes}
          significantIncreasePct={settings.priceIncreasePct}
          onChoose={(quoteId, requestedQuantity) => open({ type: "po-quote", productId: p.productId, quoteId, requestedQuantity })}
        />
      )}

      <SupplierPriceReferences productId={p.productId} />

      {rfqPo && (
        <div className="bottom-callout">
          <Check size={22} />
          <div>
            <h3>{rfqPo.poNumber} — {rfqPo.status === "draft" ? "PO Draft — Pending Approval" : rfqPo.sentStatus === "sent" || rfqPo.markedSentAt ? "Marked as sent by account owner" : "Approved · not sent"}</h3>
            <p>View, download or approve it in My Orders. Send it to the supplier yourself.</p>
          </div>
          <Link href="/orders" className="btn primary" data-testid="link-view-orders">Open My Orders</Link>
        </div>
      )}

      <PurchaseHistoryTable
        product={p}
        onRequestQuote={(supplierId) => open({ type: "rfq", productId: p.productId, supplierId })}
        onPreparePo={(purchaseId) => open({ type: "po-history", productId: p.productId, purchaseId })}
      />
    </>
  );
}
