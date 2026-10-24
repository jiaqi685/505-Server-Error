import assert from "node:assert/strict";
import test from "node:test";
import { contentTypeFor } from "./document-upload";

const file = (name: string, type: string) => ({ name, type }) as File;

test("quotation upload content types include PNG while keeping PDF and JPEG support", () => {
  assert.equal(contentTypeFor(file("quote.png", "image/png")), "image/png");
  assert.equal(contentTypeFor(file("quote.PNG", "")), "image/png");
  assert.equal(contentTypeFor(file("quote.jpg", "image/jpeg")), "image/jpeg");
  assert.equal(contentTypeFor(file("quote.pdf", "application/pdf")), "application/pdf");
  assert.throws(() => contentTypeFor(file("quote.gif", "image/gif")), /PDF, JPG, or PNG/);
});
