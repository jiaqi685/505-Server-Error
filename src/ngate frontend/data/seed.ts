import type { Product, Supplier } from "./types";
import { addDays, todayLocal } from "@/lib/format";
import { SUPPLIER_MASTER } from "@/lib/supplier-master";

/**
 * Demo catalogue for Krukkruk Mini Mart (22 items). Example business data only.
 * Used by the mock adapter; a real backend returns the same shapes.
 */

export const SUPPLIERS: Supplier[] = SUPPLIER_MASTER.filter((s) => s.active !== false).map(({ supplierId, supplierName }) => ({ supplierId, supplierName }));

const supplierName = (id: string) => SUPPLIERS.find((s) => s.supplierId === id)?.supplierName ?? id;

/** [supplier letter, unit price, quantity, purchase date] — newest first. */
type HistoryRow = [string, number, number, string];

interface SeedRow {
  id: string;
  name: string;
  short: string;
  category: string;
  unit: string;
  stock: number;
  /** Average daily usage; null = not enough data. */
  usage: number | null;
  weekly?: [previousWeek: number, thisWeek: number];
  reorder: number;
  /** Supplier letter -> lead time days. First entry is the preferred supplier. */
  suppliers: [string, number][];
  history: HistoryRow[];
  keywords: string[];
  /** Days until the earliest stock expires (relative to today). */
  expiresInDays?: number;
}

