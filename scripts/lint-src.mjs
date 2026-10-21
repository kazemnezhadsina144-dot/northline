import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["app", "components", "lib", "scripts", "test"];
const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (path === join("app", "api") || path.startsWith(join("app", "api") + "/")) continue;
      walk(path);
    } else if (/\.(ts|tsx|mjs|css)$/.test(entry)) files.push(path);
  }
};
for (const root of roots) walk(root);

const clientFiles = files.filter((file) => file.startsWith("app/") || file.startsWith("components/"));
const client = clientFiles.map((file) => readFileSync(file, "utf8")).join("\n");
const failures = [];
for (const needle of ["ZEROX_API_KEY", "NEXT_PUBLIC_ZEROEX", "0x-api-key", "lib/env"]) {
  if (client.includes(needle)) failures.push(`client source contains ${needle}`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(JSON.stringify({ result: "PASS", files: files.length }));
