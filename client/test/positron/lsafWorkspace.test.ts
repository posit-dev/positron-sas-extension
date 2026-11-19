// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import { LsafActionError, LsafClient } from "../../src/lsaf/LsafClient";
import { RepositoryModel } from "../../src/lsaf/RepositoryModel";
import { WorkspaceModel } from "../../src/lsaf/WorkspaceModel";
import { workspaceContextValue } from "../../src/lsaf/items";
import { axiosTransport } from "../../src/lsaf/transport";
import type { RepositoryItem, WorkspaceItem } from "../../src/lsaf/types";
import { emptyFolderZip } from "../../src/lsaf/zip";
import {
  LsafMockServer,
  RecordedRequest,
  parseMultipart,
  readZip,
} from "../lsaf-mock/server";
import { shown } from "./lsafMenus.test";

const encoder = new TextEncoder();
const text = (bytes: Uint8Array | undefined) =>
  new TextDecoder().decode(bytes ?? new Uint8Array());

/** The multipart parts of a recorded request. */
const partsOf = (request: RecordedRequest) =>
  parseMultipart(
    // parseMultipart reads only the content type from the request.
    Object.assign(Object.create(null), { headers: request.headers }),
    request.body,
  );

describe("LSAF empty-folder zip", () => {
  it("holds one directory entry and nothing else", () => {
    const entries = readZip(emptyFolderZip("New Folder"));
    expect(entries.map((e) => e.name)).to.deep.equal(["New Folder/"]);
    expect(entries[0].data.length).to.equal(0);
    const zip = emptyFolderZip("x/");
    expect(readZip(zip)[0].name).to.equal("x/");
    // local header, then the central directory, then its end record
    expect(Array.from(zip.subarray(0, 4))).to.deep.equal([
      0x50, 0x4b, 0x03, 0x04,
    ]);
    expect(zip.length).to.equal(30 + 2 + 46 + 2 + 22);
  });
});

describe("LSAF workspace items and menus", () => {
  const wsFile: WorkspaceItem = {
    schemaType: "file",
    path: "/Org/S/adsl.sas",
    name: "adsl.sas",
  };
  const repo = (extra: Partial<RepositoryItem> = {}): RepositoryItem => ({
    schemaType: "file",
    path: "/Org/S/adsl.sas",
    versioned: true,
    ...extra,
  });
  const view = "lsafworkspaceprovider";
  const menu = (value: string) => shown("view/item/context", view, value);

  it("builds context values from the repository file at the same path", () => {
    expect(
      workspaceContextValue(
        { schemaType: "folder", path: "/Org" },
        undefined,
        "me",
      ),
    ).to.equal(";ws;folder;");
    expect(workspaceContextValue(wsFile, undefined, "me")).to.equal(
      ";ws;file;sas;notInRepository;",
    );
    expect(workspaceContextValue(wsFile, null, "me")).to.equal(";ws;file;sas;");
    expect(
      workspaceContextValue(
        wsFile,
        repo({ checkedOut: true, checkedOutBy: "me" }),
        "me",
      ),
    ).to.equal(";ws;file;sas;inRepository;checkedOutBySelf;versioned;");
  });

  it("offers check-in only for files checked out to the user", () => {
    const mine = menu(
      workspaceContextValue(
        wsFile,
        repo({ checkedOut: true, checkedOutBy: "me" }),
        "me",
      ),
    );
    expect(mine).to.include.members([
      "SAS.lsaf.checkIn",
      "SAS.lsaf.undoCheckOut",
      "SAS.lsaf.compareWithRepository",
    ]);
    expect(mine).to.not.include("SAS.lsaf.checkOut");
    const theirs = menu(
      workspaceContextValue(
        wsFile,
        repo({ checkedOut: true, checkedOutBy: "you" }),
        "me",
      ),
    );
    expect(theirs).to.not.include.members([
      "SAS.lsaf.checkIn",
      "SAS.lsaf.checkOut",
    ]);
    const free = menu(workspaceContextValue(wsFile, repo(), "me"));
    expect(free).to.include("SAS.lsaf.checkOut");
    const added = menu(workspaceContextValue(wsFile, undefined, "me"));
    expect(added).to.include("SAS.lsaf.addToRepository");
    expect(added).to.not.include("SAS.lsaf.compareWithRepository");
    const folder = menu(";ws;folder;");
    expect(folder).to.include.members([
      "SAS.lsaf.newFile",
      "SAS.lsaf.newFolder",
      "SAS.lsaf.upload",
      "SAS.lsaf.download",
    ]);
    expect(folder).to.not.include("SAS.lsaf.checkIn");
  });

  it("offers check-out, check-in and copy in the repository view", () => {
    const repoMenu = (value: string) =>
      shown("view/item/context", "lsafrepositoryprovider", value);
    expect(repoMenu(";repo;file;notCheckedOut;")).to.include.members([
      "SAS.lsaf.checkOut",
      "SAS.lsaf.copyToWorkspace",
    ]);
    expect(repoMenu(";repo;file;checkedOutBySelf;")).to.include.members([
      "SAS.lsaf.checkIn",
      "SAS.lsaf.undoCheckOut",
    ]);
    expect(repoMenu(";repo;container;")).to.include("SAS.lsaf.upload");
  });
});

