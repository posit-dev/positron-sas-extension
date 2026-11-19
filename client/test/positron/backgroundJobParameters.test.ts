// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Saved SAS jobs (#150, phase 2): parameters, and the folder and definition
// requests. Fixtures are responses recorded from a live SAS Viya server (host
// and user names replaced).
import type { AxiosRequestConfig } from "axios";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

import { JobsModel } from "../../src/backgroundJobs/JobsModel";
import {
  argumentsFor,
  buildParameters,
  folderPath,
  ownContext,
  parameterNameProblem,
  parameterValueProblem,
  promptableParameters,
  suggestParameters,
} from "../../src/backgroundJobs/parameters";
import type { JobDefinition } from "../../src/backgroundJobs/types";
import type { RestConnection } from "../../src/viya/connection";

const FIXTURES = (() => {
  let dir = __dirname;
  while (!fs.existsSync(path.join(dir, "package.nls.json"))) {
    dir = path.dirname(dir);
  }
  return path.join(
    dir,
    "client",
    "test",
    "positron",
    "fixtures",
    "backgroundJobs",
  );
})();
// JSON.parse returns `any`, which stands in for each fixture's type.
const json = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));

describe("suggestParameters", () => {
  it("finds the macro variables a program reads, in order", () => {
    const code = [
      "data out; set adam.adsl; where age > &cutoff; run;",
      'title "Study &study, &cutoff and older";',
    ].join("\n");
    expect(suggestParameters(code)).to.deep.equal(["cutoff", "study"]);
  });

  it("leaves out variables the program sets itself", () => {
    const code = [
      "%let first = 1;",
      "%global g1 g2;",
      "data _null_; call symputx('fromstep', 5); run;",
      "proc sql noprint; select count(*) into :n from x; quit;",
      "%macro report(lib, out=work.r); %do i = 1 %to 3; &i &lib &out %end; %mend;",
      "%put &first &g1 &g2 &fromstep &n &param;",
    ].join("\n");
    expect(suggestParameters(code)).to.deep.equal(["param"]);
  });

  it("leaves out automatic and system variables", () => {
    expect(
      suggestParameters("%put &sysdate &SYSUSERID &_SASPROGRAMFILE &real;"),
    ).to.deep.equal(["real"]);
  });

  it("ignores comments and single quotes, where references don't resolve", () => {
    const code = [
      "/* uses &old */",
      "x = '&literal';",
      'y = "&resolved";',
    ].join("\n");
    expect(suggestParameters(code)).to.deep.equal(["resolved"]);
  });

  it("treats names case-insensitively and handles &&", () => {
    expect(
      suggestParameters("%put &Cutoff &CUTOFF &&cutoff &&&x;"),
    ).to.deep.equal(["Cutoff", "x"]);
  });
});

describe("parameter rules", () => {
  it("accepts SAS names only, and not the provider's own", () => {
    expect(parameterNameProblem("cutoff")).to.equal(undefined);
    expect(parameterNameProblem("")).to.equal("empty");
    expect(parameterNameProblem("1abc")).to.equal("invalid");
    expect(parameterNameProblem("a-b")).to.equal("invalid");
    expect(parameterNameProblem("a".repeat(33))).to.equal("invalid");
    expect(parameterNameProblem("_contextName")).to.equal("reserved");
    expect(parameterNameProblem("sysdate")).to.equal("reserved");
    expect(parameterNameProblem("Cutoff", ["cutoff"])).to.equal("duplicate");
  });

  it("checks values by type and requiredness", () => {
    const num = { name: "n", type: "NUMERIC" as const, required: true };
    expect(parameterValueProblem(num, "")).to.equal("required");
    expect(parameterValueProblem(num, "abc")).to.equal("number");
    expect(parameterValueProblem(num, " 12.5 ")).to.equal(undefined);
    const opt = { name: "s", type: "CHARACTER" as const, required: false };
    expect(parameterValueProblem(opt, "")).to.equal(undefined);
  });

  it("asks only for the program's parameters, not _contextName", () => {
    const definition: JobDefinition = json("definition-with-parameters.json");
    expect(promptableParameters(definition).map((p) => p.name)).to.deep.equal([
      "cutoff",
      "study",
      "nodefault",
    ]);
    expect(
      promptableParameters({
        name: "j",
        type: "Compute",
        parameters: [
          { name: "_contextName", type: "CHARACTER", defaultValue: "ctx" },
          { name: "x", type: "CHARACTER" },
        ],
      }).map((p) => p.name),
    ).to.deep.equal(["x"]);
  });

  it("passes every parameter, blank ones as empty values", () => {
    // Without a value and a default, &name would not resolve in the job.
    const parameters = [
      { name: "cutoff", type: "NUMERIC" as const },
      { name: "nodefault", type: "CHARACTER" as const },
    ];
    expect(argumentsFor(parameters, { cutoff: " 14 " })).to.deep.equal({
      cutoff: "14",
      nodefault: "",
    });
  });

  it("keeps a job's own compute context", () => {
    expect(
      ownContext({
        name: "j",
        type: "Compute",
        parameters: [
          {
            name: "_contextName",
            type: "CHARACTER",
            defaultValue: "Studio ctx",
          },
        ],
      }),
    ).to.equal("Studio ctx");
    expect(ownContext({ name: "j", type: "Compute" })).to.equal(undefined);
  });

  it("builds the stored parameter list", () => {
    expect(
      buildParameters([
        {
          name: " cutoff ",
          type: "NUMERIC",
          defaultValue: "12",
          required: true,
        },
        { name: "study", type: "CHARACTER", label: "Study ID" },
      ]),
    ).to.deep.equal([
      {
        version: 1,
        name: "cutoff",
        type: "NUMERIC",
        label: "cutoff",
        required: true,
        defaultValue: "12",
      },
      {
        version: 1,
        name: "study",
        type: "CHARACTER",
        label: "Study ID",
        required: false,
      },
    ]);
  });
});

