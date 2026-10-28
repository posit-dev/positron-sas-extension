// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  editorCodeToRun,
  locateCodeInDocument,
} from "../../src/positron/consoleDiagnostics";

describe("locateCodeInDocument", () => {
  const doc = [
    "data a;",
    "  x = 1;",
    "run;",
    "",
    "data b;",
    "  y = 2;",
    "run;",
  ].join("\n");

  it("finds code that appears once", () => {
    const code = "data b;\n  y = 2;\nrun;";
    const range = locateCodeInDocument(doc, code, 0);
    expect(range).to.deep.equal({
      start: doc.indexOf("data b;"),
      end: doc.indexOf("data b;") + code.length,
    });
  });

  it("ignores trailing whitespace sent by the console", () => {
    expect(locateCodeInDocument(doc, "  x = 1;\n\n", 0)).to.deep.equal({
      start: doc.indexOf("  x = 1;"),
      end: doc.indexOf("  x = 1;") + "  x = 1;".length,
    });
  });

  it("picks the repeated statement around or just before the cursor", () => {
    const second = doc.lastIndexOf("run;");
    expect(locateCodeInDocument(doc, "run;", second + 2)?.start).to.equal(
      second,
    );
    // Cursor already moved on to the next line: the closest one before it.
    const first = doc.indexOf("run;");
    expect(
      locateCodeInDocument(doc, "run;", doc.indexOf("data b;"))?.start,
    ).to.equal(first);
  });

  it("gives up on code that isn't in the document", () => {
    expect(locateCodeInDocument(doc, "proc print; run;", 0)).to.be.undefined;
    expect(locateCodeInDocument(doc, "   \n", 0)).to.be.undefined;
  });
});

describe("editorCodeToRun", () => {
  const doc = "data a;\n  x = 1;\nrun;\n";

  it("runs the whole document when nothing is selected", () => {
    expect(editorCodeToRun(doc, [])).to.equal(doc);
    expect(editorCodeToRun(doc, [""])).to.equal(doc);
  });

  it("runs a single selection", () => {
    expect(editorCodeToRun(doc, ["  x = 1;"])).to.equal("  x = 1;");
  });

  it("joins several selections and skips empty ones", () => {
    expect(editorCodeToRun(doc, ["data a;", "", "run;"])).to.equal(
      "data a;\nrun;",
    );
  });
});