const ROWS: SeedRow[] = [
  { id: "premium-fragrant-rice", name: "Premium Fragrant Rice", short: "Fragrant Rice", category: "Rice & staples", unit: "bag", stock: 3, usage: 3, weekly: [18, 21], reorder: 9,
    suppliers: [["A", 2], ["B", 1], ["C", 1]],
    history: [["A", 10, 20, "2026-10-12"], ["C", 10.2, 18, "2026-10-05"], ["B", 9.9, 50, "2026-09-29"], ["A", 10, 20, "2026-09-21"]],
    keywords: ["beras", "rice", "wangi", "fragrant"], expiresInDays: 180 },
  { id: "edible-cooking-oil", name: "Edible Cooking Oil", short: "Cooking Oil", category: "Rice & staples", unit: "bottle", stock: 18, usage: 1, weekly: [7, 7], reorder: 4,
    suppliers: [["A", 3], ["D", 2]], history: [["A", 7.5, 24, "2026-10-10"], ["D", 7.8, 24, "2026-09-30"]], keywords: ["minyak masak", "oil", "minyak"], expiresInDays: 240 },
  { id: "granulated-white-sugar", name: "Granulated White Sugar", short: "White Sugar", category: "Rice & staples", unit: "pack", stock: 4, usage: 3, weekly: [21, 21], reorder: 8,
    suppliers: [["A", 2], ["C", 1]], history: [["A", 2.85, 30, "2026-10-16"], ["C", 2.9, 24, "2026-10-08"]], keywords: ["gula", "gula putih", "sugar"] },
  { id: "plain-wheat-flour", name: "Plain Wheat Flour", short: "Wheat Flour", category: "Rice & staples", unit: "pack", stock: 12, usage: 2, weekly: [14, 14], reorder: 6,
    suppliers: [["C", 2], ["A", 2]], history: [["C", 3.2, 24, "2026-10-16"], ["A", 3.4, 24, "2026-10-08"]], keywords: ["tepung", "tepung gandum", "flour"], expiresInDays: 150 },
  { id: "instant-noodles-5-pack", name: "5-Packet Instant Noodles", short: "Instant Noodles", category: "Noodles & canned food", unit: "pack", stock: 5, usage: 4, weekly: [24, 28], reorder: 10,
    suppliers: [["B", 2], ["D", 1]], history: [["B", 4.5, 30, "2026-10-17"], ["D", 4.8, 24, "2026-10-10"]], keywords: ["mi segera", "mee", "noodles", "5 packet", "5-packet"], expiresInDays: 180 },
  { id: "sardine-tomato-sauce", name: "Sardine in Tomato Sauce", short: "Sardines", category: "Noodles & canned food", unit: "can", stock: 16, usage: 3, weekly: [21, 21], reorder: 8,
    suppliers: [["B", 2], ["E", 2]], history: [["B", 5.8, 24, "2026-10-07"], ["E", 6, 24, "2026-09-23"]], keywords: ["sardin", "sardine", "tomato", "canned fish"], expiresInDays: 365 },
  { id: "sweetened-creamer", name: "Sweetened Creamer Can", short: "Sweetened Creamer", category: "Milk & creamer", unit: "can", stock: 14, usage: 3, weekly: [21, 21], reorder: 6,
    suppliers: [["C", 2], ["E", 2]], history: [["C", 3.4, 24, "2026-10-07"], ["E", 3.6, 24, "2026-09-23"]], keywords: ["susu pekat", "creamer", "sweetened", "condensed"], expiresInDays: 240 },
  { id: "soya-sauce-650ml", name: "Soya Sauce 650ml", short: "Soya Sauce", category: "Sauces & condiments", unit: "bottle", stock: 8, usage: 1, weekly: [7, 7], reorder: 3,
    suppliers: [["C", 3], ["D", 3]], history: [["C", 5.9, 12, "2026-10-02"], ["D", 6.2, 12, "2026-09-18"]], keywords: ["kicap", "soy sauce", "soya", "650 ml"], expiresInDays: 300 },
  { id: "drinking-water", name: "Drinking Water", short: "Drinking Water", category: "Drinks", unit: "bottle", stock: 20, usage: 4, weekly: [14, 28], reorder: 8,
    suppliers: [["B", 1], ["C", 2]], history: [["B", 0.85, 48, "2026-10-15"], ["C", 0.9, 48, "2026-10-01"]], keywords: ["air minuman", "mineral water", "water"], expiresInDays: 365 },
  { id: "carbonated-drink", name: "Carbonated Drink", short: "Carbonated Drink", category: "Drinks", unit: "can", stock: 24, usage: 5, weekly: [35, 35], reorder: 10,
    suppliers: [["B", 1], ["E", 2]], history: [["B", 1.6, 48, "2026-10-14"], ["E", 1.7, 48, "2026-10-06"]], keywords: ["air gas", "soda", "soft drink", "carbonated"], expiresInDays: 180 },
  { id: "original-uht-milk", name: "Original UHT Milk", short: "Original UHT Milk", category: "Milk & creamer", unit: "carton", stock: 16, usage: 3, weekly: [21, 21], reorder: 6,
    suppliers: [["B", 1], ["D", 2]], history: [["B", 5.6, 24, "2026-10-16"], ["D", 5.5, 24, "2026-10-08"], ["B", 5.2, 24, "2026-09-24"]], keywords: ["susu", "milk", "uht", "plain milk"], expiresInDays: 90 },
  { id: "coffee-instant-mix", name: "Coffee Instant Mix", short: "Instant Coffee", category: "Drinks", unit: "pack", stock: 12, usage: 2, weekly: [14, 14], reorder: 5,
    suppliers: [["A", 2], ["E", 2]], history: [["A", 10.5, 24, "2026-10-14"], ["E", 10.8, 24, "2026-10-06"]], keywords: ["kopi", "coffee", "instant", "mix"], expiresInDays: 240 },
  { id: "cream-cracker-biscuits", name: "Cream Cracker Biscuits", short: "Cream Crackers", category: "Snacks & biscuits", unit: "pack", stock: 12, usage: 2, weekly: [14, 14], reorder: 5,
    suppliers: [["C", 2], ["E", 2]], history: [["C", 4.2, 24, "2026-10-14"], ["E", 4.4, 24, "2026-10-06"]], keywords: ["biskut", "cream cracker", "biscuits"], expiresInDays: 120 },
  { id: "potato-crisps", name: "Potato Crisps", short: "Potato Crisps", category: "Snacks & biscuits", unit: "pack", stock: 18, usage: 4, weekly: [28, 28], reorder: 8,
    suppliers: [["D", 1], ["E", 2]], history: [["D", 2.8, 36, "2026-10-17"], ["E", 3, 36, "2026-10-09"]], keywords: ["kerepek", "potato chips", "crisps", "crips"], expiresInDays: 120 },
  { id: "strawberry-uht-milk", name: "Strawberry UHT Milk", short: "Strawberry Milk", category: "Milk & creamer", unit: "carton", stock: 12, usage: 2, weekly: [14, 14], reorder: 5,
    suppliers: [["B", 1], ["D", 2]], history: [["B", 1.65, 24, "2026-10-17"], ["D", 1.75, 24, "2026-10-09"]], keywords: ["susu strawberi", "strawberry", "strawbeerry", "uht", "uth", "milk"], expiresInDays: 90 },
  { id: "chocolate-uht-milk", name: "Chocolate UHT Milk", short: "Chocolate Milk", category: "Milk & creamer", unit: "carton", stock: 12, usage: 2, weekly: [14, 14], reorder: 5,
    suppliers: [["B", 1], ["D", 2]], history: [["B", 1.65, 24, "2026-10-17"], ["D", 1.75, 24, "2026-10-09"]], keywords: ["susu coklat", "chocolate", "uht", "uth", "milk"], expiresInDays: 90 },
  { id: "laundry-detergent", name: "Laundry Detergent", short: "Laundry Detergent", category: "Household cleaning", unit: "bottle", stock: 10, usage: 1, weekly: [7, 7], reorder: 3,
    suppliers: [["A", 3], ["D", 2]], history: [["A", 12.5, 12, "2026-10-10"], ["D", 12.9, 12, "2026-09-30"]], keywords: ["sabun basuh", "detergent laundry", "laundry", "detergent"] },
  { id: "cleaner-liquid", name: "Cleaner Liquid", short: "Cleaner Liquid", category: "Household cleaning", unit: "bottle", stock: 6, usage: null, reorder: 2,
    suppliers: [["A", 3], ["D", 3]], history: [["A", 6.5, 12, "2026-10-04"], ["D", 6.8, 12, "2026-09-20"]], keywords: ["pencuci", "cleaner", "cleaning liquid"] },
  { id: "bathroom-tissue", name: "Bathroom Tissue", short: "Bathroom Tissue", category: "Household essentials", unit: "pack", stock: 12, usage: 2, weekly: [14, 14], reorder: 5,
    suppliers: [["C", 2], ["A", 2]], history: [["C", 8.5, 24, "2026-10-11"], ["A", 8.9, 24, "2026-09-27"]], keywords: ["tisu", "toilet paper", "bathroom tissue", "roll"] },
  { id: "bath-soap", name: "Bath Soap", short: "Bath Soap", category: "Personal care", unit: "bar", stock: 16, usage: 3, weekly: [21, 21], reorder: 6,
    suppliers: [["D", 2], ["E", 2]], history: [["D", 2.2, 36, "2026-10-17"], ["E", 2.4, 36, "2026-10-09"]], keywords: ["sabun mandi", "soap bath", "bath soap"] },
  { id: "toothpaste", name: "Toothpaste", short: "Toothpaste", category: "Personal care", unit: "tube", stock: 12, usage: 2, weekly: [14, 14], reorder: 5,
    suppliers: [["D", 2], ["E", 2]], history: [["D", 4.5, 24, "2026-10-17"], ["E", 4.8, 24, "2026-10-09"]], keywords: ["ubat gigi", "toothpaste", "dental"], expiresInDays: 365 },
  { id: "hair-shampoo", name: "Shampoo for Hair", short: "Hair Shampoo", category: "Personal care", unit: "bottle", stock: 10, usage: 2, weekly: [14, 14], reorder: 4,
    suppliers: [["D", 2], ["E", 2]], history: [["D", 8.9, 24, "2026-10-17"], ["E", 9.2, 24, "2026-10-09"]], keywords: ["syampu", "shampoo", "hair"] },
];

