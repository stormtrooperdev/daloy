import { test } from "node:test";
import assert from "node:assert/strict";

import {
  App,
  MetricsRegistry,
  Counter,
  Gauge,
  Histogram,
  httpMetrics,
  DEFAULT_DURATION_BUCKETS,
  PROMETHEUS_CONTENT_TYPE,
} from "../src/index.js";

// ---------- MetricsRegistry: counters ----------

test("counter renders HELP/TYPE headers and a labelled sample", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  const c = reg.counter("requests_total", "Total requests.");
  c.inc({ method: "GET" });
  c.inc({ method: "GET" }, 2);
  const out = reg.render();
  assert.match(out, /# HELP daloy_requests_total Total requests\./);
  assert.match(out, /# TYPE daloy_requests_total counter/);
  assert.match(out, /daloy_requests_total\{method="GET"\} 3/);
  assert.ok(out.endsWith("\n"), "exposition must end with a newline");
});

test("counter is memoized by name and rejects negative increments", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  const a = reg.counter("hits");
  const b = reg.counter("hits");
  assert.equal(a, b);
  assert.throws(() => a.inc(undefined, -1), /non-negative/);
});

test("counter default increment is 1 and unlabelled series render without braces", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  reg.counter("ticks").inc();
  assert.match(reg.render(), /\ndaloy_ticks 1\n/);
});

// ---------- MetricsRegistry: gauges ----------

test("gauge supports set, inc, and dec", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  const g = reg.gauge("queue_depth");
  g.set(undefined, 5);
  g.inc();
  g.dec(undefined, 2);
  assert.match(reg.render(), /\ndaloy_queue_depth 4\n/);
});

// ---------- MetricsRegistry: histograms ----------

test("histogram records cumulative buckets, sum, and count", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  const h = reg.histogram("latency_seconds", "Latency.", [0.1, 0.5, 1]);
  h.observe({ route: "/a" }, 0.05);
  h.observe({ route: "/a" }, 0.4);
  h.observe({ route: "/a" }, 2);
  const out = reg.render();
  assert.match(out, /daloy_latency_seconds_bucket\{route="\/a",le="0.1"\} 1/);
  assert.match(out, /daloy_latency_seconds_bucket\{route="\/a",le="0.5"\} 2/);
  assert.match(out, /daloy_latency_seconds_bucket\{route="\/a",le="1"\} 2/);
  assert.match(out, /daloy_latency_seconds_bucket\{route="\/a",le="\+Inf"\} 3/);
  assert.match(out, /daloy_latency_seconds_sum\{route="\/a"\} 2.45/);
  assert.match(out, /daloy_latency_seconds_count\{route="\/a"\} 3/);
});

test("histogram rejects empty or non-finite bucket lists", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  assert.throws(() => reg.histogram("h1", "h", []), /non-empty/);
  assert.throws(() => reg.histogram("h2", "h", [Number.NaN]), /finite/);
});

test("default duration buckets are exported and used when omitted", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  const h = reg.histogram("d_seconds");
  assert.deepEqual([...h.bounds], [...DEFAULT_DURATION_BUCKETS]);
});

// ---------- validation / injection defenses ----------

test("invalid metric names are rejected at definition", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false, prefix: "" });
  assert.throws(() => reg.counter("bad-name"), /Invalid metric name/);
  assert.throws(() => reg.counter("1leading"), /Invalid metric name/);
});

test("invalid and reserved label names are rejected", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  const c = reg.counter("c");
  assert.throws(() => c.inc({ "bad-label": "x" }), /Invalid metric label name/);
  assert.throws(() => c.inc({ le: "x" }), /reserved/);
});

test("label values are escaped so they cannot break out of the label block", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  reg.counter("c").inc({ path: 'a"b\\c\nd' });
  const out = reg.render();
  assert.match(out, /\{path="a\\"b\\\\c\\nd"\}/);
});

test("HELP text escapes backslash and newline", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  reg.counter("c", "line1\nback\\slash").inc();
  assert.match(reg.render(), /# HELP daloy_c line1\\nback\\\\slash/);
});

test("re-registering a name with a different metric type throws", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  reg.counter("dup");
  assert.throws(() => reg.gauge("dup"), /different type/);
});

