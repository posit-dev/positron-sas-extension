// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import { LsafClient } from "../../src/lsaf/LsafClient";
import { RepositoryModel } from "../../src/lsaf/RepositoryModel";
import {
  checkoutState,
  containerIcon,
  fileIcon,
  isContainer,
  isJob,
  normalizeRepositoryItem,
  repositoryContextValue,
  sortItems,
  versionLabel,
} from "../../src/lsaf/items";
import { renderPropertiesReport } from "../../src/lsaf/propertiesReport";
import { axiosTransport } from "../../src/lsaf/transport";
import type { RepositoryItem } from "../../src/lsaf/types";
import { LsafMockServer } from "../lsaf-mock/server";
import { shown } from "./lsafMenus.test";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

// From the spec's "Get children" expanded example.
const context: RepositoryItem = {
  schemaType: "context",
  typeId: "sas:project",
  name: "project1",
  path: "/org/project1",
  container: true,
  context: true,
};
const file = (extra: Partial<RepositoryItem> = {}): RepositoryItem => ({
  schemaType: "file",
  name: "adsl.sas",
  path: "/org/project1/adsl.sas",
  versioned: true,
  version: "2.0",
  checkedOut: false,
  signingStatus: "NONE",
  ...extra,
});

describe("LSAF repository items", () => {
  it("tells containers, files and jobs apart", () => {
    expect(isContainer(context)).to.equal(true);
    expect(isContainer({ schemaType: "sharedFolder", path: "/s" })).to.equal(
      true,
    );
    expect(isContainer({ schemaType: "folder", path: "/f" })).to.equal(true);
    expect(isContainer(file())).to.equal(false);
    expect(isJob({ path: "/a/report.job" })).to.equal(true);
    expect(isJob({ path: "/a/x", typeId: "sas:job" })).to.equal(true);
    expect(isJob({ path: "/a/x.sas" })).to.equal(false);
  });

  it("names items that a listing left unnamed", () => {
    expect(
      normalizeRepositoryItem({ schemaType: "folder", path: "/org/f1" }).name,
    ).to.equal("f1");
  });

  it("reads the check-out state for the signed-in user", () => {
    expect(checkoutState(file(), "me")).to.equal("none");
    expect(
      checkoutState(file({ checkedOut: true, checkedOutBy: "ME" }), "me"),
    ).to.equal("self");
    expect(
      checkoutState(file({ checkedOut: true, checkedOutBy: "you" }), "me"),
    ).to.equal("other");
  });

  it("builds delimited context values", () => {
    expect(repositoryContextValue(context, "me")).to.equal(";repo;container;");
    expect(repositoryContextValue(file(), "me")).to.equal(
      ";repo;file;notCheckedOut;versioned;",
    );
    expect(
      repositoryContextValue(
        file({
          path: "/a/r.job",
          checkedOut: true,
          checkedOutBy: "me",
          versioned: false,
          signingStatus: "CURRENT",
        }),
        "me",
      ),
    ).to.equal(";repo;file;checkedOutBySelf;job;signed;");
  });

  it("sorts folders first and picks icons", () => {
    const sorted = sortItems(
      [file({ name: "b.sas" }), { ...context, name: "z" }, file({ name: "a" })],
      isContainer,
    );
    expect(sorted.map((i) => i.name)).to.deep.equal(["z", "a", "b.sas"]);
    expect(fileIcon("/a/x.sas")).to.equal("sasProgramFile");
    expect(fileIcon("/a/x.xpt")).to.equal("sasDataSet");
    expect(fileIcon("/a/x.job")).to.equal("clinicalJobFile");
    expect(fileIcon("/a/x.txt")).to.equal("$file");
    expect(containerIcon(context)).to.equal("$project");
    expect(versionLabel(file())).to.equal("v2.0");
    expect(versionLabel(file({ versioned: false }))).to.equal(undefined);
  });

  it("offers the right repository menu items", () => {
    const view = "lsafrepositoryprovider";
    expect(
      shown("view/item/context", view, repositoryContextValue(context, "me")),
    ).to.include.members([
      "SAS.lsaf.download",
      "SAS.lsaf.showProperties",
      "SAS.lsaf.copyPath",
    ]);
    const fileMenu = shown(
      "view/item/context",
      view,
      repositoryContextValue(file(), "me"),
    );
    expect(fileMenu).to.include("SAS.lsaf.showVersions");
    expect(fileMenu).to.not.include("SAS.lsaf.upload");
  });

  it("renders the Properties report with versions and signatures", () => {
    const html = renderPropertiesReport({
      item: file({ digest: "ABC", size: 2048, createdBy: "<x>" }),
      versions: [
        { version: "1.0", path: "/p", comment: "first" },
        { version: "2.0", path: "/p", latest: true },
      ],
      signatures: [
        {
          userId: "sassjh",
          userDisplayName: "Sarah Holshouser",
          role: "Biostatistician",
          reason: "Reject",
          fileVersion: "2.0",
        },
      ],
      versionLink: (v) => `../open?target=${v}`,
    });
    expect(html).to.include("adsl.sas");
    expect(html).to.include("&lt;x&gt;");
    expect(html).to.include('<a href="../open?target=2.0">2.0 (latest)</a>');
    expect(html.indexOf("2.0 (latest)")).to.be.lessThan(html.indexOf("first"));
    expect(html).to.include("Sarah Holshouser (sassjh)");
  });
});

