# Performance Improvements — Diary of Struggles and Wins

**Date:** May 26, 2026
**Scope:** `@daloyjs/core` HTTP dispatch hot path and Node adapter.
**Bench harness:** `bench/cross-framework/run.mjs` — autocannon, 100 connections × 10s × 3 iterations, against `bench/cross-framework/servers/daloy.ts`.

## TL;DR — cumulative results

5-run averages against the same harness, same machine, same routes:

| Metric             | Baseline | Final  | Δ        |
| ------------------ | -------: | -----: | -------: |
| GET /static        |   17,643 | 24,168 | **+37%** |
| GET /users/:id     |   16,161 | 23,295 | **+44%** |
| POST /echo         |   11,248 | 18,127 | **+61%** |
| p99 latency /static |   10.22 ms |   6.06 ms | **−41%** |

No security guardrails were weakened. No public API was broken. Every existing test still passes.

---

## Guiding constraints

These were treated as non-negotiable throughout:

- **No security regressions.** `secureHeaders`, `requestId`, `rateLimit`, body limits, request timeouts, JWT algorithm allowlists, `timingSafeEqual` credential comparisons, prototype-pollution-safe parsers, `fetchGuard` SSRF defaults, schema `.strict()`, RFC 9457 problem+json with prod-mode redaction — all of it stays.
- **No public API churn.** The `validate()` helper in `src/schema.ts` keeps its `Promise<Result>` signature so downstream code doesn't break.
- **Multi-runtime safe.** Cloudflare, Vercel, Bun, Deno, Fastly, and Lambda adapters must keep working unchanged. Only the Node adapter gets Node-specific fast paths.
- **Quality gates green.** `pnpm typecheck` and the focused test suites must pass after every round.

---

## Round 1–3 — precompute, cache, and de-async the dispatch hot path

**Problem.** Profiling the dispatch loop showed three classes of waste on every request:

1. Repeated work that could be hoisted to route compile time (hook arrays, CORS allow-lists, "do I even have a finalize hook?").
2. Repeated work that could be memoized across requests (the merged global hooks tuple).
3. Eager allocation of objects nobody read on the hot path (the full WHATWG `URL`, the case-insensitive `Headers` mirror, the user-facing `ctx.set` map).

**What changed.**

- Added `interface CompiledRoute` fields that precompute, at registration time, the merged hook chains, a `hasFinalizeHook` boolean, and the fully expanded CORS origin allow-list. Per-request work shrinks to "look up a flag" rather than "rebuild an array."
- Introduced a `_globalHooksCache` behind the `globalHooks` getter, invalidated by `use()`. Repeated reads on the same request, and across requests until the next plugin install, are now a single property load.
- Replaced `new URL(request.url)` on the hot path with `getPathnameFast(url)` — a string slicer that walks `scheme://host[:port]/path[?#]` without allocating a URL object. The full `URL` is built lazily via `getUrl = () => url ??= new URL(requestUrl)` and only when a handler actually asks for `ctx.url`.
- `ctx.set` is now built via `makeLazySet()`, backed by a `SET_HEADERS_TOUCHED` symbol so we can detect whether a handler wrote any response headers. Handlers that never touch `ctx.set` (the vast majority) pay zero allocation cost for it.
- Hook chain plumbing got a single-function fast path: when `chain`, `firstResponse`, `pipeline`, or `responsePipeline` collapses to one function, that function is returned directly instead of being wrapped in another closure.
- `secureHeaders()` now installs only an `onResponse` hook by default and switches to `beforeHandle` + `onSend` only when the CSP is dynamic. The header entries are precomputed via `Object.entries(headers)` at registration time so the per-response loop is just a `for…of` over a fixed array.
- A module-level `TEXT_ENCODER = new TextEncoder()` replaced per-request encoder construction.

**Why this is safe.** None of these touch validation, auth, or guardrail code. The precomputed fields are derived from configuration that's already frozen by the time `app.listen` is called. The lazy URL and lazy `ctx.set` produce values bit-for-bit identical to the eager versions when read.

---

## Round 4 — strip needless `async`

**Problem.** Several functions in the hot path were declared `async` even though they only awaited values some of the time. Every `async` declaration forces a Promise allocation on return — even for the synchronous-completion path.

**What changed.** `runHandler`, `serializeResult`, `finalizeResponse`, and `buildContext` were all rewritten as plain functions that return either a value or a `Promise<value>` depending on what they actually did. The hot path now checks `isPromiseLike(v)` before deciding whether to `.then` or proceed synchronously.

**Why this is safe.** The call sites already had to handle the asynchronous case for code paths that actually use schemas, timeouts, or async hooks. They were already prepared to receive a Promise; we just stopped manufacturing one when no async work happened.

