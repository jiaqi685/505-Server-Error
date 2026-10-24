import { Router, type IRouter } from "express";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, quotationDocumentsTable } from "@workspace/db";
import { callFlask, flaskBaseUrl } from "../lib/flask-service";
import { inputs, outputs, readQueries } from "../lib/procurement-contracts";
import { mappedCatalogue } from "./flask-integration";
import { getDocumentFile } from "../lib/objectStorage";

const router: IRouter = Router();
const prefix = "/integrations/flask/procurement";

router.all(`${prefix}/:operation`, async (req, res): Promise<void> => {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ error: "Sign in to use connected procurement." }); return;
  }
  const operation = String(req.params.operation);
  const method = req.method;
  const read = method === "GET";
  const schema = read && Object.hasOwn(readQueries, operation) ? readQueries[operation as keyof typeof readQueries] : method === "POST" && Object.hasOwn(inputs, operation) ? inputs[operation as keyof typeof inputs] : undefined;
  if (!schema) { res.status(404).json({ error: "Unknown procurement operation or method." }); return; }
  // Custom JSON header + non-reflective CORS prevent cross-site cookie writes.
  const site = req.get("sec-fetch-site");
  if (site && !["same-origin", "none"].includes(site)) {
    res.status(403).json({ error: "Cross-site procurement requests are not allowed." }); return;
  }
  const origin = req.get("origin");
  if (origin) {
    const host = (req.get("x-forwarded-host") ?? req.get("host") ?? "").split(",")[0].trim();
    const protocol = (req.get("x-forwarded-proto") ?? req.protocol).split(",")[0].trim();
    try {
      if (new URL(origin).origin !== `${protocol}://${host}`) throw new Error("Foreign origin");
    } catch {
      res.status(403).json({ error: "Cross-origin procurement requests are not allowed." }); return;
    }
  }
  if (!read && (req.get("X-NGate-Request") !== "procurement-v2" || !req.is("application/json"))) {
    res.status(403).json({ error: "Same-origin JSON procurement request required." }); return;
  }
  const parsed = schema.safeParse(read ? req.query : req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid procurement fields.", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }); return; }
  const idempotencyKey = read ? "" : req.get("Idempotency-Key") ?? "";
  if (!read && !/^[A-Za-z0-9_-]{8,100}$/.test(idempotencyKey)) { res.status(400).json({ error: "An idempotency key is required." }); return; }
  const base = flaskBaseUrl();
  if (!base) { res.status(503).json({ error: "Flask procurement is not configured. Nothing was saved locally." }); return; }
  try {
    let data: unknown = parsed.data;
    if (operation === "import-quotation-document" && method === "POST") {
      const input = data as typeof inputs["import-quotation-document"]["_output"];
      const [doc] = await db.select().from(quotationDocumentsTable).where(and(
        eq(quotationDocumentsTable.id, input.documentId),
        eq(quotationDocumentsTable.ownerId, req.user.id),
        eq(quotationDocumentsTable.status, "ready"),
      ));
      if (!doc) { res.status(404).json({ error: "Quotation document was not found in your account." }); return; }
      const [bytes] = await getDocumentFile(doc.objectPath).download();
      const actualFingerprint = createHash("sha256").update(bytes).digest("hex");
      if (actualFingerprint !== input.fingerprint) {
        res.status(400).json({ error: "Quotation content changed after extraction. Upload and review it again." }); return;
      }
      data = { ...input, documentName: doc.fileName, documentPath: doc.objectPath, fingerprint: actualFingerprint };
    } else if (operation === "save-quote" && method === "POST") {
      const input = data as typeof inputs["save-quote"]["_output"];
      if (input.documentId) {
        const [doc] = await db.select().from(quotationDocumentsTable).where(and(
          eq(quotationDocumentsTable.id, input.documentId), eq(quotationDocumentsTable.ownerId, req.user.id), eq(quotationDocumentsTable.status, "ready"),
        ));
        if (!doc) { res.status(404).json({ error: "Quotation document was not found in your account." }); return; }
        data = { ...input, documentName: doc.fileName, documentPath: doc.objectPath };
      } else if (input.source === "document-upload" || input.documentPath || input.documentName) {
        res.status(400).json({ error: "An owner-verified uploaded document reference is required." }); return;
      }
    }
    const query = read ? new URLSearchParams(parsed.data as Record<string, string>).toString() : "";
    const upstream = await callFlask(base, `v2/procurement/${operation}${query ? `?${query}` : ""}`, req.user.id, method, read ? undefined : data, idempotencyKey);
    const body: unknown = await upstream.json();
    if (!upstream.ok) {
      const message = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "Flask rejected the request.";
      res.status([400, 401, 403, 404, 409, 503].includes(upstream.status) ? upstream.status : 502).json({ error: message }); return;
    }
    const result = outputs[operation as keyof typeof outputs].parse(body);
    if (operation === "dashboard") {
      const catalogue = await mappedCatalogue(base, req.user.id);
      res.json({ ...result as object, products: catalogue.products.map((entry) => entry.product) });
    } else res.json(result);
  } catch (error) {
    req.log.warn({ operation, errorName: error instanceof Error ? error.name : "UnknownError" }, "Connected procurement request failed");
    res.status(502).json({ error: "Flask procurement could not be confirmed. Your form is kept; retry safely. No browser-local fallback was used." });
  }
});

export default router;
