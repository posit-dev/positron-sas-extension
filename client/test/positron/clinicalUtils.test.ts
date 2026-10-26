// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { deflateRawSync } from "zlib";

import type {
  ObjectType,
  RepositoryItem,
  ResourceCollection,
} from "../../src/clinical/types";
import {
  buildChildrenUrl,
  buildContextValue,
  buildIdFilter,
  classifyProbe,
  collectPages,
  downloadFileName,
  extractSingleZipEntry,
  isAvailable,
  isZip,
  validateFileName,
  validateFolderName,
  validateVersion,
} from "../../src/clinical/utils";

const folder: RepositoryItem = {
  id: "10",
  name: "adam",
  path: "/Acme/Study1/adam",
  typeId: "folder",
  primaryType: "FOLDER",
};
const org: RepositoryItem = {
  id: "2",
  name: "Acme",
  path: "/Acme",
  typeId: "organization",
  primaryType: "CONTEXT",
};
const topType: ObjectType = {
  id: "organization",
  name: "Organization",
  capabilities: ["TOP"],
};
const file = (extra: Partial<RepositoryItem> = {}): RepositoryItem => ({
  id: "11",
  name: "adsl.sas",
  path: "/Acme/Study1/adam/adsl.sas",
  typeId: "sasprogram",
  primaryType: "FILE",
  ...extra,
});

describe("collectPages", () => {
  it("follows next links and ignores count", async () => {
    const pages: Record<string, ResourceCollection<number>> = {
      first: {
        count: 2,
        items: [1, 2],
        links: [{ rel: "next", href: "p2", method: "GET", uri: "p2" }],
      },
      p2: {
        count: 2,
        items: [3, 4],
        links: [{ rel: "next", href: "p3", method: "GET", uri: "p3" }],
      },
      p3: {
        count: 1,
        items: [5],
        links: [{ rel: "prev", href: "p2", method: "GET", uri: "p2" }],
      },
    };
    const requested: string[] = [];
    const items = await collectPages<number>(async (url) => {
      requested.push(url);
      return pages[url];
    }, "first");
    expect(items).to.deep.equal([1, 2, 3, 4, 5]);
    expect(requested).to.deep.equal(["first", "p2", "p3"]);
  });

  it("stops on a repeated next link and reports truncation", async () => {
    const reasons: string[] = [];
    const items = await collectPages<number>(
      async (): Promise<ResourceCollection<number>> => ({
        items: [1],
        links: [{ rel: "next", href: "same", method: "GET", uri: "same" }],
      }),
      "same",
      (reason) => reasons.push(reason),
    );
    expect(items).to.deep.equal([1]);
    expect(reasons).to.have.length(1);
  });

  it("stops after the page limit", async () => {
    let n = 0;
    const reasons: string[] = [];
    const items = await collectPages<number>(
      async (): Promise<ResourceCollection<number>> => ({
        items: [n],
        links: [{ rel: "next", href: `p${++n}`, method: "GET", uri: "" }],
      }),
      "p0",
      (reason) => reasons.push(reason),
      3,
    );
    expect(items).to.have.length(3);
    expect(reasons).to.have.length(1);
  });
});

describe("buildChildrenUrl", () => {
  it("encodes the id and asks for synchronization info", () => {
    expect(buildChildrenUrl("a/b")).to.equal(
      "/clinicalRepository/repository/items/a%2Fb/children?start=0&limit=500&includeSynchronizationInfo=true",
    );
  });
});

describe("classifyProbe / isAvailable", () => {
  it("classifies responses", () => {
    expect(classifyProbe(200, "application/vnd.sas.api+json")).to.equal(
      "available",
    );
    expect(classifyProbe(200, "text/html")).to.equal("absent");
    expect(classifyProbe(401, undefined)).to.equal("present");
    expect(classifyProbe(403, "application/json")).to.equal("present");
    for (const status of [302, 404]) {
      expect(classifyProbe(status, "text/html")).to.equal("absent");
    }
    for (const status of [500, 503]) {
      expect(classifyProbe(status, "text/html")).to.equal("error");
    }
  });

  it("shows the view before sign-in but not when a token is rejected", () => {
    expect(isAvailable("available", true)).to.be.true;
    expect(isAvailable("present", false)).to.be.true;
    expect(isAvailable("present", true)).to.be.false;
    expect(isAvailable("absent", false)).to.be.false;
    expect(isAvailable("error", true)).to.be.false;
  });
});