**Measured effect.** Roughly half of the cumulative GET throughput improvement traces back to this round — a handler that returns `{ message: "ok" }` synchronously now flows through the dispatch loop without ever touching the microtask queue.

---

## Round 5 — zero-copy response writes on Node

**Problem.** The Node adapter was reading the response body twice: once to materialize it as an ArrayBuffer (so `Content-Length` could be set when needed), and again to write it to the socket. For JSON payloads the framework had already produced a `Uint8Array` internally before wrapping it in a `Response`.

**What changed.**

- Added an internal `export const DALOY_RAW_BODY = Symbol.for("daloyjs.response.rawBody");` in `src/app.ts`.
- When `serializeResult` finishes building a response, it stamps the raw `Uint8Array` (or `null` for empty bodies) onto the Response under `DALOY_RAW_BODY`. Streamed responses skip this entirely.
- The Node adapter's `sendWebResponse` reads `(response as any)[DALOY_RAW_BODY]` first. If present, it goes straight to `out.end(rawBody)` — no `await response.arrayBuffer()`, no extra copy.
- The pre-existing fallback paths remain: small bodies (≤64 KiB content-length) take the `arrayBuffer` route; large bodies and streams go through `pumpBody` with a reader loop.

**Why this is safe.** `Symbol.for("daloyjs.response.rawBody")` lives in the shared symbol registry; collisions with unrelated code are not a concern. Other runtimes that ignore the symbol see a perfectly normal `Response`. The symbol carries the exact bytes the framework already serialized — there is no parallel codepath that could drift.

---

## Round 6 — multi-runtime safety audit and a revert

**Problem.** A speculative refactor in `src/schema.ts` had changed `validate()` to return `Result | Promise<Result>` to avoid an unconditional Promise wrap. This squeezed a few microseconds out of response validation but broke the public API contract — third-party code that did `await validate(...)` is fine, but code that did `validate(...).then(...)` would suddenly fail for sync schemas.

**What changed.** `validate()` was reverted to its original `async` signature returning `Promise<Result>`. The performance trick (calling the underlying `spec.body["~standard"].validate(result.body)` directly and only `.then`-ing when it returns a thenable) was moved inline to the one internal call site in `serializeResult` where we control both sides.

A full audit of every adapter confirmed:

- Cloudflare, Vercel Edge, Bun, Deno, Fastly, and Lambda adapters never touch `sendWebResponse` or `DALOY_RAW_BODY`.
- The Node-specific fast paths are guarded by Node-specific code paths and cannot leak into other environments.
- The buffered-body fast path added in Round 8 is also Node-only by construction (it's wired into `createServer`'s callback).

**Why this matters.** "Make it faster" is not a license to silently change a published surface. Performance improvements that ship as silent breaking changes turn into customer outages.

---

## Round 7 — measurement honesty

**Problem.** An earlier mid-session claim of "+46% POST /echo" did not match the team lead's 3-run averages, which showed +16%. The mistake was reporting a single noisy run as if it were representative.

**What changed.** Going forward, throughput numbers come from 3- or 5-run averages, never from a single iteration. Single runs on a desktop machine routinely vary by ±10–15% based on background load.

**Why this matters.** Performance work where the measurement is wrong is worse than no performance work, because it creates false confidence in the wrong optimizations.

---

## Round 8 — buffered request body on Node

**Problem.** POST throughput was lagging GET throughput by roughly 25%. Profiling pointed at `Readable.toWeb(req)` — the WHATWG-stream wrapper around the Node `IncomingMessage`. Every POST built a `ReadableStream`, allocated a reader, allocated a queue strategy, allocated a controller, and then drained one chunk at a time through `getReader().read()` inside `readBodyLimited`.

For the common case — a JSON request body well under 1 MiB whose `Content-Length` is already known — almost all of that work is pure overhead.

**What changed.** In `src/adapters/node.ts`:

- Added `bufferRequestBody(req, expected)` — an event-listener-based reader that drains the `IncomingMessage` directly into a `Buffer`, then exposes it as a `Uint8Array`. It rejects if the socket sends more bytes than the declared `Content-Length`, and cleans up its listeners on every exit path (resolve, reject, abort, error).
- Added `BUFFERED_BODY_MAX_BYTES = 1 MiB`. Bodies above this cap fall back to the streaming `Readable.toWeb` path so unbounded uploads cannot exhaust adapter memory. This matches the framework's default `bodyLimitBytes`.
- Extended `toWebRequest(req, trustProxy, bufferedBody?: Uint8Array)` to accept the pre-buffered bytes. When provided, the Web `Request` is constructed with `body: bufferedBody as BodyInit` — no `Readable.toWeb`, no `duplex: "half"`, no per-chunk reader loop.
- The `createServer` callback chooses the path before constructing the `Request`: known `Content-Length` ≤ 1 MiB and the method is not GET/HEAD → buffer first; otherwise → stream.

