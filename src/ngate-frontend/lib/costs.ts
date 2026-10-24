import { roundMoney } from "./format";

export function poTotal(qty: number, unitPrice: number): number {
  return roundMoney(qty * unitPrice);
}

export interface PoValidation {
  valid: boolean;
  message: string;
}

/** Quantity must be a positive whole number at or above the supplier MOQ; price must be positive. */
export function validatePoInput(qty: number, price: number, moq: number, requestedQuantity?: number | null): PoValidation {
  if (!(Number.isInteger(qty) && qty > 0)) return { valid: false, message: "Enter a whole quantity greater than zero." };
  if (requestedQuantity != null && qty < requestedQuantity) return { valid: false, message: `This RFQ requests ${requestedQuantity}. Shortfall: ${requestedQuantity - qty}. Partial orders are not supported; increase the quantity.` };
  if (qty < moq) return { valid: false, message: `This supplier's minimum order is ${moq}. Increase the quantity or choose another supplier.` };
  if (!(Number.isFinite(price) && price > 0)) return { valid: false, message: "Enter a price greater than zero." };
  return { valid: true, message: "" };
}

export function validateRfqInput(qty: number, date: string, supplierIds: string[], today: string): string | null {
  if (!(Number.isInteger(qty) && qty > 0)) return "Enter a whole quantity greater than zero.";
  if (!date) return "Choose a delivery date.";
  if (date < today) return "The delivery date cannot be in the past.";
  if (supplierIds.length === 0) return "Choose at least one supplier.";
  return null;
}
