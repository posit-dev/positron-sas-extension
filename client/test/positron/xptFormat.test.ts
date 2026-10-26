// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  BYTES_PER_CHUNK,
  TransportLibrefPool,
  buildBase64WriteCode,
  buildTransportLoadCode,
  buildWorkSubdirCode,
  detectTransportFormat,
  findSasErrors,
  quoteLocalPath,
  splitIntoChunks,
  workPathLiteral,
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
    const code = buildTransportLoadCode(
      "xport5",
      quoteLocalPath("/data/adae.xpt"),
      "_FXPT1",
    );
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
    const code = buildTransportLoadCode(
      "xport8",
      quoteLocalPath("/data/adsl.xpt"),
      "_FXPT2",
    );
    expect(code).to.include(
      "%xpt2loc(libref=_FXPT2, filespec='/data/adsl.xpt')",
    );
  });

  it("uses PROC CIMPORT for CPORT files", () => {
    const code = buildTransportLoadCode(
      "cport",
      quoteLocalPath("/data/lib.xpt"),
      "_FXPT3",
    );
    expect(code).to.include("filename _XPTIN '/data/lib.xpt';");
    expect(code).to.include(
      "proc cimport infile=_XPTIN library=_FXPT3 memtype=data;",
    );
  });

  it("doubles single quotes in the path", () => {
    const code = buildTransportLoadCode(
      "xport5",
      quoteLocalPath("/data/o'brien.xpt"),
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

  it("joins wrapped continuation lines", () => {
    const log = [
      "ERROR: Physical file does not exist,",
      "       /opt/sas/viya/saswork/SAS_work1234/_fvw1/adlbc.sas7bdat.",
      "NOTE: The SAS System stopped processing this step.",
    ].join("\n");
    expect(findSasErrors(log)).to.deep.equal([
      "ERROR: Physical file does not exist, /opt/sas/viya/saswork/SAS_work1234/_fvw1/adlbc.sas7bdat.",
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

describe("TransportLibrefPool prefixes", () => {
  it("uses the prefix and stays within 8 characters", () => {
    const pool = new TransportLibrefPool("_FVW");
    expect(pool.librefFor("a")).to.equal("_FVW1");
    for (let i = 0; i < 12000; i++) {
      expect(pool.librefFor(`k${i}`).length).to.be.at.most(8);
    }
  });
});

describe("WORK path helpers", () => {
  it("lets SAS resolve the WORK path instead of reading it from the log", () => {
    expect(workPathLiteral("_fvw1")).to.equal(
      '"%sysfunc(pathname(work))/_fvw1"',
    );
    expect(workPathLiteral("_fxptsrc", "_fxpt1.xpt")).to.equal(
      '"%sysfunc(pathname(work))/_fxptsrc/_fxpt1.xpt"',
    );
    expect(buildWorkSubdirCode("_fvw1")).to.include(
      'dcreate("_fvw1", pathname("work"))',
    );
  });

  it("rejects names that could break the literal", () => {
    expect(() => workPathLiteral("_fvw1", 'a"b.sas7bdat')).to.throw();
    expect(() => workPathLiteral("_fvw1", "a&b.sas7bdat")).to.throw();
    expect(() => workPathLiteral("../x")).to.throw();
  });
});

describe("base64 transfer to SAS", () => {
  const decodeLines = (lines: string[]): Uint8Array => {
    const parts = lines.map((l) => new Uint8Array(Buffer.from(l, "base64")));
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  };

  const dataLines = (code: string) => {
    const lines = code.split("\n");
    return lines.slice(lines.indexOf("datalines;") + 1, lines.lastIndexOf(";"));
  };

  it("writes decodable 76-character lines that round-trip the bytes", () => {
    // Include NULs, high bytes and trailing blanks, as in a sas7bdat file.
    const content = new Uint8Array(1000).map((_, i) => (i * 37) % 256);
    content.set([0x20, 0x20, 0x20], 997);
    const lines = dataLines(
      buildBase64WriteCode('"/w/a.sas7bdat"', content, false),
    );
    for (const line of lines) {
      expect(line.length).to.be.at.most(76);
      expect(line.length % 4).to.equal(0);
      expect(line).to.match(/^[A-Za-z0-9+/]+=*$/);
    }
    expect(decodeLines(lines)).to.deep.equal(content);
    // Mirror the DATA step's length arithmetic: n / 4 * 3 - padding.
    const total = lines.reduce((sum, l) => {
      const pad = (l.endsWith("=") ? 1 : 0) + (l.endsWith("==") ? 1 : 0);
      return sum + (l.length / 4) * 3 - pad;
    }, 0);
    expect(total).to.equal(content.length);
  });

  it("creates the file on the first chunk and appends afterwards", () => {
    const one = new Uint8Array([1, 2, 3]);
    const file = workPathLiteral("_fxptsrc", "_fxpt1.xpt");
    expect(buildBase64WriteCode(file, one, false)).to.include(
      `file ${file} recfm=n;`,
    );
    expect(buildBase64WriteCode(file, one, true)).to.include(
      `file ${file} recfm=n mod;`,
    );
  });

  it("splits content on line boundaries and keeps every byte", () => {
    const content = new Uint8Array(BYTES_PER_CHUNK * 2 + 10).map(
      (_, i) => i % 251,
    );
    const chunks = splitIntoChunks(content);
    expect(chunks.map((c) => c.length)).to.deep.equal([
      BYTES_PER_CHUNK,
      BYTES_PER_CHUNK,
      10,
    ]);
    expect(BYTES_PER_CHUNK % 57).to.equal(0);
    const rebuilt = decodeLines(
      chunks.flatMap((c, i) =>
        dataLines(buildBase64WriteCode('"/w/a"', c, i > 0)),
      ),
    );
    expect(rebuilt).to.deep.equal(content);
    expect(splitIntoChunks(new Uint8Array())).to.have.length(1);
  });
});
