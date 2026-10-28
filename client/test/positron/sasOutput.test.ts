// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  extractPngImages,
  htmlToText,
  pngSize,
} from "../../src/positron/sasOutput";

// A 3x2 pixel PNG.
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAEElEQVR4nGP4z8AAQQxwFgBB0gX7h/C5SAAAAABJRU5ErkJggg==";

const report = `<!DOCTYPE html>
<html><head><title>SAS Output</title><style>.c { color: red; }</style></head>
<body>
<h1 class="title">The PRINT &amp; MEANS Procedures</h1>
<section>
<table class="table">
<caption>Data Set SASHELP.CLASS</caption>
<thead><tr>
  <th class="header">Name</th>
  <th class="header">Age</th>
</tr></thead>
<tbody>
<tr>
  <td class="data">Alfred</td>
  <td class="r data">14</td>
</tr>
<tr>
  <td class="data">Alice&nbsp;B</td>
  <td class="r data">&lt;13&gt;</td>
</tr>
</tbody></table>
</section>
<div><img alt="Scatter plot" src="data:image/png;base64,${png.slice(0, 40)}
${png.slice(40)}" style="height: 2px; width: 3px;"/></div>
<svg width="10" height="10"><text>svg label</text></svg>
<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" />
<pre>
  Obs    x
    1    5
</pre>
</body></html>`;

describe("extractPngImages", () => {
  it("returns the inline PNGs only, without line breaks", () => {
    expect(extractPngImages(report)).to.deep.equal([png]);
  });

  it("returns nothing for output without images", () => {
    expect(extractPngImages("<p>hi</p>")).to.deep.equal([]);
  });
});

describe("pngSize", () => {
  it("reads the size from the IHDR chunk", () => {
    expect(pngSize(png)).to.deep.equal({ width: 3, height: 2 });
  });

  it("rejects data that isn't a PNG", () => {
    expect(pngSize("R0lGODlhAQABAAAAACw=")).to.equal(undefined);
  });
});

describe("htmlToText", () => {
  it("keeps titles and tables as tab-separated rows", () => {
    expect(htmlToText(report)).to.equal(
      [
        "The PRINT & MEANS Procedures",
        "",
        "Data Set SASHELP.CLASS",
        "",
        "Name\tAge",
        "",
        "Alfred\t14",
        "",
        "Alice B\t<13>",
        "",
        "  Obs    x",
        "    1    5",
      ].join("\n"),
    );
  });

  it("truncates long output with a note", () => {
    const text = htmlToText(`<p>${"x".repeat(50)}</p>`, 10);
    expect(text).to.equal(`${"x".repeat(10)}\n… (output truncated)`);
  });
});
