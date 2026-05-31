/**
 * Built-in API documentation handlers.
 *
 * Scalar and Swagger UI helpers serve a single HTML page that loads the spec
 * at `specUrl` and fetches UI assets from a CDN by default. No build step,
 * no extra deps.
 *
 * (You can self-host the assets if your CSP forbids CDNs.)
 */

/** JSON primitive accepted by {@link ScalarReferenceConfiguration}. */
export type ScalarJsonPrimitive = string | number | boolean | null;
/** Recursive JSON value accepted by Scalar configuration fields. */
export type ScalarJsonValue =
  | ScalarJsonPrimitive
  | ScalarJsonValue[]
  | { [key: string]: ScalarJsonValue | undefined };

/** Built-in Scalar API Reference color theme names. */
export type ScalarTheme =
  | "alternate"
  | "default"
  | "moon"
  | "purple"
  | "solarized"
  | "bluePlanet"
  | "saturn"
  | "kepler"
  | "mars"
  | "deepSpace"
  | "laserwave"
  | "none";

/**
 * Subset of Scalar API Reference configuration safe to serialize from the
 * server (function callbacks and inline `spec` are intentionally excluded).
 *
 * Forwarded verbatim as the `data-configuration` attribute on the Scalar
 * script tag.
 */
export interface ScalarReferenceConfiguration {
  [key: string]: ScalarJsonValue | undefined;
  theme?: ScalarTheme;
  customCss?: string;
  darkMode?: boolean;
  forceDarkModeState?: "dark" | "light";
  withDefaultFonts?: boolean;
  favicon?: string;
  layout?: "modern" | "classic";
  hideClientButton?: boolean;
  hideDarkModeToggle?: boolean;
  hideModels?: boolean;
  hideSearch?: boolean;
  hideTestRequestButton?: boolean;
  showOperationId?: boolean;
  showSidebar?: boolean;
  showDeveloperTools?: "always" | "localhost" | "never";
  defaultOpenFirstTag?: boolean;
  defaultOpenAllTags?: boolean;
  expandAllModelSections?: boolean;
  expandAllResponses?: boolean;
  documentDownloadType?: "json" | "yaml" | "both" | "direct" | "none";
  operationTitleSource?: "summary" | "path";
  orderRequiredPropertiesFirst?: boolean;
  orderSchemaPropertiesBy?: "alpha" | "preserve";
  searchHotKey?: string;
  baseServerURL?: string;
  proxyUrl?: string;
  oauth2RedirectUri?: string;
  persistAuth?: boolean;
  telemetry?: boolean;
  tagsSorter?: "alpha";
  operationsSorter?: "alpha" | "method";
  authentication?: { [key: string]: ScalarJsonValue | undefined };
  defaultHttpClient?: { [key: string]: ScalarJsonValue | undefined };
  metaData?: { [key: string]: ScalarJsonValue | undefined };
  mcp?: { [key: string]: ScalarJsonValue | undefined };
  pathRouting?: { [key: string]: ScalarJsonValue | undefined };
  servers?: ScalarJsonValue[];
  content?: never;
  fetch?: never;
  generateHeadingSlug?: never;
  generateModelSlug?: never;
  generateOperationSlug?: never;
  generateTagSlug?: never;
  generateWebhookSlug?: never;
  onBeforeRequest?: never;
  onDocumentSelect?: never;
  onLoaded?: never;
  onRequestSent?: never;
  onServerChange?: never;
  onShowMore?: never;
  onSidebarClick?: never;
  onSpecUpdate?: never;
  plugins?: never;
  redirect?: never;
  sources?: never;
  spec?: never;
  url?: never;
}

/**
 * Override CDN URLs and pin Subresource Integrity (SRI) hashes for the docs
 * UI assets.
 *
 * Supplying an `*Integrity` value emits an `integrity="…"` attribute plus a
 * `crossorigin` attribute on the matching `<script>` / `<link>` tag so the
 * browser refuses to execute a CDN asset whose bytes don't match the pinned
 * hash. SRI is only meaningful against a **version-pinned** URL
 * (e.g. `…/@scalar/api-reference@1.25.0`); pair each integrity hash with a
 * pinned `*Url`, since the framework's default URLs intentionally track the
 * latest upstream release and therefore cannot carry a stable hash.
 *
 * @since 0.37.0
 */