describe("buildContextValue", () => {
  it("marks containers and protects top-level contexts from rename", () => {
    expect(buildContextValue(folder, undefined, "me")).to.equal(
      ";clinical;container;canCreate;canRename;",
    );
    expect(buildContextValue(org, topType, "me")).to.equal(
      ";clinical;container;canCreate;",
    );
  });

  it("reflects who has a file checked out", () => {
    expect(buildContextValue(file(), undefined, "me")).to.equal(
      ";clinical;file;coNone;canRename;",
    );
    expect(
      buildContextValue(
        file({ checkedOut: true, checkedOutBy: "me" }),
        undefined,
        "me",
      ),
    ).to.include(";coSelf;");
    expect(
      buildContextValue(
        file({ checkedOut: true, checkedOutBy: "you" }),
        undefined,
        "me",
      ),
    ).to.include(";coOther;");
  });

  // Evaluate the package.json `when` clauses of the view's context menu
  // against real context values, so a typo in either place fails here.
  describe("package.json menus", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "../../../package.json"), "utf8"),
    );
    const menus: Array<{ command?: string; submenu?: string; when: string }> =
      pkg.contributes.menus["view/item/context"].filter(
        (m: { when?: string }) =>
          m.when?.includes("view == clinicalrepositorydataprovider"),
      );

    const shown = (contextValue: string, multi = false) =>
      menus
        .filter((menu) => {
          let expr = menu.when
            .replace("view == clinicalrepositorydataprovider", "true")
            .replace(/!listMultiSelection/g, String(!multi))
            .replace(/viewItem =~ \/([^/]+)\//g, (_m, re) =>
              String(new RegExp(re).test(contextValue)),
            );
          expect(expr).to.match(/^[truefals()|&! ]+$/);
          expr = expr.replace(/\btrue\b/g, "1").replace(/\bfalse\b/g, "0");
          return Boolean(eval(expr));
        })
        .map((menu) => menu.command ?? menu.submenu);

    it("offers folder actions on containers", () => {
      expect(shown(buildContextValue(folder, undefined, "me"))).to.have.members(
        [
          "SAS.clinical.addFolder",
          "SAS.clinical.checkOutSubmenu",
          "SAS.clinical.undoCheckout",
          "SAS.clinical.copyPath",
          "SAS.clinical.rename",
          "SAS.clinical.download",
          "SAS.clinical.upload",
          "SAS.clinical.uploadAndExpand",
        ],
      );
    });

    it("offers check out only for files nobody has checked out", () => {
      const free = shown(buildContextValue(file(), undefined, "me"));
      expect(free).to.include("SAS.clinical.checkOutSubmenu");
      expect(free).to.not.include("SAS.clinical.undoCheckout");
      expect(free).to.not.include("SAS.clinical.upload");

      const mine = shown(
        buildContextValue(
          file({ checkedOut: true, checkedOutBy: "me" }),
          undefined,
          "me",
        ),
      );
      expect(mine).to.include("SAS.clinical.undoCheckout");
      expect(mine).to.not.include("SAS.clinical.checkOutSubmenu");

      const theirs = shown(
        buildContextValue(
          file({ checkedOut: true, checkedOutBy: "you" }),
          undefined,
          "me",
        ),
      );
      expect(theirs).to.not.include("SAS.clinical.undoCheckout");
      expect(theirs).to.not.include("SAS.clinical.checkOutSubmenu");
    });

    it("hides single-item actions for multi-selections", () => {
      const multi = shown(buildContextValue(folder, undefined, "me"), true);
      expect(multi).to.not.include("SAS.clinical.rename");
      expect(multi).to.not.include("SAS.clinical.addFolder");
      expect(multi).to.include("SAS.clinical.download");
    });

    it("declares every command it uses", () => {
      const declared = new Set(
        pkg.contributes.commands.map((c: { command: string }) => c.command),
      );
      for (const menu of menus) {
        if (menu.command) {
          expect(declared.has(menu.command), menu.command).to.be.true;
        }
      }
    });
  });
});