describe("folderPath", () => {
  it("shows a path under My Folder from there on", () => {
    // Recorded: My Folder (myFolder) <- user1 (userFolder) <- Users (userRoot)
    const { ancestors } = json("ancestors.json");
    expect(folderPath(ancestors)).to.equal("My Folder");
    expect(
      folderPath([{ name: "Positron Jobs", type: "folder" }, ...ancestors]),
    ).to.equal("My Folder/Positron Jobs");
  });

  it("shows other paths from the root", () => {
    expect(
      folderPath([
        { name: "Reports", type: "folder" },
        { name: "Public", type: "folder" },
      ]),
    ).to.equal("/Public/Reports");
  });
});

describe("JobsModel definitions and folders", () => {
  const calls: { url: string; headers?: unknown }[] = [];
  let reply: () => Promise<{ data: unknown }> = async () => ({ data: {} });
  const record = (url: string, config?: AxiosRequestConfig) => {
    calls.push({ url, headers: config?.headers });
    // JSON.parse returns `any`, which stands in for each call's response
    // type, and keeps tests from sharing one fixture object.
    return reply().then((r) => ({
      data: JSON.parse(JSON.stringify(r.data ?? {})),
    }));
  };
  const connection: RestConnection = {
    get: (url, config) => record(url, config),
    post: (url, _data, config) => record(url, config),
    put: (url, _data, config) => record(url, config),
    patch: (url, _data, config) => record(url, config),
    delete: (url, config) => record(url, config),
  };
  const model = new JobsModel(
    {
      getConnection: async () => connection,
      getCurrentUserId: async () => "user1",
    },
    "en-US",
  );

  beforeEach(() => {
    calls.length = 0;
  });

  it("lists the user's definitions, most recently changed first", async () => {
    reply = async () => ({
      data: { items: [json("definition-with-parameters.json")], links: [] },
    });
    const page = await model.listDefinitions(0, 25);
    expect(page.items).to.have.length(1);
    expect(page.hasMore).to.equal(false);
    expect(decodeURIComponent(calls[0].url)).to.equal(
      "/jobDefinitions/definitions?start=0&limit=25" +
        "&sortBy=modifiedTimeStamp:descending&filter=eq(createdBy,'user1')",
    );
  });

  it("reads a resource's folders", async () => {
    reply = async () => ({ data: json("ancestors.json") });
    const ancestors = await model.getAncestors(
      "/jobDefinitions/definitions/d1",
    );
    expect(ancestors.map((a) => a.type)).to.deep.equal([
      "myFolder",
      "userFolder",
      "userRoot",
    ]);
    expect(calls[0].url).to.equal(
      "/folders/ancestors?childUri=%2FjobDefinitions%2Fdefinitions%2Fd1",
    );
  });

  it("looks up a folder by path, and reports a missing one", async () => {
    reply = async () => ({ data: { id: "f1" } });
    expect(await model.getFolderIdByPath("/Public/Reports")).to.equal("f1");
    expect(calls[0].url).to.equal(
      "/folders/folders/@item?path=%2FPublic%2FReports",
    );
    reply = () => Promise.reject({ response: { status: 404 } });
    expect(await model.getFolderIdByPath("/No/Such")).to.equal(undefined);
  });

  it("leaves _contextName out for a job with its own", async () => {
    reply = async () => ({ data: { id: "j" } });
    const posted: unknown[] = [];
    const recordingPost: RestConnection["post"] = (url, data, config) => {
      posted.push(data);
      return record(url, config);
    };
    const own = new JobsModel(
      {
        getConnection: async () => ({ ...connection, post: recordingPost }),
        getCurrentUserId: async () => "user1",
      },
      "en-US",
    );
    await own.submit({
      name: "studio job",
      definitionUri: "/jobDefinitions/definitions/d1",
      extraArguments: { cutoff: "14" },
    });
    expect(posted[0]).to.have.deep.property("arguments", { cutoff: "14" });
  });
});
