---
name: sas-quarto-report
description: >
  Turning a SAS analysis into a Quarto report or .qmd document. Use whenever the
  user asks for a report, Quarto document, .qmd, write-up or summary document
  (including the /report command) and the analysis or data is SAS: SAS code that
  ran in the SAS console session, SAS datasets (.sas7bdat, .xpt), SAS libraries,
  PROC output. The report uses `{sas}` code chunks through the sasquatch R
  package. Do not ask whether to use R/haven or Python/pandas for SAS data.
  Triggers: "/report", "make a report", "create a Quarto document", "write this
  up", "put this analysis in a .qmd", "render this as HTML".
---

# SAS reports in Quarto

This skill adds to the generic `report` and `quarto-authoring` skills and takes
precedence over them for the language and for how data is loaded. For SAS work:

- **Do not ask** whether to use R with haven or Python with pandas. The answer is
  fixed: the report keeps the SAS code as `{sas}` code chunks, run through the
  **sasquatch** R package.
- **Do not read SAS data into a data frame to analyze it.** The analysis stays in
  SAS. Do not use haven, pandas or `read_sas()`.
- The generic report rules still apply: outline first and wait for approval,
  title-only frontmatter, the AI disclaimer callout, a unique label on
  every code cell (in `{sas}` chunks written as "Chunk options in `{sas}` chunks"
  below says), no interpretation of output that has not been run, and a render
  check at the end.

## First: check the setup, before the outline

When a SAS report is requested, check the setup **before** proposing the outline,
so that missing pieces show up now and not at the render. Do these in order. Do
not wait for the user to ask for any of them.

