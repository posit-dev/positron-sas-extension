# Positron API Tests

Integration tests that run the SAS extension inside a real
[Positron](https://positron.posit.co/) build and exercise its Positron
integration (`client/src/positron/`) against the live Positron API — code
paths that the plain VS Code suite (`npm run test-client`) and the
mocked-vscode unit tests (`npm run test-positron`,
`client/test/positron/`) can't reach.

Part of the rollout tracked in
[posit-dev/positron#14531](https://github.com/posit-dev/positron/issues/14531)
(pattern established in
[quarto-dev/quarto#1058](https://github.com/quarto-dev/quarto/pull/1058) and
[posit-dev/publisher#4298](https://github.com/posit-dev/publisher/pull/4298)).

## How it works

- `tools/run-positron-tests.mjs` uses
  [`@posit-dev/positron-test-electron`](https://github.com/posit-dev/positron-test-electron)
  to download (and cache, under `.positron-test/`) a Positron build, then
  runs the compiled Mocha entry point
  (`client/out/test/positron-api/index.js`) inside its extension host — the
  Positron analog of the `@vscode/test-electron` harness used by
  `test-client`.
- `index.ts` is that entry point: it discovers `*.test.js` files in this
  directory and runs them with Mocha (BDD UI).
- Tests are compiled by the same `tsc -p ./client` step as the plain suite;
  the two are kept apart by directory (`client/test/index.ts` excludes
  `positron-api/**` from the plain suite's glob).

## What's covered

- `extension.test.ts` — Positron injects the `acquirePositronApi` global,
  the extension's own `isPositron()` / `getPositronApi()` helpers detect it,
  and the SAS extension activates in the Positron extension host.
- `runtime-discovery.test.ts` — each `SAS.connectionProfiles` entry is
  surfaced to Positron as a language runtime by `SASLanguageRuntimeManager`,
  `getPreferredRuntime("sas")` resolves to one, and the configuration
  watcher re-discovers runtimes when profiles change. All metadata-level: no
  SAS server or session is required.

## Running locally

```bash
npm run test-positron-api                        # stable Positron
POSITRON_CHANNEL=daily npm run test-positron-api # daily build
POSITRON_VERSION=2026.06.0-123 npm run test-positron-api # pinned version
```

> **Note:** `@posit-dev/positron-test-electron` can currently only download
> Positron builds for **macOS**; Windows/Linux archives are pending upstream.
> On other platforms, rely on the Positron API Tests GitHub Actions workflow
> (`.github/workflows/positron-api-tests.yml`), which runs on every PR and
> push to `main`.

## Adding tests

Add a `<name>.test.ts` file in this directory using Mocha's BDD UI
(`describe`/`it`). Things to know:

- The Positron API is reached through the `acquirePositronApi()` global that
  Positron injects into the extension host. Prefer going through the
  extension's own helpers (`getPositronApi()` from
  `client/src/positron/index.ts`) so the tests cover the code the extension
  actually runs, and use the types in
  `client/src/positron/positron-types.ts`.
- Runtime discovery is asynchronous: after changing
  `SAS.connectionProfiles`, poll the registry rather than asserting
  immediately (see `waitFor` in `runtime-discovery.test.ts`).
- Prefer metadata-level assertions (`getRegisteredRuntimes`,
  `getPreferredRuntime`) over starting sessions — starting a SAS session
  requires a reachable SAS server, which CI does not have.
- Don't open `.sas` editors unless the test needs one: the extension
  auto-starts a SAS console session when a `.sas` file becomes the active
  editor, which will fail (harmlessly, but noisily) against a fake profile.
