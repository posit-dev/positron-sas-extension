// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  type DataFileSession,
  NotTransportFileError,
  assignDataFileLibrary,
  loadTransportFile,
} from "../../src/positron/dataFiles";

function fakeSession(log: string | ((code: string) => string) = "") {
  const code: string[] = [];
  const uploads: string[] = [];
  const session: DataFileSession = {
    runSilent: async (c) => {
      code.push(c);
      return typeof log === "function" ? log(c) : log;
    },
    uploadToWork: async (subdir, name) => {
      uploads.push(`${subdir}/${name}`);
      return `'${subdir}/${name}'`;
    },
    listMembers: async () => [{ name: "CLASS" }, { name: "FISH" }],
  };
  return { session, code, uploads };
}

const local = (filePath: string) => ({
  key: `file://${filePath}`,
  local: true,
  filePath,
  read: async () => new Uint8Array(),
});

describe("assignDataFileLibrary", () => {
  it("gives each local folder its own libref", async () => {
    const { session, code } = fakeSession();
    const a = await assignDataFileLibrary(
      session,
      local("/data/one/class.sas7bdat"),
    );
    const b = await assignDataFileLibrary(
      session,
      local("/data/two/cars.sas7bdat"),
    );
    const c = await assignDataFileLibrary(
      session,
      local("/data/one/heart.sas7bdat"),
    );

    expect(a.member).to.equal("CLASS");
    expect(a.libref).to.match(/^_FVIEW\d+$/);
    expect(b.libref).to.match(/^_FVIEW\d+$/);
    expect(b.libref).to.not.equal(a.libref);
    expect(c.libref).to.equal(a.libref);
    expect(code[0]).to.match(new RegExp(`^libname ${a.libref} '/data/one';\n`));
    expect(code[0]).to.contain(`exist(${a.libref}.CLASS)`);
    expect(code[1]).to.match(new RegExp(`^libname ${b.libref} '/data/two';\n`));
  });

  it("copies a file on this machine into WORK when SAS doesn't see it", async () => {
    // SAS on a server: the folder doesn't exist there.
    const { session, code, uploads } = fakeSession((c) =>
      c.includes("exist(")
        ? "NOTE: Library _FVIEW1 does not exist.\n_SASFEXIST=0"
        : "",
    );
    const lib = await assignDataFileLibrary(
      session,
      local("/Users/me/data/Class.sas7bdat"),
    );
    expect(lib.member).to.equal("CLASS");
    expect(lib.libref).to.match(/^_FVW\d+$/);
    expect(uploads).to.deep.equal([
      `${lib.libref.toLowerCase()}/class.sas7bdat`,
    ]);
    expect(code[1]).to.match(new RegExp(`^libname ${lib.libref} `));
  });

  it("copies a file SAS can't read into WORK, with a lowercase name", async () => {
    const { session, code, uploads } = fakeSession();
    const lib = await assignDataFileLibrary(session, {
      key: "sasClinical:/repo/ADSL.sas7bdat",
      local: false,
      filePath: "/repo/ADSL.sas7bdat",
      read: async () => new Uint8Array([1]),
    });

    expect(lib.member).to.equal("ADSL");
    expect(lib.libref).to.match(/^_FVW\d+$/);
    expect(uploads).to.deep.equal([
      `${lib.libref.toLowerCase()}/adsl.sas7bdat`,
    ]);
    expect(code[0]).to.match(new RegExp(`^libname ${lib.libref} `));
  });

  it("fails with the SAS error", async () => {
    const { session } = fakeSession("ERROR: Library _FVIEW9 does not exist.");
    try {
      await assignDataFileLibrary(session, local("/data/three/x.sas7bdat"));
      expect.fail("should have thrown");
    } catch (error) {
      expect(String(error)).to.contain("does not exist");
    }
  });
});

describe("loadTransportFile", () => {
  it("unpacks a copied XPORT file into its own library", async () => {
    const { session, code, uploads } = fakeSession();
    const header = new TextEncoder().encode(
      "HEADER RECORD*******LIBRARY HEADER RECORD!!!!!!!000000000000000000000000000000  ",
    );
    const lib = await loadTransportFile(session, {
      key: "sasClinical:/repo/multi.xpt",
      local: false,
      filePath: "/repo/multi.xpt",
      read: async () => header,
    });

    expect(lib.libref).to.match(/^_FXPT\d+$/);
    expect(lib.members).to.deep.equal(["CLASS", "FISH"]);
    expect(uploads).to.deep.equal([`_fxptsrc/${lib.libref.toLowerCase()}.xpt`]);
    expect(code[0]).to.contain(lib.libref);
  });

  it("reads the header of a file on the SAS server, which SAS reads in place", async () => {
    const { session, code, uploads } = fakeSession();
    const header = new TextEncoder().encode(
      "HEADER RECORD*******LIBRARY HEADER RECORD!!!!!!!000000000000000000000000000000  ",
    );
    const lib = await loadTransportFile(session, {
      key: "sasServer:/tmp/x/one.xpt",
      local: true,
      filePath: "/tmp/x/one.xpt",
      read: async () => header,
      readHeader: async () => header,
    });
    expect(uploads).to.deep.equal([]);
    expect(code[1]).to.contain("'/tmp/x/one.xpt'");
    expect(lib.members).to.deep.equal(["CLASS", "FISH"]);
  });

  it("copies a file on this machine into WORK when SAS doesn't see it", async () => {
    const { session, code, uploads } = fakeSession((c) =>
      c.includes("fileexist(") ? "_SASFEXIST=0" : "",
    );
    const header = new TextEncoder().encode(
      "HEADER RECORD*******LIBRARY HEADER RECORD!!!!!!!000000000000000000000000000000  ",
    );
    const lib = await loadTransportFile(session, {
      key: "file:///Users/me/one.xpt",
      local: true,
      filePath: "/Users/me/one.xpt",
      read: async () => header,
    });
    expect(code[0]).to.contain("fileexist('/Users/me/one.xpt')");
    expect(uploads).to.deep.equal([`_fxptsrc/${lib.libref.toLowerCase()}.xpt`]);
  });

  it("refuses a file that is not a transport file", async () => {
    const { session } = fakeSession();
    try {
      await loadTransportFile(session, {
        key: "sasClinical:/repo/notes.xpt",
        local: false,
        filePath: "/repo/notes.xpt",
        read: async () => new TextEncoder().encode("just some text"),
      });
      expect.fail("should have thrown");
    } catch (error) {
      expect(error).to.be.instanceOf(NotTransportFileError);
    }
  });
});
