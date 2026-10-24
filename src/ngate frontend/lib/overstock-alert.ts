const STORAGE_KEY = "ngate-overstock-alerts-seen-v1";

/** Claims the one-time overstock reminder for this product in this browser. */
export function claimOverstockReminder(productId: string): boolean {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  let seen: string[] = [];

  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) seen = parsed.filter((value): value is string => typeof value === "string");
    } catch {
      // Replace a malformed value with a fresh list below.
    }
  }

  if (seen.includes(productId)) return false;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen, productId]));
  return true;
}
