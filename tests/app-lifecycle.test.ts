import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { App, InternalError, requestId, secureHeaders } from "../src/index.js";

test("query and header schemas are validated and available to handlers", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/search",
    operationId: "search",
    request: {
      query: z.object({ q: z.string(), tag: z.array(z.string()) }) as any,
      headers: z.object({ "x-tenant": z.string() }) as any,
    },
    responses: { 200: { description: "ok", body: z.object({ q: z.string(), tags: z.array(z.string()), tenant: z.string() }) as any } },
    handler: async ({ query, headers }) => ({
      status: 200 as const,
      body: { q: (query as any).q, tags: (query as any).tag, tenant: (headers as any)["x-tenant"] },
    }),
  });

  const ok = await app.request("/search?q=books&tag=a&tag=b", { headers: { "x-tenant": "acme" } });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { q: "books", tags: ["a", "b"], tenant: "acme" });

  const bad = await app.request("/search?q=books&tag=a&tag=b");
  assert.equal(bad.status, 422);
  const problem: any = await bad.json();
  assert.equal(problem.detail, "Invalid headers");
});

test("app.fetch preserves serialized URL routing and query semantics", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/",
    operationId: "urlRoot",
    responses: { 200: { description: "ok" } },
    handler: async ({ query }) => ({ status: 200 as const, body: query }),
  });
  app.route({
    method: "GET",
    path: "/target",
    operationId: "urlTarget",
    responses: { 200: { description: "ok" } },
    handler: async ({ query }) => ({ status: 200 as const, body: query }),
  });
  app.route({
    method: "GET",
    path: "/literal;path",
    operationId: "urlLiteralSemicolon",
    responses: { 200: { description: "ok" } },
    handler: async ({ query }) => ({ status: 200 as const, body: query }),
  });

  const root = await app.fetch(new Request("http://x?tag=a&tag=b"));
  assert.equal(root.status, 200);
  assert.deepEqual(await root.json(), { tag: ["a", "b"] });

  const normalized = await app.fetch(
    new Request("http://x/base/../target?next=/literal;path#frag"),
  );
  assert.equal(normalized.status, 200);
  assert.deepEqual(await normalized.json(), { next: "/literal;path" });

  const literal = await app.fetch(new Request("http://x/literal;path?ok=1"));
  assert.equal(literal.status, 200);
  assert.deepEqual(await literal.json(), { ok: "1" });
});

test("ctx.state.log is created lazily only when handler reads it", async () => {
  let childCalls = 0;
  let infoCalls = 0;
  const logger = {
    level: "info",
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {},
    child() {
      childCalls++;
      return {
        ...logger,
        info() {
          infoCalls++;
        },
      };
    },
  } as any;
  const app = new App({ logger });
  app.route({
    method: "GET",
    path: "/unused-log",
    operationId: "unusedLog",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });
  app.route({
    method: "GET",
    path: "/used-log",
    operationId: "usedLog",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean() }) as any } },
    handler: async ({ state }) => {
      (state as any).log.info("handler used request logger");
      return { status: 200 as const, body: { ok: true } };
    },
  });

  assert.equal((await app.request("/unused-log")).status, 200);
  assert.equal(childCalls, 0);
  assert.equal((await app.request("/used-log")).status, 200);
  assert.equal(childCalls, 1);
  assert.equal(infoCalls, 1);
});

test("hooks run in order and afterHandle can transform handler output", async () => {
  const events: string[] = [];
  const app = new App({ logger: false });
  app.use({
    onRequest: () => {
      events.push("global:onRequest");
    },
    beforeHandle: (ctx) => {
      events.push("global:before");
      ctx.set.headers.set("x-global", "1");
    },
    afterHandle: (_ctx, value: any) => {
      events.push("global:after");
      return { ...value, body: { ...value.body, global: true } };
    },
    onResponse: (res) => {
      events.push(`global:onResponse:${res.status}`);
    },
  });
  app.route({
    method: "GET",
    path: "/hooks",
    operationId: "hooks",
    responses: { 200: { description: "ok", body: z.object({ ok: z.boolean(), global: z.boolean(), route: z.boolean() }) as any } },
    hooks: {
      beforeHandle: () => {
        events.push("route:before");
      },
      afterHandle: (_ctx, value: any) => {
        events.push("route:after");
        return { ...value, body: { ...value.body, route: true } };
      },
    },
    handler: async () => {
      events.push("handler");
      return { status: 200 as const, body: { ok: true } as any };
    },
  });

  const res = await app.request("/hooks");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-global"), "1");
  assert.deepEqual(await res.json(), { ok: true, global: true, route: true });
  assert.deepEqual(events, ["global:onRequest", "global:before", "route:before", "handler", "global:after", "route:after", "global:onResponse:200"]);
});

