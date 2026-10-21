// Positron API integration tests: extension host sanity.
//
// Verifies the contract the SAS extension depends on when running inside
// Positron: the extension host injects the acquirePositronApi global (the
// extension feature-detects Positron by calling it — see
// client/src/positron/index.ts), the extension's own detection helpers see
// it, and the extension activates.
import { extensions } from "vscode";

import * as assert from "assert";

import { getPositronApi, isPositron } from "../../src/positron";

const EXTENSION_ID = "posit.positron-sas";

describe("Positron extension host", () => {
  it("injects the acquirePositronApi global", () => {
    assert.strictEqual(
      typeof acquirePositronApi,
      "function",
      "the extension host should provide the acquirePositronApi global",
    );

    const api = acquirePositronApi();
    assert.ok(api, "acquirePositronApi() should return the Positron API");
    assert.ok(api.runtime, "the Positron API should expose runtime");
    assert.ok(api.connections, "the Positron API should expose connections");
    assert.ok(api.window, "the Positron API should expose window");
  });

  it("is detected by the extension's own Positron helpers", () => {
    // These are the exact helpers the extension gates all Positron
    // integration on (isPositron() in client/src/node/extension.ts).
    assert.strictEqual(isPositron(), true, "isPositron() should be true");
    assert.ok(
      getPositronApi(),
      "getPositronApi() should return the Positron API",
    );
  });

  it("activates the SAS extension in Positron", async () => {
    const extension = extensions.getExtension(EXTENSION_ID);
    assert.ok(
      extension,
      `${EXTENSION_ID} should be present in the extension host`,
    );

    await extension.activate();
    assert.ok(extension.isActive, "the SAS extension should activate");
  });
});
