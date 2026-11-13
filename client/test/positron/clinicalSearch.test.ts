// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  buildSearchFilter,
  buildSearchUrl,
  escapeContentText,
  isEmptyQuery,
  parentPath,
  validateContentText,
} from "../../src/clinical/searchQuery";

const now = new Date("2026-11-13T12:00:00Z");
const params = (url: string) => new URLSearchParams(url.split("?")[1]);

describe("repository search filters", () => {
  it("has no filter without conditions", () => {
    expect(buildSearchFilter({}, "me", now)).to.be.undefined;
    expect(buildSearchFilter({ name: " ", location: "/" }, "me", now)).to.be
      .undefined;
    expect(isEmptyQuery({ location: "/" })).to.equal(true);
    expect(isEmptyQuery({ text: "x" })).to.equal(false);
    expect(isEmptyQuery({ signed: true })).to.equal(false);
  });

  it("matches names with like(), which handles * and ? without case", () => {
    // eq() with wildcards matches nothing on the server.
    expect(buildSearchFilter({ name: " ad*.sas " }, "me", now)).to.equal(
      "like(name,'ad*.sas')",
    );
  });

  it("limits the location to a folder and its subfolders", () => {
    expect(
      buildSearchFilter({ location: "/Acme/Study1/" }, "me", now),
    ).to.equal("startsWith(path,'/Acme/Study1/')");
  });

  it("combines the refinements", () => {
    expect(
      buildSearchFilter(
        {
          name: "o'brien*",
          kind: "files",
          ownedByMe: true,
          checkedOutByMe: true,
          signed: true,
          modifiedDays: 7,
        },
        "ann",
        now,
      ),
    ).to.equal(
      "and(like(name,'o''brien*'),in(primaryType,'FILE','JOB_FILE'),eq(owner,'ann'),eq(checkedOutBy,'ann'),in(signingStatus,'CURRENT','BOTH'),ge(modifiedTimeStamp,2026-11-06T12:00:00.000Z))",
    );
    expect(buildSearchFilter({ kind: "folders" }, "ann", now)).to.equal(
      "in(primaryType,'FOLDER','CONTEXT')",
    );
  });

  it("leaves out the user conditions when the user is unknown", () => {
    expect(
      buildSearchFilter({ ownedByMe: true, checkedOutByMe: true }, undefined),
    ).to.be.undefined;
  });

  it("searches items by properties, sorted by name", () => {
    const url = buildSearchUrl("/items", "/files", "like(name,'a*')", "", 500);
    expect(url.startsWith("/items?")).to.equal(true);
    expect(params(url).get("filter")).to.equal("like(name,'a*')");
    expect(params(url).get("limit")).to.equal("500");
    expect(params(url).get("sortBy")).to.equal("name:ascending");
    expect(params(url).has("text")).to.equal(false);
  });

  it("searches file content through repository/files, escaping + and -", () => {
    const url = buildSearchUrl("/items", "/files", undefined, " a+b -c ", 50);
    expect(url.startsWith("/files?")).to.equal(true);
    expect(params(url).get("text")).to.equal("a\\+b \\-c");
    expect(params(url).has("filter")).to.equal(false);
    expect(escapeContentText('"My Project" AND x')).to.equal(
      '"My Project" AND x',
    );
  });

  it("refuses content text that starts with a wildcard", () => {
    expect(validateContentText("*data")).to.equal("wildcardStart");
    expect(validateContentText(" ?x")).to.equal("wildcardStart");
    expect(validateContentText("data*")).to.be.undefined;
  });

  it("finds the folder of a path", () => {
    expect(parentPath("/Acme/Study1/adsl.sas")).to.equal("/Acme/Study1");
    expect(parentPath("/Acme")).to.equal("/");
  });
});
