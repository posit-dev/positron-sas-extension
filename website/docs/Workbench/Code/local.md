---
sidebar_position: 3
---

# Local SAS Execution

In this variant, SAS is installed where the R or Python code runs. saspy starts SAS as a child process and talks to it over standard input and output (STDIO). No SAS server, network connection, or sign-in is involved.

For the libraries and the overall pattern, see [Scenario 3: SAS in Your R and Python Code](./index.md). To send SAS work to SAS Viya instead, see [SAS Viya with OAuth Tokens](./viyaOauth.md).

## What You Get

- SAS next to your code: the SAS process runs on the same host or in the same container as R or Python, under the same Linux user.
- Direct file access: SAS reads and writes the same file system as your code, including your home directory.
- The same code everywhere: a Workbench session and Connect content use the same saspy definition, as long as SAS is at the same path.

## Requirements

- Linux. saspy STDIO does not work with SAS on Windows.
- SAS installed in one of these places:
  - On the Workbench host, for sessions that run there
  - In the session image, for Workbench with Kubernetes or Slurm, such as the unmodified SAS Analytics Pro image
  - On the Connect host, or in the content image when Connect runs content off-host
- A SAS license that is valid where SAS runs
- saspy in the Python environment, and sasquatch for R users

## Set Up

### Write the saspy Configuration

Create `sascfg_personal.py` in the saspy installation directory or in `~/.config/saspy/`. A STDIO definition needs only `saspath`, the path to the SAS startup command:

```python
SAS_config_names = ['local']

local = {'saspath': '/opt/sas/viya/home/SASFoundation/sas',
         'options': ['-fullstimer']}
```

`/opt/sas/viya/home/SASFoundation/sas` is the SAS path in the unmodified SAS Analytics Pro image. A SAS 9.4 installation usually uses a path such as `/opt/sasinside/SASHome/SASFoundation/9.4/bin/sas_u8`.

`options` takes a Python list of SAS startup options. The optional `autoexec` key takes a string of SAS code that saspy submits after SAS starts, for example a `libname` statement.

R users can create the file with sasquatch and then edit it:

```r
sasquatch::install_saspy()
sasquatch::configure_saspy()
```

`configure_saspy()` writes `sascfg_personal.py` to the saspy installation directory, with an empty definition named `config_name`. Replace it with the `local` definition above.

### License SAS Where It Runs

SAS checks its license at startup, wherever it runs. Running SAS on Connect for viewers can need a different license from running it in Workbench sessions. Confirm with SAS that your license covers each place SAS runs.

- Workbench sessions from the unmodified SAS Analytics Pro image: with `ide-session-license=1`, Workbench sets `SASV9_OPTIONS` in Positron and VS Code sessions. SAS processes that saspy starts inherit it. See [Local SAS: SAS Analytics Pro Container](../Positron/localContainer.md).
- Other sessions, hosts, and images: license SAS in the installation, or pass the license file at startup.

For SAS Analytics Pro, a definition can pass the license file as a startup option:

```python
local = {'saspath': '/opt/sas/viya/home/SASFoundation/sas',
         'options': ['-licensefile', '/opt/sas/license/license.jwt']}
```

:::warning

Do not replace `SASV9_OPTIONS` in a shell profile. SAS then loses the license that Workbench provides and fails with a SETINIT expiration error. Append to the variable instead.

:::

### Prepare Connect

- Install SAS and its license on the Connect host, or build them into the content image.
- Make sure that the Linux user that runs the content can start SAS and read the license.
- Publish the Python environment with saspy along with the content. Place `sascfg_personal.py` where saspy finds it on Connect. Python content can include it in the bundle. R content can use `~/.config/saspy/` for the user that runs the content.

## Use It

In R:

```r
library(sasquatch)

sas_connect(cfgname = "local")

sas_from_r(mtcars, "cars")
sas_run_string("
proc reg data=cars;
  model mpg = wt hp;
  output out=fit predicted=pred residual=resid;
run;
")
fit <- sas_to_r("fit")

sas_disconnect()
```

In Python:

```python
import saspy

sas = saspy.SASsession(cfgname="local")

cars = sas.sasdata("cars", "sashelp")
print(cars.means())
cars_df = sas.sd2df("cars", libref="sashelp")

sas.endsas()
```

The following screenshot shows this Python code in a Positron console in a session on the unmodified SAS Analytics Pro image. saspy starts SAS from the image as a child process, `print(cars.means())` shows the `PROC MEANS` result, and `cars_df` appears in the Variables pane as a pandas data frame.

![Positron with a Python console on the left and the Variables pane on the right. The console shows import saspy, a SAS connection established message, the table of means for sashelp.cars, and the SAS connection terminated message. The Variables pane lists cars_df as a pandas DataFrame with 428 rows and 15 columns.](/images/workbench/local-saspy-console.png)

*A Positron Python console running saspy with the local definition. SAS starts, the means of the sashelp.cars data set print, and the data set is copied to a pandas data frame that shows in the Variables pane.*

In a Quarto document, load sasquatch and connect in a setup chunk. Later `{sas}` chunks run in that session:

````markdown
```{r}
#| include: false
library(sasquatch)
sas_connect(cfgname = "local")
```

```{sas}
proc print data=sashelp.class(obs=5);
run;
```
````

## Limitations

- saspy STDIO starts one SAS process for each session. Each process uses memory and processor time on the host or in the container.
- The SAS process runs as the same Linux user as the code. SAS has the same file permissions as that user, and no other identity.
- SAS work libraries are temporary. Save results to a permanent library or return them to R or Python before you disconnect.
- On Connect, a SAS process starts with the content process, not in a separate SAS server. Size the content resources for SAS.
