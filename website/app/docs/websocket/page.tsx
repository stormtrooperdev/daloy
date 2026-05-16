import { CodeBlock } from "../../../components/code-block"

import { buildMetadata } from "@/lib/seo"

export const metadata = buildMetadata({
  title: "WebSocket primitives (Node & Bun)",
  description:
    "Register typed WebSocket routes in DaloyJS with the same Bun-style handler shape running on both Node and Bun adapters. Includes the runtime-agnostic RFC 6455 frame protocol, `app.ws()` registration, `defineWebSocket()` helper, and graceful close semantics.",
  path: "/docs/websocket",
  keywords: [
    "WebSocket",
    "RFC 6455",
    "real-time",
    "Bun WebSocket",
    "Node WebSocket",
    "DaloyJS websocket",
  ],
  type: "article",
})

export default function Page() {
  return (
    <>
      <h1>WebSocket primitives</h1>
      <p>
        DaloyJS ships runtime-agnostic WebSocket primitives in{" "}
        <code>src/websocket.ts</code> (re-exported from{" "}
        <code>@daloyjs/core/websocket</code>) plus adapter wiring for{" "}
        <code>@daloyjs/core/node</code> and <code>@daloyjs/core/bun</code>. Both
        adapters accept the <strong>same handler shape</strong> — the Bun-style
        <code> open</code> / <code>message</code> / <code>close</code> /{" "}
        <code>drain</code> / <code>error</code> callbacks — so the same{" "}
        <code>app.ws(path, handler)</code> registration works on either runtime
        without changes.
      </p>
      <p>
        On Node the adapter only installs an <code>upgrade</code> listener when
        at least one WS route is registered, so apps that don&apos;t use
        WebSockets pay zero overhead. On Bun the adapter forwards to{" "}
        <code>Bun.serve</code>&apos;s native <code>websocket</code> config.
      </p>

      <h2>Quick start</h2>
      <CodeBlock
        code={`import { App } from "@daloyjs/core";
import { serve } from "@daloyjs/core/node";

const app = new App();

app.ws("/chat/:room", {
  open(conn, ctx) {
    conn.data = { user: ctx.query.user ?? "anon", room: ctx.params.room };
    conn.send(\`welcome \${(conn.data as { user: string }).user}\`);
  },
  message(conn, data, isBinary) {
    // Echo back, upper-cased for text frames
    conn.send(typeof data === "string" ? data.toUpperCase() : data, { binary: isBinary });
  },
  close(conn, code, reason) {
    // release any per-connection resources here
  },
});

serve(app, { port: 3000 });`}
      />

      <h2>Handler shape</h2>
      <p>
        Use <code>defineWebSocket()</code> for full type-inference on path
        params (<code>ctx.params</code>), query (<code>ctx.query</code>), and
        per-connection state (<code>conn.data</code>):
      </p>
      <CodeBlock
        code={`import { defineWebSocket } from "@daloyjs/core";

const chatHandler = defineWebSocket({
  open(conn, ctx) {
    // ctx.params is typed from the path pattern "/chat/:room"
    conn.data = { room: ctx.params.room, joinedAt: Date.now() };
  },
  message(conn, data) {
    conn.send(typeof data === "string" ? data : new Uint8Array(data as ArrayBuffer));
  },
  close(conn, code, reason) {
    // cleanup
  },
  error(conn, err) {
    // user error handler — does not affect close code
  },
  drain(conn) {
    // backpressure released
  },
});

app.ws("/chat/:room", chatHandler);`}
      />

      <h2>Connection API</h2>
      <p>
        The <code>WebSocketConnection</code> passed to your handlers mirrors the
        WHATWG <code>WebSocket</code> interface where it makes sense on the
        server side:
      </p>
      <ul>
        <li>
          <code>conn.readyState</code> — one of{" "}
          <code>WS_READY_STATE.CONNECTING / OPEN / CLOSING / CLOSED</code>.
        </li>
        <li>
          <code>conn.send(data, options?)</code> — send a text frame for{" "}
          <code>string</code>, or a binary frame for <code>Uint8Array</code> /{" "}
          <code>ArrayBuffer</code>. Pass <code>{`{ binary: true }`}</code> to
          force binary framing of a string.
        </li>
        <li>
          <code>conn.ping(data?)</code> / <code>conn.pong(data?)</code> —
          control frames; payload must be ≤ 125 bytes per RFC 6455.
        </li>
        <li>
          <code>conn.close(code?, reason?)</code> — graceful close (sends a
          CLOSE frame, fires your <code>close</code> handler, then closes the
          underlying socket).
        </li>
        <li>
          <code>conn.terminate()</code> — immediate transport-level close, no
          CLOSE frame.
        </li>
        <li>
          <code>conn.bufferedAmount</code>, <code>conn.protocol</code>,{" "}
          <code>conn.extensions</code>, <code>conn.binaryType</code>.
        </li>
        <li>
          <code>conn.data</code> — opaque per-connection slot for your app
          state.
        </li>
      </ul>

      <h2>Protocol negotiation & upgrade hook</h2>
      <p>
        Optional <code>beforeUpgrade(req, ctx)</code> runs after the path match
        but before the 101 response. Return a <code>Response</code> to reject
        (handy for auth or rate-limiting), or return a <code>string</code> to
        pick a subprotocol from <code>Sec-WebSocket-Protocol</code>:
      </p>
      <CodeBlock
        code={`app.ws("/api", {
  beforeUpgrade(req, ctx) {
    const token = ctx.headers["authorization"]?.replace(/^Bearer /, "");
    if (!token || !isValid(token)) {
      return new Response("unauthorized", { status: 401 });
    }
    // Pick a subprotocol the client offered
    const offered = (ctx.headers["sec-websocket-protocol"] ?? "").split(",").map((s) => s.trim());
    return offered.includes("daloy.v1") ? "daloy.v1" : undefined;
  },
  open(conn) {
    conn.send("ready");
  },
  message(conn, data) {
    conn.send(data);
  },
});`}
      />

      <h2>Graceful shutdown</h2>
      <p>
        The Node adapter tracks every upgraded socket. When <code>close()</code>{" "}
        is invoked (or the app receives <code>SIGTERM</code> /{" "}
        <code>SIGINT</code> with <code>handleSignals: true</code>), all active
        WebSocket sockets are destroyed before <code>server.close()</code>{" "}
        resolves so the process exits promptly even if clients linger.
      </p>

      <h2>Custom adapters</h2>
      <p>
        If you target a runtime other than Node or Bun, import the primitives
        directly from <code>@daloyjs/core/websocket</code>:
      </p>
      <CodeBlock
        code={`import {
  validateUpgrade,
  computeAcceptKey,
  FrameSink,
  encodeFrame,
  encodeSendPayload,
  encodeClosePayload,
  WS_OPCODE,
  WS_CLOSE_CODE,
  WS_READY_STATE,
} from "@daloyjs/core/websocket";`}
      />
      <p>
        <code>FrameSink</code> is a streaming RFC 6455 parser: feed it bytes via{" "}
        <code>sink.push(chunk)</code> and it dispatches <code>onMessage</code>{" "}
        (with reassembled payload + <code>isBinary</code> flag),{" "}
        <code>onPing</code>, <code>onPong</code>, <code>onClose</code>, and{" "}
        <code>onProtocolError</code>. UTF-8 validation on text frames is handled
        for you.
      </p>
    </>
  )
}
