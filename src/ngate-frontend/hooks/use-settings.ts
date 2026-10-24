import { useSyncExternalStore } from "react";
import { DEFAULT_SETTINGS, type InventorySettings } from "@/lib/inventory";

/** Calculation settings for the demo (safety stock, overstock window). Saved in this browser. */
const KEY = "ngate-settings-v1";
const listeners = new Set<() => void>();

function read(): InventorySettings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<InventorySettings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current = read();

export function setSettings(patch: Partial<InventorySettings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useSettings(): InventorySettings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
