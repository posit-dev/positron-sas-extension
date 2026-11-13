// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { deflateRawSync } from "zlib";

import type {
  ObjectType,
  RepositoryItem,
  ResourceCollection,
  SynchronizationItem,
  WorkspaceItem,
} from "../../src/clinical/types";
import {
  buildCheckInBody,
  buildChildrenUrl,
  buildContextValue,
  buildIdFilter,
  buildVersionsUrl,
  buildWorkspaceContextValue,
  buildWorkspaceFolderUrl,
  buildWorkspaceItemsUrl,
  classifyProbe,
  collectPages,
  compareVersions,
  createLimiter,
  downloadFileName,
  encodePath,
  extractSingleZipEntry,
  fileKindToken,
  getNextVersion,
  getWorkspaceCheckoutState,
  isAvailable,
  isSameOrUnder,
  isVersionRow,
  isWorkspaceItem,
  isZip,
  joinWorkspacePath,
  parsePrivileges,
  parseWritePermission,
  planCheckIn,
  sortCheckInCandidates,
  sortVersions,
  validateFileName,
  validateFolderName,
  validateVersion,
  versionFileName,
  workspaceIconName,
} from "../../src/clinical/utils";

const folder: RepositoryItem = {
  id: "10",
  name: "adam",
  path: "/Acme/Study1/adam",
  typeId: "folder",
  primaryType: "FOLDER",
};
const org: RepositoryItem = {
  id: "2",
  name: "Acme",
  path: "/Acme",
  typeId: "organization",
  primaryType: "CONTEXT",
};
const topType: ObjectType = {
  id: "organization",
  name: "Organization",
  capabilities: ["TOP"],
};
const file = (extra: Partial<RepositoryItem> = {}): RepositoryItem => ({
  id: "11",
  name: "adsl.sas",
  path: "/Acme/Study1/adam/adsl.sas",
  typeId: "sasprogram",
  primaryType: "FILE",
  ...extra,
});

const wsFile = (extra: Partial<WorkspaceItem> = {}): WorkspaceItem => ({
  name: "adsl.sas",
  path: "/Acme/Study1/adsl.sas",
  type: "FILE",
  ...extra,
});
const wsFolder = (extra: Partial<WorkspaceItem> = {}): WorkspaceItem => ({
  name: "Study1",
  path: "/Acme/Study1",
  type: "FOLDER",
  ...extra,
});

describe("collectPages", () => {
  it("follows next links and ignores count", async () => {
    const pages: Record<string, ResourceCollection<number>> = {
      first: {
        count: 2,
        items: [1, 2],
        links: [{ rel: "next", href: "p2", method: "GET", uri: "p2" }],
      },
      p2: {
        count: 2,
        items: [3, 4],
        links: [{ rel: "next", href: "p3", method: "GET", uri: "p3" }],
      },
      p3: {
        count: 1,
        items: [5],
        links: [{ rel: "prev", href: "p2", method: "GET", uri: "p2" }],
      },
    };
    const requested: string[] = [];
    const items = await collectPages<number>(async (url) => {
      requested.push(url);
      return pages[url];
    }, "first");
    expect(items).to.deep.equal([1, 2, 3, 4, 5]);
    expect(requested).to.deep.equal(["first", "p2", "p3"]);
  });

  it("stops on a repeated next link and reports truncation", async () => {
    const reasons: string[] = [];
    const items = await collectPages<number>(
      async (): Promise<ResourceCollection<number>> => ({
        items: [1],
        links: [{ rel: "next", href: "same", method: "GET", uri: "same" }],
      }),
      "same",
      (reason) => reasons.push(reason),
    );
    expect(items).to.deep.equal([1]);
    expect(reasons).to.have.length(1);
  });

  it("stops after the page limit", async () => {
    let n = 0;
    const reasons: string[] = [];
    const items = await collectPages<number>(
      async (): Promise<ResourceCollection<number>> => ({
        items: [n],
        links: [{ rel: "next", href: `p${++n}`, method: "GET", uri: "" }],
      }),
      "p0",
      (reason) => reasons.push(reason),
      3,
    );
    expect(items).to.have.length(3);
    expect(reasons).to.have.length(1);
  });
});

describe("buildChildrenUrl", () => {
  it("encodes the id and asks for synchronization info", () => {
    expect(buildChildrenUrl("a/b")).to.equal(
      "/clinicalRepository/repository/items/a%2Fb/children?start=0&limit=500&includeSynchronizationInfo=true",
    );
  });
});

describe("classifyProbe / isAvailable", () => {
  it("classifies responses", () => {
    expect(classifyProbe(200, "application/vnd.sas.api+json")).to.equal(
      "available",
    );
    expect(classifyProbe(200, "text/html")).to.equal("absent");
    expect(classifyProbe(401, undefined)).to.equal("present");
    expect(classifyProbe(403, "application/json")).to.equal("present");
    for (const status of [302, 404]) {
      expect(classifyProbe(status, "text/html")).to.equal("absent");
    }
    for (const status of [500, 503]) {
      expect(classifyProbe(status, "text/html")).to.equal("error");
    }
  });

  it("shows the view before sign-in but not when a token is rejected", () => {
    expect(isAvailable("available", true)).to.be.true;
    expect(isAvailable("present", false)).to.be.true;
    expect(isAvailable("present", true)).to.be.false;
    expect(isAvailable("absent", false)).to.be.false;
    expect(isAvailable("error", true)).to.be.false;
  });
});

