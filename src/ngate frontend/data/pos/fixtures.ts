import { buildSeedProducts } from "../seed";
import { shiftDay } from "./preview";

/** Synthetic acceptance fixtures, not a connected POS or user business data. */
export function syntheticSalesCsv(riceDaily = 3, days = 30): string {
  const rows = ["date,store_id,product_id,product_name,stock_unit,quantity_sold,retail_unit_price_rm,gross_sales_rm,data_origin"];
  for (let day = 0; day < days; day += 1) {
    for (const product of buildSeedProducts()) {
      const quantity = product.productId === "premium-fragrant-rice" && day >= days - 7
        ? riceDaily : product.averageDailyUsage ?? 1;
      rows.push([
        shiftDay("2026-10-01", day), "krukkruk", product.productId, product.productName,
        product.stockUnit, quantity, 10, quantity * 10, "synthetic_pos_demo",
      ].join(","));
    }
  }
  return rows.join("\n");
}

export function syntheticInventoryCsv(stock = 3): string {
  return [
    "as_of_date,store_id,product_id,product_name,stock_unit,current_stock,data_origin",
    `2026-10-30,krukkruk,premium-fragrant-rice,Premium Fragrant Rice,bag,${stock},synthetic_demo`,
  ].join("\n");
}
