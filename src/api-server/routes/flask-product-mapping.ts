/**
 * Maps the Flask Mini Mart demo catalogue to the exact React Mini Mart IDs.
 * The Flask feed remains separate from the main mock adapter until explicitly switched.
 */

interface NgateProductShape {
  productId: string;
  productName: string;
  shortName: string;
  category: string;
  stockUnit: string;
  packSize?: string | null;
  currentStock: number;
  averageDailyUsage: number | null;
  weeklyUsage: { previousWeek: number; thisWeek: number } | null;
  reorderLevel: number;
  preferredSupplierId: string;
  supplierLeadTimeDays: number;
  lastPurchasePrice: number;
  purchaseHistory: PurchaseRecord[];
  suppliers: ProductSupplier[];
  expiryDate: string | null;
  keywords: string[];
}

interface ProductSupplier {
  supplierId: string;
  supplierName: string;
  leadTimeDays: number | null;
  eligibilitySource?: "catalogue" | "verified-reference";
}

interface PurchaseRecord {
  purchaseId: string;
  supplierId: string;
  supplierName: string;
  unitPrice: number;
  quantity: number;
  purchaseDate: string;
}

export type NgateProductField = keyof NgateProductShape;

export interface FlaskProductRecord {
  product_id: string;
  store_id: string;
  name: string;
  short_name: string;
  category: string;
  unit: string;
  pack_size: string | null;
  on_hand: number;
  daily_usage: number | null;
  weekly_usage: { previous_week: number; this_week: number } | null;
  estimated_days_until_stockout: number | null;
  suggested_reorder_quantity: number;
  reorder_level: number;
  preferred_supplier_id: string;
  supplier_lead_time_days: number;
  last_purchase_price: number;
  reorder_reason: string;
  excess_inventory_quantity: number | null;
  unit_cost_rm: number;
  estimated_excess_inventory_cost_rm: number | null;
  shelf_life_days: number | null;
  expiry_date: string | null;
  keywords: string[];
  data_source: string;
}

export interface FlaskProductsEnvelope {
  data_source: string;
  count: number;
  products: FlaskProductRecord[];
}

export interface MappedFlaskProduct {
  sourceProductId: string;
  sourceStoreId: string;
  sourceDataSource: string;
  product: NgateProductShape;
  mappedFields: NgateProductField[];
  unmappedFields: NgateProductField[];
  unavailableFields: string[];
  sourceOnlyFields: {
    packSize: string | null;
    estimatedDaysUntilStockout: number | null;
    suggestedReorderQuantity: number;
    reorderReason: string;
    excessInventoryQuantity: number | null;
    unitCostRm: number;
    estimatedExcessInventoryCostRm: number | null;
    shelfLifeDays: number | null;
    supplierTerms: Array<{
      supplierId: string;
      supplierName: string;
      minimumOrderQuantity: number | null;
      stockUnit: string;
      packSize: string | null;
    }>;
  };
}

export interface MappedFlaskProductsPayload {
  dataSource: "FLASK_MINI_MART";
  sourceDataSource: string;
  sourceStoreId: string | null;
  count: number;
  products: MappedFlaskProduct[];
}

const PRODUCT_FIELDS: NgateProductField[] = [
  "productId", "productName", "shortName", "category", "stockUnit", "packSize", "currentStock",
  "averageDailyUsage", "weeklyUsage", "reorderLevel", "preferredSupplierId",
  "supplierLeadTimeDays", "lastPurchasePrice", "purchaseHistory", "suppliers",
  "expiryDate", "keywords",
];

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label}.${key} must be a nonempty string`);
  return value;
}

function nullableStringField(record: Record<string, unknown>, key: string, label: string): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`${label}.${key} must be a string or null`);
  return value || null;
}

function numberField(record: Record<string, unknown>, key: string, label: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label}.${key} must be a finite number`);
  return value;
}

function nullableNumberField(record: Record<string, unknown>, key: string, label: string): number | null {
  return record[key] === null ? null : numberField(record, key, label);
}

function integerField(record: Record<string, unknown>, key: string, label: string): number {
  const value = numberField(record, key, label);
  if (!Number.isInteger(value)) throw new Error(`${label}.${key} must be an integer`);
  return value;
}

function nullableIntegerField(record: Record<string, unknown>, key: string, label: string): number | null {
  return record[key] === null ? null : integerField(record, key, label);
}

