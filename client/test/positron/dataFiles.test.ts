// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  type DataFileSession,
  NotTransportFileError,
  assignDataFileLibrary,
  loadTransportFile,
} from "../../src/positron/dataFiles";

function fakeSession(log = "") {
  const code: string[] = [];
  const uploads: string[] = [];
  const session: DataFileSession = {
    runSilent: async (c) => {
      code.push(c);
      return log;
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
    expect(code[0]).to.equal(`libname ${a.libref} '/data/one';`);
    expect(code[1]).to.equal(`libname ${b.libref} '/data/two';`);
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