// ---------- cardinality cap ----------

test("per-metric series cap drops overflow and counts it", () => {
  const reg = new MetricsRegistry({ maxSeries: 2 });
  const c = reg.counter("c");
  c.inc({ id: "1" });
  c.inc({ id: "2" });
  c.inc({ id: "3" }); // dropped
  const out = reg.render();
  assert.match(out, /daloy_c\{id="1"\} 1/);
  assert.match(out, /daloy_c\{id="2"\} 1/);
  assert.doesNotMatch(out, /id="3"/);
  assert.match(out, /daloy_metrics_series_dropped_total 1/);
});

test("invalid maxSeries is rejected", () => {
  assert.throws(() => new MetricsRegistry({ maxSeries: 0 }), /positive integer/);
  assert.throws(() => new MetricsRegistry({ maxSeries: 1.5 }), /positive integer/);
});

// ---------- default / process metrics ----------

test("default metrics include process gauges on Node", () => {
  const reg = new MetricsRegistry();
  const out = reg.render();
  assert.match(out, /# TYPE daloy_process_resident_memory_bytes gauge/);
  assert.match(out, /# TYPE daloy_process_heap_used_bytes gauge/);
  assert.match(out, /daloy_process_uptime_seconds /);
});

test("collectDefaultMetrics:false omits process gauges and the dropped counter", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  reg.counter("only").inc();
  const out = reg.render();
  assert.doesNotMatch(out, /process_resident_memory_bytes/);
  assert.doesNotMatch(out, /metrics_series_dropped_total/);
});

test("collect callbacks run at render time", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  const g = reg.gauge("dynamic");
  let n = 0;
  reg.collect(() => g.set(undefined, ++n));
  reg.render();
  reg.render();
  assert.match(reg.render(), /\ndaloy_dynamic 3\n/);
});

test("reset clears recorded series but keeps definitions and handles valid", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  const c = reg.counter("c");
  c.inc();
  reg.reset();
  assert.doesNotMatch(reg.render(), /\ndaloy_c /);
  c.inc(undefined, 7);
  assert.match(reg.render(), /\ndaloy_c 7\n/);
});

test("custom prefix is applied to metric names", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false, prefix: "myapp_" });
  reg.counter("hits").inc();
  assert.match(reg.render(), /\nmyapp_hits 1\n/);
});

// ---------- httpMetrics middleware ----------