describe("buildContextValue", () => {
  it("marks containers and protects top-level contexts from rename", () => {
    expect(buildContextValue(folder, undefined, "me", "write")).to.equal(
      ";clinical;canWrite;container;canCreate;canRename;canDelete;",
    );
    // Organizations are managed by administrators: no rename, no delete.
    expect(buildContextValue(org, topType, "me", "write")).to.equal(
      ";clinical;canWrite;container;canCreate;",
    );
  });

  it("marks files with a signature history", () => {
    const value = (signingStatus?: string) =>
      buildContextValue(file({ signingStatus }), undefined, "me", "read");
    expect(value("CURRENT")).to.include(";signed;");
    expect(value("PREVIOUS")).to.include(";signed;");
    expect(value("BOTH")).to.include(";signed;");
    expect(value("NONE")).to.not.include(";signed;");
    expect(value(undefined)).to.not.include(";signed;");
    // Folders report no signing status worth a menu.
    expect(
      buildContextValue(
        { ...folder, signingStatus: "CURRENT" },
        undefined,
        "me",
      ),
    ).to.not.include(";signed;");
  });

  it("never lets a context be deleted", () => {
    const study: RepositoryItem = { ...org, id: "3", typeId: "study" };
    expect(buildContextValue(study, undefined, "me", "write")).to.not.include(
      ";canDelete;",
    );
  });

  it("reflects who has a file checked out", () => {
    expect(buildContextValue(file(), undefined, "me", "write")).to.equal(
      ";clinical;canWrite;file;coNone;unversioned;sasProgram;canRename;canDelete;",
    );
    expect(
      buildContextValue(
        file({ checkedOut: true, checkedOutBy: "me" }),
        undefined,
        "me",
      ),
    ).to.include(";coSelf;");
    expect(
      buildContextValue(
        file({ checkedOut: true, checkedOutBy: "you" }),
        undefined,
        "me",
      ),
    ).to.include(";coOther;");
  });

  it("tells versioned files from unversioned ones", () => {
    expect(buildContextValue(file(), undefined, "me")).to.include(
      ";unversioned;",
    );
    const versioned = buildContextValue(
      file({ versioned: true }),
      undefined,
      "me",
    );
    expect(versioned).to.include(";versioned;");
    // The tokens are delimited, so one can't match inside the other.
    expect(versioned).to.not.match(/;unversioned;/);
    expect(buildContextValue(folder, undefined, "me")).to.not.match(
      /versioned/,
    );
  });

  it("records the permission, unknown until looked up", () => {
    expect(buildContextValue(file(), undefined, "me")).to.include(
      ";permUnknown;",
    );
    expect(buildContextValue(file(), undefined, "me", "read")).to.include(
      ";readOnly;",
    );
  });

  // Evaluate the package.json `when` clauses of the view's context menu
  // against real context values, so a typo in either place fails here.
  describe("package.json menus", () => {
    // Walk up to the extension manifest: this runs both from client/test
    // (ts-node) and from client/out/test (VS Code host), and client/ has its
    // own package.json without contributions.
    let dir = __dirname;
    while (!fs.existsSync(path.join(dir, "package.nls.json"))) {
      dir = path.dirname(dir);
    }
    const pkg = JSON.parse(
      fs.readFileSync(path.join(dir, "package.json"), "utf8"),
    );
    const menus: Array<{ command?: string; submenu?: string; when: string }> =
      pkg.contributes.menus["view/item/context"].filter(
        (m: { when?: string }) =>
          /view == clinical(repository|versionhistory|workspace)/.test(
            m.when ?? "",
          ),
      );

    interface Shown {
      multi?: boolean;
      // Context keys that are set.
      keys?: string[];
      view?: string;
    }
    const shown = (
      contextValue: string,
      {
        multi = false,
        keys = [],
        view = "clinicalrepositorydataprovider",
      }: Shown = {},
    ) =>
      menus
        .filter((menu) => {
          let expr = menu.when
            .replace(/view == (\w+)/g, (_m, v) => String(v === view))
            .replace(/!listMultiSelection/g, String(!multi))
            .replace(/viewItem =~ \/([^/]+)\//g, (_m, re) =>
              String(new RegExp(re).test(contextValue)),
            )
            .replace(/SAS\.clinical\.\w+/g, (key) =>
              String(keys.includes(key)),
            );
          expect(expr).to.match(/^[truefals()|&! ]+$/);
          expr = expr.replace(/\btrue\b/g, "1").replace(/\bfalse\b/g, "0");
          return Boolean(eval(expr));
        })
        .map((menu) => menu.command ?? menu.submenu);

    it("offers folder actions on containers", () => {
      expect(
        shown(buildContextValue(folder, undefined, "me", "write")),
      ).to.have.members([
        "SAS.clinical.addFolder",
        "SAS.clinical.checkOutSubmenu",
        "SAS.clinical.copyToWorkspaceSubmenu",
        "SAS.clinical.undoCheckout",
        "SAS.clinical.copyPath",
        "SAS.clinical.rename",
        "SAS.clinical.delete",
        "SAS.clinical.download",
        "SAS.clinical.upload",
        "SAS.clinical.uploadAndExpand",
        "SAS.clinical.signFiles",
        "SAS.clinical.showAuditHistory",
      ]);
    });

    it("offers check out only for files nobody has checked out", () => {
      const free = shown(buildContextValue(file(), undefined, "me", "write"));
      expect(free).to.include("SAS.clinical.checkOutSubmenu");
      expect(free).to.not.include("SAS.clinical.undoCheckout");
      expect(free).to.not.include("SAS.clinical.upload");

      const mine = shown(
        buildContextValue(
          file({ checkedOut: true, checkedOutBy: "me" }),
          undefined,
          "me",
          "write",
        ),
      );
      expect(mine).to.include("SAS.clinical.undoCheckout");
      expect(mine).to.not.include("SAS.clinical.checkOutSubmenu");

      const theirs = shown(
        buildContextValue(
          file({ checkedOut: true, checkedOutBy: "you" }),
          undefined,
          "me",
          "write",
        ),
      );
      expect(theirs).to.not.include("SAS.clinical.undoCheckout");
      expect(theirs).to.not.include("SAS.clinical.checkOutSubmenu");
    });

    it("hides single-item actions for multi-selections", () => {
      const multi = shown(buildContextValue(folder, undefined, "me", "write"), {
        multi: true,
      });
      expect(multi).to.not.include("SAS.clinical.rename");
      expect(multi).to.not.include("SAS.clinical.addFolder");
      expect(multi).to.include("SAS.clinical.download");
      // Several items can be deleted in one go.
      expect(multi).to.include("SAS.clinical.delete");
    });

    it("offers only read actions without write permission", () => {
      for (const permission of ["read", "unknown"] as const) {
        expect(
          shown(buildContextValue(file(), undefined, "me", permission)),
        ).to.have.members([
          "SAS.clinical.copyPath",
          "SAS.clinical.download",
          "SAS.clinical.selectForCompare",
          "SAS.clinical.copyToWorkspaceSubmenu",
          "SAS.clinical.signFiles",
          "SAS.clinical.showAuditHistory",
        ]);
        expect(
          shown(buildContextValue(folder, undefined, "me", permission)),
        ).to.have.members([
          "SAS.clinical.undoCheckout",
          "SAS.clinical.copyPath",
          "SAS.clinical.download",
          "SAS.clinical.copyToWorkspaceSubmenu",
          "SAS.clinical.signFiles",
          "SAS.clinical.showAuditHistory",
        ]);
      }
    });

    it("still offers undo for your own check-outs when read-only", () => {
      const mine = shown(
        buildContextValue(
          file({ checkedOut: true, checkedOutBy: "me" }),
          undefined,
          "me",
          "read",
        ),
      );
      expect(mine).to.include("SAS.clinical.undoCheckout");
      expect(mine).to.not.include("SAS.clinical.rename");
    });

    it("offers delete for items below a context, if writable", () => {
      expect(
        shown(buildContextValue(file(), undefined, "me", "write")),
      ).to.include("SAS.clinical.delete");
      expect(
        shown(buildContextValue(file(), undefined, "me", "read")),
      ).to.not.include("SAS.clinical.delete");
      expect(
        shown(buildContextValue(org, topType, "me", "write")),
      ).to.not.include("SAS.clinical.delete");
    });

    it("offers to turn versioning on or off, depending on the file", () => {
      const plain = shown(buildContextValue(file(), undefined, "me", "write"));
      expect(plain).to.include("SAS.clinical.enableVersioning");
      expect(plain).to.not.include("SAS.clinical.disableVersioning");

      const versioned = shown(
        buildContextValue(file({ versioned: true }), undefined, "me", "write"),
      );
      expect(versioned).to.include("SAS.clinical.disableVersioning");
      expect(versioned).to.not.include("SAS.clinical.enableVersioning");

      // Not for folders, without write permission, or for several files.
      const folderMenu = shown(
        buildContextValue(folder, undefined, "me", "write"),
      );
      expect(folderMenu).to.not.include("SAS.clinical.enableVersioning");
      expect(folderMenu).to.not.include("SAS.clinical.disableVersioning");
      const readOnly = shown(
        buildContextValue(file(), undefined, "me", "read"),
      );
      expect(readOnly).to.not.include("SAS.clinical.enableVersioning");
      const several = shown(
        buildContextValue(file(), undefined, "me", "write"),
        { multi: true },
      );
      expect(several).to.not.include("SAS.clinical.enableVersioning");
    });

    it("steps through comparing repository files", () => {
      const value = buildContextValue(file(), undefined, "me", "write");
      const compare = (keys: string[], multi = false) =>
        shown(value, { keys, multi }).filter((c) =>
          String(c).toLowerCase().includes("compare"),
        );
      expect(compare([])).to.deep.equal(["SAS.clinical.selectForCompare"]);
      expect(compare(["SAS.clinical.compareSourceSet"])).to.have.members([
        "SAS.clinical.selectForCompare",
        "SAS.clinical.compareWithSelected",
      ]);
      expect(compare(["SAS.clinical.twoItemsSelected"], true)).to.deep.equal([
        "SAS.clinical.compareSelected",
      ]);
      // Folders have nothing to compare.
      expect(
        shown(buildContextValue(folder, undefined, "me", "write"), {
          keys: ["SAS.clinical.compareSourceSet"],
        }).filter((c) => String(c).toLowerCase().includes("compare")),
      ).to.deep.equal([]);
    });

    it("offers version actions in the Version History view only", () => {
      const view = "clinicalversionhistoryprovider";
      expect(shown(";version;", { view })).to.have.members([
        "SAS.clinical.downloadVersion",
        "SAS.clinical.selectForCompare",
        "SAS.clinical.copySpecificVersion",
      ]);
      expect(
        shown(";version;", {
          view,
          keys: ["SAS.clinical.compareSourceSet"],
        }),
      ).to.include("SAS.clinical.compareWithSelected");
      expect(
        shown(";version;", {
          view,
          keys: ["SAS.clinical.twoVersionsSelected"],
          multi: true,
        }),
      ).to.include("SAS.clinical.compareSelected");
      // Repository items never show the version actions.
      expect(
        shown(buildContextValue(file(), undefined, "me", "write")),
      ).to.not.include("SAS.clinical.downloadVersion");
    });

    it("offers the audit history of any single item", () => {
      const audit = (contextValue: string, opts: Shown = {}) =>
        shown(contextValue, opts).includes("SAS.clinical.showAuditHistory");
      expect(
        audit(buildContextValue(file(), undefined, "me", "read")),
      ).to.equal(true);
      expect(audit(buildContextValue(org, topType, "me", "read"))).to.equal(
        true,
      );
      expect(
        audit(buildContextValue(file(), undefined, "me", "read"), {
          multi: true,
        }),
      ).to.equal(false);
    });

    it("offers Sign Files for files not checked out, and folders", () => {
      const sign = (contextValue: string, opts: Shown = {}) =>
        shown(contextValue, opts).includes("SAS.clinical.signFiles");
      // Signing needs read access and the privilege, not write access.
      expect(sign(buildContextValue(file(), undefined, "me", "read"))).to.equal(
        true,
      );
      expect(sign(buildContextValue(folder, undefined, "me", "read"))).to.equal(
        true,
      );
      expect(
        sign(buildContextValue(file(), undefined, "me", "read"), {
          multi: true,
        }),
      ).to.equal(true);
      for (const checkedOutBy of ["me", "you"]) {
        expect(
          sign(
            buildContextValue(
              file({ checkedOut: true, checkedOutBy }),
              undefined,
              "me",
              "write",
            ),
          ),
        ).to.equal(false);
      }
    });

    it("offers the signature history of signed files and versions", () => {
      const signature = [
        "SAS.clinical.showSignatureHistory",
        "SAS.clinical.exportSignatureHistory",
      ];
      const of = (contextValue: string, opts: Shown = {}) =>
        shown(contextValue, opts).filter((c) => signature.includes(String(c)));
      // Any signed version gives a history; read access is enough.
      for (const signingStatus of ["CURRENT", "PREVIOUS", "BOTH"]) {
        expect(
          of(
            buildContextValue(file({ signingStatus }), undefined, "me", "read"),
          ),
        ).to.have.members(signature);
      }
      expect(
        of(buildContextValue(file({ signingStatus: "NONE" }), undefined, "me")),
      ).to.deep.equal([]);
      expect(of(buildContextValue(file(), undefined, "me"))).to.deep.equal([]);
      expect(
        of(
          buildContextValue(
            file({ signingStatus: "CURRENT" }),
            undefined,
            "me",
          ),
          {
            multi: true,
          },
        ),
      ).to.deep.equal([]);

      const view = "clinicalversionhistoryprovider";
      expect(of(";version;signed;", { view })).to.have.members(signature);
      expect(of(";version;", { view })).to.deep.equal([]);
    });

    it("offers the workspace actions in the Workspace view only", () => {
      const view = "clinicalworkspaceprovider";
      const ws = (item: WorkspaceItem, opts: object = {}) =>
        shown(buildWorkspaceContextValue(item, "me"), { view, ...opts });
      const folderItem = wsFolder();
      expect(ws(folderItem)).to.have.members([
        "SAS.clinical.workspace.newFile",
        "SAS.clinical.workspace.newFolder",
        "SAS.clinical.workspace.checkIn",
        "SAS.clinical.workspace.undoCheckout",
        "SAS.clinical.workspace.copyPath",
        "SAS.clinical.workspace.rename",
        "SAS.clinical.workspace.delete",
        "SAS.clinical.workspace.download",
        "SAS.clinical.workspace.upload",
        "SAS.clinical.workspace.uploadAndExpand",
      ]);
      expect(ws(wsFile())).to.have.members([
        "SAS.clinical.workspace.checkIn",
        "SAS.clinical.workspace.copyPath",
        "SAS.clinical.workspace.rename",
        "SAS.clinical.workspace.delete",
        "SAS.clinical.workspace.download",
        "SAS.clinical.selectForCompare",
      ]);
      // Repository actions don't leak into the Workspace view.
      expect(ws(wsFile())).to.not.include("SAS.clinical.enableVersioning");
      expect(
        shown(buildContextValue(file(), undefined, "me", "write")),
      ).to.not.include("SAS.clinical.workspace.newFile");
    });

    it("limits check in and undo to what the user may do", () => {
      const view = "clinicalworkspaceprovider";
      const ws = (item: WorkspaceItem) =>
        shown(buildWorkspaceContextValue(item, "me"), { view });
      const mine = ws(
        wsFile({
          synchronizationInfo: { checkedOut: true, checkedOutBy: "me" },
        }),
      );
      expect(mine).to.include("SAS.clinical.workspace.checkIn");
      expect(mine).to.include("SAS.clinical.workspace.undoCheckout");
      const theirs = ws(
        wsFile({
          synchronizationInfo: { checkedOut: true, checkedOutBy: "you" },
        }),
      );
      expect(theirs).to.not.include("SAS.clinical.workspace.checkIn");
      expect(theirs).to.not.include("SAS.clinical.workspace.undoCheckout");
      // A file that isn't checked out can be checked in, but not undone.
      expect(ws(wsFile())).to.not.include(
        "SAS.clinical.workspace.undoCheckout",
      );
    });

    it("hides single-item workspace actions for multi-selections", () => {
      const multi = shown(buildWorkspaceContextValue(wsFolder(), "me"), {
        view: "clinicalworkspaceprovider",
        multi: true,
      });
      expect(multi).to.not.include("SAS.clinical.workspace.rename");
      expect(multi).to.not.include("SAS.clinical.workspace.newFile");
      expect(multi).to.not.include("SAS.clinical.workspace.upload");
      expect(multi).to.include("SAS.clinical.workspace.delete");
      expect(multi).to.include("SAS.clinical.workspace.download");
    });

    it("compares workspace files", () => {
      const view = "clinicalworkspaceprovider";
      const value = buildWorkspaceContextValue(wsFile(), "me");
      expect(
        shown(value, { view, keys: ["SAS.clinical.compareSourceSet"] }),
      ).to.include("SAS.clinical.compareWithSelected");
      expect(
        shown(value, {
          view,
          keys: ["SAS.clinical.twoWorkspaceItemsSelected"],
          multi: true,
        }),
      ).to.include("SAS.clinical.compareSelected");
    });

    it("offers copying into the workspace from the repository", () => {
      const submenu =
        pkg.contributes.menus["SAS.clinical.copyToWorkspaceSubmenu"];
      const offered = (value: string) =>
        submenu
          .filter((m: { when: string }) =>
            new RegExp(m.when.replace(/^viewItem =~ \/(.*)\/$/, "$1")).test(
              value,
            ),
          )
          .map((m: { command: string }) => m.command);
      expect(
        offered(buildContextValue(file(), undefined, "me", "read")),
      ).to.deep.equal(["SAS.clinical.copyLatestVersion"]);
      expect(
        offered(buildContextValue(folder, undefined, "me", "read")),
      ).to.deep.equal([
        "SAS.clinical.copyFolder",
        "SAS.clinical.copyFolderStructure",
      ]);
    });

    it("offers copying a version into the workspace", () => {
      expect(
        shown(";version;", { view: "clinicalversionhistoryprovider" }),
      ).to.include("SAS.clinical.copySpecificVersion");
    });

    it("offers Run Clinical Job on jobs when the service is there", () => {
      const keys = ["SAS.clinical.jobsAvailable"];
      const job = file({ name: "t.cjob", path: "/Acme/t.cjob" });
      const repoJob = buildContextValue(job, undefined, "me", "read");
      expect(shown(repoJob, { keys })).to.include("SAS.clinical.job.run");
      // Not without the service, not on programs, not for multi-selections.
      expect(shown(repoJob)).to.not.include("SAS.clinical.job.run");
      expect(
        shown(buildContextValue(file(), undefined, "me", "read"), { keys }),
      ).to.not.include("SAS.clinical.job.run");
      expect(shown(repoJob, { keys, multi: true })).to.not.include(
        "SAS.clinical.job.run",
      );
      const wsJob = buildWorkspaceContextValue(
        wsFile({ name: "t.cjob", path: "/Acme/t.cjob" }),
        "me",
      );
      expect(
        shown(wsJob, { keys, view: "clinicalworkspaceprovider" }),
      ).to.include("SAS.clinical.job.run");
    });

    it("offers Run as Clinical Job on workspace programs only", () => {
      const keys = ["SAS.clinical.jobsAvailable"];
      const view = "clinicalworkspaceprovider";
      const program = buildWorkspaceContextValue(wsFile(), "me");
      expect(shown(program, { keys, view })).to.include(
        "SAS.clinical.job.runProgram",
      );
      expect(shown(program, { view })).to.not.include(
        "SAS.clinical.job.runProgram",
      );
      // Not on repository programs, not on other files.
      expect(
        shown(buildContextValue(file(), undefined, "me", "write"), { keys }),
      ).to.not.include("SAS.clinical.job.runProgram");
      expect(
        shown(
          buildWorkspaceContextValue(
            wsFile({ name: "adsl.log", path: "/Acme/adsl.log" }),
            "me",
          ),
          { keys, view },
        ),
      ).to.not.include("SAS.clinical.job.runProgram");
    });

    it("offers New Schedule on jobs in both views", () => {
      const keys = ["SAS.clinical.jobsAvailable"];
      const job = file({ name: "t.cjob", path: "/Acme/t.cjob" });
      expect(
        shown(buildContextValue(job, undefined, "me", "read"), { keys }),
      ).to.include("SAS.clinical.schedule.new");
      expect(
        shown(
          buildWorkspaceContextValue(
            wsFile({ name: "t.cjob", path: "/Acme/t.cjob" }),
            "me",
          ),
          { keys, view: "clinicalworkspaceprovider" },
        ),
      ).to.include("SAS.clinical.schedule.new");
      expect(
        shown(buildContextValue(file(), undefined, "me", "read"), { keys }),
      ).to.not.include("SAS.clinical.schedule.new");
    });

    it("offers the manifest report on .cmnf files", () => {
      const keys = ["SAS.clinical.jobsAvailable"];
      const cmnf = file({ name: "t.cmnf", path: "/Acme/t.cmnf" });
      const value = buildContextValue(cmnf, undefined, "me", "read");
      expect(shown(value, { keys })).to.include.members([
        "SAS.clinical.job.showManifest",
        "SAS.clinical.job.exportManifest",
      ]);
      expect(shown(value)).to.not.include("SAS.clinical.job.showManifest");
      expect(
        shown(buildContextValue(file(), undefined, "me", "read"), { keys }),
      ).to.not.include("SAS.clinical.job.showManifest");
    });

    it("declares every command it uses", () => {
      const declared = new Set(
        pkg.contributes.commands.map((c: { command: string }) => c.command),
      );
      for (const menu of menus) {
        if (menu.command) {
          expect(declared.has(menu.command), menu.command).to.be.true;
        }
      }
    });
  });
});

