// Mocha entry point for the Positron API integration tests. This module is
// loaded inside the Positron extension host by
// @posit-dev/positron-test-electron (see tools/run-positron-tests.mjs), which
// requires it and calls run().
//
// These tests are kept separate from the plain VS Code suite (client/test/,
// run by test-client) because they exercise the Positron API, which is only
// available when the tests run inside Positron. They are also distinct from
// the mocked-vscode unit tests in client/test/positron/ (run by
// test-positron), which never launch an editor at all.
import { glob } from "glob";
import Mocha from "mocha";
import path from "path";

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: "bdd",
    color: true,
  });
  // Runtime discovery and extension activation on a cold CI machine can be
  // slow, so give each test a generous ceiling.
  mocha.timeout(120000);

  const testsRoot = __dirname;

  return new Promise((resolve, reject) => {
    try {
      const files = glob.sync("*.test.js", { cwd: testsRoot }).sort();
      files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} tests failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
