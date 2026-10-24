import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
  CompleteQuotationUploadBody,
  CompleteQuotationUploadResponse,
  RequestQuotationUploadUrlBody,
  RequestQuotationUploadUrlResponse,
} from "@workspace/api-zod";
import { db, quotationDocumentsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { createDocumentObjectPath, createDocumentUploadUrl, findPublicObject, getDocumentFile } from "../lib/objectStorage";

const router: IRouter = Router();
const MAX_FILE_SIZE = 8 * 1024 * 1024;

function authenticatedUserId(req: Request, res: Response): string | null {
  if (req.isAuthenticated() && req.user) return req.user.id;
  res.status(401).json({ error: "Please log in to upload a quotation." });
  return null;
}

router.post("/storage/uploads/request-url", async (req: Request, res: Response): Promise<void> => {
  const userId = authenticatedUserId(req, res);
  if (!userId) return;
  const parsed = RequestQuotationUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a PDF, JPG, or PNG quotation up to 8 MB." });
    return;
  }
  const { name, size, contentType } = parsed.data;
  if (size > MAX_FILE_SIZE || !["application/pdf", "image/jpeg", "image/png"].includes(contentType)) {
    res.status(400).json({ error: "Only PDF, JPG, and PNG quotations up to 8 MB are supported." });
    return;
  }
  const fileName = name.trim().replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 180);
  if (!fileName) {
    res.status(400).json({ error: "The file name is not valid." });
    return;
  }
  try {
    const objectPath = createDocumentObjectPath();
    const uploadURL = await createDocumentUploadUrl(objectPath);
    const documentId = randomUUID();
    await db.insert(quotationDocumentsTable).values({
      id: documentId,
      ownerId: userId,
      objectPath,
      fileName,
      contentType,
      size,
      status: "pending",
    });
    res.json(RequestQuotationUploadUrlResponse.parse({ uploadURL, documentId, objectPath }));
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "Error" }, "Could not prepare quotation upload");
    res.status(500).json({ error: "Could not prepare the private upload. Please try again." });
  }
});

router.post("/storage/uploads/complete", async (req: Request, res: Response): Promise<void> => {
  const userId = authenticatedUserId(req, res);
  if (!userId) return;
  const parsed = CompleteQuotationUploadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid quotation upload." });
    return;
  }
  const [document] = await db
    .select()
    .from(quotationDocumentsTable)
    .where(and(eq(quotationDocumentsTable.id, parsed.data.documentId), eq(quotationDocumentsTable.ownerId, userId)));
  if (!document) {
    res.status(404).json({ error: "Quotation upload not found." });
    return;
  }
  try {
    const file = getDocumentFile(document.objectPath);
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size) !== document.size || metadata.contentType !== document.contentType) {
      res.status(400).json({ error: "The uploaded file did not match its details. Please upload it again." });
      return;
    }
    await db
      .update(quotationDocumentsTable)
      .set({ status: "ready" })
      .where(and(eq(quotationDocumentsTable.id, document.id), eq(quotationDocumentsTable.ownerId, userId)));
    res.json(CompleteQuotationUploadResponse.parse({ documentId: document.id, objectPath: document.objectPath }));
  } catch (error) {
    req.log.warn({ errorName: error instanceof Error ? error.name : "Error" }, "Quotation upload could not be verified");
    res.status(400).json({ error: "The file did not reach private storage. Please try uploading it again." });
  }
});

router.get("/storage/objects/*path", async (req: Request, res: Response): Promise<void> => {
  const userId = authenticatedUserId(req, res);
  if (!userId) return;
  const raw = req.params.path;
  const objectPath = `/objects/${Array.isArray(raw) ? raw.join("/") : raw}`;
  const [document] = await db
    .select()
    .from(quotationDocumentsTable)
    .where(and(
      eq(quotationDocumentsTable.objectPath, objectPath),
      eq(quotationDocumentsTable.ownerId, userId),
      eq(quotationDocumentsTable.status, "ready"),
    ));
  if (!document) {
    res.status(404).json({ error: "Quotation document not found." });
    return;
  }
  try {
    const file = getDocumentFile(document.objectPath);
    const [metadata] = await file.getMetadata();
    res.setHeader("Content-Type", document.contentType);
    res.setHeader("Content-Length", String(metadata.size ?? document.size));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `inline; filename="${document.fileName.replace(/["\\]/g, "_")}"`);
    Readable.from(file.createReadStream()).pipe(res);
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "Error" }, "Could not serve quotation document");
    res.status(404).json({ error: "Quotation document not found." });
  }
});

router.get("/storage/public-objects/*filePath", async (req: Request, res: Response): Promise<void> => {
  try {
    const raw = req.params.filePath;
    const path = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await findPublicObject(path);
    if (!file) {
      res.status(404).json({ error: "File not found." });
      return;
    }
    const [metadata] = await file.getMetadata();
    res.setHeader("Content-Type", String(metadata.contentType ?? "application/octet-stream"));
    res.setHeader("Cache-Control", "public, max-age=3600");
    Readable.from(file.createReadStream()).pipe(res);
  } catch (error) {
    req.log.error({ errorName: error instanceof Error ? error.name : "Error" }, "Could not serve public asset");
    res.status(500).json({ error: "Could not serve the public file." });
  }
});

export default router;
