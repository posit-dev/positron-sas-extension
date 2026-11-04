// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { authentication } from "vscode";

import axios, { AxiosInstance, HeadersDefaults } from "axios";
import { expect } from "chai";
import * as sinon from "sinon";
import { StubbedInstance, stubInterface } from "ts-sinon";

import { RepositoryModel } from "../../src/clinical/RepositoryModel";
import { WorkspaceModel } from "../../src/clinical/WorkspaceModel";
import type {
  RepositoryItem,
  VersionRow,
  WorkspaceItem,
} from "../../src/clinical/types";
import { profileConfig } from "../../src/commands/profile";
import { ConnectionType } from "../../src/components/profile";

const WS = "/clinicalRepository/workspaces/@currentUser";
const folder: WorkspaceItem = {
  name: "Study1",
  path: "/Acme/Study1",
  type: "FOLDER",
};
const file: WorkspaceItem = {
  name: "adsl.sas",
  path: "/Acme/Study1/adsl.sas",
  type: "FILE",
};
const repoFile: RepositoryItem = {
  id: "11",
  name: "adsl.sas",
  path: "/Acme/Study1/adam/adsl.sas",
  typeId: "sasprogram",
  primaryType: "FILE",
};

const done = { data: { summary: { endTimeStamp: "2026-10-26T12:00:00Z" } } };
const failed = {
  data: {
    summary: {
      endTimeStamp: "2026-10-26T12:00:00Z",
      completionStatus: "ERROR",
    },
    details: [{ itemName: "a.sas", message: "no space left" }],
  },
};

