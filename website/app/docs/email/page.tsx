import Link from "next/link";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Email integrations for DaloyJS",
  description:
    "Send transactional and marketing email from a DaloyJS API using AWS SES, SendGrid, Resend, Postmark, Mailgun, or Mailtrap. Compares runtime support, SDK style, and best-fit use cases.",
  path: "/docs/email",
  keywords: [
    "DaloyJS email",
    "transactional email Node.js",
    "AWS SES DaloyJS",
    "SendGrid DaloyJS",
    "Resend DaloyJS",
    "Postmark DaloyJS",
    "Mailgun DaloyJS",
    "Mailtrap DaloyJS",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>Email integrations</h1>
      <p>
        DaloyJS doesn&apos;t ship its own email transport. Send mail by registering a small{" "}
        <Link href="/docs/plugins">plugin</Link> that decorates <code>app.state</code> with a
        provider client, then call it from your route handlers. The pages in this section show
        how to wire up the six most common transactional email providers using their official
        Node SDKs.
      </p>

      <h2>Supported providers</h2>
      <ul>
        <li>
          <Link href="/docs/email/aws-ses">AWS SES (SESv2)</Link> — pay-as-you-go SMTP/HTTP at AWS
          scale via <code>@aws-sdk/client-sesv2</code>. Best fit when you already run on AWS or
          need the cheapest per-message price.
        </li>
        <li>
          <Link href="/docs/email/sendgrid">SendGrid</Link> — Twilio&apos;s established sender via{" "}
          <code>@sendgrid/mail</code>. Good for high-volume marketing plus transactional.
        </li>
        <li>
          <Link href="/docs/email/resend">Resend</Link> — modern, developer-first API via the{" "}
          <code>resend</code> SDK. Great DX, React Email templating, edge-friendly.
        </li>
        <li>
          <Link href="/docs/email/postmark">Postmark</Link> — transactional-first delivery via the{" "}
          <code>postmark</code> SDK. Known for very high inbox placement.
        </li>
        <li>
          <Link href="/docs/email/mailgun">Mailgun</Link> — Sinch-backed sender via{" "}
          <code>mailgun.js</code>. Strong validation, routing, and EU/US regions.
        </li>
        <li>
          <Link href="/docs/email/mailtrap">Mailtrap</Link> — sandbox + production sending via the{" "}
          <code>mailtrap</code> SDK. Switch between a test inbox and live sending with a single
          flag.
        </li>
      </ul>

      <h2>Runtime compatibility at a glance</h2>
      <p>
        Most provider SDKs are HTTPS-based and work on every runtime DaloyJS targets, but a few
        depend on Node-only APIs (filesystem, TCP, AWS Signature V4 with NodeHttpHandler) and
        won&apos;t run on Cloudflare Workers or Vercel Edge without adjustments.
      </p>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>Node / Bun / Deno</th>
            <th>Cloudflare Workers</th>
            <th>Vercel Edge</th>
            <th>AWS Lambda</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>AWS SES (SESv2)</td>
            <td>Yes</td>
            <td>With <code>fetch</code> handler &amp; static creds</td>
            <td>With <code>fetch</code> handler &amp; static creds</td>
            <td>Yes (IAM role)</td>
          </tr>
          <tr>
            <td>SendGrid</td>
            <td>Yes</td>
            <td>Use Web API via fetch (SDK is Node-oriented)</td>
            <td>Use Web API via fetch</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>Resend</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>Postmark</td>
            <td>Yes</td>
            <td>Call REST via fetch (SDK uses axios)</td>
            <td>Call REST via fetch</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>Mailgun</td>
            <td>Yes</td>
            <td>Yes (enable <code>useFetch: true</code> in v12.1+)</td>
            <td>Yes (<code>useFetch: true</code>)</td>
            <td>Yes</td>
          </tr>
          <tr>
            <td>Mailtrap</td>
            <td>Yes</td>
            <td>Call REST via fetch (SDK uses Node features)</td>
            <td>Call REST via fetch</td>
            <td>Yes</td>
          </tr>
        </tbody>
      </table>

      <h2>Common pattern</h2>
      <p>
        Every guide in this section follows the same three steps: install the SDK, register a
        DaloyJS plugin that puts the client on <code>app.state</code>, then call it inside a
        validated route handler. The plugin shape is intentionally tiny so you can swap providers
        without touching business logic:
      </p>
      <pre>
        <code>{`// src/plugins/email.ts
import type { App } from "@daloyjs/core";

export interface EmailMessage {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<{ id: string }>;
}

export function emailPlugin(sender: EmailSender) {
  return {
    name: "email",
    register(app: App) {
      app.decorate("email", sender);
    },
  };
}

declare module "@daloyjs/core" {
  interface AppState {
    email: EmailSender;
  }
}`}</code>
      </pre>
      <p>
        Each provider page implements <code>EmailSender</code> with the official SDK so the rest
        of your app stays provider-agnostic.
      </p>

      <h2>Security checklist</h2>
      <ul>
        <li>
          <strong>Keep API keys in environment variables.</strong> Never commit them. Use AWS IAM
          roles on Lambda and platform-managed secrets on Vercel, Cloudflare, Fly, and Render.
        </li>
        <li>
          <strong>Verify your sending domain.</strong> Add SPF, DKIM, and DMARC records before
          going live; every provider here rejects unverified senders in production.
        </li>
        <li>
          <strong>Validate inputs.</strong> Treat the <code>to</code>, <code>subject</code>, and
          body as untrusted. Use <Link href="/docs/validation">DaloyJS validation</Link> with{" "}
          <code>z.string().email()</code> to block header injection.
        </li>
        <li>
          <strong>Rate-limit the send route.</strong> Use the built-in{" "}
          <Link href="/docs/security">rateLimit middleware</Link> (or the{" "}
          <Link href="/docs/security/rate-limit-redis">Redis store</Link>) on any endpoint that
          triggers email so abuse can&apos;t drive your bill or reputation down.
        </li>
        <li>
          <strong>Verify provider webhooks.</strong> If you process bounces, complaints, or opens,
          verify the signature on every incoming webhook before trusting its payload.
        </li>
      </ul>
    </>
  );
}
