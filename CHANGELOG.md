# Changelog

## Unreleased

### Bug Fixes

- Fix SAS syntax highlighting, completion and formatting: the language server crashed on startup because a bundled dependency was missing from the package [#46](https://github.com/posit-dev/positron-sas-extension/issues/46)
- Connections Pane now lists all tables of a library instead of only the first ~15; wide tables now list all columns [#45](https://github.com/posit-dev/positron-sas-extension/issues/45)
- SAS Viya sign-in: the authorization code is now handed back to Positron automatically after SSO (the callback URI pointed at the upstream `sas.sas-lsp` extension)
- Default formatter for SAS files now points to this extension (`posit.positron-sas`)

## 0.1.0 - 2026-06-02

### Features

- Ability to start SAS from the "Start Session" menu (the same as starting an R or Python session) [PR#16](https://github.com/posit-dev/positron-sas-extension/pull/16]
- See all your SAS data libraries in the Connection Pane of Positron [PR#17](https://github.com/posit-dev/positron-sas-extension/pull/17)
- Full integration into Data Explorer including code export functionality [PR#18](https://github.com/posit-dev/positron-sas-extension/pull/18)
- Open sas7bdat files listed in the file browser directly in Data Explorer [PR#19)(https://github.com/posit-dev/positron-sas-extension/pull/19)
- LLM Integration with Posit(ron) Assistant for both coding assistance but also exploratory data analysis, export and summarize LLM chat as quarto document with full code included [PR#20](https://github.com/posit-dev/positron-sas-extension/pull/20)
- SAS Extension for VS Code version used: 1.19.1 (commit e954c7fa73cc4f5a7d7382b2779b3e6eeccfe656)
