import type { ExtractedQuotation, MultiProductQuotationExtraction } from "./types";

const API_BASE = "/api";
const MAX_FILE_SIZE = 8 * 1024 * 1024;

type DocumentExtraction = ExtractedQuotation & {
  orderMultiple: number | null;
  documentId: string;
  documentName: string;
  documentPath: string;
};

interface UploadUrlResponse {
  uploadURL: string;
  documentId: string;
  objectPath: string;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Could not reach NGate. Check your connection and try again.");
  }
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const data = (await response.json()) as { error?: unknown };
      if (typeof data.error === "string") message = data.error;
    } catch {
      // Keep the useful HTTP status if the response is not JSON.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export function contentTypeFor(file: File): "application/pdf" | "image/jpeg" | "image/png" {
  const type = file.type.toLowerCase();
  if (type === "application/pdf" || /\.pdf$/i.test(file.name)) return "application/pdf";
  if (type === "image/jpeg" || /\.(jpe?g)$/i.test(file.name)) return "image/jpeg";
  if (type === "image/png" || /\.png$/i.test(file.name)) return "image/png";
  throw new Error("Choose a PDF, JPG, or PNG quotation.");
}

export async function uploadAndExtractQuotation(
  file: File,
  context: { supplierName: string; productName: string; stockUnit: string; requestedDeliveryDate: string | null },
): Promise<DocumentExtraction> {
  const contentType = contentTypeFor(file);
  if (!file.size || file.size > MAX_FILE_SIZE) throw new Error("Quotation files must be 8 MB or smaller.");

  const upload = await postJson<UploadUrlResponse>("/storage/uploads/request-url", {
    name: file.name,
    size: file.size,
    contentType,
  });
  let putResponse: Response;
  try {
    putResponse = await fetch(upload.uploadURL, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: file,
    });
  } catch {
    throw new Error("The file could not be uploaded to private storage. Please try again.");
  }
  if (!putResponse.ok) throw new Error("The file could not be uploaded to private storage. Please try again.");

  await postJson("/storage/uploads/complete", { documentId: upload.documentId });
  const extracted = await postJson<Omit<DocumentExtraction, "method">>("/quotation-documents/extract", {
    documentId: upload.documentId,
    ...context,
  });
  return { ...extracted, method: "ai" };
}

export async function uploadAndExtractMultiProductQuotation(file: File): Promise<MultiProductQuotationExtraction> {
  const contentType = contentTypeFor(file);
  if (!file.size || file.size > MAX_FILE_SIZE) throw new Error("Quotation files must be 8 MB or smaller.");

  const upload = await postJson<UploadUrlResponse>("/storage/uploads/request-url", {
    name: file.name,
    size: file.size,
    contentType,
  });
  let putResponse: Response;
  try {
    putResponse = await fetch(upload.uploadURL, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: file,
    });
  } catch {
    throw new Error("The file could not be uploaded to private storage. Please try again.");
  }
  if (!putResponse.ok) throw new Error("The file could not be uploaded to private storage. Please try again.");

  await postJson("/storage/uploads/complete", { documentId: upload.documentId });
  return postJson<MultiProductQuotationExtraction>("/quotation-documents/extract-multi", {
    documentId: upload.documentId,
  });
}
