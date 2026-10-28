// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import { parseLog } from "../../src/components/logViewer/logParser";
import { SASCodeDocument } from "../../src/components/utils/SASCodeDocument";
import { LogLine } from "../../src/connection";
import { locateCodeInDocument } from "../../src/positron/consoleDiagnostics";

// End-to-end check of #68: code run from an editor into the Positron console
// is submitted through a SASCodeDocument, so problems in the SAS log map back
// to the editor line they came from.
describe("Positron console diagnostics", () => {
  const editorLines = [
    "data a;",
    "  x = 1;",
    "run;",
    "",
    "data b;",
    "  y = 1 2;",
    "run;",
  ];
  const editorText = editorLines.join("\n");
  const consoleCode = "data b;\n  y = 1 2;\nrun;\n";

  function buildCodeDoc(): SASCodeDocument {
    const range = locateCodeInDocument(editorText, consoleCode, 0);
    expect(range).to.not.be.undefined;
    const selectedCode = editorText.slice(range!.start, range!.end);
    return new SASCodeDocument({
      languageId: "sas",
      code: editorText,
      selectedCode,
      uri: "file:///tmp/console.sas",
      fileName: "/tmp/console.sas",
      selections: [
        { start: { line: 4, character: 0 }, end: { line: 6, character: 4 } },
      ],
      // The same preamble/postamble shape execute() uses.
      preamble:
        "options source notes; /* positron: user=jdoe session=s exec=e */\n" +
        "ods graphics / outputfmt=png; ods html5(id=vscode) style=HTMLBlue\n" +
        "  options(bitmap_mode='inline' svg_mode='inline')\n" +
        '  body="b.htm";',
      postamble: `;*';*";*/;run;quit;ods html5(id=vscode) close;`,
      outputHtml: false,
      checkKeyword: async () => false,
    });
  }

  /** The log SAS writes for the submission: numbered source plus an error. */
  function fakeLog(wrapped: string): LogLine[] {
    const logs: LogLine[] = [];
    wrapped.split("\n").forEach((code, i) => {
      const line = `${40 + i}   ${code}`;
      logs.push({ line, type: "source" });
      if (code === "  y = 1 2;") {
        const column = line.indexOf("2;");
        logs.push({ line: `${" ".repeat(column)}-`, type: "error" });
        logs.push({ line: `${" ".repeat(column)}22`, type: "error" });
        logs.push({
          line: "ERROR 22-322: Syntax error, expecting one of the following: !, !!, &, *, **, +, -, /, ;.",
          type: "error",
        });
      }
    });
    return logs;
  }

  it("starts the submission with the log start marker and keeps the tag", () => {
    const wrapped = buildCodeDoc().getWrappedCode();
    const lines = wrapped.split("\n");
    expect(lines[0]).to.equal("/** LOG_START_INDICATOR **/");
    expect(wrapped).to.include(
      "options source notes; /* positron: user=jdoe session=s exec=e */",
    );
    expect(wrapped).to.include("data b;\n  y = 1 2;\nrun;");
    expect(wrapped).to.not.include("data a;");
  });

  it("maps a log error back to the editor line and column", async () => {
    const codeDoc = buildCodeDoc();
    const [problems, codeLinesInLog] = parseLog(
      fakeLog(codeDoc.getWrappedCode()),
      codeDoc.wrappedCodeLineAt(0),
    );
    expect(problems).to.have.length(1);
    const location = await codeDoc.getLocationInRawCode(
      problems[0],
      codeLinesInLog,
    );
    expect(location.lineNumber).to.equal(5);
    expect(location.startColumn).to.equal(editorLines[5].indexOf("2;"));
  });
});
