import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import router from "../routes/procurement";
import { inputs, outputs } from "./procurement-contracts";

test("all Node procurement reads and writes require a verified server session", async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { Object.defineProperty(req, "isAuthenticated", { value: () => false }); next(); });
  app.use("/api", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as { port: number };
  try {
    for (const operation of Object.keys(outputs)) {
      const read = ["dashboard", "latest-rfq", "quotes", "orders", "activity"].includes(operation);
      const response = await fetch(`http://127.0.0.1:${address.port}/api/integrations/flask/procurement/${operation}`, {
        method: read ? "GET" : "POST",
        headers: { "Content-Type": "application/json", "X-NGate-Request": "procurement-v2", "X-User-Id": "forged-owner", "Idempotency-Key": "public-test-request" },
        ...(read ? {} : { body: "{}" }),
      });
      assert.equal(response.status, 401, operation);
    }
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test("authenticated proxy rejects cross-site writes and forged/invalid body fields before Flask", async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.defineProperty(req, "isAuthenticated", { value: () => true });
    Object.defineProperty(req, "user", { value: { id: "isolated-unit-owner" } });
    next();
  });
  app.use("/api", router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/api/integrations/flask/procurement/create-rfq`;
  const valid = { productId: "premium-fragrant-rice", requestedQuantity: 17, requestedDeliveryDate: "2099-01-10", supplierIds: ["SUP-A"] };
  const headers = { "Content-Type": "application/json", "X-NGate-Request": "procurement-v2", "Idempotency-Key": "public-test-request" };
  try {
    assert.equal((await fetch(url, { method: "POST", headers: { ...headers, "Sec-Fetch-Site": "cross-site" }, body: JSON.stringify(valid) })).status, 403);
    assert.equal((await fetch(url, { method: "POST", headers: { ...headers, Origin: "https://untrusted.example.test" }, body: JSON.stringify(valid) })).status, 403);
    assert.equal((await fetch(url, { method: "POST", headers: { ...headers, Origin: `http://127.0.0.1:${address.port}` }, body: JSON.stringify({ ...valid, ownerId: "victim" }) })).status, 400);
    assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(valid) })).status, 403);
    assert.equal((await fetch(url, { method: "POST", headers, body: JSON.stringify({ ...valid, ownerId: "victim" }) })).status, 400);
    assert.equal((await fetch(url, { method: "POST", headers, body: JSON.stringify({ ...valid, requestedQuantity: -1 }) })).status, 400);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test("domain response validators retain evidence and reject false HTTP-200 shapes", () => {
  const body = {
    rfqId: "rfq", supplierId: "SUP-A", unitPrice: 31.8, minimumOrderQuantity: 30, leadTimeDays: 2,
    quotedDeliveryDate: null, source: "manual", leadTimeBasis: "working-days", leadTimeText: "2 working days",
    quotedSupplierName: "Bintang Wholesale", packDescription: "5 kg per bag", reviewConfirmed: true, supplierOverrideConfirmed: true,
  };
  assert.equal(inputs["save-quote"].parse(body).quotedDeliveryDate, null);
  const quote = outputs["save-quote"].parse({ ...body, quoteId: "quote", productId: "premium-fragrant-rice", supplierName: "Supplier A", previousUnitPrice: 31, receivedAt: "2026-10-23T00:00:00Z" });
  assert.equal(quote.leadTimeBasis, "working-days");
  assert.equal(quote.packDescription, "5 kg per bag");
  assert.throws(() => outputs.orders.parse({ status: "ok" }));
  assert.throws(() => inputs["save-quote"].parse({ ...body, reviewConfirmed: "yes" }));
  assert.throws(() => inputs["approve-po"].parse({ poNumber: "po", ownerId: "other" }));
});
