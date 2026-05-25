# Cross-framework HTTP benchmark

A **neutral, head-to-head HTTP benchmark** comparing DaloyJS against the
frameworks referenced in the root [README.md](../../README.md) comparison
table.

> ⚠️ **This package is intentionally isolated from the pnpm workspace.** It is
> not listed in [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml) so its
> devDependencies (Express, Fastify, Nest, Koa, Feathers, Elysia, Hono, …)
> never touch `@daloyjs/core`'s install graph or trip the zero-runtime-dep,
> known-dep-names, lockfile-source, or release-age gates. Install and run it
> on its own.

## What it measures

For each framework, a minimal HTTP server exposing the same three endpoints:

| Endpoint            | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `GET /static`       | Static-route fast path. No params, no body, no validation.    |
| `GET /users/:id`    | One-segment dynamic param. Echoes the id back as JSON.        |
| `POST /echo`        | JSON body parsing + schema validation of `{ name: string }`.  |

Each server is hit by [autocannon](https://github.com/mcollina/autocannon) on
`localhost`:

- 1 warmup run (5s, 100 connections) — discarded.
- 3 measurement runs (10s each, 100 connections, 1 pipelining).
- Mean req/sec and p99 latency reported across the 3 runs.

The runner spawns each server as a child process, polls `GET /static` until
the server responds, runs autocannon, kills the process, then moves on. No
framework sees another's warmup.

## What it does NOT measure

- Cold start time / time-to-first-request.
- TLS termination.
- Anything beyond the local loopback (no real network).
- Production middleware stacks (compression, auth, logging) — each server is
  deliberately bare so router and request-pipeline cost dominate.
- Memory footprint.

If you need any of these, fork the runner.

## Why these scenarios

- **`GET /static`** — measures the router fast path. Most frameworks have a
  hash-map or radix-trie shortcut here.
- **`GET /users/:id`** — measures the dynamic-segment cost (trie walk,
  regex, or string scan) plus param extraction.
- **`POST /echo`** — measures body parsing + validation, which is where the
  "thin router" frameworks usually lose to "batteries-included" frameworks
  (and vice versa).

## Frameworks included

| Framework                 | Adapter / transport used                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| **DaloyJS**               | `@daloyjs/core/node` (sourced from this repo via `file:../..`)                           |
| **Hono**                  | `@hono/node-server`                                                                      |
| **Fastify**               | native                                                                                   |
| **Express v5**            | native                                                                                   |
| **Koa**                   | `@koa/router` + `koa-bodyparser`                                                         |
| **NestJS**                | `@nestjs/platform-fastify` (faster than the default Express platform — fairer to Nest)   |
| **Elysia**                | `@elysiajs/node` (Elysia is Bun-first; the Node adapter is the only cross-runtime path)  |
| **FeathersJS**            | `@feathersjs/koa` transport with a plain route (no service layer, kept fair)             |

Every server uses `JSON.stringify` / built-in body parsing only. No
framework-specific perf tricks (no Fastify response schema, no DaloyJS
typed-client client-side cache).

## Running

```bash
cd bench/cross-framework
pnpm install   # installs all framework deps in this folder only
node run.mjs   # ~5 min wall time for all 8 frameworks
```

To run a subset:

```bash
node run.mjs --only=daloy,fastify,hono
```

To change durations:

```bash
DURATION=20 CONNECTIONS=200 node run.mjs
```

## Output

`run.mjs` writes a `results.json` and prints a markdown table:

```
| Framework  | GET /static (req/s) | GET /users/:id (req/s) | POST /echo (req/s) | p99 (ms) /static |
| ---------- | ------------------: | ---------------------: | -----------------: | ---------------: |
| daloy      |             123,456 |                111,222 |             88,777 |             1.21 |
| hono       |                 ... |                    ... |                ... |              ... |
...
```

Reproducible: pin Node version (`.nvmrc`), pin lockfile, run on a quiet
machine with `--max-old-space-size` left at default.

## Honest caveats

- Microbenchmarks are **not production performance**. They flatter routers
  and punish any framework that does useful work (validation, OpenAPI,
  refuse-to-boot checks). DaloyJS's validation path adds cost that
  Express/Koa skip entirely on `POST /echo` because they don't validate.
- The numbers can shift ±10% between runs depending on CPU thermal state.
  Run twice if a number looks off.
- Elysia on `@elysiajs/node` is **not** representative of Elysia on Bun.
  Bun-native numbers will be much higher; that is a runtime story, not a
  framework story.
- NestJS on Fastify is the fast configuration; on Express (the default) it
  is meaningfully slower.

## Reproducing the README claim

The root [README.md](../../README.md#performance) currently quotes only the
in-process router micro-benchmark (`pnpm bench`, see
[bench/router.bench.ts](../router.bench.ts)). That number is **not**
comparable to the numbers produced here — `bench/router.bench.ts` measures
`Router.find()` in a tight loop, no HTTP, no body parsing, no JSON
serialization. Use this folder for cross-framework HTTP numbers.
