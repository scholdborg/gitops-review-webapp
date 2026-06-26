#!/usr/bin/env node
// check-flow-language.mjs
// Policy check for the lab: the "flow" text box (<p id="flow-text"> in
// public/index.html) MUST be written in Swedish. Exits non-zero if it is not,
// so a hook (or CI) can enforce it.
//
// This is a deliberately simple, deterministic heuristic — not a real language
// detector. It looks for Swedish signals (å/ä/ö or common Swedish words) and
// rejects text that still contains common English words.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const TARGET_ID = "flow-text";
const indexPath = join(process.cwd(), "public/index.html");

const html = readFileSync(indexPath, "utf8");

// Extract the inner text of <p id="flow-text"> ... </p>.
const re = new RegExp(`<p[^>]*\\bid="${TARGET_ID}"[^>]*>([\\s\\S]*?)</p>`, "i");
const match = html.match(re);

if (!match) {
  console.error(
    `[flow-language] FAIL: could not find <p id="${TARGET_ID}"> in public/index.html.`
  );
  process.exit(1);
}

// Strip any inline tags and collapse whitespace.
const text = match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const lower = text.toLowerCase();

// Whole-word matcher (Unicode-aware enough for Latin words).
function countWords(words) {
  let n = 0;
  const found = [];
  for (const w of words) {
    const wre = new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, "iu");
    if (wre.test(lower)) {
      n++;
      found.push(w);
    }
  }
  return { n, found };
}

const swedishWords = [
  "och", "att", "är", "från", "till", "efter", "endast", "ändring",
  "granskas", "byggs", "källa", "sanning", "webbplats", "grinden", "alla",
];
const englishWords = [
  "the", "and", "is", "after", "only", "every", "change", "source",
  "truth", "site", "gate", "deployed", "reviewed", "built", "passes",
  "decides", "whether", "reaches", "live",
];

const hasSwedishChars = /[åäöÅÄÖ]/.test(text);
const sv = countWords(swedishWords);
const en = countWords(englishWords);

const swedishSignal = hasSwedishChars || sv.n >= 2;
const ok = swedishSignal && en.n === 0;

console.log("");
console.log("=== Flow Text Language Check ===");
console.log(`  Target:        <p id="${TARGET_ID}"> in public/index.html`);
console.log(`  Text:          "${text}"`);
console.log(`  Swedish chars: ${hasSwedishChars ? "yes (å/ä/ö)" : "no"}`);
console.log(`  Swedish words: ${sv.n}${sv.found.length ? " (" + sv.found.join(", ") + ")" : ""}`);
console.log(`  English words: ${en.n}${en.found.length ? " (" + en.found.join(", ") + ")" : ""}`);
console.log("--------------------------------");

if (ok) {
  console.log("Result: PASS — flow text is Swedish.");
  console.log("");
  process.exit(0);
} else {
  console.log("Result: FAIL — flow text must be written in Swedish.");
  if (!swedishSignal) {
    console.log("  Hint: add Swedish content (use å/ä/ö or Swedish words).");
  }
  if (en.n > 0) {
    console.log(`  Hint: remove English words: ${en.found.join(", ")}.`);
  }
  console.log("");
  process.exit(1);
}