export interface DocsAssetOptions {
  /** Override the Scalar API Reference bundle URL (useful for self-hosting). */
  scalarScriptUrl?: string;
  /**
   * SRI hash for {@link scalarScriptUrl}. One or more space-separated
   * `sha256-`/`sha384-`/`sha512-` base64 digests. Invalid values throw.
   *
   * @since 0.37.0
   */
  scalarScriptIntegrity?: string;
  /** Override the Swagger UI stylesheet URL (useful for self-hosting). */
  swaggerUiCssUrl?: string;
  /**
   * SRI hash for {@link swaggerUiCssUrl}. One or more space-separated
   * `sha256-`/`sha384-`/`sha512-` base64 digests. Invalid values throw.
   *
   * @since 0.37.0
   */
  swaggerUiCssIntegrity?: string;
  /** Override the Swagger UI bundle URL (useful for self-hosting). */
  swaggerUiBundleUrl?: string;
  /**
   * SRI hash for {@link swaggerUiBundleUrl}. One or more space-separated
   * `sha256-`/`sha384-`/`sha512-` base64 digests. Invalid values throw.
   *
   * @since 0.37.0
   */
  swaggerUiBundleIntegrity?: string;
  /**
   * `crossorigin` attribute value emitted alongside any pinned integrity
   * hash. SRI on a cross-origin asset requires CORS, so this defaults to
   * `"anonymous"`; use `"use-credentials"` only when the asset host needs
   * credentialed requests.
   *
   * @since 0.37.0
   */
  crossOrigin?: "anonymous" | "use-credentials";
}

/** Shared options for {@link scalarHtml} and {@link swaggerUiHtml}. */
export interface DocsOptions {
  /** Absolute or relative URL of the OpenAPI document to render. */
  specUrl: string;
  /** `<title>` of the generated HTML page. */
  title?: string;
  /**
   * Override CDN URLs and pin SRI hashes for the docs UI assets (useful for
   * self-hosting or supply-chain hardening). See {@link DocsAssetOptions}.
   */
  assets?: DocsAssetOptions;
  /** CSP `nonce` to apply to inline/script tags; must match the response CSP. */
  scriptNonce?: string;
}

/** Options for {@link scalarHtml}; adds Scalar-specific UI configuration. */
export interface ScalarHtmlOptions extends DocsOptions {
  /** Forwarded to the Scalar `<script id="api-reference">` tag. */
  configuration?: ScalarReferenceConfiguration;
}

/** Options for {@link docsContentSecurityPolicy}. */
export interface DocsContentSecurityPolicyOptions {
  /** Extra origins to allow for `script-src` / `style-src` (defaults to jsDelivr). */
  assetOrigins?: string[];
  /** When set, allows nonce-protected inline scripts instead of `'unsafe-inline'`. */
  scriptNonce?: string;
  /** When `false`, omits `'unsafe-inline'` from `style-src`. Defaults to `true`. */
  allowInlineStyles?: boolean;
}

/** Options for {@link htmlResponse}. */
export interface HtmlResponseOptions extends DocsContentSecurityPolicyOptions {
  /** Override the computed `content-security-policy` header verbatim. */
  contentSecurityPolicy?: string;
}

const JSDELIVR_ORIGIN = "https://cdn.jsdelivr.net";

/**
 * Matches a single Subresource Integrity digest: a `sha256-`/`sha384-`/
 * `sha512-` prefix followed by standard base64 (with up to two `=` pads).
 * Linear-time / ReDoS-safe (no nested or overlapping quantifiers).
 */
const SRI_HASH = /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/;

function nonceAttr(nonce: string | undefined): string {
  return nonce ? ` nonce="${escapeHtml(nonce)}"` : "";
}

/**
 * Build the `integrity`/`crossorigin` attribute fragment for a docs asset.
 *
 * Returns an empty string when no `integrity` value is supplied. When one is
 * supplied it is validated as one or more space-separated SRI digests and a
 * `crossorigin` attribute (default `"anonymous"`) is emitted alongside it.
 * A malformed integrity value throws a {@link TypeError} so a typo fails
 * loudly instead of silently shipping a docs page with no SRI protection.
 *
 * @throws {TypeError} when `integrity` is provided but is not a valid SRI value.
 */
function integrityAttr(
  integrity: string | undefined,
  crossOrigin: DocsAssetOptions["crossOrigin"],
): string {
  if (integrity === undefined) return "";
  const tokens = integrity.trim().split(/\s+/);
  if (integrity.trim() === "" || tokens.some((t) => !SRI_HASH.test(t))) {
    throw new TypeError(
      `Invalid Subresource Integrity value: ${JSON.stringify(integrity)}. ` +
        `Expected one or more space-separated "sha256-"/"sha384-"/"sha512-" base64 hashes.`,
    );
  }
  const co = crossOrigin ?? "anonymous";
  return ` integrity="${escapeHtml(integrity.trim())}" crossorigin="${escapeHtml(co)}"`;
}

