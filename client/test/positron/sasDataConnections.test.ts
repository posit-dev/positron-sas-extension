// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";
import sinon from "sinon";

import type { PositronApi } from "../../src/positron/positron-types";
import {
  SasDataConnectionSource,
  SasDataConnectionsDriver,
  isDataConnectionsPaneActive,
} from "../../src/positron/sasDataConnections";

function makeSource(profileName = "Viya"): SasDataConnectionSource {
  return {
    profileName,
    host: "https://viya.example.com",
    client: {
      getLibraryList: sinon.stub().resolves(["SASHELP", "WORK"]),
      getLibraryMembers: sinon.stub().resolves([
        { name: "CLASS", type: "DATA" },
        { name: "VCOLUMN", type: "VIEW" },
      ]),
      getDatasetColumns: sinon.stub().resolves([
        { name: "Name", type: "char", length: 8 },
        { name: "Age", type: "num", length: 8 },
      ]),
    },
    openDataExplorer: sinon.stub(),
  };
}

describe("isDataConnectionsPaneActive", () => {
  const withDriverApi = {
    dataConnections: { registerDriver: () => ({ dispose() {} }) },
  } as unknown as PositronApi;
  const legacyApi = {} as PositronApi;

  it("is true when the API exists and the setting is on", () => {
    expect(isDataConnectionsPaneActive(withDriverApi, true)).to.be.true;
  });

  it("is false when the setting is off or unset", () => {
    expect(isDataConnectionsPaneActive(withDriverApi, false)).to.be.false;
    expect(isDataConnectionsPaneActive(withDriverApi, undefined)).to.be.false;
  });

  it("is false on Positron builds without the Data Connections API", () => {
    expect(isDataConnectionsPaneActive(legacyApi, true)).to.be.false;
  });
});

