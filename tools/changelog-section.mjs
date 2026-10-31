// Prints the CHANGELOG.md section for a version, for use as GitHub release
// notes, so every release shows the same notes as the changelog.
//
//   node tools/changelog-section.mjs <version>   # e.g. 0.4.0
//
// The section is everything after the "## <version> - <date>" heading up to the
// next "## " heading, without leading and trailing blank lines. Exits with 1 if
// the changelog has no such section or the section is empty.
import { readFileSync } from "fs";

const version = process.argv[2];
if (!version) {
  console.error("Usage: node tools/changelog-section.mjs <version>");
  process.exit(1);
}

const lines = readFileSync("CHANGELOG.md", "utf8").split(/\r?\n/);
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const heading = new RegExp(`^## ${escaped}(\\s|$)`);

const start = lines.findIndex((line) => heading.test(line));
if (start === -1) {
  console.error(`CHANGELOG.md has no "## ${version}" section.`);
  process.exit(1);
}
let end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
if (end === -1) {
  end = lines.length;
}

const section = lines
  .slice(start + 1, end)
  .join("\n")
  .trim();
if (!section) {
  console.error(`The "## ${version}" section of CHANGELOG.md is empty.`);
  process.exit(1);
}
console.log(section);
