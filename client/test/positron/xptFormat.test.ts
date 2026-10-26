// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  TransportLibrefPool,
  buildTransportLoadCode,
  detectTransportFormat,
  findSasErrors,
} from "../../src/positron/xptFormat";

const header = (text: string) =>
  new Uint8Array(Buffer.from(text.padEnd(80, " "), "latin1"));

describe("detectTransportFormat", () => {
  it("detects XPORT v5 files", () => {
    expect(
      detectTransportFormat(
        header(
          "HEADER RECORD*******LIBRARY HEADER RECORD!!!!!!!000000000000000000000000000000",
        ),
      ),
    ).to.equal("xport5");
  });

  it("detects XPORT v8/9 files", () => {
    expect(
      detectTransportFormat(
        header(
          "HEADER RECORD*******LIBV8   HEADER RECORD!!!!!!!000000000000000000000000000000",
        ),
      ),
    ).to.equal("xport8");
  });

  it("detects PROC CPORT files", () => {
    expect(
      detectTransportFormat(
        header("**COMPRESSED** **COMPRESSED** **COMPRESSED** **COMPRESSED**"),
      ),
    ).to.equal("cport");
  });

  it("rejects other content", () => {
    expect(detectTransportFormat(header("data class; set sashelp.class;"))).to
      .be.undefined;
    expect(detectTransportFormat(new Uint8Array())).to.be.undefined;
  });
});

describe("buildTransportLoadCode", () => {
  it("copies an XPORT v5 file into a WORK subdirectory library", () => {
    const code = buildTransportLoadCode("xport5", "/data/adae.xpt", "_FXPT1");
    expect(code).to.include('dcreate("_fxpt1", pathname("work"))');
    expect(code).to.include(
      'libname _FXPT1 "%sysfunc(pathname(work))/_fxpt1";',
    );
    expect(code).to.include("proc datasets lib=_FXPT1 kill nolist nowarn;");
    expect(code).to.include("libname _XPTIN xport '/data/adae.xpt';");
    expect(code).to.include("proc copy in=_XPTIN out=_FXPT1 memtype=data;");
    expect(code).to.include("libname _XPTIN clear;");
  });

  it("uses %xpt2loc for XPORT v8/9 files", () => {
    const code = buildTransportLoadCode("xport8", "/data/adsl.xpt", "_FXPT2");
    expect(code).to.include(
      "%xpt2loc(libref=_FXPT2, filespec='/data/adsl.xpt')",
    );
  });

  it("uses PROC CIMPORT for CPORT files", () => {
    const code = buildTransportLoadCode("cport", "/data/lib.xpt", "_FXPT3");
    expect(code).to.include("filename _XPTIN '/data/lib.xpt';");
    expect(code).to.include(
      "proc cimport infile=_XPTIN library=_FXPT3 memtype=data;",
    );
  });

  it("doubles single quotes in the path", () => {
    const code = buildTransportLoadCode(
      "xport5",
      "/data/o'brien.xpt",
      "_FXPT1",
    );
    expect(code).to.include("xport '/data/o''brien.xpt';");
  });
});

describe("findSasErrors", () => {
  it("returns ERROR lines only", () => {
    const log = [
      "NOTE: Libref _XPTIN was successfully assigned.",
      "ERROR: File is not in transport format.",
      "WARNING: something",
      "  ERROR 22-322: Syntax error.",
      "NOTE: ERROR: not at the start",
    ].join("\n");
    expect(findSasErrors(log)).to.deep.equal([
      "ERROR: File is not in transport format.",
      "ERROR 22-322: Syntax error.",
    ]);
  });

  it("returns nothing for a clean log", () => {
    expect(findSasErrors("NOTE: all good\r\nNOTE: done")).to.be.empty;
  });
});

describe("TransportLibrefPool", () => {
  it("reuses the libref for the same file and allocates new ones otherwise", () => {
    const pool = new TransportLibrefPool();
    expect(pool.librefFor("/a.xpt")).to.equal("_FXPT1");
    expect(pool.librefFor("/b.xpt")).to.equal("_FXPT2");
    expect(pool.librefFor("/a.xpt")).to.equal("_FXPT1");
  });

  it("keeps librefs within 8 characters", () => {
    const pool = new TransportLibrefPool();
    for (let i = 0; i < 1200; i++) {
      expect(pool.librefFor(`/f${i}.xpt`).length).to.be.at.most(8);
    }
  });
});