export function buildSeedProducts(today = todayLocal()): Product[] {
  return ROWS.map((r) => {
    const suppliers = r.suppliers.map(([letter, lead]) => ({ supplierId: `SUP-${letter}`, supplierName: supplierName(`SUP-${letter}`), leadTimeDays: lead }));
    const history = r.history.map(([letter, unitPrice, quantity, purchaseDate], i) => ({
      purchaseId: `PUR-${r.id}-${r.history.length - i}`,
      supplierId: `SUP-${letter}`,
      supplierName: supplierName(`SUP-${letter}`),
      unitPrice,
      quantity,
      purchaseDate,
    }));
    return {
      productId: r.id,
      productName: r.name,
      shortName: r.short,
      category: r.category,
      stockUnit: r.unit,
      currentStock: r.stock,
      averageDailyUsage: r.usage,
      weeklyUsage: r.weekly ? { previousWeek: r.weekly[0], thisWeek: r.weekly[1] } : null,
      reorderLevel: r.reorder,
      preferredSupplierId: suppliers[0].supplierId,
      supplierLeadTimeDays: suppliers[0].leadTimeDays,
      lastPurchasePrice: history[0]?.unitPrice ?? 0,
      purchaseHistory: history,
      suppliers,
      expiryDate: r.expiresInDays != null ? addDays(today, r.expiresInDays) : null,
      keywords: r.keywords,
    } satisfies Product;
  });
}

/* ---------- Demo supplier quotations (clearly labelled as examples in the UI) ---------- */

/** Preserve the original comparison scenario on rice. Recommendations remain calculated. */
const RICE_EXAMPLE_QUOTES: Record<string, { unitPrice: number; minimumOrderQuantity: number; leadTimeDays: number }> = {
  "SUP-A": { unitPrice: 12.5, minimumOrderQuantity: 20, leadTimeDays: 2 },
  "SUP-B": { unitPrice: 9.8, minimumOrderQuantity: 50, leadTimeDays: 1 },
  "SUP-C": { unitPrice: 10.5, minimumOrderQuantity: 20, leadTimeDays: 1 },
};

export function exampleQuotation(p: Product, supplierId: string, today = todayLocal()) {
  const rice = p.productId === "premium-fragrant-rice" ? RICE_EXAMPLE_QUOTES[supplierId] : undefined;
  if (rice) {
    return { ...rice, quotedDeliveryDate: addDays(today, rice.leadTimeDays), orderMultiple: null };
  }
  const idx = Math.max(0, p.suppliers.findIndex((s) => s.supplierId === supplierId));
  const s = p.suppliers[idx];
  const last = p.purchaseHistory.find((h) => h.supplierId === supplierId)?.unitPrice ?? p.lastPurchasePrice;
  const factor = [1.08, 0.97, 1.02][idx % 3];
  const price = Math.round(last * factor * 20) / 20;
  const base = Math.max(2, Math.ceil((p.averageDailyUsage ?? 1) * 3));
  const minimumOrderQuantity = idx % 3 === 1 ? Math.ceil(base * 2.5) : base;
  const leadTimeDays = s?.leadTimeDays ?? p.supplierLeadTimeDays;
  return {
    unitPrice: price,
    minimumOrderQuantity,
    leadTimeDays,
    quotedDeliveryDate: addDays(today, leadTimeDays),
    orderMultiple: null,
  };
}