/**
 * Render a Scalar API Reference HTML page that loads `opts.specUrl`.
 *
 * The output is a single HTML document with configurable external assets;
 * pair it with {@link htmlResponse} (or your own `Response`) and serve from
 * any route.
 */
export function scalarHtml(opts: ScalarHtmlOptions): string {
  const title = escapeHtml(opts.title ?? "API Reference");
  const url = escapeHtml(opts.specUrl);
  const scriptUrl = escapeHtml(
    opts.assets?.scalarScriptUrl ??
      `${JSDELIVR_ORIGIN}/npm/@scalar/api-reference`,
  );
  const scriptSri = integrityAttr(
    opts.assets?.scalarScriptIntegrity,
    opts.assets?.crossOrigin,
  );
  const nonce = nonceAttr(opts.scriptNonce);
  const configuration = scalarConfigurationAttr(
    opts.specUrl,
    opts.configuration,
  );
  return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
</head><body>
<script id="api-reference" data-url="${url}"${configuration}${nonce}></script>
<script src="${scriptUrl}"${scriptSri}${nonce}></script>
</body></html>`;
}

/**
 * Render a Swagger UI HTML page that loads `opts.specUrl`. Same usage as
 * {@link scalarHtml} but emits the classic Swagger UI bundle.
 */
export function swaggerUiHtml(opts: DocsOptions): string {
  const title = escapeHtml(opts.title ?? "API Docs");
  const url = escapeHtml(opts.specUrl);
  const cssUrl = escapeHtml(
    opts.assets?.swaggerUiCssUrl ??
      `${JSDELIVR_ORIGIN}/npm/swagger-ui-dist/swagger-ui.css`,
  );
  const bundleUrl = escapeHtml(
    opts.assets?.swaggerUiBundleUrl ??
      `${JSDELIVR_ORIGIN}/npm/swagger-ui-dist/swagger-ui-bundle.js`,
  );
  const cssSri = integrityAttr(
    opts.assets?.swaggerUiCssIntegrity,
    opts.assets?.crossOrigin,
  );
  const bundleSri = integrityAttr(
    opts.assets?.swaggerUiBundleIntegrity,
    opts.assets?.crossOrigin,
  );
  const nonce = nonceAttr(opts.scriptNonce);
  return `<!doctype html>
<html><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<link rel="stylesheet" href="${cssUrl}"${cssSri} />
</head><body>
<div id="swagger"></div>
<script src="${bundleUrl}"${bundleSri}${nonce}></script>
<script${nonce}>window.onload=()=>SwaggerUIBundle({url:"${url}",dom_id:"#swagger"});</script>
</body></html>`;
}

/**
 * Build a Content-Security-Policy string compatible with the docs HTML
 * produced by {@link scalarHtml} / {@link swaggerUiHtml}.
 *
 * Allows `'self'` plus the listed `assetOrigins` (default: jsDelivr) and
 * either `'unsafe-inline'` or the provided `scriptNonce` for scripts.
 */
export function docsContentSecurityPolicy(
  opts: DocsContentSecurityPolicyOptions = {},
): string {
  const assetOrigins = opts.assetOrigins ?? [JSDELIVR_ORIGIN];
  const scriptSrc = ["'self'", ...assetOrigins];
  if (opts.scriptNonce) scriptSrc.push(`'nonce-${opts.scriptNonce}'`);
  else scriptSrc.push("'unsafe-inline'");

  const styleSrc = ["'self'", ...assetOrigins];
  if (opts.allowInlineStyles !== false) styleSrc.push("'unsafe-inline'");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    `style-src ${styleSrc.join(" ")}`,
    "img-src 'self' data: https:",
    "connect-src 'self'",
  ].join("; ");
}

/**
 * Wrap a docs HTML string in a `Response` with safe defaults:
 * `text/html` content type, `nosniff`, `no-referrer`, and a CSP from
 * {@link docsContentSecurityPolicy} (or a caller-supplied override).
 */
export function htmlResponse(
  html: string,
  opts: HtmlResponseOptions = {},
): Response {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        opts.contentSecurityPolicy ??
        docsContentSecurityPolicy({
          assetOrigins: opts.assetOrigins,
          scriptNonce: opts.scriptNonce,
          allowInlineStyles: opts.allowInlineStyles,
        }),
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

function scalarConfigurationAttr(
  specUrl: string,
  configuration: ScalarReferenceConfiguration | undefined,
): string {
  if (!configuration) return "";
  const {
    content: _content,
    fetch: _fetch,
    plugins: _plugins,
    sources: _sources,
    spec: _spec,
    url: _url,
    ...uiConfiguration
  } = configuration;
  return ` data-configuration='${escapeHtml(JSON.stringify({ ...uiConfiguration, url: specUrl }))}'`;
}
