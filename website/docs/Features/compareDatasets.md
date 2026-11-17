---
sidebar_position: 11
---

# Comparing Datasets

In Positron, the SAS extension compares two SAS datasets with `PROC COMPARE`, as the **Compare Data** step of SAS Studio does. Use it to check a dataset against an earlier version, or a double-programmed dataset against the original. The comparison runs in the SAS console, so the code is in the console for you to reuse, and the report opens in the **Viewer**.

## Start a comparison

Start a comparison in any of these ways:

- **Command Palette:** run **SAS: Compare Datasets...**, then pick the base dataset and the dataset to compare it with. The picker lists the datasets open in the Data Explorer first, then **Choose from a library...**, which lists the libraries and datasets of the SAS session.
- **Data Explorer:** while a SAS dataset is open in the Data Explorer, select **Compare with Another Dataset...** in the editor title bar. The dataset in the Data Explorer is the base dataset.
- **Explorer:** right-click a `.sas7bdat` or `.xpt` file and select **Select Dataset for Compare**, then right-click a second file and select **Compare Dataset with Selected**. To compare two files at once, select both, right-click one of them, and select **Compare Datasets**.
- **Clinical Repository:** **Compare with Selected** and **Compare Selected** compare two `.sas7bdat` or `.xpt` files or versions as datasets. See [SAS Clinical Acceleration](./clinicalAcceleration.md#compare-files-and-versions).

For a transport file with more than one dataset, a picker asks which dataset to compare. Files are opened in the SAS session the same way as in the Data Explorer, so a SAS console must run first.

## Options

After you pick the datasets, the extension asks for two options:

- **ID variables:** the variables that identify an observation, such as `USUBJID`. The picker lists the variables that both datasets have. Observations with the same ID values are compared. Both datasets are sorted by the ID variables into WORK first, as `PROC COMPARE` requires. Pick no variables to compare observations by position: the first with the first, the second with the second, and so on.
- **Numeric tolerance:** numeric values that differ by at most this amount count as equal (`METHOD=ABSOLUTE CRITERION=`). Leave it empty to compare values exactly.

## Results

The `PROC COMPARE` report opens in the **Viewer**: a summary of both datasets, the variables that only one dataset has, the variables with different attributes, and the values that differ. A message then says whether the datasets are identical or what differs, for example *unequal values* or *observations only in the base dataset*. It offers these actions:

- **Highlight Differences:** shows the observations that differ in the **Viewer**, with the values that differ in color. For each observation, the base values and the compare values are in two rows, one under the other: values that differ are red in the base row and green in the compare row. Observations that only one dataset has are one row, in the color of that dataset. Only the variables that differ are shown, and a list at the top says in how many observations each one differs. The page shows the first 500 observations; **Open Differences** has all of them. Values are compared as PROC COMPARE compares them, within the numeric tolerance, but shown with their formats.
- **Open Differences:** opens the observations that differ in the **Data Explorer**, where you can sort and filter them. The dataset is `WORK._COMPARE`. For each observation that differs, it has three rows: the base values (`_TYPE_` is `BASE`), the compare values (`COMPARE`), and the differences (`DIF`). For numeric variables, `DIF` is the difference. For character variables, `DIF` marks each differing character with an `X`. `_OBS_` is the observation number. An observation that only one dataset has gets only one row: `BASE` for an observation only in the base dataset, `COMPARE` for one only in the compare dataset. The next comparison replaces `WORK._COMPARE`.
- **Open Side by Side:** opens both datasets in Data Explorers in two editor groups, next to each other. If the base dataset is already open in a Data Explorer, as when you started the comparison from its title bar, that Data Explorer is reused. Each one scrolls, sorts, and filters on its own. The Data Explorer can't color cells, so use **Highlight Differences** to see which values differ.

The code that the comparison ran stays in the console. Copy it into a program to run the same comparison again, for example as part of a validation program.

Posit Assistant can also compare datasets: ask it to compare two datasets, and it writes and runs the `PROC COMPARE` code in the console.
