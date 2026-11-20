// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  CONSOLE_OPTIONS,
  CONSOLE_POSTAMBLE,
  LOG_CATEGORIES,
  classifyLogLine,
  createLogLineClassifier,
  isWrapperLogLine,
  logCategory,
  odsOpenCode,
  parseLogOutputSetting,
  stripSubmissionTag,
} from "../../src/positron/consoleLog";

const tag =
  "/* positron: user=jdoe session=sas-abc123 exec=1b2c3d4e-0000-4000-8000-000000000000 */";

describe("isWrapperLogLine", () => {
  it("hides the source echo of every wrapper line", () => {
    const wrapper = [
      `${CONSOLE_OPTIONS} ${tag}`,
      `${tag} ${CONSOLE_OPTIONS}`,
      ...odsOpenCode("6f1e2d3c-4b5a-4987-a6b5-c4d3e2f1a0b9").split("\n"),
      CONSOLE_POSTAMBLE,
      "/** LOG_START_INDICATOR **/",
      "%let _SASPROGRAMFILE = %nrquote(%nrstr(/home/jdoe/a.sas));",
      "%put --vscode-sas-extension-submit-end--;",
    ];
    wrapper.forEach((code, i) => {
      expect(isWrapperLogLine(`${i + 1}          ${code}`), code).to.equal(
        true,
      );
    });
  });

  it("hides a source line that holds only the tag", () => {
    expect(isWrapperLogLine(`12         ${tag}`)).to.equal(true);
  });

  it("hides the ODS body file note and ITC markers", () => {
    expect(
      isWrapperLogLine(
        "NOTE: Writing HTML5(VSCODE) Body file: 6f1e2d3c-4b5a-4987-a6b5-c4d3e2f1a0b9.htm",
      ),
    ).to.equal(true);
    expect(isWrapperLogLine("--vscode-sas-extension-submit-end--")).to.equal(
      true,
    );
  });

  it("keeps the user's source, notes, warnings and errors", () => {
    const kept = [
      "13         %put NOTE: user=&sysuserid;",
      "NOTE: user=jdoe",
      "14         data x; set sashelp.class; run;",
      "15         run;",
      `16         ${tag} data y; x = 1; run;`,
      "NOTE: The data set WORK.X has 19 observations and 5 variables.",
      "WARNING: Variable z is uninitialized.",
      "ERROR: File WORK.NOPE.DATA does not exist.",
      "hello",
      "16",
      "",
    ];
    kept.forEach((line) => {
      expect(isWrapperLogLine(line), line).to.equal(false);
    });
  });
});

describe("stripSubmissionTag", () => {
  it("removes the tag in front of user code", () => {
    expect(stripSubmissionTag(`16         ${tag} data y; run;`)).to.equal(
      "16         data y; run;",
    );
  });

  it("leaves untagged lines alone", () => {
    expect(stripSubmissionTag("NOTE: user=jdoe")).to.equal("NOTE: user=jdoe");
  });
});

describe("classifyLogLine", () => {
  it("types untyped lines by their text", () => {
    expect(
      classifyLogLine("ERROR: File WORK.NOPE.DATA does not exist."),
    ).to.equal("error");
    expect(classifyLogLine("ERROR 22-322: Syntax error.")).to.equal("error");
    expect(classifyLogLine("WARNING: Apparent symbolic reference")).to.equal(
      "warning",
    );
    expect(classifyLogLine("NOTE: DATA statement used")).to.equal("note");
    expect(
      classifyLogLine("12         data x; set sashelp.class; run;"),
    ).to.equal("source");
    expect(classifyLogLine("      real time           0.01 seconds")).to.equal(
      "normal",
    );
  });
});

describe("logCategory", () => {
  it("maps every log line type to a console category", () => {
    expect(logCategory("source")).to.equal("source");
    expect(logCategory("error")).to.equal("errors");
    expect(logCategory("warning")).to.equal("warnings");
    for (const type of [
      "note",
      "normal",
      "hilighted",
      "title",
      "byline",
      "footnote",
      "message",
    ]) {
      expect(logCategory(type), type).to.equal("notes");
    }
  });
});

describe("createLogLineClassifier", () => {
  it("keeps the indented lines of an untyped error with it", () => {
    const classify = createLogLineClassifier();
    expect(
      classify("ERROR 22-322: Syntax error, expecting one of", "normal"),
    ).to.deep.equal({
      effective: "error",
      category: "errors",
      continuation: false,
    });
    expect(
      classify("              a name, a quoted string.", "normal"),
    ).to.deep.equal({
      effective: "error",
      category: "errors",
      continuation: true,
    });
    // A blank line ends the message.
    expect(classify("", "normal").category).to.equal("notes");
    expect(
      classify("              not part of it", "normal").category,
    ).to.equal("notes");
  });

  it("keeps the indented lines of a warning with it", () => {
    const classify = createLogLineClassifier();
    classify("WARNING: The data set WORK.X may be incomplete.", "normal");
    expect(
      classify("         When this step was stopped there were 0", "normal"),
    ).to.include({
      category: "warnings",
      continuation: true,
    });
  });

  it("leaves the lines after a note as notes", () => {
    const classify = createLogLineClassifier();
    classify("NOTE: DATA statement used (Total process time):", "normal");
    expect(
      classify("      real time           0.01 seconds", "normal"),
    ).to.include({
      category: "notes",
      continuation: false,
    });
  });

  it("uses the type that the session sends", () => {
    const classify = createLogLineClassifier();
    expect(classify("12  data x;", "source").category).to.equal("source");
    expect(classify("ERROR: Typed by the server.", "error").category).to.equal(
      "errors",
    );
    expect(classify("  NOTE text typed as a note", "note")).to.include({
      category: "notes",
      continuation: false,
    });
  });
});

describe("parseLogOutputSetting", () => {
  it("shows everything when the setting is missing", () => {
    expect([...parseLogOutputSetting(undefined)]).to.deep.equal([
      ...LOG_CATEGORIES,
    ]);
  });

  it("keeps the known categories only", () => {
    expect([
      ...parseLogOutputSetting(["errors", "bogus", "warnings"]),
    ]).to.deep.equal(["warnings", "errors"]);
  });

  it("allows an empty selection", () => {
    expect(parseLogOutputSetting([]).size).to.equal(0);
  });
});