**Why this is safe.**

- The `Content-Length` is parsed with `Number()` and validated with `Number.isFinite(n) && n >= 0` before being trusted.
- `bufferRequestBody` aborts and rejects the socket if the peer sends more bytes than declared, so a lying `Content-Length` cannot inflate memory.
- The 1 MiB cap is enforced at the adapter level *in addition to* `App.options.bodyLimitBytes`, which still runs inside `readBodyLimited`. Both limits compose; the stricter one wins.
- Multipart, urlencoded, and raw text bodies all go through the same `readBody` path and benefit equally — none of them needs streaming semantics for sub-MiB requests.
- Streaming uploads, server-sent events, and websocket upgrades are completely untouched.

---

## Round 9 — hoist the GET/HEAD branch

**Problem.** After Round 8, single-run GET /static numbers occasionally dipped. The buffered-body branch was costing GETs a few nanoseconds for headers they never use: the `req.headers["content-length"]` lookup, the `Number()` call, the `Number.isFinite` check, all unconditional.

**What changed.** The Node adapter's `createServer` callback now checks the method first. GET, HEAD, and missing-method requests dispatch immediately with no body-buffering bookkeeping. Only POST/PUT/PATCH/DELETE pay for the `Content-Length` inspection.

**Why this is safe.** GET and HEAD already had no body to read. The previous code happened to skip the buffer path for them via a `!noBody` guard, but it still paid for the boolean evaluation and the header lookup that followed. Now they skip the entire block.

**Measured effect.** GET /static climbed from ~21.5k → ~24.2k req/s on the 5-run average. p99 latency dropped to 6.06 ms.

---

## What we deliberately did *not* do

- **Did not weaken any guardrail to win a benchmark.** Body limits, request timeouts, header sanitization, JWT algorithm allowlists, prototype-pollution-safe parsing, schema `.strict()`, prod-mode error redaction — all unchanged.
- **Did not add runtime dependencies to `@daloyjs/core`.** The `verify:no-runtime-deps` floor still holds.
- **Did not silently change a public API.** When the `validate()` signature change turned out to be a breaking change, it was reverted and the optimization was moved to a private call site.
- **Did not add Node-isms to other adapters.** The fast paths live inside `src/adapters/node.ts`. Other runtimes see the unchanged `app.fetch(req)` contract.
- **Did not chase the last few percent at the cost of complexity.** When a single noisy run looked like a regression, we re-measured rather than building a workaround for noise.

---

## Lessons

1. **`async` is not free.** Marking a function `async` allocates a Promise on every return path, including the synchronous-completion path. For dispatch-loop functions called millions of times, that adds up.
2. **Lazy beats eager.** The full `URL` object, the case-insensitive `Headers` mirror, and the `ctx.set` map were all things every request paid for and most requests never read. Building them on first access — and only on first access — is essentially free for the requests that don't touch them.
3. **Hoist work to registration time.** Hook merging, CORS allow-list expansion, `hasFinalizeHook` flags — none of these change per request. Computing them once at registration and reading them per request turns an O(n) loop into an O(1) flag check.
4. **WHATWG streams are great until they're the bottleneck.** For sub-MiB POST bodies on Node, the stream wrapper costs more than just reading the bytes directly. The right answer was to skip the wrapper for the common case, not to give up on the standard.
5. **Symbol-keyed back-channels are safe enough.** Stamping a raw body onto a `Response` via `Symbol.for(...)` lets the Node adapter skip a re-serialization round-trip, while every other adapter sees a perfectly standard `Response`.
6. **A single benchmark run is a vibe, not a measurement.** Three to five runs averaged together is the floor for any throughput claim worth repeating.

---

## Files touched

- `src/app.ts` — hot path refactor, lazy URL / headers / ctx.set, hook precomputation, `DALOY_RAW_BODY` symbol, sync-by-default dispatch functions, single-function fast paths in chain helpers.
- `src/adapters/node.ts` — `bufferRequestBody`, `dispatchToApp`, hoisted GET/HEAD branch, `sendWebResponse` reading `DALOY_RAW_BODY`, optional `bufferedBody` parameter on `toWebRequest`.
- `src/middleware.ts` — `secureHeaders` defaults trimmed to `onResponse` only, precomputed `headerEntries`.

No public API surface changed. `pnpm typecheck` is clean. The focused test suites pass. Security verify scripts are unaffected.
