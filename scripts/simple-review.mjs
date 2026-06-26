#!/usr/bin/env node
// Simple deterministic "code review".
// Exits non-zero if any check fails so CI and hooks can gate on it.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();

let failures = 0;
const lines = [];

function pass(msg) {
  lines.push(`  PASS  ${msg}`);
}

function fail(msg) {
  failures++;
  lines.push(`  FAIL  ${msg}`);
}

// --- 1. Required files exist -------------------------------------------------
const requiredFiles = [
  "public/index.html",
  "src/main.js",
  "src/style.css",
];

for (const rel of requiredFiles) {
  if (existsSync(join(root, rel))) {
    pass(`required file present: ${rel}`);
  } else {
    fail(`required file missing: ${rel}`);
  }
}

// --- 2. index.html has a <title> --------------------------------------------
const indexPath = join(root, "public/index.html");
if (existsSync(indexPath)) {
  const html = readFileSync(indexPath, "utf8");
  if (/<title>\s*\S[\s\S]*?<\/title>/i.test(html)) {
    pass("public/index.html contains a non-empty <title>");
  } else {
    fail("public/index.html is missing a <title>");
  }
}

// --- 3. No obvious secrets in scanned project files --------------------------
// Patterns to flag. TOKEN= and password= are matched as literal assignments.
const secretPatterns = [
  { label: "API_KEY", re: /API_KEY/ },
  { label: "SECRET", re: /SECRET/ },
  { label: "TOKEN=", re: /TOKEN=/ },
  { label: "password=", re: /password=/ },
];

// Only scan source we author. Skip generated/vendored dirs and the meta files
// (this script, README, docs) that legitimately *describe* the patterns above.
const skipDirs = new Set([
  ".git",
  "node_modules",
  "dist",
  "docs",
  ".github",
  ".claude",
]);
const skipFiles = new Set([
  "scripts/simple-review.mjs",
  "README.md",
  "package.json",
  "package-lock.json",
]);

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const rel = relative(root, abs);
    if (statSync(abs).isDirectory()) {
      if (skipDirs.has(entry)) continue;
      out.push(...listFiles(abs));
    } else {
      out.push(rel);
    }
  }
  return out;
}

const scanned = listFiles(root).filter((rel) => !skipFiles.has(rel));

let secretHits = 0;
for (const rel of scanned) {
  let content;
  try {
    content = readFileSync(join(root, rel), "utf8");
  } catch {
    continue; // skip unreadable / binary files
  }
  for (const { label, re } of secretPatterns) {
    if (re.test(content)) {
      secretHits++;
      fail(`possible secret "${label}" found in ${rel}`);
    }
  }
}
if (secretHits === 0) {
  pass("no obvious secrets found in scanned files");
}

// --- 4. No console.log in src/main.js ---------------------------------------
const mainPath = join(root, "src/main.js");
if (existsSync(mainPath)) {
  const main = readFileSync(mainPath, "utf8");
  if (/console\.log\s*\(/.test(main)) {
    fail("console.log found in src/main.js");
  } else {
    pass("no console.log in src/main.js");
  }
}

// --- 5. No TODO in production files ------------------------------------------
const productionFiles = [
  "public/index.html",
  "src/main.js",
  "src/style.css",
];
let todoHits = 0;
for (const rel of productionFiles) {
  const p = join(root, rel);
  if (!existsSync(p)) continue;
  if (/TODO/.test(readFileSync(p, "utf8"))) {
    todoHits++;
    fail(`TODO found in production file: ${rel}`);
  }
}
if (todoHits === 0) {
  pass("no TODO markers in production files");
}

// --- Summary -----------------------------------------------------------------
console.log("");
console.log("=== Simple Code Review ===");
for (const line of lines) console.log(line);
console.log("--------------------------");
if (failures === 0) {
  console.log(`Result: PASS (${lines.length} checks ok)`);
  console.log("");
  process.exit(0);
} else {
  console.log(`Result: FAIL (${failures} problem${failures === 1 ? "" : "s"})`);
  console.log("");
  process.exit(1);
}
