---
sidebar_position: 1
---

# Scenario 3: SAS in Your R and Python Code

In this scenario, users mix SAS and R, or SAS and Python, in the same code. R or Python prepares the data, SAS runs the analysis, and R or Python presents the results. The code runs in Posit Workbench sessions and in content that users publish to Posit Connect.

The scenario has two variants that differ in where SAS runs:

- [SAS Viya with OAuth Tokens](./viyaOauth.md): the code sends SAS work to SAS Viya 4. Workbench or Connect supplies the user's SAS Viya access token, so the code contains no sign-in.
- [Local SAS Execution](./local.md): SAS is installed where the code runs, and the code starts SAS as a local process.

## What You Get

- SAS from R: the sasquatch package sends R data frames to SAS, runs SAS code, and returns SAS data sets to R as data frames.
- SAS in Quarto documents: with sasquatch loaded, `{sas}` code chunks run in the same SAS session as the R chunks around them.
- SAS from Python: the saspy package runs SAS code and moves data between SAS data sets and pandas data frames.
- SAS Viya services from Python: the swat package calls SAS Cloud Analytic Services (CAS) actions, and the sasctl package calls SAS Viya web services, such as model management.
- Shared results: Shiny apps, Quarto documents, and R Markdown reports that call SAS run on Connect for other people.

## The Pattern from the Demo Repository

