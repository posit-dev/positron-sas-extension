// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  buildHighlightHtml,
  pairCompareRows,
  splitRow,
  valueDiffers,
} from "../../src/positron/compareHighlight";
import type { CompareOptions } from "../../src/positron/datasetCompare";

// WORK._COMPARE of WORK.A (SASHELP.CLASS) and WORK.B (Alfred's age 15,
// Barbara deleted), compared by Name.
const COLUMNS = [
  { name: "_TYPE_", type: "char" },
  { name: "_OBS_", type: "num" },
  { name: "Name", type: "char" },
  { name: "Sex", type: "char" },
  { name: "Age", type: "num" },
  { name: "Height", type: "num" },
];
const ROWS = [
  "|BASE|1|Alfred|M|14|69",
  "|COMPARE|1|Alfred|M|15|69",
  "|DIF|1|Alfred|.|1|0",
  "|BASE|3|Barbara|F|13|65.3",
];
const OPTIONS: CompareOptions = {
  base: { lib: "WORK", mem: "A", label: "WORK.A" },
  compare: { lib: "WORK", mem: "B", label: "WORK.B" },
  idVars: ["NAME"],
};

const split = (rows: string[]) =>
  rows.map((r) => splitRow(r, COLUMNS.length) ?? []);

describe("splitRow", () => {
  it("splits a row of formatted values", () => {
    expect(splitRow("|BASE|1|Alfred  |M", 4)).to.deep.equal([
      "BASE",
      "1",
      "Alfred",
      "M",
    ]);
  });

  it("rejects a row with a value that contains |", () => {
    expect(splitRow("|BASE|1|A|B|M", 4)).to.equal(undefined);
  });
});

describe("valueDiffers", () => {
  it("uses the numeric difference and the tolerance", () => {
    expect(valueDiffers("num", "14", "15", "1")).to.equal(true);
    expect(valueDiffers("num", "69", "69", "0")).to.equal(false);
    expect(valueDiffers("num", "14", "15", "1", 1)).to.equal(false);
    expect(valueDiffers("num", "1,000", "1,002", "2", 1)).to.equal(true);
  });

  it("compares the values when the difference is missing or no number", () => {
    expect(valueDiffers("num", ".", "3", ".")).to.equal(true);
    expect(valueDiffers("num", ".", ".", ".")).to.equal(false);
    expect(valueDiffers("num", "01JAN2020", "02JAN2020", "02JAN1960")).to.equal(
      true,
    );
    expect(valueDiffers("num", "01JAN2020", "01JAN2020", "01JAN1960")).to.equal(
      false,
    );
  });

  it("uses the X marks of a character difference", () => {
    expect(valueDiffers("char", "ABC", "ABD", "..X")).to.equal(true);
    expect(valueDiffers("char", "ABC", "ABC", "...")).to.equal(false);
    expect(valueDiffers("char", "ABC", "ABC  ", undefined)).to.equal(false);
  });
});

describe("pairCompareRows", () => {
  it("pairs base and compare rows by the ID values", () => {
    const groups = pairCompareRows(COLUMNS, split(ROWS), ["NAME"]);
    expect(groups).to.have.length(2);
    expect(groups[0].key).to.deep.equal(["Alfred"]);
    expect(groups[0].base?.[4]).to.equal("14");
    expect(groups[0].compare?.[4]).to.equal("15");
    expect(groups[0].dif?.[4]).to.equal("1");
    expect(groups[1].key).to.deep.equal(["Barbara"]);
    expect(groups[1].compare).to.equal(undefined);
  });

  it("pairs by observation number without ID variables", () => {
    const groups = pairCompareRows(
      COLUMNS,
      split([
        "|BASE|2|Alice|F|13|56.5",
        "|COMPARE|2|Barbara|F|13|65.3",
        "|DIF|2|XXXXXXX|.|0|8.8",
        "|COMPARE|19|William|M|15|66.5",
      ]),
      [],
    );
    expect(groups.map((g) => g.key)).to.deep.equal([["2"], ["19"]]);
    expect(groups[0].compare?.[2]).to.equal("Barbara");
    expect(groups[1].base).to.equal(undefined);
  });
});

describe("buildHighlightHtml", () => {
  const html = buildHighlightHtml({
    options: OPTIONS,
    columns: COLUMNS,
    rows: ROWS,
    totalRows: ROWS.length,
  });

  it("colors the values that differ", () => {
    expect(html).to.contain('<td class="changed base">14</td>');
    expect(html).to.contain('<td class="changed compare">15</td>');
  });

  it("shows only the variables that differ", () => {
    expect(html).to.contain("<th>Age</th>");
    expect(html).not.to.contain("<th>Height</th>");
    expect(html).not.to.contain("<th>Sex</th>");
    expect(html).to.contain("<code>Age</code>: 1 observation");
  });

  it("marks observations that only one dataset has", () => {
    expect(html).to.contain('<tr class="only base">');
    expect(html).to.contain("Only in WORK.A");
    expect(html).to.contain(
      "1 observation with unequal values; 1 observation only in WORK.A.",
    );
  });

  it("says when it shows only part of WORK._COMPARE", () => {
    const part = buildHighlightHtml({
      options: OPTIONS,
      columns: COLUMNS,
      rows: ROWS.slice(0, 2),
      totalRows: 4,
    });
    expect(part).to.contain("the first 2 rows of the 4 rows");
    // The last observation may be incomplete and is left out.
    expect(part).not.to.contain("Alfred");
  });

  it("escapes values and counts rows it can't split", () => {
    const odd = buildHighlightHtml({
      options: OPTIONS,
      columns: COLUMNS,
      rows: [
        "|BASE|1|<b>|M|14|69",
        "|COMPARE|1|<b>|M|15|69",
        "|DIF|1|<b>|.|1|0",
        "|BASE|2|A|B|F|13|65.3",
      ],
      totalRows: 4,
    });
    expect(odd).to.contain("&lt;b&gt;");
    expect(odd).not.to.contain("<b>");
    expect(odd).to.contain("1 row of <code>WORK._COMPARE</code> could not be read");
  });
});