describe("downloads", () => {
  it("names files, containers and multi-selections", () => {
    expect(downloadFileName([file()])).to.equal("adsl.sas");
    expect(downloadFileName([folder])).to.equal("adam.zip");
    expect(downloadFileName([file(), folder])).to.equal("adsl.sas.zip");
  });

  it("builds an id filter", () => {
    expect(buildIdFilter(["a", "b'c"])).to.equal("in(id,'a','b''c')");
  });
});

const bytes = (text: string) => new Uint8Array(Buffer.from(text));

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Build a zip archive with the given entries (deflated, or stored). */
function makeZip(
  entries: Array<{ name: string; data: Uint8Array; store?: boolean }>,
): Uint8Array {
  const parts: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = bytes(entry.name);
    const body = entry.store
      ? entry.data
      : new Uint8Array(deflateRawSync(entry.data));
    const method = entry.store ? 0 : 8;
    const local = new Uint8Array(30);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, name.length, true);
    const central = new Uint8Array(46);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    parts.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = concat(centrals);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cd.length, true);
  ev.setUint32(16, offset, true);
  return concat([...parts, cd, eocd]);
}

describe("zip handling", () => {
  const text = bytes("data class; set sashelp.class; run;\n".repeat(20));

  it("detects zips", () => {
    expect(isZip(makeZip([{ name: "a.sas", data: text }]))).to.be.true;
    expect(isZip(text)).to.be.false;
  });

  it("extracts a single deflated or stored entry", () => {
    for (const store of [false, true]) {
      const out = extractSingleZipEntry(
        makeZip([{ name: "a.sas", data: text, store }]),
      );
      expect(out).to.deep.equal(text);
    }
  });

  it("ignores directory entries", () => {
    const out = extractSingleZipEntry(
      makeZip([
        { name: "dir/", data: new Uint8Array(), store: true },
        { name: "dir/a.sas", data: text },
      ]),
    );
    expect(out).to.deep.equal(text);
  });

  it("returns undefined for several files or non-zips", () => {
    expect(
      extractSingleZipEntry(
        makeZip([
          { name: "a.sas", data: text },
          { name: "b.sas", data: text },
        ]),
      ),
    ).to.be.undefined;
    expect(extractSingleZipEntry(text)).to.be.undefined;
  });
});

describe("validators", () => {
  it("validates file names", () => {
    expect(validateFileName("adsl.sas")).to.be.undefined;
    expect(validateFileName("adsl")).to.equal("fileName");
    expect(validateFileName("a/b.sas")).to.equal("fileName");
  });

  it("validates folder names", () => {
    expect(validateFolderName("adam")).to.be.undefined;
    expect(validateFolderName(".hidden")).to.equal("folderDot");
    expect(validateFolderName(" x")).to.equal("folderLeadingSpace");
    expect(validateFolderName("x ")).to.equal("folderTrailingSpace");
    expect(validateFolderName("a*b")).to.equal("folderCharacters");
    expect(validateFolderName("a\\b")).to.equal("folderCharacters");
    expect(validateFolderName("x".repeat(256))).to.equal("folderLength");
  });

  it("validates versions", () => {
    expect(validateVersion("")).to.be.undefined;
    expect(validateVersion("1.0")).to.be.undefined;
    expect(validateVersion("1")).to.equal("versionFormat");
    // The regex has no /g flag, so repeated calls give the same answer.
    expect(validateVersion("2.1")).to.be.undefined;
  });
});
