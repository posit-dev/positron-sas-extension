// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

import {
  buildAuditEntriesUrl,
  buildAuditFilter,
  itemAuditFilter,
  normalizeLocation,
  parseDay,
  periodStart,
  quote,
  validateLocation,
} from "../../src/clinical/auditQuery";
import {
  AuditReportLabels,
  auditCsv,
  auditReportTitle,
  describeDetail,
  renderAuditReport,
} from "../../src/clinical/auditReport";
import type {
  AuditEntry,
  RepositoryItem,
  ResourceCollection,
} from "../../src/clinical/types";

// Shaped like the server's responses, with names replaced.
function json<T>(name: string): T {
  let dir = __dirname;
  while (!fs.existsSync(path.join(dir, "package.nls.json"))) {
    dir = path.dirname(dir);
  }
  return JSON.parse(
    fs.readFileSync(
      path.join(dir, "client/test/positron/fixtures/clinicalRepository", name),
      "utf8",
    ),
  );
}

const labels: AuditReportLabels = {
  title: "Audit History",
  query: "Search",
  entries: "Audit records",
  date: "Date",
  user: "Acted on by",
  action: "Action",
  object: "Object",
  name: "Name",
  location: "Location",
  mode: "Mode",
  details: "Changes",
  attribute: "Attribute",
  oldValue: "Old value",
  newValue: "New value",
  none: "No audit records match.",
  generated: "Generated",
  count: "{shown} of {total} records.",
  truncated: "Only the newest.",
  detailsLimited: "Changes for the first {count}.",
  scope: "Own actions only, unless administrator.",
  modes: { USER: "User", ADMIN: "Administrative", SYSTEM: "System" },
  objectTypes: { FILE: "File", FOLDER: "Folder", CONTEXT: "Context" },
};

const generatedAt = new Date("2026-11-13T12:00:00Z");

describe("audit filters", () => {
  it("is empty without conditions", () => {
    expect(buildAuditFilter({})).to.be.undefined;
    expect(buildAuditFilter({ name: "  ", actions: [], modes: [] })).to.be
      .undefined;
  });

  it("matches names case-insensitively, with wildcards as typed", () => {
    expect(buildAuditFilter({ name: " ad*.sas " })).to.equal(
      "like(sourceName,'ad*.sas')",
    );
  });

  it("includes a folder and its subfolders, not its look-alikes", () => {
    expect(buildAuditFilter({ location: "/Acme/Study1/" })).to.equal(
      "or(eq(sourceLocation,'/Acme/Study1'),like(sourceLocation,'/Acme/Study1/*'))",
    );
    // The root is everywhere.
    expect(buildAuditFilter({ location: "/" })).to.be.undefined;
  });

  it("combines actions, modes and the period", () => {
    expect(
      buildAuditFilter({
        actions: ["checkedIn", "checkedOut"],
        modes: ["USER"],
        from: new Date("2026-11-01T00:00:00Z"),
        to: new Date("2026-11-02T00:00:00Z"),
      }),
    ).to.equal(
      "and(in(action,'checkedIn','checkedOut'),in(mode,'USER'),ge(timestamp,2026-11-01T00:00:00.000Z),le(timestamp,2026-11-02T00:00:00.000Z))",
    );
  });

  it("doubles quotes in values", () => {
    expect(quote("it's")).to.equal("'it''s'");
    expect(buildAuditFilter({ name: "o'brien*" })).to.equal(
      "like(sourceName,'o''brien*')",
    );
  });

  it("finds a file by id, and a folder with its contents", () => {
    const file: RepositoryItem = {
      id: "f1",
      name: "adsl.sas",
      path: "/Acme/adsl.sas",
      typeId: "sasprogram",
      primaryType: "FILE",
    };
    expect(itemAuditFilter(file)).to.equal("eq(sourceId,'f1')");
    expect(
      itemAuditFilter({
        ...file,
        id: "d1",
        name: "programs",
        path: "/Acme/programs",
        primaryType: "FOLDER",
      }),
    ).to.equal(
      "or(eq(sourceId,'d1'),eq(sourceLocation,'/Acme/programs'),like(sourceLocation,'/Acme/programs/*'))",
    );
  });

  it("builds the URL newest first, filter encoded", () => {
    const url = buildAuditEntriesUrl("/a", "eq(sourceId,'x y')", 500);
    expect(url).to.match(
      /^\/a\?start=0&limit=500&sortBy=timestamp%3Adescending/,
    );
    expect(new URLSearchParams(url.split("?")[1]).get("filter")).to.equal(
      "eq(sourceId,'x y')",
    );
    expect(buildAuditEntriesUrl("/a", undefined, 5)).to.not.include("filter");
  });

  it("normalizes and checks locations", () => {
    expect(normalizeLocation(" /Acme/ ")).to.equal("/Acme");
    expect(normalizeLocation("/")).to.equal("/");
    expect(validateLocation("/Acme")).to.be.undefined;
    expect(validateLocation("")).to.be.undefined;
    expect(validateLocation("Acme")).to.equal("location");
  });

  it("reads typed days and periods", () => {
    const start = parseDay("2026-11-01");
    expect(start?.getDate()).to.equal(1);
    expect(start?.getHours()).to.equal(0);
    expect(parseDay("2026-11-01", true)?.getHours()).to.equal(23);
    expect(parseDay("2026-02-30")).to.be.undefined;
    expect(parseDay("11/01/2026")).to.be.undefined;
    const now = new Date("2026-11-13T12:00:00Z");
    expect(periodStart(7, now).toISOString()).to.equal(
      "2026-11-06T12:00:00.000Z",
    );
  });
});

