/**
 * Registry-exfiltration / TLS-bypass / credential-injection CI gate
 * (Socket GemStuffer class).
 *
 * Socket's 2026-05-13 write-up
 * (https://socket.dev/blog/gemstuffer) documents the **GemStuffer**
 * campaign, in which a malicious Ruby script — using only the standard
 * library — exfiltrated scraped data by building a `.gem` archive in
 * `/tmp`, fabricating a credential file under a `HOME` override, and
 * publishing the archive directly to `rubygems.org/api/v1/gems` via a
 * hard-coded API key. SSL certificate verification was disabled to
 * suppress cert errors during the scraping phase. Variants that didn't
 * even shell out to `gem push` built the request by hand with
 * `Net::HTTP::Post`, defeating any "no shell-out" gate by staying inside
 * a single Ruby process.
 *
 * The same technique translates verbatim to a malicious Node package
 * that uses only `node:fs`, `node:os`, and the global `fetch`:
 *
 *   1. **TLS verification bypass** to scrape internal or victim-side
 *      endpoints without cert warnings —
 *      `process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"`, or an
 *      `https.Agent({ rejectUnauthorized: false })`, or a `fetch` /
 *      `tls.connect` option of `rejectUnauthorized: false`.
 *   2. **`HOME` / npm-credential-file mutation** to inject a publish
 *      token into a fabricated home directory and then run `npm publish`
 *      / `pnpm publish` (already blocked by `verify-no-remote-exec`'s
 *      `child_process` ban) OR to leak a token from the consumer's real
 *      `~/.npmrc` by reading `os.homedir() + "/.npmrc"`.
 *   3. **Direct POST to a package-registry publish endpoint** — the
 *      "skip-the-CLI" GemStuffer variant translated to Node would
 *      construct a `fetch("https://registry.npmjs.org/-/npm/v1/...",
 *      { method: "POST", body: tarball })` (or the equivalent for
 *      RubyGems, PyPI, crates.io, Hex.pm) inside the runtime source
 *      itself. No `child_process` is needed; the entire exfil pipeline
 *      runs inside one Node process using only stdlib + global `fetch`.
 *
 * Daloy's runtime source (`src/**`) MUST NOT do any of the above. This
 * gate refuses to merge a PR that adds:
 *
 *   - `rejectUnauthorized: false` (any object-literal property
 *     assigning the literal `false` to `rejectUnauthorized`) — used by
 *     `https`, `tls`, `node-fetch`, `undici`, etc.
 *   - `NODE_TLS_REJECT_UNAUTHORIZED` as an environment-variable mutation
 *     target (`process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"`).
 *   - `process.env.HOME = ...` mutation (GemStuffer's HOME redirect).
 *   - String literals referencing the publish path of any major package
 *     registry: `registry.npmjs.org/-/npm/v1/...`, `rubygems.org/api/v1`,
 *     `upload.pypi.org`, `crates.io/api/v1/crates/new`, `hex.pm/api/...`.
 *   - Reads of `~/.npmrc`, `~/.yarnrc`, `~/.netrc`, `~/.gem/credentials`
 *     (host credential files the malicious package would slurp).
 *
 * This gate is the regression net for the GemStuffer attack class.
 * Combined with `verify-no-remote-exec` (no `child_process` / no `vm` /
 * no `eval` / no `new Function` / no remote dynamic `import`), a
 * malicious republish of `@daloyjs/core` has no in-process exfiltration
 * channel: it cannot shell out to `npm publish`, it cannot fetch an
 * internal endpoint with cert verification disabled, and it cannot POST
 * a tarball to a registry endpoint directly from runtime code.
 *
 * Exit code:
 *   0 — no forbidden primitives found in `src/**`.
 *   1 — at least one was found; offending lines printed to stderr.
 *
 * ---
 *
 * **RATatouille / rand-user-agent extension (Aikido 2025-05-06, since 0.34.0):**
 * https://www.aikido.dev/blog/catching-a-rat-remote-access-trojian-rand-user-agent-supply-chain-compromise
 *
 * The malicious `rand-user-agent@{1.0.110, 2.0.83, 2.0.84}` publishes hid a
 * Remote Access Trojan inside `dist/index.js` whose decoded payload used
 * four pieces of tradecraft that don't trip the upstream `child_process` /
 * `vm` / `eval` / `new Function` / TLS-bypass gates:
 *
 *   1. `global['r'] = require` then `const c = global.r; c('child_process')`
 *      — aliased-require to bypass static `require('child_process')`
 *      regex detection.
 *   2. `module.paths.push(path.join(os.homedir(), '.node_modules',
 *      'node_modules'))` — manual NODE_PATH injection so the malware
 *      could `require('axios')` / `require('socket.io-client')` after
 *      side-installing them into a hidden `~/.node_modules` directory.
 *   3. A leading-dot `~/.node_modules` hidden install dir — never used
 *      by legitimate Node tooling (real `node_modules` has no leading
 *      dot) and a clean IOC.
 *   4. Hard-coded raw-IPv4 `http://` / `ws://` C2 URLs (the documented
 *      RATatouille C2 was `http://85.239.62.36:3306` for socket.io and
 *      `http://85.239.62.36:27017/u/f` for file exfil).
 *
 * Daloy's runtime source MUST NOT do any of these. Combined with the
 * existing `verify-no-remote-exec` ban on `child_process` / `vm` /
 * `eval` / `new Function` / remote dynamic `import()`, a malicious
 * republish of `@daloyjs/core` has no in-process channel left to land
 * a RATatouille-shape RAT — the aliased-require trick is moot when
 * there's no `child_process` to call through it, and side-loading a
 * fetched `axios` is moot when there's no `.node_modules` path
 * injection to make it resolvable.
 *
 * @since 0.50.0
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { relative } from "node:path";

const SRC_ROOT = new URL("../src/", import.meta.url);

export interface ForbiddenRegistryExfilCall {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly reason: string;
}

interface ForbiddenPattern {
  readonly re: RegExp;
  readonly reason: string;
  /** When true the pattern is checked against the line WITH string literals
   *  intact (so host-name string matches still work). When false it is
   *  checked against the line with string literals stripped (so a doc
   *  string mentioning the pattern doesn't trip). */
  readonly keepStrings: boolean;
}

