// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  buildPropertiesHtml,
  columnsAsText,
  formatBytes,
  propertyList,
  supportsTableSections,
} from "../../src/positron/datasetProperties";
import type { DatasetProperties } from "../../src/positron/sasClient";

const CLASS: DatasetProperties = {
  lib: "SASHELP",
  mem: "CLASS",
  memtype: "DATA",
  label: "Student Data",
  created: "2026-11-17T09:30:00",
  modified: "2026-11-17T10:15:42",
  rows: 19,
  deletedRows: 0,
  columns: 5,
  rowLength: 40,
  fileSize: 131072,
  compression: "NO",
  encoding: "utf-8  Unicode (UTF-8)",
  sortedBy: ["Name"],
};

const COLUMNS = [
  { name: "Name", type: "char", length: 8, label: "Student <name>" },
  { name: "Age", type: "num", length: 8, format: "BEST12.", informat: "F8." },
];

describe("formatBytes", () => {
  it("picks a unit", () => {
    expect(formatBytes(512)).to.equal("512 bytes");
    expect(formatBytes(131072)).to.equal("128 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).to.equal("1.5 MB");
  });
});

describe("propertyList", () => {
  it("lists what is known, in words", () => {
    expect(propertyList(CLASS)).to.deep.equal([
      { name: "Name", value: "SASHELP.CLASS" },
      { name: "Type", value: "Dataset" },
      { name: "Label", value: "Student Data" },
      { name: "Rows", value: "19" },
      { name: "Columns", value: "5" },
      { name: "Row length", value: "40 bytes" },
      { name: "File size", value: "128 KB" },
      { name: "Created", value: "2026-11-17 09:30:00" },
      { name: "Modified", value: "2026-11-17 10:15:42" },
      { name: "Sorted by", value: "Name" },
      { name: "Compression", value: "None" },
      { name: "Encoding", value: "utf-8  Unicode (UTF-8)" },
    ]);
  });

  it("leaves out rows and compression for a view", () => {
    const names = propertyList({
      lib: "SASHELP",
      mem: "VCOLUMN",
      memtype: "VIEW",
      columns: 18,
      sortedBy: [],
    }).map((p) => p.name);
    expect(names).to.deep.equal(["Name", "Type", "Columns"]);
  });
});

describe("columnsAsText", () => {
  it("aligns the columns", () => {
    expect(columnsAsText(COLUMNS).split("\n")).to.deep.equal([
      "#  Name  Type       Length  Format   Informat  Label",
      "1  Name  Character  8                          Student <name>",
      "2  Age   Numeric    8       BEST12.  F8.",
    ]);
  });
});

describe("supportsTableSections", () => {
  it("is true from Positron 2026.11", () => {
    expect(supportsTableSections("2026.11.1")).to.equal(true);
    expect(supportsTableSections("2027.01.0")).to.equal(true);
    expect(supportsTableSections("2026.10.2")).to.equal(false);
    expect(supportsTableSections(undefined)).to.equal(false);
  });
});

describe("buildPropertiesHtml", () => {
  it("shows the properties and the columns, escaped", () => {
    const html = buildPropertiesHtml(CLASS, COLUMNS, "class.sas7bdat");
    expect(html).to.contain("<title>Properties: class.sas7bdat</title>");
    expect(html).to.contain(
      '<tr><th scope="row">Rows</th><td>19</td></tr>',
    );
    expect(html).to.contain("<td>Student &lt;name&gt;</td>");
    expect(html).to.contain("<td>BEST12.</td>");
  });
});