describe("Clinical WorkspaceModel", () => {
  let sandbox: sinon.SinonSandbox;
  let connection: StubbedInstance<AxiosInstance>;
  let model: WorkspaceModel;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    sandbox.stub(authentication, "getSession").resolves({
      accessToken: "token-1",
      account: { id: "me", label: "Me" },
      id: "session",
      scopes: [],
    });
    sandbox.stub(profileConfig, "getActiveProfileDetail").returns({
      name: "Viya",
      profile: {
        connectionType: ConnectionType.Rest,
        endpoint: "https://viya.example.com",
      },
    });
    connection = stubInterface<AxiosInstance>();
    connection.interceptors.response = {
      use: () => 0,
      eject: () => undefined,
      clear: () => undefined,
    };
    const headers: HeadersDefaults = {
      common: { Authorization: "" },
      put: {},
      post: {},
      patch: {},
      delete: {},
      head: {},
      get: {},
    };
    connection.defaults = {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      headers: headers as AxiosInstance["defaults"]["headers"],
    };
    sandbox.stub(axios, "create").returns(connection);
    model = new WorkspaceModel(new RepositoryModel());
  });

  afterEach(() => sandbox.restore());

  /**
   * Make a batch action finish with the given final status. Other posts
   * (the content of a download) answer with `content`. (ts-sinon has its own
   * sinon, so matchers from ours don't work in `withArgs`.)
   */
  const batchFinishes = (
    status: unknown = done,
    content: ArrayBuffer = new ArrayBuffer(0),
  ) => {
    connection.post.callsFake(async (url: string) =>
      url.includes("/items/batch?action=")
        ? {
            headers: {
              location: "/clinicalActionStatus/actionstatus/act-1",
            },
          }
        : { data: content, headers: {} },
    );
    connection.get
      .withArgs("/clinicalActionStatus/actionstatus/act-1")
      .resolves(status);
  };

  const batchCall = () =>
    connection.post
      .getCalls()
      .find((c) => String(c.args[0]).includes("/items/batch?action="));

  describe("reading", () => {
    it("lists the root and follows next links", async () => {
      connection.get
        .withArgs(`${WS}/items?includeSynchronizationInfo=true`)
        .resolves({
          data: { items: [folder], links: [{ rel: "next", href: "/more" }] },
        });
      connection.get.withArgs("/more").resolves({ data: { items: [file] } });
      const children = await model.getChildren(undefined);
      expect(children.map((c) => c.name)).to.deep.equal(["Study1", "adsl.sas"]);
      expect(connection.get.firstCall.args[1]?.headers?.Accept).to.equal(
        "application/vnd.sas.collection+json",
      );
      // Every page is asked for in the same way.
      expect(connection.get.secondCall.args[1]?.headers?.Accept).to.equal(
        "application/vnd.sas.collection+json",
      );
    });

    it("lists a folder by its path", async () => {
      connection.get.resolves({ data: { items: [] } });
      await model.getChildren({ ...folder, path: "/Acme/My Study" });
      expect(connection.get.firstCall.args[0]).to.equal(
        `${WS}/items/Acme/My%20Study?includeSynchronizationInfo=true`,
      );
    });

    it("reads a file's details", async () => {
      connection.get.resolves({ data: { ...file, size: 5 } });
      expect((await model.getItem(file.path)).size).to.equal(5);
      expect(connection.get.firstCall.args[0]).to.equal(
        `${WS}/items/Acme/Study1/adsl.sas?type=FILE&includeSynchronizationInfo=true`,
      );
    });

    it("reads a file's content as bytes", async () => {
      connection.post.resolves({ data: new Uint8Array([0, 255, 7]).buffer });
      expect(await model.getContent(file.path)).to.deep.equal(
        new Uint8Array([0, 255, 7]),
      );
      const [url, body, config] = connection.post.firstCall.args;
      expect(url).to.equal(`${WS}/items/content`);
      expect(body).to.deep.equal({ paths: [file.path] });
      expect(config?.responseType).to.equal("arraybuffer");
    });
  });

  describe("writing", () => {
    it("saves content as one multipart file part named after the file", async () => {
      connection.put.resolves({ data: file });
      await model.saveContent(file.path, new Uint8Array([1, 2, 3]));
      const [url, body, config] = connection.put.firstCall.args;
      expect(url).to.equal(`${WS}/items/Acme/Study1/adsl.sas?expand=false`);
      expect(body).to.be.instanceOf(FormData);
      const form = body instanceof FormData ? body : new FormData();
      expect([...form.keys()]).to.deep.equal(["file"]);
      const part = form.get("file");
      expect(part).to.have.property("name", "adsl.sas");
      expect(part).to.have.property("size", 3);
      // axios adds the Content-Type with the boundary.
      expect(config?.headers?.["Content-Type"]).to.be.undefined;
    });

    it("creates a file by saving nothing", async () => {
      connection.put.resolves({ data: file });
      await model.createFile("/Acme/Study1", "adsl.sas");
      const [url, body] = connection.put.firstCall.args;
      expect(url).to.equal(`${WS}/items/Acme/Study1/adsl.sas?expand=false`);
      const form = body instanceof FormData ? body : new FormData();
      expect(form.get("file")).to.have.property("size", 0);
    });

    it("creates folders", async () => {
      connection.post.resolves({ data: folder });
      await model.createFolder("/Acme", "new folder");
      expect(connection.post.firstCall.args[0]).to.equal(
        `${WS}/folders/Acme?name=new%20folder`,
      );
      await model.createFolder("/", "top");
      expect(connection.post.secondCall.args[0]).to.equal(
        `${WS}/folders?name=top`,
      );
    });

    it("renames with the new name as a JSON string", async () => {
      connection.post.resolves({
        data: { ...file, name: "adsl2.sas", path: "/Acme/Study1/adsl2.sas" },
      });
      const renamed = await model.rename(file, "adsl2.sas");
      const [url, body, config] = connection.post.firstCall.args;
      expect(url).to.equal(`${WS}/items/Acme/Study1/adsl.sas?action=RENAME`);
      expect(body).to.equal('"adsl2.sas"');
      expect(config?.headers?.["Content-Type"]).to.equal("application/json");
      expect(renamed.path).to.equal("/Acme/Study1/adsl2.sas");
    });

    it("works out the new path itself if the server doesn't send it", async () => {
      connection.post.resolves({ data: undefined });
      expect(await model.rename(file, "b.sas")).to.deep.include({
        name: "b.sas",
        path: "/Acme/Study1/b.sas",
      });
      expect(
        await model.rename({ ...file, path: "/adsl.sas" }, "b.sas"),
      ).to.have.property("path", "/b.sas");
    });
  });

  describe("batch actions", () => {
    it("copies the latest version of files and folders", async () => {
      batchFinishes();
      await model.copyLatestVersion([repoFile], () => false);
      const call = batchCall();
      expect(String(call?.args[0])).to.match(
        /^\/clinicalRepository\/workspaces\/@currentUser\/items\/batch\?action=COPY_LATEST_VERSION&clientId=/,
      );
      expect(call?.args[1]).to.deep.equal([repoFile.path]);
    });

    it("copies the folder structure with subfolders", async () => {
      batchFinishes();
      await model.copyFolderStructure([repoFile], () => false);
      const call = batchCall();
      expect(String(call?.args[0])).to.include("action=COPY_FOLDER_STRUCTURE");
      expect(call?.args[1]).to.deep.equal({
        paths: [repoFile.path],
        includeSubfolders: true,
      });
    });

    it("copies one version by path and version", async () => {
      batchFinishes();
      const version: VersionRow = {
        fileId: "11",
        fileVersion: "2.0",
        name: "adsl.sas",
        path: repoFile.path,
      };
      await model.copySpecificVersion(version, () => false);
      const call = batchCall();
      expect(String(call?.args[0])).to.include("action=COPY_SPECIFIC_VERSION");
      expect(call?.args[1]).to.deep.equal([
        { path: repoFile.path, fileVersion: "2.0" },
      ]);
    });

    it("deletes and undoes check outs with path lists", async () => {
      batchFinishes();
      await model.delete([file, folder], () => false);
      expect(String(batchCall()?.args[0])).to.include("action=DELETE");
      expect(batchCall()?.args[1]).to.deep.equal([file.path, folder.path]);
      connection.post.resetHistory();
      await model.undoCheckout([file], () => false);
      expect(String(batchCall()?.args[0])).to.include("action=UNDO_CHECKOUT");
      expect(batchCall()?.args[1]).to.deep.equal([file.path]);
    });

    it("checks in with the body it is given", async () => {
      batchFinishes();
      const body = {
        fileSpecifications: [{ path: file.path, type: "FILE" as const }],
        comment: "c",
        includeNewFiles: true as const,
      };
      await model.checkIn(body, () => false);
      expect(String(batchCall()?.args[0])).to.include("action=CHECK_IN");
      expect(batchCall()?.args[1]).to.deep.equal(body);
    });

    it("lists what can be checked in", async () => {
      connection.post.resolves({
        data: {
          items: [{ name: "a.sas", path: "/a.sas", synchronizationInfo: {} }],
        },
      });
      const items = await model.getCheckInCandidates(["/Acme"]);
      expect(items).to.have.length(1);
      const [url, body, config] = connection.post.firstCall.args;
      expect(url).to.equal(
        "/clinicalRepository/synchronization/items?type=CHECKIN",
      );
      expect(body).to.deep.equal(["/Acme"]);
      expect(config?.headers?.Accept).to.equal(
        "application/vnd.sas.collection+json",
      );
    });

    it("has no candidates when the server lists none", async () => {
      connection.post.resolves({ data: {} });
      expect(await model.getCheckInCandidates(["/Acme"])).to.deep.equal([]);
    });
  });

  describe("download", () => {
    it("announces the download, then asks for the content with its token", async () => {
      batchFinishes(done, new Uint8Array([9, 8]).buffer);
      const content = await model.download([file, folder], () => false);
      expect(content).to.deep.equal(new Uint8Array([9, 8]));
      expect(batchCall()?.args[1]).to.deep.equal([file.path, folder.path]);
      const contentCall = connection.post
        .getCalls()
        .find((c) => c.args[0] === `${WS}/items/content`);
      expect(contentCall?.args[1]).to.deep.equal({
        paths: [file.path, folder.path],
        actionStatusId: "act-1",
      });
    });

    it("fails if the server ends the action with an error", async () => {
      batchFinishes(failed);
      let message = "";
      try {
        await model.download([file], () => false);
      } catch (error) {
        message = error instanceof Error ? error.message : "";
      }
      expect(message).to.equal("no space left");
    });
  });

  describe("upload", () => {
    beforeEach(() => {
      batchFinishes();
      connection.put.resolves({ data: {} });
    });

    it("announces the file, sends it, and waits for the action", async () => {
      await model.upload(
        "/Acme",
        "a b.sas",
        new Uint8Array([1]),
        false,
        () => false,
      );
      expect(String(batchCall()?.args[0])).to.include("action=UPLOAD&");
      expect(batchCall()?.args[1]).to.deep.equal(["/Acme/a b.sas"]);
      const [url, body] = connection.put.firstCall.args;
      expect(url).to.equal(
        `${WS}/items/Acme/a%20b.sas?expand=false&actionStatusId=act-1`,
      );
      const form = body instanceof FormData ? body : new FormData();
      expect(form.get("file")).to.have.property("name", "a b.sas");
      // The action is polled after the file was sent.
      expect(
        connection.get.calledWith("/clinicalActionStatus/actionstatus/act-1"),
      ).to.be.true;
    });

    it("unpacks a zip into the folder itself", async () => {
      await model.upload(
        "/Acme",
        "data.zip",
        new Uint8Array([1]),
        true,
        () => false,
      );
      expect(String(batchCall()?.args[0])).to.include("action=UPLOAD_EXPAND");
      expect(connection.put.firstCall.args[0]).to.equal(
        `${WS}/items/Acme?expand=true&actionStatusId=act-1`,
      );
    });

    it("names the root when unpacking a zip there", async () => {
      await model.upload(
        "/",
        "data.zip",
        new Uint8Array([1]),
        true,
        () => false,
      );
      expect(batchCall()?.args[1]).to.deep.equal(["/data.zip"]);
      expect(connection.put.firstCall.args[0]).to.equal(
        `${WS}/items?path=%2F&expand=true&actionStatusId=act-1`,
      );
    });

    it("fails if the server ends the action with an error", async () => {
      connection.get
        .withArgs("/clinicalActionStatus/actionstatus/act-1")
        .resolves(failed);
      let message = "";
      try {
        await model.upload(
          "/Acme",
          "a.sas",
          new Uint8Array([1]),
          false,
          () => false,
        );
      } catch (error) {
        message = error instanceof Error ? error.message : "";
      }
      expect(message).to.equal("no space left");
    });
  });
});