describe("LSAF repository model against the mock server", function () {
  this.timeout(10_000);
  let mock: LsafMockServer;
  let model: RepositoryModel;

  beforeEach(async () => {
    mock = new LsafMockServer({ jobDurationMs: 50 });
    const apiUrl = await mock.start();
    const client = new LsafClient(apiUrl, axiosTransport(apiUrl), {
      userId: "demo",
      secret: "demo",
    });
    await client.logon();
    model = new RepositoryModel(() => client);
  });

  afterEach(() => mock.stop());

  const lastRequest = () => mock.requests[mock.requests.length - 1];

  it("lists the top level and folders with every property", async () => {
    const top = await model.getChildren("/");
    expect(top.map((i) => i.path)).to.deep.equal(["/Org"]);
    expect(lastRequest().path).to.equal("/lsaf/api/repository/containers");
    expect(lastRequest().query).to.deep.include({
      component: "children",
      expand: "item",
    });
    expect(Number(lastRequest().query.limit)).to.be.greaterThan(100);
    const programs = await model.getChildren("/Org/Study1/programs");
    expect(programs.map((i) => i.name).sort()).to.deep.equal([
      "adae.sas",
      "adsl.sas",
    ]);
    expect(programs.find((i) => i.name === "adsl.sas")?.version).to.equal(
      "2.0",
    );
  });

  it("encodes paths with spaces", async () => {
    mock.addRepoFile("/Org/My Study/a b.sas", "x");
    const items = await model.getChildren("/Org/My Study");
    expect(items[0].name).to.equal("a b.sas");
    expect(text(await model.getContent("/Org/My Study/a b.sas"))).to.equal("x");
  });

  it("reads contents, versions and properties", async () => {
    const path = "/Org/Study1/programs/adsl.sas";
    expect(text(await model.getContent(path))).to.match(/^data work.adsl/);
    expect(text(await model.getContent(path, "1.0"))).to.match(/version 1.0/);
    expect(lastRequest().query).to.deep.equal({
      component: "contents",
      version: "1.0",
    });
    const versions = await model.getVersions(path);
    expect(versions.map((v) => [v.version, v.latest])).to.deep.equal([
      ["1.0", false],
      ["2.0", true],
    ]);
    expect((await model.getFileProperties(path)).versioned).to.equal(true);
    expect(
      (await model.getContainerProperties("/Org/Study1")).schemaType,
    ).to.equal("context");
    expect(await model.getSignatures(path)).to.deep.equal([]);
  });

  it("downloads a folder as a zip", async () => {
    const zip = await model.downloadContainer("/Org/Study1/programs");
    expect([zip[0], zip[1], zip[2], zip[3]]).to.deep.equal([
      0x50, 0x4b, 0x03, 0x04,
    ]);
  });

  it("reports a missing file as a 404 LsafError", async () => {
    try {
      await model.getFileProperties("/Org/nope.sas");
      expect.fail("should throw");
    } catch (error) {
      expect(error).to.have.property("status", 404);
    }
  });
});
