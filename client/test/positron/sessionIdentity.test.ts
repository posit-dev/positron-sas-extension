// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  SessionIdentity,
  buildIdentityMacroCode,
  buildJobTags,
  buildSessionTags,
  buildSubmissionComment,
  getSessionIdentity,
  getWorkbenchInfo,
  sasSafe,
  tagCode,
} from "../../src/positron/sessionIdentity";

const identity: SessionIdentity = {
  osUser: "jdoe",
  host: "wb-node-1",
  positronSessionId: "sas-abc123",
  profile: "Viya",
  connectionType: "rest",
};

describe("getWorkbenchInfo", () => {
  it("is empty outside Posit Workbench", () => {
    expect(getWorkbenchInfo({ RS_SESSION_ID: "x" })).to.deep.equal({});
  });

  it("reads the server URL and the first session id variable that is set", () => {
    expect(
      getWorkbenchInfo({
        RS_SERVER_URL: "https://wb.example.com/",
        RSTUDIO_SESSION_ID: "s2",
        POSIT_SESSION_ID: "s3",
      }),
    ).to.deep.equal({ serverUrl: "https://wb.example.com/", sessionId: "s2" });
  });
});

describe("getSessionIdentity", () => {
  it("records the profile, connection type and Workbench session", () => {
    const id = getSessionIdentity("sas-1", "Viya", "rest", {
      RS_SERVER_URL: "https://wb.example.com/",
      RS_SESSION_ID: "wb-42",
    });
    expect(id.positronSessionId).to.equal("sas-1");
    expect(id.profile).to.equal("Viya");
    expect(id.connectionType).to.equal("rest");
    expect(id.workbenchSessionId).to.equal("wb-42");
    expect(id.osUser).to.be.a("string").and.not.empty;
    expect(id.host).to.be.a("string").and.not.empty;
  });
});

describe("sasSafe", () => {
  it("replaces characters that could break a comment or %let", () => {
    expect(sasSafe("a*/b;c%d&e'f")).to.equal("a_/b_c_d_e_f");
    expect(sasSafe("jdoe@example.com")).to.equal("jdoe@example.com");
    expect(sasSafe(undefined)).to.equal("");
  });
});

describe("session and job tags", () => {
  it("names the Viya session after the user and records attributes", () => {
    const tags = buildSessionTags({
      ...identity,
      workbenchServerUrl: "https://wb.example.com/",
      workbenchSessionId: "wb-42",
    });
    expect(tags.name).to.equal("Positron SAS (jdoe)");
    expect(tags.description).to.equal(
      "Posit Workbench session sas-abc123 on wb-node-1",
    );
    expect(tags.attributes).to.deep.equal({
      client: "posit.positron-sas",
      osUser: "jdoe",
      host: "wb-node-1",
      positronSessionId: "sas-abc123",
      workbenchSessionId: "wb-42",
      workbenchServerUrl: "https://wb.example.com/",
    });
  });

  it("omits Workbench attributes outside Workbench", () => {
    const tags = buildSessionTags(identity);
    expect(tags.description).to.match(/^Positron session/);
    expect(tags.attributes).to.not.have.property("workbenchSessionId");
  });

  it("describes each job with user, session and execution id", () => {
    expect(buildJobTags(identity, "exec-1")).to.deep.equal({
      name: "positron-console",
      description: "user=jdoe session=sas-abc123 exec=exec-1",
    });
  });
});

describe("SAS-side tagging code", () => {
  it("sets global macro variables", () => {
    expect(buildIdentityMacroCode(identity)).to.equal(
      "%global POSIT_USER POSIT_SESSION POSIT_WORKBENCH_SESSION; " +
        "%let POSIT_USER=jdoe; %let POSIT_SESSION=sas-abc123; " +
        "%let POSIT_WORKBENCH_SESSION=;",
    );
  });

  it("tags the first line without adding lines", () => {
    const code = "options source notes;\ndata a; x=1; run;";
    const tagged = tagCode(code, buildSubmissionComment(identity, "exec-1"));
    expect(tagged.split("\n")).to.have.length(code.split("\n").length);
    expect(tagged.split("\n")[0]).to.equal(
      "/* positron: user=jdoe session=sas-abc123 exec=exec-1 */ options source notes;",
    );
  });
});