describe("fileKindToken", () => {
  it("tells jobs, manifests and programs apart", () => {
    expect(fileKindToken("t.cjob")).to.equal("job");
    expect(fileKindToken("T.CJOB")).to.equal("job");
    expect(fileKindToken("t", "JOB_FILE")).to.equal("job");
    expect(fileKindToken("t.cmnf")).to.equal("manifest");
    expect(fileKindToken("adsl.sas")).to.equal("sasProgram");
    expect(fileKindToken("adsl.sas7bdat")).to.equal(undefined);
    expect(fileKindToken("README")).to.equal(undefined);
  });
});

describe("parseWritePermission", () => {
  it("reads the permission shapes the service may return", () => {
    expect(parseWritePermission(["READ", "WRITE"])).to.be.true;
    expect(parseWritePermission(["READ"])).to.be.false;
    expect(parseWritePermission("READ,WRITE")).to.be.true;
    expect(parseWritePermission("read")).to.be.false;
    expect(parseWritePermission({ permissions: ["write"] })).to.be.true;
    expect(parseWritePermission({ items: ["READ"] })).to.be.false;
    expect(parseWritePermission([])).to.be.false;
  });

  it("gives up on unrecognised responses", () => {
    expect(parseWritePermission(undefined)).to.be.undefined;
    expect(parseWritePermission({ entries: [] })).to.be.undefined;
    expect(parseWritePermission(42)).to.be.undefined;
  });
});

