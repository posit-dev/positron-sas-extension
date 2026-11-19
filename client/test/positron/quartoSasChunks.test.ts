// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  chunkIndexAtLine,
  chunksAbove,
  chunksBelow,
  findSasChunks,
} from "../../src/positron/quartoSasChunks";

describe("findSasChunks", () => {
  const doc = [
    "---", // 0
    'title: "Report"', // 1
    "---", // 2
    "```{r}", // 3
    "library(sasquatch)", // 4
    "```", // 5
    "```{sas}", // 6
    "*| label: load-data;", // 7
    "proc print data=sashelp.cars(obs=5);", // 8
    "run;", // 9
    "```", // 10
    "", // 11
    "```{sas, echo=FALSE}", // 12
    "proc means data=sashelp.cars;", // 13
    "run;", // 14
    "```", // 15
  ].join("\n");

  it("finds {sas} chunks and skips other engines", () => {
    const chunks = findSasChunks(doc);
    expect(chunks).to.deep.equal([
      {
        fenceLine: 6,
        endLine: 10,
        code: "proc print data=sashelp.cars(obs=5);\nrun;",
      },
      {
        fenceLine: 12,
        endLine: 15,
        code: "proc means data=sashelp.cars;\nrun;",
      },
    ]);
  });

  it("accepts a space after the engine name", () => {
    const chunks = findSasChunks("```{sas label}\ndata a; run;\n```");
    expect(chunks.map((c) => c.code)).to.deep.equal(["data a; run;"]);
  });

  it("ignores display-only blocks", () => {
    const text = [
      "```{.sas}",
      "data a; run;",
      "```",
      "```sas",
      "data b; run;",
      "```",
      "```{sashelp}",
      "x",
      "```",
    ].join("\n");
    expect(findSasChunks(text)).to.deep.equal([]);
  });

  it("does not look inside longer fences", () => {
    const text = [
      "````markdown",
      "```{sas}",
      "data a; run;",
      "```",
      "````",
      "````{sas}",
      "data b; run;",
      "```",
      "````",
    ].join("\n");
    expect(findSasChunks(text)).to.deep.equal([
      { fenceLine: 5, endLine: 8, code: "data b; run;\n```" },
    ]);
  });

  it("runs an unclosed chunk to the end of the document", () => {
    expect(findSasChunks("```{sas}\ndata a;\nrun;")).to.deep.equal([
      { fenceLine: 0, endLine: 2, code: "data a;\nrun;" },
    ]);
  });

  it("keeps *| lines that are not leading chunk options", () => {
    const text =
      "```{sas}\n*| label: x\n*| echo: false;\ndata a;\n*| not an option;\nrun;\n```";
    expect(findSasChunks(text)[0].code).to.equal(
      "data a;\n*| not an option;\nrun;",
    );
  });

  it("handles CRLF line endings", () => {
    expect(findSasChunks("```{sas}\r\ndata a;\r\n```\r\n")).to.deep.equal([
      { fenceLine: 0, endLine: 2, code: "data a;" },
    ]);
  });

  describe("chunk lookups", () => {
    const chunks = findSasChunks(doc);

    it("finds the chunk at a line, fences included", () => {
      expect(chunkIndexAtLine(chunks, 6)).to.equal(0);
      expect(chunkIndexAtLine(chunks, 9)).to.equal(0);
      expect(chunkIndexAtLine(chunks, 15)).to.equal(1);
      expect(chunkIndexAtLine(chunks, 4)).to.equal(-1);
      expect(chunkIndexAtLine(chunks, 11)).to.equal(-1);
    });

    it("lists the chunks above and below a line", () => {
      expect(chunksAbove(chunks, 12)).to.deep.equal([chunks[0]]);
      expect(chunksAbove(chunks, 6)).to.deep.equal([]);
      expect(chunksBelow(chunks, 10)).to.deep.equal([chunks[1]]);
      expect(chunksBelow(chunks, 0)).to.deep.equal(chunks);
    });
  });
});
