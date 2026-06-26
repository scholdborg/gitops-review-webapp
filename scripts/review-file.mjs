#!/usr/bin/env node
// review-file.mjs <path>
// Targeted, file-type-aware checks on a SINGLE edited file. This is what makes
// local-review more than a blanket scan: it looks closely at whatever Claude
// just touched.
//
// For JavaScript it runs the REAL ESLint engine (flat config in
// eslint.config.js). For everything else it uses lightweight text checks.
//
// Severity:
//   ERROR  -> high severity (merge markers, ESLint errors). Exit code 1.
//   warn   -> advisory only. Does not affect exit code.
//
// Prints a short report and exits 1 if any ERROR-level finding exists, else 0.

import { existsSync, readFileSync, statSync } from "node:fs";
import { extname } from "node:path";

const file = process.argv[2];
if (!file || !existsSync(file)) process.exit(0);

let content;
try {
  content = readFileSync(file, "utf8");
} catch {
  process.exit(0); // binary / unreadable — nothing to do
}

const lines = content.split(/\r?\n/);
const ext = extname(file).toLowerCase();
const at = (i) => `line ${i + 1}`;

const errors = [];
const warnings = [];

// --- checks for any text file -----------------------------------------------
lines.forEach((l, i) => {
  if (/^(<{7}|={7}|>{7})(\s|$)/.test(l)) errors.push(`merge conflict marker (${at(i)})`);
});

lines.forEach((l, i) => {
  const m = l.match(/\b(TODO|FIXME|XXX|HACK)\b/);
  if (m) warnings.push(`unfinished-work marker "${m[1]}" (${at(i)})`);
});

let trailing = 0;
let longLines = 0;
lines.forEach((l) => {
  if (/[ \t]+$/.test(l)) trailing++;
  if (l.length > 120) longLines++;
});
if (trailing) warnings.push(`${trailing} line(s) with trailing whitespace`);
if (longLines) warnings.push(`${longLines} line(s) longer than 120 chars`);

// --- JavaScript: run the real ESLint engine ---------------------------------
if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
  try {
    const { ESLint } = await import("eslint");
    const eslint = new ESLint();
    const results = await eslint.lintFiles([file]);
    for (const res of results) {
      for (const msg of res.messages) {
        const where = msg.line ? ` (line ${msg.line})` : "";
        const rule = msg.ruleId ? `${msg.ruleId}: ` : "";
        const label = `eslint ${rule}${msg.message}${where}`;
        if (msg.severity === 2) errors.push(label);
        else warnings.push(label);
      }
    }
  } catch (e) {
    // ESLint not installed (e.g. fresh clone before `npm install`) — degrade.
    warnings.push(`eslint unavailable (${e && e.code ? e.code : "skipped"})`);
  }
}

// --- HTML -------------------------------------------------------------------
if (ext === ".html" || ext === ".htm") {
  for (const tag of content.match(/<img\b[^>]*>/gi) || []) {
    if (!/\balt\s*=/.test(tag)) warnings.push(`<img> without alt attribute: ${tag.slice(0, 48)}…`);
  }
  if (!/lang\s*=/.test(content.match(/<html\b[^>]*>/i)?.[0] || "")) {
    warnings.push(`<html> tag has no lang attribute`);
  }
}

// --- size -------------------------------------------------------------------
try {
  const kb = statSync(file).size / 1024;
  if (kb > 200) warnings.push(`large file: ${kb.toFixed(0)} KB`);
} catch {
  /* ignore */
}

// --- report -----------------------------------------------------------------
const out = [];
out.push(`file review: ${file}`);
if (!errors.length && !warnings.length) {
  out.push("  clean — no findings");
}
for (const e of errors) out.push(`  ERROR  ${e}`);
for (const w of warnings) out.push(`  warn   ${w}`);
console.log(out.join("\n"));

process.exit(errors.length ? 1 : 0);