describe("createLimiter", () => {
  it("never runs more than the limit at once and runs everything", async () => {
    const limit = createLimiter(3);
    let running = 0;
    let peak = 0;
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        limit(async () => {
          running++;
          peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 1));
          running--;
          return i;
        }),
      ),
    );
    expect(peak).to.equal(3);
    expect(results).to.deep.equal(Array.from({ length: 20 }, (_, i) => i));
  });

  it("frees the slot when a task fails", async () => {
    const limit = createLimiter(1);
    let error: unknown;
    try {
      await limit(() => Promise.reject(new Error("boom")));
    } catch (e) {
      error = e;
    }
    expect(error).to.be.instanceOf(Error);
    expect(await limit(async () => "ok")).to.equal("ok");
  });
});

describe("downloads", () => {
  it("names files, containers and multi-selections", () => {
    expect(downloadFileName([file()])).to.equal("adsl.sas");
    expect(downloadFileName([folder])).to.equal("adam.zip");
    expect(downloadFileName([file(), folder])).to.equal("adsl.sas.zip");
  });

  it("builds an id filter", () => {
    expect(buildIdFilter(["a", "b'c"])).to.equal("in(id,'a','b''c')");
  });
});

const bytes = (text: string) => new Uint8Array(Buffer.from(text));

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Build a zip archive with the given entries (deflated, or stored). */
function makeZip(
  entries: Array<{ name: string; data: Uint8Array; store?: boolean }>,
): Uint8Array {
  const parts: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = bytes(entry.name);
    const body = entry.store
      ? entry.data
      : new Uint8Array(deflateRawSync(entry.data));
    const method = entry.store ? 0 : 8;
    const local = new Uint8Array(30);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, name.length, true);
    const central = new Uint8Array(46);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    parts.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = concat(centrals);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cd.length, true);
  ev.setUint32(16, offset, true);
  return concat([...parts, cd, eocd]);
}

