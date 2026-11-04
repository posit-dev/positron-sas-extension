// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { authentication } from "vscode";

import axios, {
  AxiosError,
  AxiosHeaders,
  AxiosInstance,
  HeadersDefaults,
} from "axios";
import { expect } from "chai";
import * as sinon from "sinon";
import { StubbedInstance, stubInterface } from "ts-sinon";

import { RepositoryModel } from "../../src/clinical/RepositoryModel";
import type { RepositoryItem } from "../../src/clinical/types";
import { profileConfig } from "../../src/commands/profile";
import { ConnectionType } from "../../src/components/profile";

const folder: RepositoryItem = {
  id: "10",
  name: "adam",
  path: "/Acme/Study1/adam",
  typeId: "folder",
  primaryType: "FOLDER",
};
const file: RepositoryItem = {
  id: "11",
  name: "adsl.sas",
  path: "/Acme/Study1/adam/adsl.sas",
  typeId: "sasprogram",
  primaryType: "FILE",
};

describe("Clinical RepositoryModel", () => {
  let sandbox: sinon.SinonSandbox;
  let connection: StubbedInstance<AxiosInstance>;
  let model: RepositoryModel;
  let getSession: sinon.SinonStub;
  let createConnection: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    getSession = sandbox.stub(authentication, "getSession").resolves({
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
    createConnection = sandbox.stub(axios, "create").returns(connection);
    model = new RepositoryModel();
  });

  afterEach(() => sandbox.restore());

  it("authenticates with the SAS Viya sign-in", async () => {
    expect(await model.getCurrentUserId()).to.equal("me");
    expect(connection.defaults.headers.common.Authorization).to.equal(
      "Bearer token-1",
    );
  });

  it("replays a 401 request with the refreshed token", async () => {
    // Capture the response interceptor that the model installs on its connection.
    let onRejected: ((error: AxiosError) => Promise<unknown>) | undefined;
    const replay = sandbox.stub().resolves({ status: 200 });
    const replayConnection = Object.assign(replay, {
      defaults: connection.defaults,
      interceptors: {
        response: {
          use: (
            _onFulfilled: unknown,
            rejected: (error: AxiosError) => Promise<unknown>,
          ) => {
            onRejected = rejected;
            return 0;
          },
          eject: () => undefined,
          clear: () => undefined,
        },
      },
    });
    createConnection.returns(replayConnection);
    getSession.onSecondCall().resolves({
      accessToken: "token-2",
      account: { id: "me", label: "Me" },
      id: "session",
      scopes: [],
    });

    await model.getCurrentUserId();
    expect(connection.defaults.headers.common.Authorization).to.equal(
      "Bearer token-1",
    );

    // The failed request already carries the old token in its own headers.
    const config = {
      headers: AxiosHeaders.from({ Authorization: "Bearer token-1" }),
    };
    const failure = new AxiosError("Unauthorized", "ERR_BAD_REQUEST", config);
    failure.response = {
      status: 401,
      statusText: "Unauthorized",
      data: "",
      headers: {},
      config,
    };
    await onRejected?.(failure);

    expect(connection.defaults.headers.common.Authorization).to.equal(
      "Bearer token-2",
    );
    expect(replay.calledOnce).to.equal(true);
    expect(replay.firstCall.args[0].headers.Authorization).to.equal(
      "Bearer token-2",
    );
  });

  it("lists the root by path and follows next links", async () => {
    connection.get
      .withArgs("/clinicalRepository/repository/paths?path=%2F")
      .resolves({ data: { id: "1" } });
    connection.get
      .withArgs(
        "/clinicalRepository/repository/items/1/children?start=0&limit=500&includeSynchronizationInfo=true",
      )
      .resolves({
        data: {
          count: 1,
          items: [folder],
          links: [{ rel: "next", href: "/next-page" }],
        },
      });
    connection.get.withArgs("/next-page").resolves({
      data: { count: 1, items: [file], links: [] },
    });

    const children = await model.getChildren(undefined);
    expect(children.map((c) => c.id)).to.deep.equal(["10", "11"]);
  });

  it("creates folders without a request body", async () => {
    connection.post.resolves({ data: { ...folder, id: "12", name: "new" } });
    await model.createFolder(folder, "new folder");
    const [url, body, config] = connection.post.firstCall.args;
    expect(url).to.equal(
      "/clinicalRepository/repository/items/10/children?name=new%20folder&type=FOLDER",
    );
    expect(body).to.be.undefined;
    expect(config?.headers?.Accept).to.equal(
      "application/vnd.sas.clinical.repository.item+json",
    );
  });

  it("renames with the item's current ETag", async () => {
    connection.get.resolves({ data: file, headers: { etag: '"v7"' } });
    connection.patch.resolves({ data: { ...file, name: "adsl2.sas" } });
    await model.rename(file, "adsl2.sas");
    const [url, body, config] = connection.patch.firstCall.args;
    expect(url).to.equal("/clinicalRepository/repository/items/11");
    expect(body).to.deep.equal({ name: "adsl2.sas" });
    expect(config?.headers?.["If-Match"]).to.equal('"v7"');
  });

  it("uploads with expand, comment and version", async () => {
    connection.put.resolves({ data: file });
    await model.upload(
      folder,
      "a b.zip",
      new Uint8Array([1]),
      true,
      "first load",
      "1.0",
    );
    const [url, body, config] = connection.put.firstCall.args;
    expect(url).to.equal(
      "/clinicalRepository/repository/items/10/content?name=a%20b.zip&expand=true&comment=first%20load&fileVersion=1.0",
    );
    // multipart/form-data with one `file` part named after the upload; axios
    // adds the Content-Type and boundary itself, so none is set here.
    expect(body).to.be.instanceOf(FormData);
    const form = body instanceof FormData ? body : new FormData();
    const part = form.get("file");
    expect(part).to.be.instanceOf(File);
    expect(part).to.have.property("name", "a b.zip");
    expect(part).to.have.property("size", 1);
    expect([...form.keys()]).to.deep.equal(["file"]);
    expect(config?.headers?.["Content-Type"]).to.be.undefined;
  });

  it("does not version an upload unless asked to", async () => {
    connection.put.resolves({ data: file });
    await model.upload(folder, "a.sas", new Uint8Array([1]), false);
    expect(connection.put.firstCall.args[0]).to.equal(
      "/clinicalRepository/repository/items/10/content?name=a.sas&expand=false",
    );
    await model.upload(folder, "a.sas", new Uint8Array([1]), false, "", "");
    expect(connection.put.secondCall.args[0]).to.not.include("fileVersion");
  });

  it("sends version keywords in upper case", async () => {
    connection.put.resolves({ data: file });
    await model.upload(
      folder,
      "a.sas",
      new Uint8Array([1]),
      false,
      "",
      "major",
    );
    expect(connection.put.firstCall.args[0]).to.include("&fileVersion=MAJOR");
  });

  it("downloads one item or several by id filter", async () => {
    connection.post.resolves({ data: new Uint8Array([7]).buffer });
    expect(await model.download([file])).to.deep.equal(new Uint8Array([7]));
    expect(connection.post.firstCall.args[0]).to.equal(
      "/clinicalRepository/repository/items/11/content",
    );
    await model.download([file, folder]);
    expect(connection.post.secondCall.args[0]).to.equal(
      "/clinicalRepository/repository/files/content",
    );
    expect(connection.post.secondCall.args[1]).to.deep.equal({
      filter: "in(id,'11','10')",
    });
  });

  it("checks out through the workspace batch API and polls the status", async () => {
    connection.post.resolves({
      headers: { location: "/clinicalActionStatus/actionstatus/act-1" },
    });
    connection.get
      .withArgs("/clinicalActionStatus/actionstatus/act-1")
      .resolves({
        data: {
          summary: {
            endTimeStamp: "2026-10-26T12:00:00Z",
            completionStatus: "INFO",
          },
        },
      });

    const status = await model.runCheckoutAction(
      "REPOSITORY_CHECK_OUT",
      [file],
      true,
      () => false,
    );
    expect(status.summary.completionStatus).to.equal("INFO");
    const [url, body] = connection.post.firstCall.args;
    expect(url).to.match(
      /^\/clinicalRepository\/workspaces\/@currentUser\/items\/batch\?action=REPOSITORY_CHECK_OUT&clientId=[0-9a-f-]{36}$/,
    );
    expect(body).to.deep.equal({ paths: [file.path], copyContent: true });
  });

  it("runs any batch action on the endpoint it is given", async () => {
    connection.post.resolves({
      headers: { location: "/clinicalActionStatus/actionstatus/act-3" },
    });
    connection.get
      .withArgs("/clinicalActionStatus/actionstatus/act-3")
      .resolves({
        data: { summary: { endTimeStamp: "2026-10-26T12:00:00Z" } },
      });
    await model.runBatchAction(
      "/clinicalRepository/repository/items/batch",
      "ENABLE_VERSIONING",
      { comment: "c" },
      () => false,
    );
    const [url, body] = connection.post.firstCall.args;
    expect(url).to.match(
      /^\/clinicalRepository\/repository\/items\/batch\?action=ENABLE_VERSIONING&clientId=[0-9a-f-]{36}$/,
    );
    expect(body).to.deep.equal({ comment: "c" });
  });

  it("fails when a batch action returns no status to poll", async () => {
    connection.post.resolves({ headers: {} });
    let message = "";
    try {
      await model.runBatchAction("/b", "X", [], () => false);
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).to.equal("The server did not return an action status.");
  });

  it("sends a plain path list to undo a check out", async () => {
    connection.post.resolves({
      headers: { location: "/clinicalActionStatus/actionstatus/act-2" },
    });
    connection.get.resolves({
      data: { summary: { endTimeStamp: "x", completionStatus: "INFO" } },
    });
    await model.runCheckoutAction("UNDO_CHECKOUT", [file], false, () => false);
    expect(connection.post.firstCall.args[0]).to.include(
      "action=UNDO_CHECKOUT",
    );
    expect(connection.post.firstCall.args[1]).to.deep.equal([file.path]);
  });

  it("deletes softly, to the recycle bin", async () => {
    connection.delete.resolves({});
    await model.delete(file);
    expect(connection.delete.firstCall.args[0]).to.equal(
      "/clinicalRepository/repository/items/11?permanent=false",
    );
  });

  describe("versions", () => {
    const versionsUrl = "/clinicalRepository/repository/items/11/versions";

    it("lists every version, following next links", async () => {
      connection.get.withArgs(versionsUrl).resolves({
        data: {
          items: [{ fileId: "11", fileVersion: "1.0" }],
          links: [{ rel: "next", href: "/versions-2" }],
        },
      });
      connection.get.withArgs("/versions-2").resolves({
        data: { items: [{ fileId: "11", fileVersion: "2.0" }] },
      });
      const versions = await model.getVersions(file);
      expect(versions.map((v) => v.fileVersion)).to.deep.equal(["1.0", "2.0"]);
    });

    it("reads the details of one version as a repository file", async () => {
      connection.get.resolves({
        data: { fileId: "11", fileVersion: "2.0", fileSize: 7 },
      });
      const version = await model.getVersion("11", "2.0");
      expect(version.fileSize).to.equal(7);
      const [url, config] = connection.get.firstCall.args;
      expect(url).to.equal(`${versionsUrl}/2.0`);
      expect(config?.headers?.Accept).to.equal(
        "application/vnd.sas.clinical.repository.file+json",
      );
    });

    it("reads the content of a version as bytes", async () => {
      connection.get.resolves({ data: new Uint8Array([1, 2, 255]).buffer });
      expect(await model.getVersionContent("11", "2.0")).to.deep.equal(
        new Uint8Array([1, 2, 255]),
      );
      const [url, config] = connection.get.firstCall.args;
      expect(url).to.equal(`${versionsUrl}/2.0/content`);
      expect(config?.responseType).to.equal("arraybuffer");
    });
  });

  describe("versioning", () => {
    const batchUrl =
      /^\/clinicalRepository\/repository\/items\/batch\?action=(\w+)&clientId=[0-9a-f-]{36}$/;
    const finish = () => {
      connection.post.resolves({
        headers: { location: "/clinicalActionStatus/actionstatus/act-v" },
      });
      connection.get
        .withArgs("/clinicalActionStatus/actionstatus/act-v")
        .resolves({
          data: { summary: { endTimeStamp: "2026-10-26T12:00:00Z" } },
        });
    };

    it("enables versioning with the file's path and first version", async () => {
      finish();
      await model.runVersioningAction(
        "ENABLE_VERSIONING",
        file,
        "start",
        "1.0",
        () => false,
      );
      const [url, body] = connection.post.firstCall.args;
      expect(url).to.match(batchUrl);
      expect(String(url)).to.include("action=ENABLE_VERSIONING");
      expect(body).to.deep.equal({
        comment: "start",
        fileSpecifications: [{ path: file.path, fileVersion: "1.0" }],
      });
    });

    it("leaves the version out when none was entered", async () => {
      finish();
      await model.runVersioningAction(
        "ENABLE_VERSIONING",
        file,
        "",
        undefined,
        () => false,
      );
      expect(connection.post.firstCall.args[1]).to.deep.equal({
        comment: "",
        fileSpecifications: [{ path: file.path }],
      });
    });

    it("disables versioning with a path list", async () => {
      finish();
      await model.runVersioningAction(
        "DISABLE_VERSIONING",
        file,
        "done",
        undefined,
        () => false,
      );
      const [url, body] = connection.post.firstCall.args;
      expect(String(url)).to.include("action=DISABLE_VERSIONING");
      expect(body).to.deep.equal({ comment: "done", paths: [file.path] });
    });

    it("reads the versioning privileges of the user", async () => {
      connection.get
        .withArgs("/clinicalRepository/authorizations/11/privileges")
        .resolves({ data: ["PRIVILEGE_MANAGE_VERSIONING"] });
      expect(await model.getPrivileges("11")).to.deep.equal({
        enableVersioning: false,
        manageVersioning: true,
      });
    });

    it("can't tell the privileges if the lookup fails, and does not throw", async () => {
      const log = sinon.stub();
      model = new RepositoryModel(log);
      connection.get.rejects(
        Object.assign(new Error("404"), {
          isAxiosError: true,
          response: { status: 404 },
        }),
      );
      expect(await model.getPrivileges("11")).to.be.undefined;
      expect(log.calledOnce).to.be.true;
      connection.get.resolves({ data: 42 });
      expect(await model.getPrivileges("11")).to.be.undefined;
    });
  });

  describe("permissions", () => {
    const permissionsUrl = (id: string) =>
      `/clinicalRepository/authorizations/${id}/permissions`;

    it("looks up effective permissions once per item", async () => {
      connection.get.withArgs(permissionsUrl("11")).resolves({
        data: ["READ", "WRITE"],
      });
      connection.get.withArgs(permissionsUrl("12")).resolves({
        data: ["READ"],
      });
      expect(model.getKnownPermission("11")).to.be.undefined;
      expect(await model.loadPermission("11")).to.equal("write");
      expect(await model.loadPermission("12")).to.equal("read");
      expect(await model.loadPermission("11")).to.equal("write");
      expect(model.getKnownPermission("12")).to.equal("read");
      expect(
        connection.get
          .getCalls()
          .filter((c) => c.args[0] === permissionsUrl("11")),
      ).to.have.length(1);
    });

    it("treats a 403 on the lookup as read-only", async () => {
      connection.get.withArgs(permissionsUrl("11")).rejects(
        Object.assign(new Error("403"), {
          isAxiosError: true,
          response: { status: 403 },
        }),
      );
      expect(await model.loadPermission("11")).to.equal("read");
    });

    it("fails open when the endpoint is unavailable, and stops asking", async () => {
      const log = sinon.stub();
      model = new RepositoryModel(log);
      connection.get.withArgs(permissionsUrl("11")).rejects(
        Object.assign(new Error("404"), {
          isAxiosError: true,
          response: { status: 404 },
        }),
      );
      expect(await model.loadPermission("11")).to.equal("write");
      expect(await model.loadPermission("12")).to.equal("write");
      expect(model.getKnownPermission("99")).to.equal("write");
      expect(log.calledOnce).to.be.true;
      expect(
        connection.get
          .getCalls()
          .filter((c) => String(c.args[0]).includes("/authorizations/")),
      ).to.have.length(1);
      // Refresh (reset) tries again.
      model.reset();
      expect(model.getKnownPermission("99")).to.be.undefined;
    });

    it("limits concurrent lookups", async () => {
      let running = 0;
      let peak = 0;
      connection.get.callsFake(async (url: string) => {
        if (!url.includes("/authorizations/")) {
          return { data: {} };
        }
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
        return { data: ["READ"] };
      });
      await Promise.all(
        Array.from({ length: 30 }, (_, i) => model.loadPermission(`i${i}`)),
      );
      expect(peak).to.be.at.most(8);
    });

    it("retries after a failure that isn't about permissions", async () => {
      sandbox.restore();
      sandbox = sinon.createSandbox();
      const profile = sandbox
        .stub(profileConfig, "getActiveProfileDetail")
        .returns(undefined);
      for (let attempt = 0; attempt < 2; attempt++) {
        let error: unknown;
        try {
          await model.loadPermission("11");
        } catch (e) {
          error = e;
        }
        expect(error).to.be.instanceOf(Error);
      }
      // Each call tried again instead of reusing the failed lookup.
      expect(profile.callCount).to.equal(2);
      expect(model.getKnownPermission("11")).to.be.undefined;
    });
  });

  it("refuses non-Viya profiles", async () => {
    sandbox.restore();
    sandbox = sinon.createSandbox();
    sandbox.stub(profileConfig, "getActiveProfileDetail").returns({
      name: "SSH",
      profile: {
        connectionType: ConnectionType.SSH,
        host: "h",
        saspath: "/sas",
        port: 22,
        username: "u",
      },
    });
    let error: unknown;
    try {
      await new RepositoryModel().getChildren(undefined);
    } catch (e) {
      error = e;
    }
    expect(error).to.be.instanceOf(Error);
  });
});
