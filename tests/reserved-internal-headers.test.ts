import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  App,
  BadRequestError,
  RESERVED_INBOUND_HEADER_PREFIXES,
  assertNoReservedInternalHeaders,
} from "../src/index.js";

// Structural regression for the Next.js CVE-2025-29927 class of bug.
// Daloy has no internal-trust header that could skip middleware, and
// the `x-daloy-internal-*` / `x-daloyjs-internal-*` namespaces are
// reserved so a future internal-routing marker cannot be silently
// spoofed by an external client.

test("RESERVED_INBOUND_HEADER_PREFIXES advertises the framework-owned prefixes", () => {
  assert.ok(RESERVED_INBOUND_HEADER_PREFIXES.includes("x-daloy-internal-"));
  assert.ok(RESERVED_INBOUND_HEADER_PREFIXES.includes("x-daloyjs-internal-"));
});

test("assertNoReservedInternalHeaders accepts ordinary headers", () => {
  const h = new Headers({
    host: "example.com",
    "content-length": "0",
    "user-agent": "curl/8",
    "x-request-id": "abc",
    "x-daloy-public": "ok", // not in the reserved namespace
  });
  assert.doesNotThrow(() => assertNoReservedInternalHeaders(h));
});

test("assertNoReservedInternalHeaders rejects spoofed x-daloy-internal-* headers", () => {
  for (const name of [
    "x-daloy-internal-subrequest",
    "X-DALOY-INTERNAL-RECURSION",
    "x-daloyjs-internal-bypass",
  ]) {
    const h = new Headers({ [name]: "yes" });
    assert.throws(
      () => assertNoReservedInternalHeaders(h),
      BadRequestError,
      `expected ${name} to be rejected`,
    );
  }
});

test("App rejects requests carrying a reserved internal header with 400", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/protected",
    operationId: "protected",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  const res = await app.request("/protected", {
    headers: { "x-daloy-internal-subrequest": "middleware:middleware:middleware" },
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { title?: string };
  assert.match(String(body.title ?? ""), /Bad Request|Reserved internal header/i);
});

test("App still routes normally without the reserved header", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/protected",
    operationId: "protected2",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  const res = await app.request("/protected");
  assert.equal(res.status, 200);
});