describe("zip handling", () => {
  const text = bytes("data class; set sashelp.class; run;\n".repeat(20));

  it("detects zips", () => {
    expect(isZip(makeZip([{ name: "a.sas", data: text }]))).to.be.true;
    expect(isZip(text)).to.be.false;
  });

  it("extracts a single deflated or stored entry", () => {
    for (const store of [false, true]) {
      const out = extractSingleZipEntry(
        makeZip([{ name: "a.sas", data: text, store }]),
      );
      expect(out).to.deep.equal(text);
    }
  });

  it("ignores directory entries", () => {
    const out = extractSingleZipEntry(
      makeZip([
        { name: "dir/", data: new Uint8Array(), store: true },
        { name: "dir/a.sas", data: text },
      ]),
    );
    expect(out).to.deep.equal(text);
  });

  it("returns undefined for several files or non-zips", () => {
    expect(
      extractSingleZipEntry(
        makeZip([
          { name: "a.sas", data: text },
          { name: "b.sas", data: text },
        ]),
      ),
    ).to.be.undefined;
    expect(extractSingleZipEntry(text)).to.be.undefined;
  });
});

describe("validators", () => {
  it("validates file names", () => {
    expect(validateFileName("adsl.sas")).to.be.undefined;
    expect(validateFileName("adsl")).to.equal("fileName");
    expect(validateFileName("a/b.sas")).to.equal("fileName");
  });

  it("validates folder names", () => {
    expect(validateFolderName("adam")).to.be.undefined;
    expect(validateFolderName(".hidden")).to.equal("folderDot");
    expect(validateFolderName(" x")).to.equal("folderLeadingSpace");
    expect(validateFolderName("x ")).to.equal("folderTrailingSpace");
    expect(validateFolderName("a*b")).to.equal("folderCharacters");
    expect(validateFolderName("a\\b")).to.equal("folderCharacters");
    expect(validateFolderName("x".repeat(256))).to.equal("folderLength");
  });

  it("validates versions", () => {
    expect(validateVersion("")).to.be.undefined;
    expect(validateVersion("1.0")).to.be.undefined;
    expect(validateVersion("1")).to.equal("versionFormat");
    expect(validateVersion("1.0.1")).to.equal("versionFormat");
    expect(validateVersion("MAJOR")).to.be.undefined;
    expect(validateVersion("minor")).to.be.undefined;
    expect(validateVersion("majors")).to.equal("versionFormat");
    // The regex has no /g flag, so repeated calls give the same answer.
    expect(validateVersion("2.1")).to.be.undefined;
  });
});