1. **Is sasquatch installed?** Check in the user's R session, for example with
   `requireNamespace("sasquatch", quietly = TRUE)`, or with the package commands
   of the `positron-commands` skill. If R itself is missing, say that SAS reports
   need R, because sasquatch is an R package, and ask the user to install R.
   If sasquatch is **not** installed, **ask the user right away** whether to install
   it, for example "sasquatch (the R package that runs SAS chunks in Quarto) is not
   installed. Shall I install it?". Wait for the answer. On yes, install it with
   `install.packages("sasquatch")` (or the package install command of the
   `positron-commands` skill, which respects the user's repositories). On no,
   explain that the report cannot run SAS chunks without it, and stop.
2. **Is saspy installed?** sasquatch needs the Python package saspy. If
   `sasquatch::install_saspy()` has not been run yet, or `sas_connect()` reports
   that saspy cannot be found, ask the user whether to run
   `sasquatch::install_saspy()`, and run it on yes.
3. **Export the saspy connection file.** Unless `sascfg_personal.py` already exists
   next to the `.qmd`, trigger the export now, following "Connection setup" below
   (the `SAS.exportSaspyConfig` command first). Do this even if the user did not
   mention connections. Do not leave it for the render to fail on. For a SAS Viya
   profile, also save the token, as in "The SAS Viya token" below.

Then continue with the outline. The setup check is a short step: report what you
found and did in a sentence, not a long explanation.

## Chunk options in `{sas}` chunks use `*|` and `;`

In a `{sas}` chunk, chunk options are **not** written with `#|`. The knitr engine
treats SAS like a language with `*` comments that end in `;`, and Quarto stops the
render with "The chunk options should start with '*| ' instead of '#| ', and end
with ';'". Write the label like this:

```{sas}
*| label: load-data;

data work.cars;
  set sashelp.cars;
run;
```

- Use `*| ` at the start of the line and `;` at the end. `{r}` chunks keep `#|`.
- Put the options on the first lines of the chunk, before the SAS code.
- **Always leave one blank line between the last `*|` line and the first SAS
  statement, in every `{sas}` chunk.** Without it, knitr reads only the first
  option line. Every further `*|` line is passed to SAS as code, where it is a
  comment, so `echo`, `fig-cap` and the like are silently ignored. With the blank
  line all option lines are read. A chunk with a single label also works without
  the blank line, but write it anyway so that every chunk looks the same and
  adding an option later cannot break it.
- Prefer the label as the only option.

## How a SAS report works

A SAS report is a knitr Quarto document. Two things make that work:

1. A `setup` chunk, an `{r}` chunk that runs `library(sasquatch)` and
   `sas_connect()`, comes **first**. Quarto chooses the knitr engine because the
   document has an `{r}` chunk. A document with only `{sas}` chunks makes Quarto
   pick the Jupyter engine, which looks for a SAS Jupyter kernel and fails. No
   `engine:` field is needed, so the frontmatter stays title-only.
2. `sas_connect()` must run before any `{sas}` chunk, because a `{sas}` chunk has
   no session to run in until then. `library(sasquatch)` must run first as well,
   because loading the package is what registers the `{sas}` chunk type. That is
   why both calls sit together in the `setup` chunk, before every other chunk.
3. Each `{sas}` chunk runs in the SAS session that `sas_connect()` opened. That
   session is shared by all chunks, so a DATA step in one chunk is visible to the
   chunks after it. The output (tables and ODS graphics) is embedded in the
   report, and so is the SAS log.
4. The output format is **HTML or PDF only**. The `{sas}` chunk type cannot
   produce anything else and stops with an error. Do not write a `format:` field
   unless the user asks for one, and if they ask for Word (`docx`), Typst or
   another format, tell them that SAS chunks support only HTML and PDF.

## The render uses its own SAS session

`sas_connect()` opens a **new** SAS session through the Python package saspy. It
is not the SAS console session in Positron, where the analysis ran. So:

- Tables in WORK, macro variables, formats and options from the console session
  **do not exist** when the report renders.
- The `load-data` chunk therefore has to load from something that persists: a
  permanent library (`libname`), a file (`proc import`, `infile`), `sashelp`, or
  the DATA steps and `proc import` code that built the tables, copied from the
  conversation. This answers the generic skill's "how should the document load
  the data" question, so do not ask it. Ask only if a table's origin cannot be
  found in the conversation or the project.
- Include in the report every step that the later chunks depend on: `libname`
  statements, `options`, `%let`, format definitions.

## Writing the document

Order the cells like this:

- `setup`: the first chunk of the document, an `{r}` chunk with
  `library(sasquatch)` followed by `sas_connect()`. It takes the place of the
  generic skill's `load-packages` cell for SAS reports. Do not split it up, and
  do not put another code chunk before it (the disclaimer callout and text may
  come first).
- `load-data`: the `{sas}` chunk that assigns libraries and creates or imports
  the data.
- The analysis: one labelled `{sas}` chunk per step, reusing the SAS code that
  already ran in the conversation, in SAS and not translated to R.

Example:

````markdown
---
title: "Cars by origin"
---

[AI disclaimer callout from the report skill]

```{r}
#| label: setup
library(sasquatch)
sas_connect()
```

```{sas}
*| label: load-data;

data work.cars;
  set sashelp.cars;
run;
```

## Summary statistics

```{sas}
*| label: summarize-mpg;

proc means data=work.cars mean min max;
  class origin;
  var mpg_city;
run;
```
````

Notes:

- Inline `` `{r} ...` `` expressions in the text cannot read SAS tables. Do not
  hard-code numbers from SAS output either, unless the chunk that produces them
  has been run and the numbers were read from its output. When a value must be
  inline, fetch it first with `sas_to_r("table", libref = "WORK")` in an `{r}`
  chunk after the SAS chunk that creates the table.
- Use R-side analysis (`sas_to_r()` followed by ggplot2 or similar) only when the
  user asks for R. Then convert the table explicitly with `sas_to_r()`.
- SAS chunks get ODS HTML output. Keep `ods graphics` and `ods` statements the
  conversation used, but do not add `ods html` destinations that write files
  unless the user asked for them.

## Connection setup

sasquatch does not connect to SAS itself. It runs saspy, so the report needs:

- **saspy**, installed from R with `sasquatch::install_saspy()` (see the setup
  check above).
- A **`sascfg_personal.py`** in the same folder as the `.qmd`. saspy searches its
  install directory, then the working directory, then `~/.config/saspy/`.
  Keeping the file next to the `.qmd` makes the project self-contained and
  deployable to Posit Connect.

First check whether a `sascfg_personal.py` already exists next to the `.qmd`. If it
does, use it. If not, create it from the user's active SAS connection profile, in
this order:

1. **Run the extension command `SAS.exportSaspyConfig`**, with the tool that runs
   Positron commands and the folder of the `.qmd` as its argument. It writes
   `sascfg_personal.py` there and returns the file's path, the configuration name
   and, for SAS Viya, how the token gets to saspy (see "The SAS Viya token"
   below). If the file exists with other content, the command does not ask: it
   keeps the old file as `sascfg_personal.py.old-<timestamp>` next to it and writes the
   new one. The result then has a `backupPath`: **tell the user in your reply that the
   previous configuration was saved there.** A `not-found` result means the extension
   is older than this command.
2. **If the command is not available or cannot be run, ask the user to run
   *SAS: Export saspy Configuration* from the Command Palette**, with the `.qmd`
   open so the file lands next to it.
3. **If that is not possible either, write the file yourself** from the active
   profile. It is in the user settings under `SAS.connectionProfiles`: the name
   in `activeProfile`, and its details in `profiles`. Use this shape, where `name`
   is the profile name with every character other than letters, digits and `_`
   replaced by `_` (prefix `sas_` if it starts with a digit):

   ```python
   SAS_config_names = ['name']

   name = {
       # one block from the table below
   }
   ```

   For SAS Viya, use this shape instead, so the token is read each time saspy
   connects (the token file is the one from "The SAS Viya token" below):

   ```python
   import json, os, time

   SAS_config_names = ['name']

   def __getattr__(attr):
       if attr != 'name':
           raise AttributeError(attr)
       token = os.environ.get('SAS_VIYA_TOKEN')
       if not token:
           try:
               with open(os.path.expanduser('~/.positron-sas/viya-token.json')) as f:
                   saved = json.load(f)
               if saved.get('expires_at', time.time() + 60) > time.time() + 30:
                   token = saved.get('access_token')
           except Exception:
               pass
       return {'url': 'ENDPOINT', 'context': 'CONTEXT', 'authtoken': token}
   ```

   | Profile `connectionType` | Keys in the dictionary |
   |---|---|
   | `rest` (SAS Viya) | `'url'`: the profile's `endpoint`; `'context'`: its `context` (default `SAS Job Execution compute context`); `'authtoken'`: the token, as in the SAS Viya shape above |
   | `stdio` (local SAS) | `'saspath'`: the profile's `saspath`; `'encoding'`: `'utf-8'` |
   | `ssh` | `'saspath'`, `'ssh'`: `'/usr/bin/ssh'`, `'host'`, `'port'`, `'encoding'`: `'utf-8'` |
   | `iom` | `'java'`: `'/usr/bin/java'`, `'iomhost'`: its `host`, `'iomport'`: its `port`, `'encoding'`: `'utf-8'` |
   | `com` | `'provider'`: `'sas.workspace'`, `'host'`: its `host` (default `localhost`) |

   If the profile is missing or incomplete, ask the user how they connect to SAS
   rather than guessing.

### The SAS Viya token

For a SAS Viya profile, saspy needs an access token, and the render runs in a
separate R and Python process that cannot see the extension's sign-in. The
exported `sascfg_personal.py` therefore looks for a token each time saspy
connects, and takes the first of these:

1. The environment variable `SAS_VIYA_TOKEN`.
2. A variable `SAS_VIYA_TOKEN` on the Python main module, which R can set.
3. On Posit Workbench, the SAS Viya OAuth integration, read with the posit-sdk
   package. It needs the integration ID, from the environment variable
   `SAS_VIYA_INTEGRATION_ID` or the `workbenchIntegration` setting of the profile
   (the ID is under the information icon in Managed Credentials). If posit-sdk or
   the ID is missing, this step is skipped.
4. The file `~/.positron-sas/viya-token.json`, which the extension writes from its
   own sign-in. It is only used when it is for the same server and has not
   expired.

**Save the token automatically, without asking the user.** Do this before every
`quarto render` of a SAS report when the active profile is SAS Viya, and do not
wait for the user to mention tokens:

1. Check, in the same shell that will run `quarto render`, whether the variable is
   set, without printing its value: `[ -n "$SAS_VIYA_TOKEN" ] && echo set || echo unset`
   (in PowerShell: `if ($env:SAS_VIYA_TOKEN) { "set" } else { "unset" }`).
2. If it is `set`, the user supplied the token: do nothing more.
3. If it is `unset`, run the extension command `SAS.saveViyaTokenForSaspy` with the
   tool that runs Positron commands, then render. It refreshes the token if needed,
   writes the file so that only the user can read it, and returns the file's path
   and the expiry. Running it is always safe: the token file is the last place the
   configuration looks, so it never overrides the variable or the Workbench
   integration.
4. If a render still fails because SAS Viya rejected the connection (a 401, "token
   expired", or a prompt for a user ID and password), run the command again and
   render once more. Tokens expire, so this also covers a long session.

If the command is not available, ask the user to run **SAS: Save Viya Token for
saspy** from the Command Palette.

**Never read that file, print the token, or put a token, password or client
secret into a file or the report.** The token must not appear in the conversation.

## Before you say the report is done

Do these in order after writing or changing the `.qmd`.

**1. Lint the `{sas}` chunks.** Every `{sas}` chunk needs a `*| label: name;` line,
no `#|` lines, `;` at the end of each `*|` line, and a blank line after the last `*|`
line. Run this, with the path of the `.qmd` as the argument (it needs only R; on
Windows save it to a file and run `Rscript file.R report.qmd`):

```bash
Rscript - report.qmd <<'EOF'
x <- readLines(commandArgs(TRUE)[1], warn = FALSE)
open <- NA_integer_
sas <- FALSE
problems <- character()
n <- 0
for (i in seq_along(x)) {
  if (!grepl("^\\s*`{3,}", x[i])) next
  if (is.na(open)) {
    open <- i
    sas <- grepl("^\\s*`{3,}\\s*\\{sas[ ,}]", x[i])
    next
  }
  if (sas) {
    n <- n + 1
    body <- x[seq_len(i - open - 1) + open]
    for (k in grep("^\\s*#\\|", body)) {
      problems <- c(problems, sprintf("line %d: `#|` option in a {sas} chunk, use `*| ...;`", open + k))
    }
    star <- grep("^\\s*\\*\\|", body)
    if (!any(grepl("^\\s*\\*\\|\\s*label:", body[star]))) {
      problems <- c(problems, sprintf("line %d: {sas} chunk has no `*| label: name;` line", open))
    }
    for (k in star[!grepl(";\\s*$", body[star])]) {
      problems <- c(problems, sprintf("line %d: `*|` option does not end in `;`", open + k))
    }
    if (length(star) > 0 && max(star) < length(body) && nzchar(trimws(body[max(star) + 1]))) {
      problems <- c(problems, sprintf("line %d: no blank line after the last `*|` option line", open + max(star)))
    }
  }
  open <- NA_integer_
}
if (length(problems)) { cat(problems, sep = "\n"); quit(status = 1) }
cat("OK:", n, "{sas} chunks checked\n")
EOF
```

Fix every line it reports, then run it again. If you cannot run commands, check the
same four rules by reading the file.

**2. Render it, do not leave that to the user.** When the setup is complete
(sasquatch, saspy, the connection file and, for SAS Viya, the saved token), run
`quarto render` yourself, as the generic report skill describes, after saving the
SAS Viya token as described above. Do not end with an offer such as "Render the report
and check that it runs": render it and report what happened.

**3. Choose the closing words by what actually happened.**

- The render succeeded: say so, and only now say the report is done. Name the output file.
- The render was not run (a setup step is missing or the user said no): say
  "Written, not rendered", give the reason, and name the next step. Do not say
  "done", "complete" or "finished".
- The render failed: say it failed and show the error. Fix it with the list below
  and render again.

If the render fails, the usual causes are, in this order:

1. "The chunk options should start with '*| ' instead of '#| '": a `{sas}` chunk
   has `#| label: name` and needs `*| label: name;`. If an option such as `echo` or
   `fig-cap` has no effect, there is no blank line after the `*|` lines.
2. The Jupyter engine was chosen: the first chunk is not an `{r}` chunk.
3. `sasquatch` is not installed, or saspy is not installed in the Python
   environment that reticulate uses (`sasquatch::install_saspy()`).
4. `sascfg_personal.py` is missing or in the wrong folder, or the SAS Viya token is
   missing or has expired (run `SAS.saveViyaTokenForSaspy` again).
5. A chunk uses a table that only exists in the console session (see above).

The SAS log in the failing chunk's output shows SAS errors. As the generic skill
says, never interpret output of code that has not been run: if the render cannot
run, say so and leave the narrative for the user.