describe("LSAF workspace and repository actions against the mock server", function () {
  this.timeout(10_000);
  let mock: LsafMockServer;
  let workspace: WorkspaceModel;
  let repository: RepositoryModel;

  beforeEach(async () => {
    mock = new LsafMockServer({ jobDurationMs: 50 });
    const apiUrl = await mock.start();
    const client = new LsafClient(apiUrl, axiosTransport(apiUrl), {
      userId: "demo",
      secret: "demo",
    });
    await client.logon();
    workspace = new WorkspaceModel(() => client);
    repository = new RepositoryModel(() => client);
  });

  afterEach(() => mock.stop());

  const last = () => mock.requests[mock.requests.length - 1];

  it("lists and reads the workspace", async () => {
    const top = await workspace.getChildren("/");
    expect(top.map((i) => i.path)).to.deep.equal(["/Org"]);
    expect(last().path).to.equal("/lsaf/api/workspace/folders");
    const programs = await workspace.getChildren("/Org/Study1/programs");
    expect(programs.map((i) => i.name)).to.deep.equal(["adsl.sas"]);
    expect(
      text(await workspace.getContent("/Org/Study1/programs/adsl.sas")),
    ).to.match(/^data work.adsl/);
    expect(
      await workspace.fileExists("/Org/Study1/programs/adsl.sas"),
    ).to.equal(true);
    expect(await workspace.fileExists("/Org/nope.sas")).to.equal(false);
  });

  it("saves with a multipart filename and file", async () => {
    await workspace.write(
      "/Org/Study1/programs/adsl.sas",
      encoder.encode("changed"),
    );
    const request = last();
    expect(request.method).to.equal("PUT");
    expect(request.query).to.deep.include({
      action: "upload",
      overwrite: "true",
      createParents: "true",
      expand: "item,status",
    });
    const parts = partsOf(request);
    expect(parts.map((p) => p.name)).to.deep.equal(["filename", "file"]);
    expect(text(parts[0].data)).to.equal("adsl.sas");
    expect(parts[1].filename).to.equal("adsl.sas");
    expect(
      text(mock.workspace.get("/Org/Study1/programs/adsl.sas")?.content),
    ).to.equal("changed");
  });

  it("refuses to create a file that exists", async () => {
    try {
      await workspace.write(
        "/Org/Study1/programs/adsl.sas",
        encoder.encode("x"),
        { overwrite: false },
      );
      expect.fail("should throw");
    } catch (error) {
      expect(error).to.be.instanceOf(LsafActionError);
      expect(String(error)).to.match(/overwrite is set to false/);
    }
  });

  it("creates a folder by expanding a zip", async () => {
    await workspace.createFolder("/Org/Study1", "New Folder");
    expect(mock.workspace.get("/Org/Study1/New Folder")?.type).to.equal(
      "folder",
    );
    const parts = partsOf(last());
    expect(parts[0].name).to.equal("uploadFile");
    expect(parts[0].filename).to.equal("New Folder.zip");
  });

  it("checks out, checks in a new version and undoes check-outs", async () => {
    const path = "/Org/Study1/programs/adsl.sas";
    await repository.checkOut(path, false);
    expect(last().query).to.deep.include({
      action: "checkout",
      copyToWorkspace: "false",
    });
    expect(mock.repository.get(path)?.checkedOutBy).to.equal("demo");
    await workspace.write(path, encoder.encode("v3"));
    await repository.checkIn(path, { version: "MINOR", comment: "Fix" });
    expect(last().query).to.deep.include({
      action: "checkin",
      version: "MINOR",
      comment: "Fix",
    });
    expect(String(last().headers["content-type"])).to.match(
      /^multipart\/form-data/,
    );
    const versions = await repository.getVersions(path);
    expect(versions.map((v) => v.version)).to.deep.equal(["1.0", "2.0", "2.1"]);
    expect(text(await repository.getContent(path))).to.equal("v3");
    expect(mock.repository.get(path)?.checkedOutBy).to.equal(undefined);

    await repository.checkOut(path);
    await repository.undoCheckOut(path);
    expect(mock.repository.get(path)?.checkedOutBy).to.equal(undefined);
  });

  it("reports a refused check-in as an action failure", async () => {
    try {
      await repository.checkIn("/Org/Study1/programs/adae.sas");
      expect.fail("should throw");
    } catch (error) {
      expect(error).to.be.instanceOf(LsafActionError);
      expect(String(error)).to.match(/not checked out to you/);
    }
  });

  it("adds new files to the repository, versioned or not", async () => {
    await repository.upload(
      "/Org/Study1/new/a.sas",
      "a.sas",
      encoder.encode("a"),
      { version: "MAJOR", comment: "Initial", createParents: true },
    );
    expect(last().query).to.deep.include({
      action: "upload",
      version: "MAJOR",
      comment: "Initial",
      createParents: "true",
    });
    const added = await repository.getFileProperties("/Org/Study1/new/a.sas");
    expect([added.versioned, added.version]).to.deep.equal([true, "1.0"]);
    await repository.upload(
      "/Org/Study1/new/b.txt",
      "b.txt",
      encoder.encode("b"),
    );
    expect(last().query).to.not.have.property("version");
    try {
      await repository.upload(
        "/Org/Study1/new/b.txt",
        "b.txt",
        encoder.encode("c"),
      );
      expect.fail("should throw");
    } catch (error) {
      expect(error).to.be.instanceOf(LsafActionError);
    }
  });
});
