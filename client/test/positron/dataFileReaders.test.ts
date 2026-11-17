// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  fileExtension,
  positronHasReader,
  sasDataFileKind,
  sasViewerFor,
  serverDataFileKind,
} from "../../src/positron/dataFileReaders";

// The defaults of Positron 2026.12.
const READERS = { sas7bdat: "read_stat", xpt: "read_stat", dta: "read_stat" };

describe("sasDataFileKind", () => {
  it("matches the extension in any case", () => {
    expect(sasDataFileKind("/data/adsl.sas7bdat")).to.equal("sas7bdat");
    expect(sasDataFileKind("/data/ADSL.XPT")).to.equal("xpt");
    expect(sasDataFileKind("/data/adsl.csv")).to.equal(undefined);
    expect(sasDataFileKind("/data.xpt/readme")).to.equal(undefined);
  });

  it("names the extension's viewer", () => {
    expect(sasViewerFor("/a/b.SAS7BDAT")).to.equal("sas.sas7bdatViewer");
    expect(sasViewerFor("/a/b.xpt")).to.equal("sas.xptViewer");
    expect(sasViewerFor("/a/b.sas")).to.equal(undefined);
  });

  it("finds no extension without a dot or for a dot file", () => {
    expect(fileExtension("/a/README")).to.equal("");
    expect(fileExtension("/a/.xpt")).to.equal("");
  });
});

describe("serverDataFileKind", () => {
  it("opens datasets and transport files as tables, views as views", () => {
    expect(serverDataFileKind("class.sas7bdat")).to.equal("table");
    expect(serverDataFileKind("ADSL.XPT")).to.equal("table");
    expect(serverDataFileKind("v.sas7bvew")).to.equal("view");
    expect(serverDataFileKind("formats.sas7bcat")).to.equal(undefined);
  });
});

describe("positronHasReader", () => {
  it("is false before Positron 2026.12, without the setting", () => {
    expect(positronHasReader(undefined, "/a/b.sas7bdat")).to.equal(false);
  });

  it("uses the reader of the file's extension", () => {
    expect(positronHasReader(READERS, "/a/b.sas7bdat")).to.equal(true);
    expect(positronHasReader(READERS, "/a/B.XPT")).to.equal(true);
    expect(positronHasReader(READERS, "/a/b.sas")).to.equal(false);
  });

  it("treats an empty or invalid value as turned off", () => {
    expect(positronHasReader({ xpt: "" }, "/a/b.xpt")).to.equal(false);
    expect(positronHasReader({ xpt: "read stat" }, "/a/b.xpt")).to.equal(false);
    expect(positronHasReader({ xpt: 1 }, "/a/b.xpt")).to.equal(false);
    expect(
      positronHasReader({ xpt: "community/read_stat:read_stat" }, "/a/b.xpt"),
    ).to.equal(true);
  });

  it("ignores inherited properties", () => {
    expect(positronHasReader({}, "/a/b.constructor")).to.equal(false);
  });
});
