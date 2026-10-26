# Changelog

## Unreleased

### Bug Fixes

- Data Explorer: SAS transport files (`.xpt`, XPORT v5 and v8/9, and PROC CPORT files) now open in the Data Explorer instead of as text. A file that holds several datasets asks which ones to open [#64](https://github.com/posit-dev/positron-sas-extension/issues/64)
- Opening a `.sas7bdat` file now reports a failed LIBNAME (for example, a path the SAS server can't see) instead of an empty Data Explorer

## 0.2.1 - 2026-10-21

### Bug Fixes

- Data Explorer: column distributions (histograms for numeric columns, frequency bars for character columns) and character column statistics (unique and empty counts) are now shown for SAS tables [#55](https://github.com/posit-dev/positron-sas-extension/issues/55)
- Data Explorer: summary statistics and missing-value counts no longer fail for column names longer than about 26 characters
- Positron: the SAS sidebar no longer shows an empty Libraries view; libraries are listed in the Connections / Data Connections pane. SAS Content and SAS Server stay available [#54](https://github.com/posit-dev/positron-sas-extension/issues/54)

## 0.2.0 - 2026-10-18

### Features

- Positron 2026.10+: SAS libraries and SAS Server Files appear in the new Data Connections pane; Positron 2026.09 and earlier keep using the Connections pane [#47](https://github.com/posit-dev/positron-sas-extension/issues/47)
- "SAS Authentication" log channel for diagnosing SAS Viya sign-in
- Updated to SAS Extension for VS Code 1.21.0 (upstream main at commit 7d14ab4, tag v1.21.0)

### Bug Fixes

- Fix SAS syntax highlighting, completion and formatting: the language server crashed on startup because a bundled dependency was missing from the package [#46](https://github.com/posit-dev/positron-sas-extension/issues/46)
- Connections Pane now lists all tables of a library instead of only the first ~15; wide tables now list all columns [#45](https://github.com/posit-dev/positron-sas-extension/issues/45)
- SAS Viya sign-in: the OAuth callback URI now points at this extension instead of the upstream `sas.sas-lsp`, and the URI handler is registered before the browser opens
- Default formatter for SAS files now points to this extension (`posit.positron-sas`)
- The extension description was missing (misspelled `"description "` key in `package.json`)

## 0.1.0 - 2026-06-02

### Features

- Ability to start SAS from the "Start Session" menu (the same as starting an R or Python session) [PR#16](https://github.com/posit-dev/positron-sas-extension/pull/16]
- See all your SAS data libraries in the Connection Pane of Positron [PR#17](https://github.com/posit-dev/positron-sas-extension/pull/17)
- Full integration into Data Explorer including code export functionality [PR#18](https://github.com/posit-dev/positron-sas-extension/pull/18)
- Open sas7bdat files listed in the file browser directly in Data Explorer [PR#19)(https://github.com/posit-dev/positron-sas-extension/pull/19)
- LLM Integration with Posit(ron) Assistant for both coding assistance but also exploratory data analysis, export and summarize LLM chat as quarto document with full code included [PR#20](https://github.com/posit-dev/positron-sas-extension/pull/20)
- SAS Extension for VS Code version used: 1.19.1 (commit e954c7fa73cc4f5a7d7382b2779b3e6eeccfe656)
