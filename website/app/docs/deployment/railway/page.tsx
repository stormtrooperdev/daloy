import Link from "next/link";

import { CodeBlock } from "@/components/code-block";
import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Deploy to Railway",
  description:
    "Deploy DaloyJS to Railway. Railway auto-detects from package.json; add an optional railway.json or railway.toml to pin the start command, health check, and pre-deploy migrations. Set TRUST_PROXY_HOPS=1 so the reverse-proxy guard accepts Railway's X-Forwarded-* headers instead of returning 500.",
  path: "/docs/deployment/railway",
  keywords: [
    "Deploy DaloyJS to Railway",
    "railway.json",
    "railway.toml",
    "Railpack builder",
    "Railway healthcheckPath",
    "Railway TRUST_PROXY_HOPS",
    "Railway behindProxy hops",
    "Railway X-Forwarded-For 500",
    "Railway RAILWAY_PUBLIC_DOMAIN OpenAPI server URL",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Railway</h1>
      <p>
        Railway auto-detects Node projects from <code>package.json</code>. A config file is{" "}
        <strong>optional</strong>; add one only when you want to pin the start command, set a
        health check, run pre-deploy migrations, or switch to a Dockerfile-based build.
      </p>

      <h2>When to choose Railway</h2>
      <ul>
        <li>You want the lowest-config push-and-it-runs experience on Node.</li>
        <li>You want managed Postgres, Redis, or MySQL in the same project.</li>
        <li>You like environment-per-PR with usage-based billing.</li>
      </ul>

      <h2>Server entrypoint</h2>
      <p>
        The scaffolded <code>create-daloy</code> templates already ship this as{" "}
        <code>src/index.ts</code> (the only file that opens a port). It builds the app from
        the pure <code>buildApp()</code> factory and starts the Node adapter:
      </p>
      <CodeBlock
        language="ts"
        code={`// src/index.ts
import { serve } from "@daloyjs/core/node";
import { buildApp } from "./build-app.ts";

const app = buildApp();
serve(app, { port: Number(process.env.PORT ?? 3000) });`}
      />

      <h2>railway.json</h2>
      <CodeBlock
        language="json"
        code={`{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "RAILPACK"
  },
  "deploy": {
    "startCommand": "node dist/index.js",
    "preDeployCommand": ["pnpm run migrate"],
    "healthcheckPath": "/healthz",
    "healthcheckTimeout": 300,
    "restartPolicyType": "ON_FAILURE"
  }
}`}
      />
      <p>Or, equivalently, <code>railway.toml</code>:</p>
      <CodeBlock
        language="toml"
        code={`[build]
builder = "RAILPACK"

[deploy]
startCommand = "node dist/index.js"
healthcheckPath = "/healthz"
healthcheckTimeout = 300`}
      />

      <h2>Deploy</h2>
      <CodeBlock
        language="bash"
        code={`pnpm dlx @railway/cli login
pnpm dlx @railway/cli link
pnpm dlx @railway/cli up`}
      />

      <h2>Trust Railway&apos;s edge proxy</h2>
      <p>
        Railway terminates TLS and proxies every request, adding{" "}
        <code>X-Forwarded-For</code> / <code>X-Forwarded-Proto</code> headers. In production
        DaloyJS <strong>refuses to trust forwarded headers until you declare the proxy
        posture</strong>: an app with no posture set returns{" "}
        <code>500 https://daloyjs.dev/errors/internal</code> on the first request that carries
        an <code>X-Forwarded-*</code> header (which, behind Railway, is every request). This is
        deliberate, a misconfigured proxy chain must not silently feed spoofable client IPs to
        rate-limiting, request-id propagation, and audit logs.
      </p>
      <p>
        Railway is exactly <strong>one</strong> proxy hop, so declare it. The scaffolded
        templates read <code>TRUST_PROXY_HOPS</code> into{" "}
        <code>behindProxy: {"{ hops: 1 }"}</code>, so set the service variable:
      </p>
      <CodeBlock
        language="bash"
        code={`pnpm dlx @railway/cli variables --set "TRUST_PROXY_HOPS=1"`}
      />
      <p>
        Now DaloyJS reads the real client IP from the right-most{" "}
        <code>X-Forwarded-For</code> entry and rejects spoofed extra hops, the guard is
        satisfied rather than disabled. If you put Cloudflare (or another proxy) in front of
        Railway, that is two hops, set <code>TRUST_PROXY_HOPS=2</code>. See the{" "}
        <Link href="/docs/deployment">deployment overview</Link> for the full posture matrix.
      </p>

      <h2>Public API URL</h2>
      <p>
        So the Scalar <em>Try it</em> panel and the OpenAPI <code>servers</code> entry point at
        your deployed origin instead of <code>localhost</code> (which the browser blocks under
        the <code>connect-src &apos;self&apos;</code> CSP), the templates resolve the server URL
        at runtime: <code>PUBLIC_URL</code>, then Railway&apos;s injected{" "}
        <code>RAILWAY_PUBLIC_DOMAIN</code>, then the local dev port. Railway sets{" "}
        <code>RAILWAY_PUBLIC_DOMAIN</code> automatically once the service has a domain, so this
        usually needs no extra config. Set <code>PUBLIC_URL</code> explicitly to pin a custom
        domain:
      </p>
      <CodeBlock
        language="bash"
        code={`pnpm dlx @railway/cli variables --set "PUBLIC_URL=https://api.example.com"`}
      />

      <h2>Gotchas</h2>
      <ul>
        <li>
          Don&apos;t override <code>PORT</code>. Railway injects it and the load balancer targets that
          port.
        </li>
        <li>
          Set <code>TRUST_PROXY_HOPS=1</code> or every route returns{" "}
          <code>500</code> in production (see above). It is the single most common
          first-deploy surprise.
        </li>
        <li>
          <code>healthcheckTimeout</code> is in seconds. Make it longer than your slowest
          legitimate startup.
        </li>
        <li>
          Use <code>preDeployCommand</code> for migrations so schema changes run before traffic
          shifts.
        </li>
      </ul>

      <h2>See also</h2>
      <ul>
        <li>
          <Link href="/docs/deployment">Deployment overview</Link>
        </li>
        <li>
          <Link href="/docs/adapters/node">Node adapter</Link>
        </li>
      </ul>
    </>
  );
}