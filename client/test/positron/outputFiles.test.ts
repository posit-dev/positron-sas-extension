// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";

import { OutputFiles } from "../../src/positron/outputFiles";

describe("OutputFiles", () => {
  let parent: string;

  beforeEach(() => {
    parent = mkdtempSync(join(tmpdir(), "output-files-test-"));
  });

  afterEach(() => {
    rmSync(parent, { recursive: true, force: true });
  });

  it("writes each report to a new file in its own folder", async () => {
    const files = new OutputFiles(20, parent);
    const first = await files.write("<p>one</p>");
    const second = await files.write("<p>two</p>");

    expect(dirname(first)).to.equal(dirname(second));
    expect(dirname(dirname(first))).to.equal(parent);
    expect(basename(first)).to.equal("sas-output-1.html");
    expect(readFileSync(second, "utf8")).to.equal("<p>two</p>");
  });

  it("keeps only the newest files", async () => {
    const files = new OutputFiles(2, parent);
    const written = [
      await files.write("1"),
      await files.write("2"),
      await files.write("3"),
    ];
    expect(written.map((file) => existsSync(file))).to.deep.equal([
      false,
      true,
      true,
    ]);
  });

  it("removes the folder on dispose and can write again afterwards", async () => {
    const files = new OutputFiles(20, parent);
    const file = await files.write("x");
    await files.dispose();
    expect(existsSync(dirname(file))).to.equal(false);

    const again = await files.write("y");
    expect(readFileSync(again, "utf8")).to.equal("y");
    await files.dispose();
  });
});