test("AppOptions.hooks compose before route hooks from the cached route chain", async () => {
  const events: string[] = [];
  const app = new App({
    logger: false,
    hooks: {
      beforeHandle: (ctx) => {
        events.push("options:before");
        ctx.set.headers.set("x-options-before", "1");
      },
      afterHandle: (_ctx, value: any) => {
        events.push("options:after");
        return { ...value, body: { ...value.body, options: true } };
      },
      onSend: (res) => {
        events.push("options:onSend");
        res.headers.set("x-options-send", "1");
        return res;
      },
      onResponse: () => {
        events.push("options:onResponse");
      },
    },
  });
  app.route({
    method: "GET",
    path: "/options-hooks",
    operationId: "optionsHooks",
    responses: { 200: { description: "ok" } },
    hooks: {
      beforeHandle: (ctx) => {
        events.push("route:before");
        ctx.set.headers.set("x-route-before", "1");
      },
      afterHandle: (_ctx, value: any) => {
        events.push("route:after");
        return { ...value, body: { ...value.body, route: true } };
      },
      onSend: (res) => {
        events.push("route:onSend");
        res.headers.set("x-route-send", "1");
        return res;
      },
      onResponse: () => {
        events.push("route:onResponse");
      },
    },
    handler: async () => {
      events.push("handler");
      return { status: 200 as const, body: { ok: true } };
    },
  });

  const res = await app.request("/options-hooks");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-options-before"), "1");
  assert.equal(res.headers.get("x-route-before"), "1");
  assert.equal(res.headers.get("x-options-send"), "1");
  assert.equal(res.headers.get("x-route-send"), "1");
  assert.deepEqual(await res.json(), { ok: true, options: true, route: true });
  assert.deepEqual(events, [
    "options:before",
    "route:before",
    "handler",
    "options:after",
    "route:after",
    "options:onSend",
    "route:onSend",
    "options:onResponse",
    "route:onResponse",
  ]);
});

test("onResponse runs for beforeHandle short-circuit responses", async () => {
  let observedStatus = 0;
  const app = new App({ logger: false });
  app.use({
    beforeHandle: () => new Response("blocked", { status: 403 }),
    onResponse: (res) => {
      observedStatus = res.status;
      res.headers.set("x-observed", "yes");
    },
  });
  app.route({
    method: "GET",
    path: "/blocked",
    operationId: "blocked",
    responses: { 200: { description: "ok" }, 403: { description: "blocked" } },
    handler: async () => ({ status: 200 as const, body: undefined }),
  });

  const res = await app.request("/blocked");
  assert.equal(res.status, 403);
  assert.equal(observedStatus, 403);
  assert.equal(res.headers.get("x-observed"), "yes");
  assert.equal(await res.text(), "blocked");
});

test("route-level onError can replace error responses and still runs onResponse", async () => {
  let onResponse = false;
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/boom",
    operationId: "boom",
    responses: { 418: { description: "handled" } },
    hooks: {
      onError: () => new Response("handled", { status: 418 }),
      onResponse: (res) => {
        onResponse = true;
        res.headers.set("x-final", "yes");
      },
    },
    handler: async () => {
      throw new Error("boom");
    },
  });

  const res = await app.request("/boom");
  assert.equal(res.status, 418);
  assert.equal(onResponse, true);
  assert.equal(res.headers.get("x-final"), "yes");
  assert.equal(await res.text(), "handled");
});

