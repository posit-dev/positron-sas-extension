// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

import { csvField, toCsv } from "../../src/clinical/report/html";
import {
  SignatureReportLabels,
  renderSignatureReport,
  signatureReportTitle,
  signaturesCsv,
} from "../../src/clinical/signatureReport";
import {
  buildSignRequest,
  describeSignRequest,
  isValidPin,
  normalizePin,
  parseStringList,
  partitionSignable,
} from "../../src/clinical/signing";
import type {
  RepositoryItem,
  ResourceCollection,
  Signature,
} from "../../src/clinical/types";
import {
  buildSignaturesUrl,
  collectPages,
  hasSignatures,
  isSigned,
  sortSignatures,
} from "../../src/clinical/utils";

// The response in the clinicalRepository v3 API documentation.
function fixture(): ResourceCollection<Signature> {
  let dir = __dirname;
  while (!fs.existsSync(path.join(dir, "package.nls.json"))) {
    dir = path.dirname(dir);
  }
  return JSON.parse(
    fs.readFileSync(
      path.join(
        dir,
        "client/test/positron/fixtures/clinicalRepository/signatures.json",
      ),
      "utf8",
    ),
  );
}

const labels: SignatureReportLabels = {
  title: "Signature History",
  file: "File",
  location: "Location",
  version: "Version",
  status: "Status",
  signatures: "Signatures",
  date: "Date signed",
  signedBy: "Signed by",
  userId: "User ID",
  role: "Role",
  reason: "Reason",
  comment: "Comment",
  none: "No signatures.",
  latestOnly: "Latest version only.",
  generated: "Generated",
  statuses: {
    NONE: "Not signed",
    CURRENT: "Signed",
    PREVIOUS: "Earlier versions signed",
    BOTH: "Signed, and earlier versions",
  },
};

const generatedAt = new Date("2026-11-13T12:00:00Z");

const signature = (extra: Partial<Signature> = {}): Signature => ({
  id: "s1",
  fileId: "f1",
  userId: "ann",
  userDisplayName: "Ann Analyst",
  role: "Reviewer",
  reason: "Approve",
  creationTimeStamp: "2026-11-01T10:00:00Z",
  ...extra,
});

const subject = {
  name: "adsl.sas",
  path: "/Acme/Study1/adam/adsl.sas",
  versioned: true,
  signingStatus: "CURRENT",
};

describe("signature helpers", () => {
  const file = (signingStatus?: string): RepositoryItem => ({
    id: "f1",
    name: "adsl.sas",
    path: "/Acme/adsl.sas",
    typeId: "sasprogram",
    primaryType: "FILE",
    signingStatus,
  });

  it("shows Signed only when the latest version is signed", () => {
    expect(isSigned(file("CURRENT"))).to.equal(true);
    expect(isSigned(file("BOTH"))).to.equal(true);
    expect(isSigned(file("PREVIOUS"))).to.equal(false);
    expect(isSigned(file("NONE"))).to.equal(false);
    expect(isSigned(file())).to.equal(false);
  });

  it("offers a history whenever some version is signed", () => {
    expect(hasSignatures(file("PREVIOUS"))).to.equal(true);
    expect(hasSignatures(file("BOTH"))).to.equal(true);
    expect(hasSignatures(file("NONE"))).to.equal(false);
    expect(hasSignatures(file())).to.equal(false);
  });

  it("builds the signatures URL, for a file or one version", () => {
    expect(buildSignaturesUrl("a b")).to.equal(
      "/clinicalRepository/repository/items/a%20b/signatures?start=0&limit=500",
    );
    expect(buildSignaturesUrl("f1", "2.0")).to.equal(
      "/clinicalRepository/repository/items/f1/signatures?start=0&limit=500&fileVersion=2.0",
    );
  });

  it("sorts newest first and keeps undated ones last, in order", () => {
    const sorted = sortSignatures([
      signature({ id: "old", creationTimeStamp: "2026-01-01T00:00:00Z" }),
      signature({ id: "undated-1", creationTimeStamp: undefined }),
      signature({ id: "new", creationTimeStamp: "2026-11-01T00:00:00Z" }),
      signature({ id: "undated-2", creationTimeStamp: "not a date" }),
    ]);
    expect(sorted.map((s) => s.id)).to.deep.equal([
      "new",
      "old",
      "undated-1",
      "undated-2",
    ]);
  });

  it("reads every page of the documented response", async () => {
    const page = fixture();
    const items = await collectPages<Signature>(
      async () => page,
      buildSignaturesUrl("8ab1344f-86e3-422a-8f80-a6124b8bebc2"),
    );
    expect(items.map((s) => s.fileVersion)).to.deep.equal(["2.0", "6.1"]);
  });
});