function dateField(record: Record<string, unknown>, key: string, label: string): string {
  const value = stringField(record, key, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}.${key} must use YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label}.${key} must be a valid date`);
  }
  return value;
}

function nullableDateField(record: Record<string, unknown>, key: string, label: string): string | null {
  return record[key] === null ? null : dateField(record, key, label);
}

function parseWeeklyUsage(value: unknown, label: string): FlaskProductRecord["weekly_usage"] {
  if (value === null) return null;
  const record = asRecord(value, label);
  return {
    previous_week: integerField(record, "previous_week", label),
    this_week: integerField(record, "this_week", label),
  };
}

function parseProductRecord(value: unknown, label: string): FlaskProductRecord {
  const record = asRecord(value, label);
  if (!Array.isArray(record.keywords) || record.keywords.some((item) => typeof item !== "string")) {
    throw new Error(`${label}.keywords must be an array of strings`);
  }
  return {
    product_id: stringField(record, "product_id", label),
    store_id: stringField(record, "store_id", label),
    name: stringField(record, "name", label),
    short_name: stringField(record, "short_name", label),
    category: stringField(record, "category", label),
    unit: stringField(record, "unit", label),
    pack_size: nullableStringField(record, "pack_size", label),
    on_hand: integerField(record, "on_hand", label),
    daily_usage: nullableNumberField(record, "daily_usage", label),
    weekly_usage: parseWeeklyUsage(record.weekly_usage, `${label}.weekly_usage`),
    estimated_days_until_stockout: nullableNumberField(record, "estimated_days_until_stockout", label),
    suggested_reorder_quantity: integerField(record, "suggested_reorder_quantity", label),
    reorder_level: integerField(record, "reorder_level", label),
    preferred_supplier_id: stringField(record, "preferred_supplier_id", label),
    supplier_lead_time_days: integerField(record, "supplier_lead_time_days", label),
    last_purchase_price: numberField(record, "last_purchase_price", label),
    reorder_reason: stringField(record, "reorder_reason", label),
    excess_inventory_quantity: nullableNumberField(record, "excess_inventory_quantity", label),
    unit_cost_rm: numberField(record, "unit_cost_rm", label),
    estimated_excess_inventory_cost_rm: nullableNumberField(record, "estimated_excess_inventory_cost_rm", label),
    shelf_life_days: nullableNumberField(record, "shelf_life_days", label),
    expiry_date: nullableDateField(record, "expiry_date", label),
    keywords: record.keywords as string[],
    data_source: stringField(record, "data_source", label),
  };
}

export function parseFlaskProductsEnvelope(value: unknown): FlaskProductsEnvelope {
  const record = asRecord(value, "Flask products response");
  const dataSource = stringField(record, "data_source", "Flask products response");
  const count = integerField(record, "count", "Flask products response");
  if (!Array.isArray(record.products)) throw new Error("Flask products response.products must be an array");
  const products = record.products.map((item, index) => parseProductRecord(item, `products[${index}]`));
  if (count !== products.length) throw new Error("Flask products response count does not match its product list");
  if (products.some((product) => product.data_source !== dataSource)) {
    throw new Error("Flask product data_source values do not match the response envelope");
  }
  const productIds = new Set(products.map((product) => product.product_id));
  if (productIds.size !== products.length) throw new Error("Flask products response contains duplicate product IDs");
  const storeIds = new Set(products.map((product) => product.store_id));
  if (storeIds.size > 1) throw new Error("Flask products response contains more than one store");
  return { data_source: dataSource, count, products };
}

export function mapFlaskProductRecord(
  source: FlaskProductRecord,
  detailValue: unknown,
  purchasesValue: unknown,
): MappedFlaskProduct {
  const detailRoot = asRecord(detailValue, "Flask product detail response");
  const detail = parseProductRecord(detailRoot.product, "Flask product detail response.product");
  if (
    detail.product_id !== source.product_id ||
    detail.store_id !== source.store_id ||
    detail.name !== source.name
  ) {
    throw new Error(`Flask product detail did not match source product ${source.product_id}`);
  }

  const detailProduct = asRecord(detailRoot.product, "detail.product");
  if (!Array.isArray(detailProduct.suppliers)) {
    throw new Error(`Flask product detail suppliers must be an array for ${source.product_id}`);
  }
  const suppliers: ProductSupplier[] = [];
  const supplierTerms: MappedFlaskProduct["sourceOnlyFields"]["supplierTerms"] = [];
  for (const [index, value] of (detailProduct.suppliers as unknown[]).entries()) {
    const row = asRecord(value, `suppliers[${index}]`);
    const supplierId = stringField(row, "supplier_id", `suppliers[${index}]`);
    const supplierName = stringField(row, "supplier_name", `suppliers[${index}]`);
    const leadTimeDays = nullableIntegerField(row, "lead_days", `suppliers[${index}]`);
    const minimumOrderQuantity = nullableNumberField(row, "moq", `suppliers[${index}]`);
    const stockUnit = stringField(row, "unit", `suppliers[${index}]`);
    const packSize = nullableStringField(row, "pack_size", `suppliers[${index}]`);
    const rawEligibilitySource = row.eligibility_source;
    if (rawEligibilitySource !== undefined && rawEligibilitySource !== "catalogue" && rawEligibilitySource !== "verified-reference") {
      throw new Error(`suppliers[${index}].eligibility_source must be catalogue or verified-reference`);
    }
    suppliers.push({ supplierId, supplierName, leadTimeDays, eligibilitySource: rawEligibilitySource ?? "catalogue" });
    supplierTerms.push({ supplierId, supplierName, minimumOrderQuantity, stockUnit, packSize });
  }

  const purchasesRoot = asRecord(purchasesValue, "Flask purchase history response");
  if (
    stringField(purchasesRoot, "product_id", "purchase history") !== source.product_id ||
    stringField(purchasesRoot, "product_name", "purchase history") !== source.name ||
    !Array.isArray(purchasesRoot.purchases)
  ) {
    throw new Error(`Flask purchase history did not match source product ${source.product_id}`);
  }
  const purchaseRows = purchasesRoot.purchases as unknown[];
  const purchaseHistory: PurchaseRecord[] = purchaseRows.map((value, index) => {
    const row = asRecord(value, `purchases[${index}]`);
    const id = row.purchase_id;
    if (!(typeof id === "number" && Number.isSafeInteger(id)) && typeof id !== "string") {
      throw new Error(`purchases[${index}].purchase_id must be a string or safe integer`);
    }
    return {
      purchaseId: `PUR-${source.product_id}-${purchaseRows.length - index}`,
      supplierId: stringField(row, "supplier_id", `purchases[${index}]`),
      supplierName: stringField(row, "supplier_name", `purchases[${index}]`),
      unitPrice: numberField(row, "unit_price", `purchases[${index}]`),
      quantity: integerField(row, "quantity", `purchases[${index}]`),
      purchaseDate: dateField(row, "purchase_date", `purchases[${index}]`),
    };
  });

  const product: NgateProductShape = {
    productId: source.product_id,
    productName: source.name,
    shortName: source.short_name,
    category: source.category,
    stockUnit: source.unit,
    packSize: source.pack_size,
    currentStock: source.on_hand,
    averageDailyUsage: source.daily_usage,
    weeklyUsage: source.weekly_usage
      ? { previousWeek: source.weekly_usage.previous_week, thisWeek: source.weekly_usage.this_week }
      : null,
    reorderLevel: source.reorder_level,
    preferredSupplierId: source.preferred_supplier_id,
    supplierLeadTimeDays: source.supplier_lead_time_days,
    lastPurchasePrice: source.last_purchase_price,
    purchaseHistory,
    suppliers,
    expiryDate: source.expiry_date,
    keywords: source.keywords,
  };

  return {
    sourceProductId: source.product_id,
    sourceStoreId: source.store_id,
    sourceDataSource: source.data_source,
    product,
    mappedFields: [...PRODUCT_FIELDS],
    unmappedFields: [],
    unavailableFields: ["barcode"],
    sourceOnlyFields: {
      packSize: source.pack_size,
      estimatedDaysUntilStockout: source.estimated_days_until_stockout,
      suggestedReorderQuantity: source.suggested_reorder_quantity,
      reorderReason: source.reorder_reason,
      excessInventoryQuantity: source.excess_inventory_quantity,
      unitCostRm: source.unit_cost_rm,
      estimatedExcessInventoryCostRm: source.estimated_excess_inventory_cost_rm,
      shelfLifeDays: source.shelf_life_days,
      supplierTerms,
    },
  };
}

export function makeMappedFlaskProductsPayload(
  envelope: FlaskProductsEnvelope,
  products: MappedFlaskProduct[],
): MappedFlaskProductsPayload {
  if (products.length !== envelope.count) throw new Error("Mapped product count does not match Flask source count");
  return {
    dataSource: "FLASK_MINI_MART",
    sourceDataSource: envelope.data_source,
    sourceStoreId: envelope.products[0]?.store_id ?? null,
    count: products.length,
    products,
  };
}
