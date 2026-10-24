import { GoogleGenAI } from "@google/genai";

export class GeminiUnavailableError extends Error {
  constructor() {
    super("AI quotation reading is unavailable. Reconnect the Gemini integration or enter quotation values manually.");
    this.name = "GeminiUnavailableError";
  }
}

let client: GoogleGenAI | undefined;

export function getGeminiClient(): GoogleGenAI {
  if (client) return client;
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!baseUrl || !apiKey) throw new GeminiUnavailableError();
  client = new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: "", baseUrl },
  });
  return client;
}