describe("renderSignatureReport", () => {
  it("lists the documented signatures, newest first", () => {
    const html = renderSignatureReport(subject, fixture().items, labels, {
      generatedAt,
      locale: "en-US",
    });
    expect(html).to.match(/^<!DOCTYPE html>/);
    expect(html).to.include("<title>Signature History: adsl.sas</title>");
    expect(html).to.include("SAS Test User 1");
    expect(html).to.include("<code>sastest1</code>");
    expect(html.indexOf("6.1")).to.be.lessThan(html.indexOf(">2.0<"));
    // The file's own status; no note about earlier versions, since the list
    // spans two versions.
    expect(html).to.include("<td>Signed</td>");
    expect(html).to.not.include("Latest version only.");
    // Without links (exports), the file name is plain text.
    expect(html).to.not.include("<a href");
  });

  it("notes that earlier versions have their own history", () => {
    const html = renderSignatureReport(
      subject,
      [signature({ fileVersion: "3.0" }), signature({ fileVersion: "3.0" })],
      labels,
      { generatedAt },
    );
    expect(html).to.include("Latest version only.");
  });

  it("links to the file when the report has links", () => {
    const html = renderSignatureReport(subject, [], labels, {
      generatedAt,
      link: "../open?target=x&y",
    });
    expect(html).to.include(
      '<a href="../open?target=x&amp;y"><code>adsl.sas</code></a>',
    );
  });

  it("says so when there are no signatures", () => {
    const html = renderSignatureReport(subject, [], labels, { generatedAt });
    expect(html).to.include('<p class="empty">No signatures.</p>');
  });

  it("describes one version, without the file's status or the note", () => {
    const version = { ...subject, version: "2.0" };
    expect(signatureReportTitle(version, labels)).to.equal(
      "Signature History: adsl.sas v2.0",
    );
    const html = renderSignatureReport(version, [signature()], labels, {
      generatedAt,
    });
    expect(html).to.not.include("Latest version only.");
    expect(html).to.not.include("<td>Signed</td>");
  });

  it("leaves out empty Version and Comment columns", () => {
    const plain = renderSignatureReport(
      { ...subject, versioned: false },
      [signature({ fileVersion: "-" })],
      labels,
      { generatedAt },
    );
    expect(plain).to.not.include("<th>Version</th>");
    expect(plain).to.not.include("<th>Comment</th>");
    expect(plain).to.not.include("Latest version only.");

    const commented = renderSignatureReport(
      subject,
      [signature({ fileVersion: "1.0", comment: "QC passed" })],
      labels,
      { generatedAt },
    );
    expect(commented).to.include("<th>Version</th>");
    expect(commented).to.include("<th>Comment</th>");
    expect(commented).to.include("QC passed");
  });

  it("escapes what the server returns", () => {
    const html = renderSignatureReport(
      { ...subject, name: "<b>x</b>.sas" },
      [signature({ userDisplayName: "<script>", reason: 'a "b" & c' })],
      labels,
      { generatedAt },
    );
    expect(html).to.not.include("<script>");
    expect(html).to.not.include("<b>x</b>");
    expect(html).to.include("&lt;script&gt;");
    expect(html).to.include("a &quot;b&quot; &amp; c");
  });
});