describe("parsePrivileges", () => {
  it("reads the versioning and signing privileges", () => {
    expect(
      parsePrivileges(["PRIVILEGE_ENABLE_VERSIONING", "PRIVILEGE_X"]),
    ).to.deep.equal({
      enableVersioning: true,
      manageVersioning: false,
      signFiles: false,
    });
    expect(
      parsePrivileges({
        items: ["privilege_manage_versioning", "PRIVILEGE_SIGN_FILE"],
      }),
    ).to.deep.equal({
      enableVersioning: false,
      manageVersioning: true,
      signFiles: true,
    });
    expect(parsePrivileges([])).to.deep.equal({
      enableVersioning: false,
      manageVersioning: false,
      signFiles: false,
    });
  });

  it("gives up on unrecognised responses", () => {
    expect(parsePrivileges(undefined)).to.be.undefined;
    expect(parsePrivileges(42)).to.be.undefined;
  });
});

describe("versions", () => {
  it("builds the versions URL of an item", () => {
    expect(buildVersionsUrl("a b")).to.equal(
      "/clinicalRepository/repository/items/a%20b/versions",
    );
  });

  it("compares versions numerically, newest first", () => {
    expect(compareVersions("10.0", "9.1")).to.be.lessThan(0);
    expect(compareVersions("1.2", "1.10")).to.be.greaterThan(0);
    expect(compareVersions("2", "2.0")).to.equal(0);
    const versions = ["1.0", "10.0", "2.1", "2.0"].map((fileVersion) => ({
      fileId: "11",
      fileVersion,
    }));
    expect(sortVersions(versions).map((v) => v.fileVersion)).to.deep.equal([
      "10.0",
      "2.1",
      "2.0",
      "1.0",
    ]);
    // The input is left as it was.
    expect(versions[0].fileVersion).to.equal("1.0");
  });

  it("names the file of a version", () => {
    expect(versionFileName("adsl.sas", "2.0")).to.equal("adsl-v2.0.sas");
    expect(versionFileName("my.data.xpt", "1.1")).to.equal("my.data-v1.1.xpt");
    expect(versionFileName("README", "3.0")).to.equal("README-v3.0");
    expect(versionFileName(".hidden", "1.0")).to.equal(".hidden-v1.0");
  });

  it("tells versions from repository items", () => {
    expect(
      isVersionRow({ ...file(), fileId: "11", name: "a", fileVersion: "1.0" }),
    ).to.be.true;
    // A repository file may carry a fileVersion, but never a fileId.
    expect(isVersionRow(file({ fileVersion: "1.0" }))).to.be.false;
  });
});

