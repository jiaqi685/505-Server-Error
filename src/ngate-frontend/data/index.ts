import type { NGateApi } from "./api";
import { HttpAdapter } from "./adapters/http";
import { MockAdapter } from "./adapters/mock";
import { ConnectedAdapter } from "./adapters/connected";
import type { PosImportKind, PosPreview } from "./pos/types";

/**
 * Single data entry point. Choose the adapter with VITE_DATA_SOURCE:
 *   - "mock" (default): Demo Mode. Example products; your RFQs, quotes, POs and
 *     activity are saved in this browser's localStorage.
 *   - "http": authenticated read-only Flask catalogue diagnostic; procurement
 *     is intentionally disabled until its ownership/write contract is verified.
 *   - "connected": owner-scoped Flask SQLite procurement plus local synthetic POS.
 * UI code must go through src/hooks, never import adapters directly.
 */
const source = String(import.meta.env.VITE_DATA_SOURCE ?? "mock").toLowerCase();

export const dataSource: "http" | "mock" | "connected" = source === "connected" ? "connected" : source === "http" ? "http" : "mock";
export const isDemoMode = dataSource === "mock";
export const isConnectedMode = dataSource === "connected";

const mockAdapter = new MockAdapter(180, isConnectedMode);

function assertPosDemoMode() {
  if (dataSource === "http") throw new Error("Use Mock or Connected Mode for browser-local synthetic POS import.");
}

export const posDemo = {
  getState: () => { assertPosDemoMode(); return mockAdapter.getPosImportState(); },
  preview: (file: File, kind: PosImportKind) => { assertPosDemoMode(); return mockAdapter.previewPosImport(file, kind); },
  confirm: (preview: PosPreview) => { assertPosDemoMode(); return mockAdapter.confirmPosImport(preview); },
  reset: (kind?: PosImportKind) => { assertPosDemoMode(); return mockAdapter.resetPosImport(kind); },
};

export const api: NGateApi =
  isConnectedMode ? new ConnectedAdapter("/api", mockAdapter) : dataSource === "http" ? new HttpAdapter(String(import.meta.env.VITE_API_BASE_URL ?? "/api")) : mockAdapter;

export function setCurrentDemoUser(userId: string) {
  if (dataSource !== "http") mockAdapter.setOwnerId(userId);
}

export type { NGateApi } from "./api";
export * from "./types";