describe("signaturesCsv", () => {
  it("writes a header and one row per signature, newest first", () => {
    const csv = signaturesCsv(
      [
        signature({ id: "old", creationTimeStamp: "2026-01-01T00:00:00Z" }),
        signature({
          comment: 'Checked, "all" fine',
          fileVersion: "2.0",
        }),
      ],
      labels,
    );
    expect(csv.split("\r\n")).to.deep.equal([
      "Date signed,Signed by,User ID,Role,Reason,Version,Comment",
      '2026-11-01T10:00:00Z,Ann Analyst,ann,Reviewer,Approve,2.0,"Checked, ""all"" fine"',
      "2026-01-01T00:00:00Z,Ann Analyst,ann,Reviewer,Approve,,",
      "",
    ]);
  });

  it("quotes only fields that need it", () => {
    expect(csvField("plain")).to.equal("plain");
    expect(csvField("a,b")).to.equal('"a,b"');
    expect(csvField("line\nbreak")).to.equal('"line\nbreak"');
    expect(csvField(undefined)).to.equal("");
    expect(toCsv(["a"], [])).to.equal("a\r\n");
  });
});

describe("signing", () => {
  const item = (
    id: string,
    extra: Partial<RepositoryItem> = {},
  ): RepositoryItem => ({
    id,
    name: `${id}.sas`,
    path: `/Acme/${id}.sas`,
    typeId: "sasprogram",
    primaryType: "FILE",
    ...extra,
  });

  it("builds the SIGN body the web app sends", () => {
    expect(
      buildSignRequest(
        [item("a"), item("b")],
        { role: "Reviewer", reason: "Approve", comment: " QC done " },
        " 123456 ",
      ),
    ).to.deep.equal({
      pin: "123456",
      role: "Reviewer",
      reason: "Approve",
      comment: "QC done",
      paths: ["/Acme/a.sas", "/Acme/b.sas"],
    });
    expect(
      buildSignRequest([item("a")], { role: "R", reason: "A" }, "123456")
        .comment,
    ).to.equal("");
  });

  it("never puts the PIN in what is logged", () => {
    const request = buildSignRequest(
      [item("a")],
      { role: "Reviewer", reason: "Approve", comment: "ok" },
      "987654",
    );
    const line = describeSignRequest(request);
    expect(line).to.not.include("987654");
    expect(line).to.include("Reviewer");
    expect(line).to.include("/Acme/a.sas");
  });

  it("accepts 6 to 8 digit PINs, spaces ignored", () => {
    expect(isValidPin("123456")).to.equal(true);
    expect(isValidPin("123 456")).to.equal(true);
    expect(isValidPin("12345678")).to.equal(true);
    expect(isValidPin("12345")).to.equal(false);
    expect(isValidPin("123456789")).to.equal(false);
    expect(isValidPin("12a456")).to.equal(false);
    expect(isValidPin("")).to.equal(false);
    expect(normalizePin(" 123 456 ")).to.equal("123456");
  });

  it("leaves out checked-out files, folders and duplicates", () => {
    const folder = item("f", { primaryType: "FOLDER" });
    const { signable, checkedOut } = partitionSignable([
      item("a"),
      folder,
      item("b", { checkedOut: true }),
      item("a"),
      item("c"),
    ]);
    expect(signable.map((f) => f.id)).to.deep.equal(["a", "c"]);
    expect(checkedOut.map((f) => f.id)).to.deep.equal(["b"]);
  });

  it("reads the reasons and roles lists", () => {
    expect(parseStringList(["Approve", "Reject"])).to.deep.equal([
      "Approve",
      "Reject",
    ]);
    expect(parseStringList({ items: ["Reviewer", 3, ""] })).to.deep.equal([
      "Reviewer",
    ]);
    expect(parseStringList("Approve")).to.deep.equal([]);
    expect(parseStringList(undefined)).to.deep.equal([]);
  });
});
