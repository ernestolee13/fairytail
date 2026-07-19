#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  evaluateG012ReadmeVisual,
  G012_VISUAL_CONTRACT,
} from "../src/benchmark/g012-performance.mjs";

const runFile = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputRoot = join(root, "docs/assets/evidence");
const mode = process.argv[2] ?? "--write";
const viewport = { width: 1800, height: 1080 };

if (mode !== "--write" && mode !== "--verify") {
  throw new TypeError("Use --write or --verify");
}

const fixture = await buildFixture();
if (mode === "--write") {
  process.stdout.write(`${JSON.stringify(await writeEvidence(), null, 2)}\n`);
} else {
  process.stdout.write(`${JSON.stringify(await verifyEvidence(), null, 2)}\n`);
}

async function writeEvidence() {
  await mkdir(outputRoot, { recursive: true });
  const chromium = await chromiumBinary();
  const { stdout } = await runFile(chromium, ["--version"]);
  const paths = artifactPaths();
  const temporary = await mkdtemp(join(tmpdir(), "fairytail-readme-evidence-"));
  const htmlPath = join(temporary, "jargon-to-clarity.html");
  try {
    await writeFile(htmlPath, fixture.html, "utf8");
    await runFile(
      chromium,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        `--window-size=${viewport.width},${viewport.height}`,
        `--screenshot=${paths.png}`,
        pathToFileURL(htmlPath).href,
      ],
      { maxBuffer: 1024 * 1024 },
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }

  const terminalEvidenceBytes = await readFile(
    join(outputRoot, "terminal-evidence.json"),
  );
  const terminalEvidence = JSON.parse(terminalEvidenceBytes.toString("utf8"));
  const terminalScenarios = /** @type {Record<string, any>[]} */ (
    terminalEvidence.scenarios
  );
  const evidence = {
    schema_version: G012_VISUAL_CONTRACT.schema_version,
    evidence_id: G012_VISUAL_CONTRACT.evidence_id,
    synthetic_fixture: true,
    comparison_kind: G012_VISUAL_CONTRACT.comparison_kind,
    not_a_host_session_capture: true,
    same_read_only_scenario: true,
    model_calls: 0,
    model_output_tokens: 0,
    network_calls: 0,
    profile_fixture_kind: "synthetic-approved-labels",
    production_personalization_path_exercised: false,
    concepts: terminalEvidence.sample.concept_ids,
    canonical_fact_set_hashes: Object.fromEntries(
      terminalScenarios.map((scenario) => [
        scenario.concept_id,
        scenario.canonical_fact_set_hash,
      ]),
    ),
    approved_profile_labels: fixture.approvedProfileLabels,
    claim_boundary: G012_VISUAL_CONTRACT.claim_boundary,
    screenshot: {
      chromium_version: stdout.trim(),
      browser_distribution_pinned: false,
      viewport: `${viewport.width}x${viewport.height}`,
      jargon_sha256: hash(Buffer.from(fixture.jargon)),
      clarity_sha256: hash(Buffer.from(fixture.clarity)),
      html_sha256: hash(Buffer.from(fixture.html)),
      png_sha256: hash(await readFile(paths.png)),
    },
    source_pins: {
      "scripts/generate-g012-readme-evidence.mjs": hash(
        await readFile(fileURLToPath(import.meta.url)),
      ),
      "docs/assets/evidence/terminal-evidence.json": hash(
        terminalEvidenceBytes,
      ),
      "src/learning/terminal.mjs": hash(
        await readFile(join(root, "src/learning/terminal.mjs")),
      ),
      "src/analogy/personalized.mjs": hash(
        await readFile(join(root, "src/analogy/personalized.mjs")),
      ),
    },
  };
  await writeFile(paths.json, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  return {
    status: "generated",
    output: relative(root, paths.png),
    concepts: evidence.concepts.length,
    model_calls: 0,
    network_calls: 0,
    png_sha256: evidence.screenshot.png_sha256,
  };
}

async function verifyEvidence() {
  const paths = artifactPaths();
  const evidence = JSON.parse(await readFile(paths.json, "utf8"));
  const terminalEvidenceBytes = await readFile(
    join(outputRoot, "terminal-evidence.json"),
  );
  const terminalEvidence = JSON.parse(terminalEvidenceBytes.toString("utf8"));
  const terminalScenarios = /** @type {Record<string, any>[]} */ (
    terminalEvidence.scenarios
  );
  const expected = {
    jargon: Buffer.from(fixture.jargon),
    clarity: Buffer.from(fixture.clarity),
    html: Buffer.from(fixture.html),
  };
  if (!evaluateG012ReadmeVisual(evidence).passed) {
    throw new Error("G012 README evidence contract drift");
  }
  if (
    JSON.stringify(terminalEvidence.sample?.concept_ids) !==
      JSON.stringify(G012_VISUAL_CONTRACT.concepts) ||
    !Array.isArray(terminalScenarios) ||
    terminalScenarios.length !== G012_VISUAL_CONTRACT.concepts.length
  ) {
    throw new Error("G012 README evidence terminal concept drift");
  }
  const expectedCanonicalHashes = Object.fromEntries(
    terminalScenarios.map((scenario) => [
      scenario.concept_id,
      scenario.canonical_fact_set_hash,
    ]),
  );
  if (
    JSON.stringify(evidence.canonical_fact_set_hashes) !==
    JSON.stringify(expectedCanonicalHashes)
  ) {
    throw new Error("G012 README evidence canonical hash drift");
  }
  const expectedSourcePins = Object.fromEntries(
    await Promise.all(
      G012_VISUAL_CONTRACT.source_pins.map(async (path) => [
        path,
        hash(
          await readFile(
            path === "scripts/generate-g012-readme-evidence.mjs"
              ? fileURLToPath(import.meta.url)
              : join(root, path),
          ),
        ),
      ]),
    ),
  );
  if (
    JSON.stringify(evidence.source_pins) !== JSON.stringify(expectedSourcePins)
  ) {
    throw new Error("G012 README evidence source pin drift");
  }
  if (
    evidence.screenshot.jargon_sha256 !== hash(expected.jargon) ||
    evidence.screenshot.clarity_sha256 !== hash(expected.clarity) ||
    evidence.screenshot.html_sha256 !== hash(expected.html)
  ) {
    throw new Error("G012 README evidence transcript hash drift");
  }
  const png = await readFile(paths.png);
  if (
    hash(png) !== evidence.screenshot.png_sha256 ||
    png.length < 24 ||
    png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    png.readUInt32BE(16) !== viewport.width ||
    png.readUInt32BE(20) !== viewport.height
  ) {
    throw new Error("G012 README evidence PNG integrity drift");
  }
  return {
    status: "pass",
    fixture_hashes_recomputed: 3,
    png_integrity_verified: true,
    model_calls: 0,
    network_calls: 0,
  };
}

async function buildFixture() {
  const approvedProfileLabels = [
    ...G012_VISUAL_CONTRACT.approved_profile_labels,
  ];
  const jargon = finish([
    "JARGON-DENSE FORMATTER — SYNTHETIC",
    "",
    "The MCP host initializes a client connection to an MCP server.",
    "The server receives tools/call, exchanges an OAuth access token, and invokes an HTTP API endpoint.",
    "The API server process validates scope, runs a DBMS query, serializes a JSON response, and returns it through the MCP transport.",
    "",
    "Verify authN/authZ, token audience, endpoint schema, process state, query semantics, and protocol result framing.",
  ]);
  const clarity = finish([
    "FAIRYTAIL — SAME READ-ONLY SCENARIO",
    "",
    "Think of one restaurant workflow:",
    "",
    "1. AI app = kitchen manager deciding what information is needed",
    "2. MCP client = dedicated supplier line carrying one request",
    "3. MCP server = supplier receiving that request",
    "4. API endpoint = service counter with a fixed order format",
    "5. Access token = temporary station pass with limited scope",
    "6. Database = order ledger holding the task record",
    "",
    "FLOW",
    "The manager uses the supplier line → the supplier presents its limited pass at the service counter → the counter reads one entry from the order ledger → the result travels back on the same line.",
    "",
    "WHERE THE PICTURE STOPS",
    "MCP does not make a server trustworthy. An API follows schemas and failure rules, not human intent. A token can be copied or over-scoped. A database query can write unless it is constrained to read-only.",
    "",
    "BEFORE IT RUNS",
    "Confirm the MCP server and tool, API method and target, token audience and scope, read-only query, and the response evidence you expect.",
  ]);
  for (const term of [
    "MCP host",
    "MCP server",
    "OAuth access token",
    "HTTP API endpoint",
    "DBMS query",
  ]) {
    if (!jargon.includes(term)) throw new Error(`missing jargon term: ${term}`);
  }
  for (const label of approvedProfileLabels.slice(1)) {
    if (!clarity.toLowerCase().includes(label.toLowerCase())) {
      throw new Error(`missing approved profile label: ${label}`);
    }
  }
  return {
    approvedProfileLabels,
    jargon,
    clarity,
    html: html(jargon, clarity),
  };
}

/** @param {string} jargon @param {string} clarity */
function html(jargon, clarity) {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Fairytail: jargon to clarity</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; width: 1800px; height: 1080px; overflow: hidden; background: #f5f0e7; color: #18212d; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  main { padding: 48px 58px 44px; }
  header { display: flex; justify-content: space-between; align-items: end; margin-bottom: 27px; }
  h1 { margin: 0; font-size: 46px; letter-spacing: -1.5px; }
  .sub { margin-top: 8px; color: #5c6672; font-size: 19px; }
  .badge { border-radius: 999px; padding: 12px 18px; background: #153f36; color: #effff8; font-size: 17px; font-weight: 750; }
  .grid { display: grid; grid-template-columns: .85fr 1.15fr; gap: 26px; }
  .card { height: 885px; border-radius: 18px; overflow: hidden; background: #111820; border: 1px solid rgba(28, 35, 43, .18); box-shadow: 0 15px 38px rgba(45, 38, 29, .14); }
  .bar { height: 48px; display: flex; align-items: center; padding: 0 19px; background: #29313b; color: #d9e0e7; font: 650 15px ui-monospace, SFMono-Regular, Menlo, monospace; }
  .dots { color: #f2a261; letter-spacing: 5px; margin-right: 14px; }
  pre { margin: 0; height: 837px; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; padding: 25px 27px; color: #e9eff4; font: 17px/1.58 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .before { border-color: #8d6262; }
  .before .bar { background: #4b3033; color: #ffe7e4; }
  .before pre { color: #e8dfe0; }
  .after { border-color: #4a9b84; }
  .after .bar { background: #153f36; color: #ddfff3; }
  .after pre { font-size: 15.5px; line-height: 1.48; }
</style>
<main>
  <header>
    <div><h1>Same facts. One flow you can picture.</h1><div class="sub">Synthetic read-only scenario · not a host capture · no model or network call</div></div>
    <div class="badge">API · MCP · token · server · database → one familiar map</div>
  </header>
  <div class="grid">
    <section class="card before"><div class="bar"><span class="dots">●●●</span>Jargon-dense formatter · synthetic</div><pre>${escapeHtml(jargon)}</pre></section>
    <section class="card after"><div class="bar"><span class="dots">●●●</span>Fairytail · reviewed familiar flow</div><pre>${escapeHtml(clarity)}</pre></section>
  </div>
</main>
</html>
`;
}

function artifactPaths() {
  return {
    png: join(outputRoot, "jargon-to-clarity.png"),
    json: join(outputRoot, "jargon-to-clarity.json"),
  };
}

/** @returns {Promise<string>} */
async function chromiumBinary() {
  const candidates = /** @type {string[]} */ (
    [
      process.env.FAIRYTAIL_CHROMIUM_BIN,
      "/opt/homebrew/bin/chromium",
      "/usr/local/bin/chromium",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ].filter((value) => typeof value === "string" && value.length > 0)
  );
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next deterministic local browser candidate.
    }
  }
  throw new Error("A local Chromium binary is required for evidence capture");
}

/** @param {string[]} lines */
function finish(lines) {
  return `${lines.join("\n")}\n`;
}

/** @param {string} value */
function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** @param {Buffer} value */
function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}