The [sol-eng/sas-demo](https://github.com/sol-eng/sas-demo) repository shows the pattern with a clinical trial simulation. Each version follows the same three steps:

1. R generates a synthetic study data set with studies, sites, subjects, visits, and treatment groups.
2. SAS fits a mixed-effects model with `PROC MIXED` or `PROC HPMIXED` and writes residuals, fixed effects, and variance components to SAS data sets.
3. R reads those data sets back and draws summary tables and diagnostic plots with ggplot2.

The repository contains these versions:

- `sas/`: the whole analysis in the SAS language, to run in Positron with the SAS extension.
- `R/demo.R`: an R script that calls SAS through sasquatch.
- `quarto/demo.qmd`: a Quarto document with R chunks and `{sas}` chunks.
- `shiny/app.R`: a Shiny app that runs the analysis on demand and shows the residuals.

The core of `R/demo.R` looks like this:

```r
library(sasquatch)

sas_connect(cfgname = "ssh", reconnect = TRUE)

# Copy the R data frame into the SAS session
sas_from_r(large_study_data, "large_study_data")

result <- sas_run_string("
proc hpmixed data=large_study_data method=reml;
  class unique_subject_id study_id treatment_group visit;
  model outcome = visit treatment_group visit*treatment_group / solution;
  random intercept / subject=unique_subject_id;
  output out=mixed_results predicted=Pred residual=Resid;
  ods output ParameterEstimates=fixed_effects;
run;
", capture = "both")

# Return SAS data sets to R as data frames
mixed_results_df <- sas_to_r("mixed_results")
fixed_effects_df <- sas_to_r("fixed_effects")

sas_disconnect()
```

The demo connects to SAS Analytics Pro over SSH. The same code works with SAS Viya or with local SAS. Only the saspy configuration named in `cfgname` changes.

## Requirements

- R with the sasquatch package, or Python with the saspy package
- A Python environment with saspy and pandas for sasquatch, which runs saspy through the reticulate package
- Access to SAS, as one of the following:
  - SAS Viya 4 with the Compute service, for the [SAS Viya variant](./viyaOauth.md)
  - SAS installed and licensed where the code runs, for the [local variant](./local.md)
  - SAS 9.4 or SAS Analytics Pro on another Linux host that accepts SSH key sign-in
- For the SAS Viya variant on Connect: Connect OAuth integrations, which need the Enhanced or Advanced tier

## Set Up

### Choose the Libraries

| Library | Language | What it does | How it reaches SAS |
|---|---|---|---|
| sasquatch | R | Runs SAS code, moves data frames, and adds `{sas}` chunks to Quarto | Through saspy and reticulate |
| saspy | Python | Runs SAS code and moves pandas data frames | STDIO, STDIO over SSH, or HTTP to SAS Viya |
| swat | Python and R | Calls CAS actions on SAS Viya | CAS HTTP or binary protocol |
| sasctl | Python | Calls SAS Viya web services | HTTPS to SAS Viya |

sasquatch does not connect to SAS itself. It calls `saspy.SASsession()` through reticulate, so every connection option comes from the saspy configuration.

### Choose a saspy Access Method

saspy reads connection definitions from a `sascfg_personal.py` file. Each definition is a Python dictionary, and `SAS_config_names` lists the definitions you can use. These access methods matter for this scenario:

| Access method | When to use it | Required keys |
|---|---|---|
| Standard input and output (STDIO) | SAS is installed on the same Linux host or container as the code | `saspath` |
| STDIO over SSH | SAS is installed on another Linux host | `saspath`, `ssh`, and `host` |
| HTTP | SAS Viya 4, through the Compute service | `url` (or `ip`), and usually `context` |

saspy uses STDIO when a definition has neither an `ssh` key nor a `java` key. It uses HTTP when a definition has a `url` or `ip` key.

saspy looks for `sascfg_personal.py` in the saspy installation directory, then in the current directory, then in `~/.config/saspy/`, and then in the rest of the Python path. In Python, `saspy.SASsession(cfgfile=...)` points to a specific file. The sasquatch function `sas_connect()` accepts only `cfgname`, so R users rely on the search order. sasquatch also provides `configure_saspy()`, which creates the file in the saspy installation directory.

The following example shows one definition for each access method:

```python
SAS_config_names = ['local', 'ssh', 'viya']

local = {'saspath': '/opt/sas/viya/home/SASFoundation/sas'}

ssh = {'saspath': '/opt/sas/viya/home/SASFoundation/sas',
       'ssh':     '/usr/bin/ssh',
       'host':    'sas.example.com'}

viya = {'url':     'https://viya.example.com',
        'context': 'SAS Studio compute context'}
```

The `viya` definition also needs an access token. [SAS Viya with OAuth Tokens](./viyaOauth.md) shows how Workbench and Connect supply it.

### Workbench and Connect

| | Posit Workbench | Posit Connect |
|---|---|---|
| Who runs the code | The signed-in user, in their session | The content process, for each viewer or on a schedule |
| SAS Viya token | Workbench User OAuth Provider (Custom OAuth integration) | Connect OAuth integration, Viewer or Service Account |
| Token function in R | `rstudioapi::getOAuthCredentials()` | `connectapi::get_oauth_credentials()` or `connectapi::get_oauth_content_credentials()` |
| Token function in Python | `posit.workbench.Client().oauth.get_credentials()` | `posit.connect.Client().oauth.get_credentials()` or `get_content_credentials()` |
| Local SAS | SAS on the Workbench host or in the session image | SAS on the Connect host or in the content image |

Code that works in a Workbench session needs two changes for Connect. It needs the Connect token function, and the Python environment with saspy must be published with the content. sasquatch content uses reticulate, so publish its Python environment as for any R content that uses reticulate.

## Use It

1. Write the analysis in R or Python and keep the SAS code in strings, `.sas` files, or Quarto `{sas}` chunks.
2. Connect to SAS with the saspy definition for your variant. See [SAS Viya with OAuth Tokens](./viyaOauth.md) or [Local SAS Execution](./local.md).
3. Move data with `sas_from_r()` and `sas_to_r()` in R, or with `df2sd()` and `sd2df()` in saspy.
4. Disconnect at the end with `sas_disconnect()` in R or `sas.endsas()` in Python.

A short Python equivalent of the R example:

```python
import saspy

sas = saspy.SASsession(cfgname='local')

sas.df2sd(study_df, table='study')
result = sas.submit("""
proc means data=study mean std;
  class treatment_group;
  var outcome;
  output out=summary mean=mean_outcome;
run;
""")
summary_df = sas.sd2df('summary')

sas.endsas()
```

## Limitations

- sasquatch keeps one SAS session for each R process. Content on Connect that serves several viewers from one R process shares that session.
- A Quarto document with `{sas}` chunks needs an `{r}` chunk first that runs `library(sasquatch)` and `sas_connect()`. The `{r}` chunk makes Quarto use the knitr engine. Without it, Quarto uses the Jupyter engine and looks for a SAS kernel.
- In a `{sas}` chunk, chunk options start with `*| ` and end with `;`, for example `*| label: load-data;`, and one blank line must follow the last option line, or only the first option is read. The `#|` form fails, because knitr treats SAS comments like that. `{sas}` chunks produce HTML and PDF output only.
- A rendered document opens its own SAS session. It does not see tables in `WORK` from another session, such as a Positron console.
- `sas_connect()` passes only `cfgname` to saspy. Options such as an access token must come from `sascfg_personal.py`. [SAS Viya with OAuth Tokens](./viyaOauth.md) shows how.
- saspy STDIO and STDIO over SSH work only with SAS on Linux or UNIX.
- Data moves between the languages as copies. Large data sets take time to transfer.