describe("renderAuditReport", () => {
  const page = json<ResourceCollection<AuditEntry>>("audit-entries.json");
  const detailed = json<AuditEntry>("audit-entry.json");

  it("lists the entries with their changes and the search", () => {
    const entries = [page.items[0], detailed];
    const html = renderAuditReport(
      entries,
      [["Name", "<code>adsl*</code>"]],
      labels,
      { generatedAt, total: 3, detailsRead: 2, locale: "en-US" },
    );
    expect(html).to.include("<title>Audit History</title>");
    expect(html).to.include("<code>adsl*</code>");
    expect(html).to.include("Checked in");
    expect(html).to.include("Permissions changed");
    expect(html).to.include("Administrative");
    expect(html).to.include("user2: - r w d");
    expect(html).to.include("2 of 3 records.");
    expect(html).to.include("Only the newest.");
    expect(html).to.not.include("Changes for the first");
    expect(html).to.include("Own actions only, unless administrator.");
  });

  it("links the files it can open, only when asked", () => {
    const linkFor = (e: AuditEntry) =>
      e.sourcePrimaryType === "FILE" ? `../open?id=${e.sourceId}` : undefined;
    const html = renderAuditReport(page.items, [], labels, {
      generatedAt,
      linkFor,
    });
    expect(html).to.include(
      '<a href="../open?id=f1"><code>adsl.sas</code></a>',
    );
    expect(html).to.not.include("../open?id=d1");
    expect(
      renderAuditReport(page.items, [], labels, { generatedAt }),
    ).to.not.include("<a href");
  });

  it("says when details were read for some entries only", () => {
    const html = renderAuditReport(page.items, [], labels, {
      generatedAt,
      detailsRead: 1,
    });
    expect(html).to.include("Changes for the first 1.");
    // No details at all: no Changes column.
    expect(html).to.not.include("<th>Changes</th>");
  });

  it("says when nothing matches, and titles an item's history", () => {
    const html = renderAuditReport([], [], labels, { generatedAt }, "adsl.sas");
    expect(html).to.include('<p class="empty">No audit records match.</p>');
    expect(auditReportTitle(labels, "adsl.sas")).to.equal(
      "Audit History: adsl.sas",
    );
    expect(html).to.include("<title>Audit History: adsl.sas</title>");
  });

  it("escapes what the server returns", () => {
    const html = renderAuditReport(
      [
        {
          id: "x",
          sourceName: "<img src=x>",
          userDisplayName: "<script>",
          auditEntryDetails: [{ attributeName: "a", newValue: "<b>" }],
        },
      ],
      [],
      labels,
      { generatedAt },
    );
    expect(html).to.not.include("<script>");
    expect(html).to.not.include("<img");
    expect(html).to.include("a: &lt;b&gt;");
  });

  it("describes changes with and without an old value", () => {
    expect(
      describeDetail({ attributeName: "Owner", oldValue: "a", newValue: "b" }),
    ).to.equal("Owner: a → b");
    expect(describeDetail({ attributeId: "u", newValue: "r" })).to.equal(
      "u: r",
    );
    expect(describeDetail({ newValue: "v" })).to.equal("v");
  });
});

describe("auditCsv", () => {
  it("writes one row per entry with ISO dates and ids", () => {
    const page = json<ResourceCollection<AuditEntry>>("audit-entries.json");
    const detailed = json<AuditEntry>("audit-entry.json");
    const lines = auditCsv([page.items[0], detailed], labels).split("\r\n");
    expect(lines[0]).to.equal(
      "Date,Acted on by,Action,Object,Name,Location,Mode,Changes",
    );
    expect(lines[1]).to.equal(
      "2026-11-12T08:05:58.724Z,user1,checkedIn,FILE,adsl.sas,/Acme/Study1/programs,USER,",
    );
    expect(lines[2]).to.equal(
      "2026-11-11T17:00:00.000Z,user1,aclUpdated,FOLDER,programs,/Acme/Study1,ADMIN,user2: - r w d",
    );
  });
});
