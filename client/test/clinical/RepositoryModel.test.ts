// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { authentication } from "vscode";

import axios, { AxiosInstance, HeadersDefaults } from "axios";
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
    model = new RepositoryModel();
  });

  afterEach(() => sandbox.restore());

  it("authenticates with the SAS Viya sign-in", async () => {
    expect(await model.getCurrentUserId()).to.equal("me");
    expect(connection.defaults.headers.common.Authorization).to.equal(
      "Bearer token-1",
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
    const [url, , config] = connection.put.firstCall.args;
    expect(url).to.equal(
      "/clinicalRepository/repository/items/10/content?name=a%20b.zip&expand=true&comment=first%20load&fileVersion=1.0",
    );
    expect(config?.headers?.["Content-Type"]).to.equal(
      "application/octet-stream",
    );
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
