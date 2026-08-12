// One-off: ensure every locale CHANGELOG has Unreleased + 3.8.50 sections
// so check-docs-sync passes on brain-dev.
import fs from "node:fs";
import path from "node:path";

const i18nDir = "docs/i18n";
const locales = fs
  .readdirSync(i18nDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

for (const loc of locales) {
  const p = path.join(i18nDir, loc, "CHANGELOG.md");
  if (!fs.existsSync(p)) continue;
  let c = fs.readFileSync(p, "utf8");
  if (c.includes("## [3.8.50]")) {
    console.log(`skip ${loc} (has 3.8.50)`);
    continue;
  }
  const block = `## [Unreleased]

## [3.8.50] — 2026-08-12

_Development cycle in progress._

`;
  const m = c.match(/^## \[/m);
  if (m && m.index !== undefined) {
    c = c.slice(0, m.index) + block + c.slice(m.index);
  } else {
    c = c + "\n" + block;
  }
  fs.writeFileSync(p, c);
  console.log(`updated ${loc}`);
}
console.log("done");
