// Launcher for the Positron API integration tests (client/test/positron-api/).
//
// Downloads (or reuses a cached copy of) a real Positron build and runs the
// compiled Mocha entry point (client/out/test/positron-api/index.js) inside
// its extension host, via @posit-dev/positron-test-electron — the Positron
// analog of @vscode/test-electron used by test-client.
//
// Run with `npm run test-positron-api` (which builds the extension and
// compiles the tests first).
//
// On a headless Linux machine (including CI), Positron needs a display
// server — wrap the run in xvfb: `xvfb-run -a npm run test-positron-api`.
//
// Environment variables:
//   POSITRON_CHANNEL  "stable" or "daily". Defaults to "stable".
//   POSITRON_VERSION  Pin an exact Positron version (e.g. "2026.06.0-123")
//                     for reproducible runs.
import { runTests } from "@posit-dev/positron-test-electron";

import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // Repo root is the extension root (contains the manifest package.json).
  const extensionDevelopmentPath = path.resolve(__dirname, "..");

  // Compiled Mocha entry point that discovers and runs the Positron tests.
  const extensionTestsPath = path.resolve(
    extensionDevelopmentPath,
    "client",
    "out",
    "test",
    "positron-api",
    "index.js",
  );

  const channel = process.env.POSITRON_CHANNEL ?? "stable";

  const code = await runTests({
    channel,
    version: process.env.POSITRON_VERSION,
    extensionDevelopmentPath,
    extensionTestsPath,
    // The tests only need the SAS extension itself: its runtime manager is
    // what registers SAS runtimes with Positron, so Positron's bundled
    // runtime extensions (Python, Ark) can stay disabled for speed.
    launchArgs: ["--disable-workspace-trust", "--locale", "en-US"],
  });

  process.exit(code);
}

main().catch((err) => {
  console.error("Failed to run Positron API tests:");
  console.error(err);
  process.exit(1);
});