function pingApp(hook: ReturnType<typeof httpMetrics>): App {
  const app = new App({ env: "development" });
  app.use(hook);
  app.route({
    method: "GET",
    path: "/ping",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  return app;
}

test("httpMetrics records counter, duration, and balances in-flight", async () => {
  const reg = new MetricsRegistry();
  const app = pingApp(httpMetrics({ registry: reg }));
  const res = await app.fetch(new Request("http://x/ping"));
  assert.equal(res.status, 200);
  const out = reg.render();
  assert.match(out, /daloy_http_requests_total\{method="GET",route="\/ping",status="200"\} 1/);
  assert.match(out, /daloy_http_request_duration_seconds_count\{method="GET",route="\/ping"\} 1/);
  assert.match(out, /\ndaloy_http_requests_in_flight 0\n/);
});

test("httpMetrics custom route resolver controls the route label", async () => {
  const reg = new MetricsRegistry();
  const app = pingApp(httpMetrics({ registry: reg, route: () => "/ping/:id" }));
  await app.fetch(new Request("http://x/ping"));
  assert.match(reg.render(), /route="\/ping\/:id"/);
});

test("httpMetrics exclude predicate skips instrumentation but still balances in-flight", async () => {
  const reg = new MetricsRegistry();
  const app = pingApp(httpMetrics({ registry: reg, exclude: (p) => p === "/ping" }));
  await app.fetch(new Request("http://x/ping"));
  const out = reg.render();
  assert.doesNotMatch(out, /daloy_http_requests_total\{/);
  assert.match(out, /\ndaloy_http_requests_in_flight 0\n/);
});

test("default route label cardinality collapses overflow to <other>", async () => {
  const reg = new MetricsRegistry();
  const app = new App({ env: "development" });
  app.use(httpMetrics({ registry: reg, maxRouteCardinality: 1 }));
  app.route({
    method: "GET",
    path: "/a/:id",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: {} }),
  });
  await app.fetch(new Request("http://x/a/1"));
  await app.fetch(new Request("http://x/a/2"));
  const out = reg.render();
  assert.match(out, /route="\/a\/1"/);
  assert.match(out, /route="&lt;other&gt;"|route="<other>"/);
});

// ---------- app.metrics() route ----------

test("app.metrics() exposes Prometheus text and records matched routes", async () => {
  const app = new App({ env: "development" });
  app.metrics();
  app.route({
    method: "GET",
    path: "/ping",
    responses: { 200: { description: "ok" } },
    handler: () => ({ status: 200 as const, body: { ok: true } }),
  });
  await app.fetch(new Request("http://x/ping"));
  const res = await app.fetch(new Request("http://x/metrics"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), PROMETHEUS_CONTENT_TYPE);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.text();
  assert.match(body, /daloy_http_requests_total\{method="GET",route="\/ping",status="200"\} 1/);
  // The scrape route itself must be excluded from instrumentation.
  assert.doesNotMatch(body, /route="\/metrics"/);
});

test("app.metrics() renders custom metrics from a supplied registry", async () => {
  const registry = new MetricsRegistry();
  registry.counter("widgets_built_total", "Widgets.").inc({ kind: "a" }, 4);
  const app = new App({ env: "development" });
  app.metrics({ registry });
  const res = await app.fetch(new Request("http://x/metrics"));
  const body = await res.text();
  assert.match(body, /daloy_widgets_built_total\{kind="a"\} 4/);
});

test("app.metrics() enforces a bearer token (401 missing, 403 wrong, 200 correct)", async () => {
  const app = new App({ env: "development" });
  app.metrics({ token: "s3cret" });
  const missing = await app.fetch(new Request("http://x/metrics"));
  assert.equal(missing.status, 401);
  assert.equal(missing.headers.get("www-authenticate"), 'Bearer realm="metrics"');
  const wrong = await app.fetch(
    new Request("http://x/metrics", { headers: { authorization: "Bearer nope" } }),
  );
  assert.equal(wrong.status, 403);
  const ok = await app.fetch(
    new Request("http://x/metrics", { headers: { authorization: "Bearer s3cret" } }),
  );
  assert.equal(ok.status, 200);
});

test("app.metrics() rate-limits scrapes per IP", async () => {
  const app = new App({ env: "development" });
  app.metrics({ rateLimit: { limit: 1, windowMs: 60_000 } });
  const first = await app.fetch(new Request("http://x/metrics"));
  assert.equal(first.status, 200);
  const second = await app.fetch(new Request("http://x/metrics"));
  assert.equal(second.status, 429);
});

test("app.metrics() refuses to boot unauthenticated in production", () => {
  const app = new App({ env: "production" });
  assert.throws(() => app.metrics(), /refused in production/);
});

test("app.metrics() boots in production with a token or explicit acknowledgement", () => {
  const withToken = new App({ env: "production" });
  assert.doesNotThrow(() => withToken.metrics({ token: "t" }));
  const acked = new App({ env: "production" });
  assert.doesNotThrow(() => acked.metrics({ acknowledgeUnauthenticated: true }));
});

test("exported metric classes are the concrete handle types", () => {
  const reg = new MetricsRegistry({ collectDefaultMetrics: false });
  assert.ok(reg.counter("a") instanceof Counter);
  assert.ok(reg.gauge("b") instanceof Gauge);
  assert.ok(reg.histogram("c") instanceof Histogram);
});
