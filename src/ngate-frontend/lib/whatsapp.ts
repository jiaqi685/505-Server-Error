import { BUSINESS_NAME } from "./brand";
import { prettyDate } from "./format";

export function buildQuotationMessage(args: { supplierName: string; productName: string; quantity: number; unit: string; deliveryDate: string }): string {
  const { supplierName, productName, quantity, unit, deliveryDate } = args;
  return [
    `Hi ${supplierName},`,
    "",
    `I'm from ${BUSINESS_NAME}.`,
    "",
    "I would like to request a quotation for:",
    "",
    `Product: ${productName}`,
    `Quantity: ${quantity} ${unit}${quantity !== 1 ? "s" : ""}`,
    `Requested Delivery: ${prettyDate(deliveryDate)}`,
    "",
    "Please confirm:",
    "- Unit price",
    "- Minimum order quantity",
    "- Available delivery date",
    "",
    "Thank you!",
  ].join("\n");
}

/**
 * A prefilled WhatsApp compose link. It only opens WhatsApp —
 * the owner presses Send themselves. With a phone number the chat opens
 * directly; without one, the owner picks the contact.
 */
export function whatsappComposeUrl(text: string, phone?: string | null): string {
  const digits = phone?.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
}