describe("SasDataConnectionsDriver", () => {
  it("discovers one connection per registered session", async () => {
    const driver = new SasDataConnectionsDriver();
    const changed = sinon.spy();
    driver.onDidChange(changed);

    const registration = driver.addSource(makeSource("Viya"));
    expect(changed.callCount).to.equal(1);
    expect(await driver.discoverConnections()).to.deep.equal([
      {
        id: "Viya",
        name: "SAS (Viya)",
        description: "https://viya.example.com",
        mechanismId: "session",
        parameters: { profile: "Viya", content: "libraries" },
      },
    ]);

    registration.dispose();
    expect(changed.callCount).to.equal(2);
    expect(await driver.discoverConnections()).to.deep.equal([]);
  });

  it("keeps a restarted session when the old registration is disposed", async () => {
    const driver = new SasDataConnectionsDriver();
    const first = driver.addSource(makeSource("Viya"));
    const restarted = makeSource("Viya");
    driver.addSource(restarted);

    first.dispose();
    expect(await driver.discoverConnections()).to.have.length(1);

    const connection = await driver.connect("session", { profile: "Viya" });
    await connection.getChildren();
    expect(restarted.client.getLibraryList).to.have.property("callCount", 1);
  });

  it("rejects connecting to a profile without a running session", async () => {
    const driver = new SasDataConnectionsDriver();
    let error: unknown;
    try {
      await driver.connect("session", { profile: "Missing" });
    } catch (e) {
      error = e;
    }
    expect(String(error)).to.include(
      'No running SAS session for profile "Missing"',
    );
  });

  it("browses libraries, members and columns", async () => {
    const driver = new SasDataConnectionsDriver();
    const source = makeSource();
    driver.addSource(source);
    const connection = await driver.connect("session", { profile: "Viya" });

    const libraries = await connection.getChildren();
    expect(
      libraries.map(({ name, kind, path }) => ({ name, kind, path })),
    ).to.deep.equal([
      { name: "SASHELP", kind: "schema", path: "SASHELP" },
      { name: "WORK", kind: "schema", path: "WORK" },
    ]);

    const members = await libraries[0].getChildren!();
    expect(
      members.map(({ name, kind, path }) => ({ name, kind, path })),
    ).to.deep.equal([
      { name: "CLASS", kind: "table", path: "SASHELP.CLASS" },
      { name: "VCOLUMN", kind: "view", path: "SASHELP.VCOLUMN" },
    ]);
    expect(source.client.getLibraryMembers)
      .to.have.property("firstCall")
      .with.nested.property("args[0]", "SASHELP");

    const fields = await members[0].getChildren!();
    expect(fields).to.deep.equal([
      { name: "Name", kind: "field", dataType: "char(8)" },
      { name: "Age", kind: "field", dataType: "num" },
    ]);
  });

  it("previews a table in the Data Explorer", async () => {
    const driver = new SasDataConnectionsDriver();
    const source = makeSource();
    driver.addSource(source);
    const connection = await driver.connect("session", { profile: "Viya" });
    const [sashelp] = await connection.getChildren();
    const [cls] = await sashelp.getChildren!();

    await cls.preview!();
    expect(
      (source.openDataExplorer as sinon.SinonStub).calledOnceWith(
        "SASHELP",
        "CLASS",
      ),
    ).to.be.true;
  });

  it("reports the connection as disconnected once the session ends", async () => {
    const driver = new SasDataConnectionsDriver();
    const registration = driver.addSource(makeSource());
    const connection = await driver.connect("session", { profile: "Viya" });
    expect(await connection.isConnected()).to.be.true;

    registration.dispose();
    expect(await connection.isConnected()).to.be.false;
  });

  describe("server files", () => {
    function makeFilesSource() {
      const source = makeSource("Viya");
      source.serverFiles = {
        listDirectory: sinon.stub().callsFake(async (segments: string[]) =>
          segments.length === 0
            ? [
                { name: "code", isDirectory: true },
                { name: "data.sas7bdat", isDirectory: false },
              ]
            : [{ name: "hello.sas", isDirectory: false }],
        ),
        readFile: sinon.stub().resolves("proc print data=sashelp.class; run;"),
        getProperties: sinon
          .stub()
          .resolves({ size: 35, modified: "2026-10-18T12:00:00Z" }),
      };
      return source;
    }

    it("discovers a server files connection only for sources that have one", async () => {
      const driver = new SasDataConnectionsDriver();
      driver.addSource(makeSource("Local"));
      driver.addSource(makeFilesSource());
      const discovered = await driver.discoverConnections();
      expect(
        discovered.map((c) => [c.name, c.parameters.content]),
      ).to.deep.equal([
        ["SAS (Local)", "libraries"],
        ["SAS (Viya)", "libraries"],
        ["SAS Server Files (Viya)", "files"],
      ]);
    });

    it("rejects server files for a profile without them", async () => {
      const driver = new SasDataConnectionsDriver();
      driver.addSource(makeSource("Local"));
      let error: unknown;
      try {
        await driver.connect("session", { profile: "Local", content: "files" });
      } catch (e) {
        error = e;
      }
      expect(String(error)).to.include("Server files are not available");
    });

    it("browses folders and shows file content in the details", async () => {
      const driver = new SasDataConnectionsDriver();
      const source = makeFilesSource();
      driver.addSource(source);
      const connection = await driver.connect("session", {
        profile: "Viya",
        content: "files",
      });

      const root = await connection.getChildren();
      expect(
        root.map(({ name, kind, path }) => ({ name, kind, path })),
      ).to.deep.equal([
        { name: "code", kind: "directory", path: "/code" },
        { name: "data.sas7bdat", kind: "file", path: "/data.sas7bdat" },
      ]);

      const [file] = await root[0].getChildren!();
      expect(file).to.include({
        name: "hello.sas",
        kind: "file",
        path: "/code/hello.sas",
      });
      const details = await file.getDetails!();
      expect(details.sections).to.deep.equal([
        {
          kind: "properties",
          properties: [
            { name: "Path", value: "/code/hello.sas" },
            { name: "Size", value: "35 bytes" },
            { name: "Modified", value: "2026-10-18T12:00:00Z" },
          ],
        },
        {
          kind: "code",
          title: "Content",
          languageId: "sas",
          code: "proc print data=sashelp.class; run;",
        },
      ]);
      expect(
        (source.serverFiles!.readFile as sinon.SinonStub).calledOnceWith([
          "code",
          "hello.sas",
        ]),
      ).to.be.true;
    });

    it("does not read binary or large files", async () => {
      const driver = new SasDataConnectionsDriver();
      const source = makeFilesSource();
      driver.addSource(source);
      const connection = await driver.connect("session", {
        profile: "Viya",
        content: "files",
      });
      const [, dataset] = await connection.getChildren();
      const binary = await dataset.getDetails!();
      expect(binary.description).to.include("Binary file");
      expect(binary.sections.map((s) => s.kind)).to.deep.equal(["properties"]);

      (source.serverFiles!.getProperties as sinon.SinonStub).resolves({
        size: 10 * 1024 * 1024,
      });
      const [folder] = await connection.getChildren();
      const [big] = await folder.getChildren!();
      const large = await big.getDetails!();
      expect(large.description).to.include("too large");
      expect((source.serverFiles!.readFile as sinon.SinonStub).called).to.be
        .false;
    });
  });
});