describe("isSameOrUnder", () => {
  it("matches the folder itself and what lies inside it", () => {
    expect(isSameOrUnder("/Acme/Study1", "/Acme/Study1")).to.be.true;
    expect(isSameOrUnder("/Acme/Study1/adam/a.sas", "/Acme/Study1")).to.be.true;
    expect(isSameOrUnder("/Acme/Study1/", "/Acme/Study1/")).to.be.true;
  });

  it("does not match siblings that merely share a prefix", () => {
    expect(isSameOrUnder("/Acme/Study10/a.sas", "/Acme/Study1")).to.be.false;
    expect(isSameOrUnder("/Acme", "/Acme/Study1")).to.be.false;
  });
});

describe("workspace paths", () => {
  it("encodes a path but keeps its slashes", () => {
    expect(encodePath("/Acme/My Study/a#b.sas")).to.equal(
      "/Acme/My%20Study/a%23b.sas",
    );
  });

  it("builds items URLs, with the root as the collection itself", () => {
    expect(buildWorkspaceItemsUrl(undefined)).to.equal(
      "/clinicalRepository/workspaces/@currentUser/items",
    );
    expect(buildWorkspaceItemsUrl("/")).to.equal(
      "/clinicalRepository/workspaces/@currentUser/items",
    );
    expect(
      buildWorkspaceItemsUrl("/Acme/a b.sas", {
        type: "FILE",
        includeSynchronizationInfo: true,
      }),
    ).to.equal(
      "/clinicalRepository/workspaces/@currentUser/items/Acme/a%20b.sas?type=FILE&includeSynchronizationInfo=true",
    );
    // A path without its leading slash is the same path.
    expect(buildWorkspaceItemsUrl("Acme", { expand: false })).to.equal(
      "/clinicalRepository/workspaces/@currentUser/items/Acme?expand=false",
    );
  });

  it("builds folder URLs", () => {
    expect(buildWorkspaceFolderUrl("/Acme/Study1", "new folder")).to.equal(
      "/clinicalRepository/workspaces/@currentUser/folders/Acme/Study1?name=new%20folder",
    );
    expect(buildWorkspaceFolderUrl("/", "top")).to.equal(
      "/clinicalRepository/workspaces/@currentUser/folders?name=top",
    );
  });

  it("joins a folder path and a name", () => {
    expect(joinWorkspacePath("/", "a.sas")).to.equal("/a.sas");
    expect(joinWorkspacePath("/Acme", "a.sas")).to.equal("/Acme/a.sas");
    expect(joinWorkspacePath("/Acme/", "a.sas")).to.equal("/Acme/a.sas");
  });

  it("tells workspace items from repository items and versions", () => {
    expect(isWorkspaceItem(wsFile())).to.be.true;
    expect(isWorkspaceItem(file())).to.be.false;
    expect(isWorkspaceItem({ ...file(), fileId: "11", fileVersion: "1.0" })).to
      .be.false;
    expect(isVersionRow(wsFile())).to.be.false;
  });

  it("picks the icon of a Clinical Acceleration file type", () => {
    expect(workspaceIconName("adsl.sas")).to.equal("sasProgramFile");
    expect(workspaceIconName("ADSL.SAS7BDAT")).to.equal("sasDataSet");
    expect(workspaceIconName("adsl.xpt")).to.equal("sasTransportFile");
    expect(workspaceIconName("run.cjob")).to.equal("clinicalJobFile");
    expect(workspaceIconName("run.cmnf")).to.equal("clinicalJobManifest");
    expect(workspaceIconName("run.log")).to.equal("log");
    expect(workspaceIconName("notes.txt")).to.be.undefined;
    expect(workspaceIconName("Makefile")).to.be.undefined;
  });

  it("names downloads of workspace items", () => {
    expect(
      downloadFileName([{ name: "adsl.sas", primaryType: "FILE" }]),
    ).to.equal("adsl.sas");
    expect(
      downloadFileName([{ name: "Study1", primaryType: "FOLDER" }]),
    ).to.equal("Study1.zip");
  });
});

describe("workspace check-out state", () => {
  const checkedOut = (by: string) =>
    wsFile({ synchronizationInfo: { checkedOut: true, checkedOutBy: by } });

  it("tells who has a file checked out", () => {
    expect(getWorkspaceCheckoutState(wsFile(), "me")).to.equal("none");
    expect(getWorkspaceCheckoutState(checkedOut("me"), "me")).to.equal("self");
    expect(getWorkspaceCheckoutState(checkedOut("you"), "me")).to.equal(
      "other",
    );
    expect(getWorkspaceCheckoutState(checkedOut("me"), undefined)).to.equal(
      "other",
    );
    expect(getWorkspaceCheckoutState(wsFolder(), "me")).to.equal("none");
  });

  it("builds the context value of workspace items", () => {
    expect(buildWorkspaceContextValue(wsFolder(), "me")).to.equal(
      ";workspace;container;canCheckIn;canUndo;",
    );
    expect(buildWorkspaceContextValue(wsFile(), "me")).to.equal(
      ";workspace;file;coNone;canCheckIn;sasProgram;",
    );
    expect(buildWorkspaceContextValue(checkedOut("me"), "me")).to.equal(
      ";workspace;file;coSelf;canCheckIn;canUndo;sasProgram;",
    );
    expect(buildWorkspaceContextValue(checkedOut("you"), "me")).to.equal(
      ";workspace;file;coOther;sasProgram;",
    );
  });
});

