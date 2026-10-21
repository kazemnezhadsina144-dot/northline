import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = ".next/static";
const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else files.push(path);
  }
};

try {
  walk(root);
} catch {
  console.error("BUNDLE_CHECK_BLOCKED missing .next/static. Run the production build first.");
  process.exit(2);
}

const banned = ["NEXT_PUBLIC_ZEROEX", "0x-api-key", "ZEROX_API_KEY"];
const key = process.env.ZEROX_API_KEY?.trim();
if (key && key.length >= 8) banned.push(key);
const hits = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const needle of banned) {
    if (text.includes(needle)) hits.push({ file, needle: needle === key ? "ZEROX_API_KEY value" : needle });
  }
}

if (hits.length) {
  console.error(JSON.stringify({ result: "FAIL", hits }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ result: "PASS", files: files.length, needles: banned.length }));