/**
 * Patterns that must NEVER appear in `src/**`. Documented inline against
 * the GemStuffer TTPs they would enable in a Node port of the attack.
 */
const FORBIDDEN_PATTERNS: readonly ForbiddenPattern[] = [
  // ---- TLS verification bypass (GemStuffer's `VERIFY_NONE`) ----
  {
    re: /\brejectUnauthorized\s*:\s*false\b/,
    reason:
      "`rejectUnauthorized: false` disables TLS certificate validation (GemStuffer-class VERIFY_NONE); " +
      "use the system CA bundle and a real hostname instead",
    keepStrings: false,
  },
  {
    re: /\bNODE_TLS_REJECT_UNAUTHORIZED\b/,
    reason:
      "`NODE_TLS_REJECT_UNAUTHORIZED` mutation disables TLS certificate validation " +
      "process-wide (GemStuffer-class VERIFY_NONE); never set this from library code",
    keepStrings: true,
  },
  // ---- HOME / credential-file mutation (GemStuffer's HOME override) ----
  {
    // `process.env.HOME =` (assignment, not read). Use a negative
    // lookahead for `==` / `===` so equality comparisons don't trip.
    re: /\bprocess\.env\.HOME\s*=(?!=)/,
    reason:
      "`process.env.HOME = ...` redirects the home directory and is the GemStuffer " +
      "credential-injection primitive; library code must never mutate HOME",
    keepStrings: false,
  },
  // ---- Direct POST to a package-registry publish endpoint ----
  // The full publish-path literals below are the actual exfiltration
  // endpoints — a runtime mention of any of them inside `src/**` is a
  // strong IOC of the "POST tarball to registry from inside the
  // process" variant. The bare host names (e.g. just `registry.npmjs.org`)
  // are NOT blocked — clients legitimately reference registry hosts in
  // user-facing docs / error messages — only the publish API paths.
  {
    re: /registry\.npmjs\.org\/-\/npm\/v1\//,
    reason:
      "npm publish-API path in source can exfiltrate data as a tarball POST (GemStuffer class); " +
      "Daloy never publishes from runtime — remove this string",
    keepStrings: true,
  },
  {
    re: /rubygems\.org\/api\/v1\/gems\b/,
    reason:
      "RubyGems publish-API path in source can exfiltrate data as a `.gem` POST (GemStuffer class); " +
      "Daloy never publishes from runtime — remove this string",
    keepStrings: true,
  },
  {
    re: /upload\.pypi\.org\/legacy/,
    reason:
      "PyPI publish-API path in source can exfiltrate data as a wheel POST (GemStuffer class); " +
      "Daloy never publishes from runtime — remove this string",
    keepStrings: true,
  },
  {
    re: /crates\.io\/api\/v1\/crates\/new\b/,
    reason:
      "crates.io publish-API path in source can exfiltrate data as a crate POST (GemStuffer class); " +
      "Daloy never publishes from runtime — remove this string",
    keepStrings: true,
  },
  // ---- Reads of host credential files ----
  {
    re: /\/\.npmrc\b/,
    reason:
      "library code must not reference `~/.npmrc`; GemStuffer-class attacks slurp host npm tokens " +
      "from the user's home directory",
    keepStrings: true,
  },
  {
    re: /\/\.yarnrc(?:\.yml)?\b/,
    reason:
      "library code must not reference `~/.yarnrc` / `~/.yarnrc.yml`; GemStuffer-class attacks slurp " +
      "host yarn tokens from the user's home directory",
    keepStrings: true,
  },
  {
    re: /\/\.netrc\b/,
    reason:
      "library code must not reference `~/.netrc`; GemStuffer-class attacks slurp host HTTP " +
      "credentials from the user's home directory",
    keepStrings: true,
  },
  {
    re: /\/\.gem\/credentials\b/,
    reason:
      "library code must not reference `~/.gem/credentials`; this is the exact path GemStuffer " +
      "writes a fabricated RubyGems token to",
    keepStrings: true,
  },
  // ---- Lazarus / Jade Sleet npm campaign (Socket 2023-07-25, GitHub
  //      security alert) — paired-package token handoff via
  //      `~/.vscode/jsontoken` and a typosquat C2 host. See
  //      https://socket.dev/blog/social-engineering-campaign-npm-malware
  //      and https://github.blog/2023-07-18-security-alert-social-engineering-campaign-targets-technology-industry-employees/ ----
  {
    // Catches `/.vscode/`, `\\.vscode\\` (Windows path literals), etc.
    // Daloy core has no business touching the user's IDE config dir;
    // the Jade Sleet "first package writes token, second package
    // reads token" handoff is staged at `$HOME/.vscode/jsontoken`.
    re: /[\\/]\.vscode[\\/]/,
    reason:
      "library code must not reference `~/.vscode/` — Daloy never touches the user's IDE config " +
      "directory, and `$HOME/.vscode/jsontoken` is the exact path the Lazarus / Jade Sleet paired-package " +
      "npm campaign uses to hand off a token between its first-stage and second-stage packages " +
      "(https://socket.dev/blog/social-engineering-campaign-npm-malware)",
    keepStrings: true,
  },
  {
    // `npmjsregister.com` is the documented C2 host the Lazarus / Jade
    // Sleet packages POST scraped data to (`/checkupdate.php`,
    // `/getupdate.php`). Any mention in `src/**` is a hard IOC.
    re: /\bnpmjsregister\.com\b/i,
    reason:
      "library code must not reference `npmjsregister.com` — this is the documented Lazarus / Jade " +
      "Sleet npm-campaign C2 host (typosquat of `registry.npmjs.org`) used for `/checkupdate.php` and " +
      "`/getupdate.php` exfiltration endpoints (https://socket.dev/blog/social-engineering-campaign-npm-malware)",
    keepStrings: true,
  },
  // ---- RATatouille / rand-user-agent supply-chain compromise
  //      (Aikido 2025-05-06, https://www.aikido.dev/blog/catching-a-rat-remote-access-trojian-rand-user-agent-supply-chain-compromise) ----
  {
    // Aliased-require: `global.r = require`, `global['r'] = require`,
    // `globalThis.r = require`. RATatouille used `global['r'] = require`
    // then `const c = global.r; c('child_process')` to bypass any
    // gate that grep'd for the literal `require('child_process')`.
    // Library code has no legitimate reason to hand `require` to a
    // global; the module-level binding is always in scope.
    // Note: `keepStrings: false` strips string literals to `""`, so the
    // bracket-key alt accepts `[""]` (zero chars between the quotes)
    // to match `global["r"] = require` after stripping.
    re: /\b(?:global|globalThis)\s*(?:\.\s*[A-Za-z_$][\w$]*|\[\s*["'][^"']*["']\s*\])\s*=\s*require\b/,
    reason:
      "aliased-require (`global.X = require`) is the RATatouille obfuscation trick used to bypass " +
      "static `require('child_process')` detection; library code must call `require` directly so " +
      "gates like `verify-no-remote-exec` can see the module name",
    keepStrings: false,
  },
  {
    // Manual NODE_PATH injection. RATatouille pushed
    // `path.join(homedir, '.node_modules', 'node_modules')` onto
    // `module.paths` so a side-installed malicious `axios` /
    // `socket.io-client` became resolvable. Daloy core never mutates
    // module-resolution paths at runtime.
    re: /\bmodule\s*\.\s*paths\s*\.\s*(?:push|unshift|splice|fill)\b/,
    reason:
      "`module.paths.push(...)` injects extra NODE_PATH entries at runtime; this is the RATatouille " +
      "primitive for side-loading a fetched `axios` / `socket.io-client` from a hidden home-directory " +
      "install dir, and Daloy core never does this",
    keepStrings: false,
  },
  {
    // Leading-dot `.node_modules` hidden install dir under $HOME.
    // Real `node_modules` has no leading dot — this is a clean RAT
    // IOC for the "hide deps in $HOME/.node_modules" pattern.
    re: /(?:^|["'`/\\\s(=,])\.node_modules\b/,
    reason:
      "`.node_modules` (with a leading dot) is the RATatouille hidden install dir under `$HOME` used " +
      "to stash a fetched `axios` / `socket.io-client` for the RAT; real Node `node_modules` has no " +
      "leading dot — library code must never reference this path",
    keepStrings: true,
  },
  {
    // Hard-coded raw-IPv4 host in an `http(s)://` or `ws(s)://` URL.
    // RATatouille's C2 was `http://85.239.62.36:3306` (socket.io) and
    // `http://85.239.62.36:27017/u/f` (file upload). Loopback (`127.x`),
    // unspecified-bind (`0.0.0.0`), and `localhost` are allow-listed.
    re: /\b(?:https?|wss?):\/\/(?!127\.|0\.0\.0\.0\b|localhost\b)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
    reason:
      "raw-IPv4 `http(s)://` / `ws(s)://` URL in source is a DNS-less command-and-control IOC " +
      "(RATatouille used `http://85.239.62.36:3306`); use a real hostname (with TLS) or restrict " +
      "to `127.0.0.1` / `0.0.0.0` / `localhost`",
    keepStrings: true,
  },
  {
    // The documented RATatouille C2 IP literal, even when not in a URL
    // (e.g. stashed in a config variable for later string-concat into
    // a URL). Mirrors the npmjsregister.com IOC pattern above.
    re: /\b85\.239\.62\.36\b/,
    reason:
      "`85.239.62.36` is the documented RATatouille / rand-user-agent C2 host " +
      "(https://www.aikido.dev/blog/catching-a-rat-remote-access-trojian-rand-user-agent-supply-chain-compromise); " +
      "any reference in `src/**` is a hard IOC",
    keepStrings: true,
  },
];

const STRING_LITERAL_RE = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;

/**
 * Find the start index of a line comment (`//`) that is NOT inside a
 * string literal. Mirrors the helper in `verify-no-remote-exec.ts` so
 * URLs embedded in string literals (`"https://..."`) aren't mistakenly
 * truncated as line comments.
 */
function findLineCommentStart(s: string): number {
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      i++;
      continue;
    }
    if (inSingle) {
      if (c === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (c === '"') inDouble = false;
      continue;
    }
    if (inBacktick) {
      if (c === "`") inBacktick = false;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      continue;
    }
    if (c === "`") {
      inBacktick = true;
      continue;
    }
    if (c === "/" && s[i + 1] === "/") return i;
  }
  return -1;
}

export function findForbiddenRegistryExfilCalls(
  file: string,
  source: string,
): readonly ForbiddenRegistryExfilCall[] {
  const out: ForbiddenRegistryExfilCall[] = [];
  const lines = source.split(/\r?\n/);
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    let working = raw;
    if (inBlockComment) {
      const end = working.indexOf("*/");
      if (end < 0) continue;
      working = working.slice(end + 2);
      inBlockComment = false;
    }
    const blockOpen = working.lastIndexOf("/*");
    const blockClose = working.lastIndexOf("*/");
    if (blockOpen >= 0 && blockClose < blockOpen) {
      working = working.slice(0, blockOpen);
      inBlockComment = true;
    }
    // Strip inline block comments (`/* ... */` on the same line) before
    // the line-comment scan so a token inside an inline block comment
    // does not trip the gate.
    working = working.replace(/\/\*[\s\S]*?\*\//g, " ");
    const lineCommentIndex = findLineCommentStart(working);
    const noComments = lineCommentIndex >= 0 ? working.slice(0, lineCommentIndex) : working;
    if (noComments.trim().length === 0) continue;

    const codeOnly = noComments.replace(STRING_LITERAL_RE, '""');
    for (const pattern of FORBIDDEN_PATTERNS) {
      const haystack = pattern.keepStrings ? noComments : codeOnly;
      if (pattern.re.test(haystack)) {
        out.push({ file, line: i + 1, text: raw.trim(), reason: pattern.reason });
        break;
      }
    }
  }
  return out;
}

async function* walk(dir: URL): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    if (entry.isDirectory()) {
      yield* walk(child);
    } else if (entry.isFile() && /\.(?:m?ts|m?js)$/.test(entry.name)) {
      yield child.pathname;
    }
  }
}