describe("check in", () => {
  const candidate = (
    name: string,
    synchronizationInfo: SynchronizationItem["synchronizationInfo"],
  ): SynchronizationItem => ({
    name,
    path: `/Acme/${name}`,
    synchronizationInfo,
  });
  const items = [
    candidate("new.sas", {}),
    candidate("unversioned.sas", { checkedOut: true, fileVersion: "-" }),
    candidate("unversioned2.sas", { checkedOut: true }),
    candidate("versioned.sas", { checkedOut: true, fileVersion: "2.3" }),
  ];

  it("sorts the candidates by what has to be asked", () => {
    const plan = planCheckIn(items);
    expect(plan.newFiles.map((i) => i.name)).to.deep.equal(["new.sas"]);
    expect(plan.unversioned.map((i) => i.name)).to.deep.equal([
      "unversioned.sas",
      "unversioned2.sas",
    ]);
    expect(plan.versioned.map((i) => i.name)).to.deep.equal(["versioned.sas"]);
  });

  describe("files that can't be checked in", () => {
    const ws = (
      name: string,
      synchronizationInfo?: WorkspaceItem["synchronizationInfo"],
    ): WorkspaceItem => ({
      name,
      path: `/Acme/${name}`,
      type: "FILE",
      synchronizationInfo,
    });

    it("keeps new files and the user's own check-outs", () => {
      const result = sortCheckInCandidates(
        [],
        [
          candidate("new.sas", { workspaceStatus: "NOT_SYNCED" }),
          candidate("mine.sas", {
            checkedOut: true,
            checkedOutBy: "me",
            workspaceStatus: "OUT_OF_SYNC",
          }),
        ],
        "me",
      );
      expect(result.candidates.map((c) => c.name)).to.deep.equal([
        "new.sas",
        "mine.sas",
      ]);
      expect(result.blocked).to.be.empty;
    });

    it("explains a changed copy that isn't checked out", () => {
      const result = sortCheckInCandidates(
        [],
        [candidate("copy.sas", { workspaceStatus: "OUT_OF_SYNC" })],
        "me",
      );
      expect(result.candidates).to.be.empty;
      expect(result.blocked).to.deep.equal([
        { name: "copy.sas", path: "/Acme/copy.sas", reason: "notCheckedOut" },
      ]);
    });

    it("leaves out an unchanged copy quietly", () => {
      const result = sortCheckInCandidates(
        [],
        [candidate("same.sas", { workspaceStatus: "IN_SYNC" })],
        "me",
      );
      expect(result.candidates).to.be.empty;
      expect(result.blocked).to.be.empty;
    });

    it("names who has a file checked out", () => {
      const result = sortCheckInCandidates(
        [],
        [
          candidate("theirs.sas", {
            checkedOut: true,
            checkedOutBy: "bob",
            checkedOutByDisplayName: "Bob B",
            workspaceStatus: "OUT_OF_SYNC",
          }),
        ],
        "me",
      );
      expect(result.blocked).to.deep.equal([
        {
          name: "theirs.sas",
          path: "/Acme/theirs.sas",
          reason: "checkedOutByOther",
          by: "Bob B",
        },
      ]);
    });

    it("explains selected files the server left out", () => {
      const result = sortCheckInCandidates(
        [
          ws("copy.sas", { workspaceStatus: "IN_SYNC" }),
          ws("odd.sas", { workspaceStatus: "NOT_SYNCED" }),
          ws("listed.sas"),
          { name: "folder", path: "/Acme/folder", type: "FOLDER" },
        ],
        [candidate("listed.sas", {})],
        "me",
      );
      expect(result.candidates.map((c) => c.name)).to.deep.equal([
        "listed.sas",
      ]);
      expect(result.blocked.map((b) => [b.name, b.reason])).to.deep.equal([
        ["copy.sas", "notCheckedOut"],
        ["odd.sas", "notOffered"],
      ]);
    });

    it("trusts the server when the user is unknown", () => {
      const result = sortCheckInCandidates(
        [],
        [candidate("x.sas", { checkedOut: true, checkedOutBy: "bob" })],
        undefined,
      );
      expect(result.candidates).to.have.length(1);
    });
  });

  it("raises the major or minor version", () => {
    expect(getNextVersion("major", "2.3")).to.equal("3.0");
    expect(getNextVersion("minor", "2.3")).to.equal("2.4");
    expect(getNextVersion("minor", "9.9")).to.equal("9.10");
    expect(getNextVersion("major", undefined)).to.equal("1.0");
    expect(getNextVersion("minor", "-")).to.equal("0.1");
    expect(() => getNextVersion("major", "3")).to.throw(/not a valid version/);
  });

  it("builds the body, versioning only what was asked for", () => {
    const body = buildCheckInBody(planCheckIn(items), {
      newFileVersion: "1.0",
      bump: "minor",
      comment: "weekly",
    });
    expect(body).to.deep.equal({
      fileSpecifications: [
        { path: "/Acme/new.sas", fileVersion: "1.0", type: "FILE" },
        { path: "/Acme/unversioned.sas", type: "FILE" },
        { path: "/Acme/unversioned2.sas", type: "FILE" },
        { path: "/Acme/versioned.sas", fileVersion: "2.4", type: "FILE" },
      ],
      comment: "weekly",
      includeNewFiles: true,
    });
  });

  it("can version everything, and upper-cases version keywords", () => {
    const body = buildCheckInBody(planCheckIn(items), {
      newFileVersion: "major",
      unversionedVersion: "1.0",
      bump: "major",
      comment: "",
    });
    expect(body.fileSpecifications.map((f) => f.fileVersion)).to.deep.equal([
      "MAJOR",
      "1.0",
      "1.0",
      "3.0",
    ]);
  });
});
