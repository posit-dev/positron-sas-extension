// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  type DataFileSession,
  assignDataFileLibrary,
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
    },
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
