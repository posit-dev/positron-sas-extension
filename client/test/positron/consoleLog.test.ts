// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  CONSOLE_OPTIONS,
  CONSOLE_POSTAMBLE,
  isWrapperLogLine,
  odsOpenCode,
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
