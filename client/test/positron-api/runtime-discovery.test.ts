// Positron API integration tests: SAS runtime discovery.
//
// The heart of the extension's Positron integration is
// SASLanguageRuntimeManager (client/src/positron/PositronLanguageRuntimeManager.ts):
// each SAS.connectionProfiles entry is surfaced to Positron as a language
// runtime, and a configuration watcher re-runs discovery whenever the
// profiles change (client/src/positron/index.ts). These tests exercise that
// wiring against the live Positron runtime registry — purely at the metadata
// level, so no SAS server or session is needed.
import { ConfigurationTarget, extensions, workspace } from "vscode";

import * as assert from "assert";

import { getPositronApi } from "../../src/positron";
import type { LanguageRuntimeMetadata } from "../../src/positron/positron-types";

const EXTENSION_ID = "posit.positron-sas";
const PROFILE_NAME = "positronApiTest";
const SECOND_PROFILE_NAME = "positronApiTestSecond";

const testProfile = {
  connectionType: "rest",
  endpoint: "https://example.invalid",
  context: "SAS Job Execution compute context",
};

type ProfilesSetting = {
  activeProfile?: string;
  profiles?: Record<string, unknown>;
};

async function seedProfiles(
  profiles: Record<string, typeof testProfile>,
): Promise<void> {
  await workspace.getConfiguration("SAS").update(
    "connectionProfiles",
    {
      activeProfile: PROFILE_NAME,
      profiles,
    },
    ConfigurationTarget.Global,
  );
}

/**
 * True if every profile in `profiles` is present in the current
 * SAS.connectionProfiles setting.
 */
function profilesAreSeeded(
  profiles: Record<string, typeof testProfile>,
): boolean {
  const current = workspace
    .getConfiguration("SAS")
    .get<ProfilesSetting>("connectionProfiles");
  return Object.keys(profiles).every(
    (name) => current?.profiles?.[name] !== undefined,
  );
}

/** Poll until fn() resolves to a defined value, or time out. */
async function waitFor<T>(
  fn: () => Thenable<T | undefined>,
  description: string,
  timeoutMs = 60000,
  intervalMs = 500,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const result = await fn();
      if (result !== undefined) {
        return result;
      }
    } catch {
      // Positron may throw while the registry is still warming up — retry.
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function positronApi() {
  const api = getPositronApi();
  assert.ok(api, "the Positron API should be available");
  return api;
}

async function findRegisteredRuntime(
  runtimeId: string,
): Promise<LanguageRuntimeMetadata | undefined> {
  const runtimes = await positronApi().runtime.getRegisteredRuntimes();
  return runtimes.find((runtime) => runtime.runtimeId === runtimeId);
}

/**
 * Wait for a runtime to appear in the Positron registry, re-seeding the
 * connection profiles if they get clobbered along the way.
 *
 * The extension's ProfileConfig.validateSettings() fires an *unawaited*
 * default write ({ activeProfile: "", profiles: {} }) whenever the setting is
 * missing; if one of those was enqueued from a read that raced our seed, it
 * can apply after it and wipe the test profile. It can only happen while the
 * key is absent — after it exists no further default writes are enqueued — so
 * re-seeding once heals it and converges.
 */
async function waitForRuntime(
  runtimeId: string,
  profiles: Record<string, typeof testProfile>,
): Promise<LanguageRuntimeMetadata> {
  return waitFor(async () => {
    if (!profilesAreSeeded(profiles)) {
      await seedProfiles(profiles);
    }
    return findRegisteredRuntime(runtimeId);
  }, `runtime ${runtimeId} to appear in the Positron registry`);
}

describe("Positron runtime discovery", () => {
  before(async function () {
    this.timeout(120000);

    // Runtime discovery is wired up during activation
    // (initializePositronIntegration registers the runtime manager and the
    // SAS.connectionProfiles watcher), so make sure that has happened before
    // touching configuration.
    const extension = extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} should be present`);
    await extension.activate();

    await seedProfiles({ [PROFILE_NAME]: testProfile });
  });

  after(async () => {
    await workspace
      .getConfiguration("SAS")
      .update("connectionProfiles", undefined, ConfigurationTarget.Global);
  });

  it("registers a SAS runtime for a configured connection profile", async () => {
    const runtime = await waitForRuntime(`sas-${PROFILE_NAME}`, {
      [PROFILE_NAME]: testProfile,
    });

    assert.strictEqual(runtime.runtimeName, `SAS (${PROFILE_NAME})`);
    assert.strictEqual(runtime.runtimeShortName, PROFILE_NAME);
    assert.strictEqual(runtime.languageId, "sas");
    assert.strictEqual(runtime.languageName, "SAS");
    assert.strictEqual(runtime.runtimeSource, "SAS Extension");
  });

  it("reports a SAS runtime as the preferred runtime for the language", async () => {
    const preferred = await waitFor(
      () => positronApi().runtime.getPreferredRuntime("sas"),
      "getPreferredRuntime('sas') to return a runtime",
    );

    assert.strictEqual(preferred.languageId, "sas");
    assert.ok(
      preferred.runtimeId.startsWith("sas-"),
      `preferred runtime should be a SAS profile runtime, got ${preferred.runtimeId}`,
    );
  });

  it("re-discovers runtimes when connection profiles change", async () => {
    // Adding a profile must be picked up by the extension's configuration
    // watcher and surfaced as a new runtime without restarting Positron.
    const profiles = {
      [PROFILE_NAME]: testProfile,
      [SECOND_PROFILE_NAME]: testProfile,
    };
    await seedProfiles(profiles);

    const runtime = await waitForRuntime(
      `sas-${SECOND_PROFILE_NAME}`,
      profiles,
    );

    assert.strictEqual(runtime.runtimeName, `SAS (${SECOND_PROFILE_NAME})`);
    assert.strictEqual(runtime.languageId, "sas");
  });
});
