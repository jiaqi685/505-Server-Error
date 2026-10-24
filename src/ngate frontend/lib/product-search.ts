import type { Product } from "../data/types";

function normalize(value: string | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

export function productSearchScore(product: Product, query: string): number {
  const q = normalize(query);
  if (!q) return 1;

  const name = normalize(product.productName);
  if (name === q) return 700;
  if (name.startsWith(q)) return 600;
  if (name.includes(q)) return 500;

  // The current catalogue has no separate SKU field; productId is its stable item-code fallback.
  const codes = [normalize(product.sku), normalize(product.productId)].filter(Boolean);
  if (codes.some((code) => code === q)) return 400;
  if (codes.some((code) => code.includes(q))) return 350;

  if (product.suppliers.some((supplier) => normalize(supplier.supplierName).includes(q))) return 300;
  if (normalize(product.category).includes(q)) return 200;
  if ([product.shortName, ...(product.keywords ?? [])].some((term) => normalize(term).includes(q))) return 100;
  return 0;
}

export function rankProductsBySearch(products: Product[], query: string): Product[] {
  if (!normalize(query)) return products;
  return products
    .map((product, index) => ({ product, index, score: productSearchScore(product, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.product);
}
