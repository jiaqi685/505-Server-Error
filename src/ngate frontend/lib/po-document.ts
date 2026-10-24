import type { PurchaseOrder } from "@/data/types";
import { APP_NAME, BUSINESS_NAME } from "./brand";
import { isConnectedMode } from "@/data";
import { dateTime, money, shortDate } from "./format";
import { historicalSupplierLabel } from "./supplier-master";

export function poStatusLabel(o: PurchaseOrder): { label: string; tone: "green" | "orange" } {
  if (o.sentStatus === "sent" || o.markedSentAt) return { label: "Marked as sent", tone: "green" };
  return o.status === "approved" ? { label: isConnectedMode ? "Approved — Not Sent" : "Approved (Demo) — Not Sent", tone: "green" } : { label: "PO Draft — Pending Approval", tone: "orange" };
}

/** Builds a tiny single-page PDF (Helvetica) for a PO. Pure — returns the raw PDF string. */
export function poPdfSource(o: PurchaseOrder): string {
  const ascii = (s: string) => String(s).replace(/[^\x20-\x7e]/g, "?").replace(/([\\()])/g, "\\$1");
  const lines: [string, number, number, number][] = [
    [BUSINESS_NAME, 22, 52, 779],
    ["PURCHASE ORDER", 18, 52, 738],
    ["OWNER-MANAGED PO - NGATE DOES NOT SEND", 10, 52, 716],
    [`PO Number: ${o.poNumber}`, 11, 52, 682],
    [`Prepared: ${shortDate(o.preparedAt)}`, 11, 52, 659],
    [`Supplier: ${historicalSupplierLabel(o.supplierId, o.supplier)}`, 11, 52, 636],
    [`Item: ${o.productName}`, 11, 52, 604],
    [`Quantity: ${o.qty} ${o.unit}(s)`, 11, 52, 581],
    [`Unit price: ${money(o.unitPrice)}`, 11, 52, 558],
    [`Total: ${money(o.total)}`, 16, 52, 510],
    [o.sentStatus === "sent" || o.markedSentAt ? "STATUS: SENT (RECORDED BY ACCOUNT OWNER)" : o.status === "approved" ? (isConnectedMode ? "STATUS: APPROVED - NOT SENT" : "STATUS: APPROVED (DEMO) - NOT SENT") : "STATUS: DRAFT - PENDING APPROVAL", 12, 52, 457],
    [o.sentStatus === "sent" || o.markedSentAt ? `Sent (owner recorded): ${o.markedSentAt ? shortDate(o.markedSentAt) : "date not recorded"}${o.markedSentMethod ? ` via ${o.markedSentMethod}` : ""}` : o.status === "approved" ? "Approved; separate supplier dispatch required." : "Approval and separate supplier dispatch required.", 10, 52, 425],
    [isConnectedMode ? `Procurement saved in Flask SQLite; PDF generated in ${APP_NAME}.` : `This example PO was created locally in ${APP_NAME}.`, 10, 52, 402],
  ];
  const stream = lines.map(([txt, size, x, y]) => `BT /F1 ${size} Tf ${x} ${y} Td (${ascii(txt)}) Tj ET`).join("\n") + "\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) pdf += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

export function poPdfBlob(o: PurchaseOrder): Blob {
  return new Blob([poPdfSource(o)], { type: "application/pdf" });
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

/** Standalone printable HTML document for a PO. */
export function poPrintHtml(order: PurchaseOrder): string {
  const o = { ...order, supplier: historicalSupplierLabel(order.supplierId, order.supplier) };
  const draft = o.status === "draft";
  const sent = o.sentStatus === "sent" || !!o.markedSentAt;
  return `<!doctype html><html><head><title>${esc(o.poNumber)}</title><style>body{font-family:Arial,sans-serif;max-width:750px;margin:40px auto;color:#163a34}.sheet{padding:35px;border:2px solid #ddd}.top,.info{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}.info div{width:40%;margin:14px 0}.info small{display:block;color:#666}table{width:100%;border-collapse:collapse;margin:30px 0}td,th{padding:12px;border-bottom:1px solid #ddd;text-align:left}.grand{text-align:right;font-weight:bold;font-size:20px}.imp{padding:15px;background:#fff4e3}</style></head><body><section class="sheet"><div class="top"><strong>${esc(BUSINESS_NAME)}</strong><span>${draft ? "DRAFT · NOT APPROVED" : sent ? "SENT · OWNER RECORDED" : "APPROVED · NOT SENT"}</span></div><h2>PURCHASE ORDER</h2><div class="info"><div><small>PO number</small><strong>${esc(o.poNumber)}</strong></div><div><small>Date prepared</small><strong>${esc(shortDate(o.preparedAt))}</strong></div><div><small>Supplier</small><strong>${esc(o.supplier)}</strong></div><div><small>Requested by</small><strong>${esc(BUSINESS_NAME)}</strong></div>${sent ? `<div><small>Sent (owner recorded)</small><strong>${esc(o.markedSentAt ? dateTime(o.markedSentAt) : "Date not recorded")}${o.markedSentMethod ? ` · ${esc(o.markedSentMethod)}` : ""}</strong></div>` : ""}</div><table><thead><tr><th>Product</th><th>Quantity</th><th>Unit price</th><th>Amount</th></tr></thead><tbody><tr><td>${esc(o.productName)}</td><td>${o.qty} ${esc(o.unit)}s</td><td>${money(o.unitPrice)}</td><td>${money(o.total)}</td></tr></tbody></table><div class="grand">TOTAL: ${money(o.total)}</div><p class="imp">${draft ? "Pending approval. Do not send this draft as a confirmed order." : sent ? "The account owner recorded this PO as sent. NGate did not transmit it." : "Approved; the supplier must be contacted separately. NGate does not send POs."}</p><small>This PO is generated from saved procurement records. No inventory update has been made.</small></section></body></html>`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