async function main(): Promise<void> {
  let total = 0;
  try {
    await stat(SRC_ROOT);
  } catch (err) {
    console.error(
      `verify-no-registry-exfiltration: cannot stat src/: ${(err as Error).message}`,
    );
    process.exitCode = 1;
    return;
  }
  for await (const absolute of walk(SRC_ROOT)) {
    const rel = "src/" + relative(SRC_ROOT.pathname, absolute);
    const text = await readFile(absolute, "utf8");
    const findings = findForbiddenRegistryExfilCalls(rel, text);
    for (const f of findings) {
      console.error(
        `${f.file}:${f.line}: forbidden registry-exfiltration primitive (${f.reason}): ${f.text}`,
      );
      total++;
    }
  }
  if (total > 0) {
    console.error(
      `verify-no-registry-exfiltration: ${total} forbidden primitive${total === 1 ? "" : "s"} found. ` +
        "Core source must not disable TLS verification, mutate HOME, reference host credential " +
        "files, include package-registry publish-API paths, reference `~/.vscode/` (the Lazarus / " +
        "Jade Sleet paired-package token-handoff dir), name the `npmjsregister.com` C2 host, alias " +
        "`require` through a `global.*` binding, mutate `module.paths`, reference a `.node_modules` " +
        "hidden install dir, or embed raw-IPv4 `http(s)://` / `ws(s)://` URLs / the documented " +
        "RATatouille C2 IP `85.239.62.36`. These are the runtime primitives the GemStuffer, Lazarus / " +
        "Jade Sleet, and RATatouille / rand-user-agent classes of supply-chain attack use to scrape " +
        "and exfiltrate data. See https://socket.dev/blog/gemstuffer, " +
        "https://socket.dev/blog/social-engineering-campaign-npm-malware, and " +
        "https://www.aikido.dev/blog/catching-a-rat-remote-access-trojian-rand-user-agent-supply-chain-compromise.",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("verify-no-registry-exfiltration.ts")) {
  await main();
}