test("groups and plugin registration merge prefix, tags, hooks, auth, and decorations", async () => {
  const app = new App({ logger: false });
  app.decorate("db", { name: "primary" });
  app.group("/api", { tags: ["api"], hooks: { beforeHandle: (ctx) => ctx.set.headers.set("x-group", "yes") }, auth: { scheme: "bearer" } }, (api) => {
    api.route({
      method: "GET",
      path: "/health",
      operationId: "health",
      responses: { 200: { description: "ok" } },
      handler: async ({ state }) => ({ status: 200 as const, body: { db: (state.db as any).name } }),
    });
  });

  app.register({
    name: "books",
    register(child) {
      child.route({
        method: "GET",
        path: "/:id",
        operationId: "getBook",
        responses: { 200: { description: "ok" } },
        handler: async ({ params }) => ({ status: 200 as const, body: { id: (params as any).id } }),
      });
    },
  }, { prefix: "/books", tags: ["books"] });

  assert.throws(() => app.register({ name: "books", register() {} }), /already registered/);

  const health = await app.request("/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("x-group"), "yes");
  assert.deepEqual(await health.json(), { db: "primary" });

  const routes = app.introspect();
  assert.ok(routes.some((r) => r.path === "/api/health" && r.tags?.includes("api") && r.auth?.scheme === "bearer"));
  assert.ok(routes.some((r) => r.path === "/books/:id" && r.tags?.includes("books")));
});

test("async plugins are awaited by ready before their routes are available", async () => {
  const app = new App({ logger: false });
  app.register({
    name: "async-plugin",
    async register(child) {
      await Promise.resolve();
      child.route({
        method: "GET",
        path: "/ready",
        operationId: "ready",
        responses: { 200: { description: "ok" } },
        handler: async () => ({ status: 200 as const, body: { ready: true } }),
      });
    },
  }, { prefix: "/plugin" });

  await app.ready();
  await app.ready();
  const res = await app.request("/plugin/ready");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ready: true });
});

test("onClose hooks registered by apps and plugins run once during shutdown", async () => {
  const events: string[] = [];
  const app = new App({ logger: false });

  app.onClose(() => {
    events.push("root");
  });
  app.register({
    name: "cleanup-plugin",
    register(child) {
      child.onClose(async () => {
        events.push("plugin");
      });
      child.route({
        method: "GET",
        path: "/ok",
        operationId: "ok",
        responses: { 200: { description: "ok" } },
        handler: async () => ({ status: 200 as const, body: { ok: true } }),
      });
    },
  });

  await app.shutdown();
  await app.shutdown();

  assert.deepEqual(events, ["root", "plugin"]);
  const res = await app.request("/ok");
  assert.equal(res.status, 503);
});

test("response schema validation failures become redacted production 500s", async () => {
  const app = new App({ logger: false, production: true });
  app.route({
    method: "GET",
    path: "/bad-response",
    operationId: "badResponse",
    responses: { 200: { description: "ok", body: z.object({ count: z.number() }) as any } },
    handler: async () => ({ status: 200 as const, body: { count: "nope" } as any }),
  });

  const res = await app.request("/bad-response");
  assert.equal(res.status, 500);
  const problem: any = await res.json();
  assert.equal(problem.title, "Internal Server Error");
  assert.equal("detail" in problem, false);
  assert.match(problem.instance, /^urn:request:/);
});

test("undeclared handler status becomes internal error", async () => {
  const app = new App({ logger: false, production: false });
  app.route({
    method: "GET",
    path: "/teapot",
    operationId: "teapot",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 418 as any, body: { nope: true } }),
  });

  const res = await app.request("/teapot");
  assert.equal(res.status, 500);
  const problem: any = await res.json();
  assert.match(problem.detail, /not declared/);
});

test("request timeout returns 408", async () => {
  const app = new App({ logger: false, requestTimeoutMs: 1 });
  app.route({
    method: "GET",
    path: "/slow",
    operationId: "slow",
    responses: { 200: { description: "ok" }, 408: { description: "timeout" } },
    handler: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { status: 200 as const, body: { ok: true } };
    },
  });

  const res = await app.request("/slow");
  assert.equal(res.status, 408);
});

test("explicit non-JSON content-type returns raw text instead of JSON-stringified text", async () => {
  const app = new App({ logger: false });
  app.route({
    method: "GET",
    path: "/html",
    operationId: "html",
    responses: { 200: { description: "html" } },
    handler: async () => ({ status: 200 as const, body: "<h1>ok</h1>", headers: { "content-type": "text/html" } }),
  });

  const res = await app.request("/html");
  assert.equal(res.headers.get("content-type"), "text/html");
  assert.equal(await res.text(), "<h1>ok</h1>");
});

test("HEAD requests fall back to GET handlers with an empty body", async () => {
  const app = new App({ logger: false });
  app.use(requestId());
  app.use(secureHeaders());
  app.route({
    method: "GET",
    path: "/headable",
    operationId: "headable",
    responses: { 200: { description: "ok" } },
    handler: async () => ({ status: 200 as const, body: { ok: true } }),
  });

  const res = await app.request("/headable", { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "");
  assert.ok(res.headers.get("x-request-id"));
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
});
