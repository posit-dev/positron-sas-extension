// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  PropertyLabels,
  buildPropertyRows,
  formatBytes,
  formatDate,
} from "../../src/clinical/properties";
import type { RepositoryItem } from "../../src/clinical/types";

// Every label is its own key, which keeps the expectations readable.
const labels: PropertyLabels = {
  name: "name",
  description: "description",
  location: "location",
  type: "type",
  owner: "owner",
  createdBy: "createdBy",
  dateCreated: "dateCreated",
  modifiedBy: "modifiedBy",
  dateModified: "dateModified",
  state: "state",
  size: "size",
  lockStatus: "lockStatus",
  versionStatus: "versionStatus",
  version: "version",
  checkedOut: "checkedOut",
  checkedOutBy: "checkedOutBy",
  checkedOutDate: "checkedOutDate",
  workspaceStatus: "workspaceStatus",
  locked: "locked",
  unlocked: "unlocked",
  versioned: "versioned",
  unversioned: "unversioned",
  checkedOutYes: "checkedOutYes",
  checkedOutNo: "checkedOutNo",
  syncMissing: "syncMissing",
  syncOutOfSync: "syncOutOfSync",
  syncInSync: "syncInSync",
  syncNotSynced: "syncNotSynced",
  syncUnknown: "syncUnknown",
};

const file = (extra: Partial<RepositoryItem> = {}): RepositoryItem => ({
  id: "11",
  name: "adsl.sas",
  path: "/Acme/Study1/adam/adsl.sas",
  typeId: "sasprogram",
  primaryType: "FILE",
  size: 2048,
  ...extra,
});

const rows = (item: RepositoryItem, typeName?: string) =>
  Object.fromEntries(
    buildPropertyRows(item, typeName, labels, "en-US").map((row) => [
      row.key,
      row.value,
    ]),
  );

describe("formatBytes", () => {
  it("scales to the largest fitting unit", () => {
    expect(formatBytes(0)).to.equal("0 Bytes");
    expect(formatBytes(undefined)).to.equal("0 Bytes");
    expect(formatBytes(1)).to.equal("1 Bytes");
    expect(formatBytes(1023)).to.equal("1023 Bytes");
    expect(formatBytes(2048)).to.equal("2 KB");
    expect(formatBytes(1536, 1)).to.equal("1.5 KB");
    expect(formatBytes(5 * 1024 ** 3)).to.equal("5 GB");
  });
});

describe("formatDate", () => {
  it("leaves out missing dates and keeps unparsable ones as they are", () => {
    expect(formatDate(undefined)).to.equal("");
    expect(formatDate("")).to.equal("");
    expect(formatDate("not a date")).to.equal("not a date");
  });

  it("formats timestamps given as text or as milliseconds", () => {
    const text = formatDate("2026-10-26T12:00:00Z", "en-US");
    expect(text).to.match(/2026/);
    expect(formatDate(Date.parse("2026-10-26T12:00:00Z"), "en-US")).to.equal(
      text,
    );
  });
});

describe("buildPropertyRows", () => {
  it("describes an unversioned file", () => {
    const r = rows(
      file({
        description: "ADSL",
        ownerDisplayName: "Ann",
        modifiedTimeStamp: "2026-10-26T12:00:00Z",
        synchronizationInfo: { workspaceStatus: "IN_SYNC" },
      }),
      "SAS Program",
    );
    expect(r).to.include({
      name: "adsl.sas",
      description: "ADSL",
      location: "/Acme/Study1/adam/adsl.sas",
      type: "SAS Program",
      owner: "Ann",
      size: "2 KB",
      locked: "unlocked",
      versioned: "unversioned",
      checkedOut: "checkedOutNo",
      workspaceStatus: "syncInSync",
    });
    expect(r).to.have.property("dateModified");
    expect(r).to.not.have.any.keys("fileVersion", "checkedOutBy", "state");
  });

  it("adds the version and check-out details when they apply", () => {
    const r = rows(
      file({
        versioned: true,
        fileVersion: "2.0",
        locked: true,
        checkedOut: true,
        checkedOutBy: "u1",
        checkedOutByDisplayName: "Bob",
        checkedOutTimestamp: "2026-10-26T12:00:00Z",
      }),
    );
    expect(r).to.include({
      versioned: "versioned",
      fileVersion: "2.0",
      locked: "locked",
      checkedOut: "checkedOutYes",
      checkedOutBy: "Bob",
    });
    expect(r).to.have.property("checkedOutDate");
  });

  it("falls back to the type id and the path", () => {
    const r = rows(file({ location: undefined }));
    expect(r.type).to.equal("sasprogram");
    expect(r.location).to.equal("/Acme/Study1/adam/adsl.sas");
  });

  it("maps each workspace status and passes unknown ones through", () => {
    const status = (workspaceStatus?: string) =>
      rows(file({ synchronizationInfo: { workspaceStatus } })).workspaceStatus;
    expect(status("WORKSPACE_FILE_MISSING")).to.equal("syncMissing");
    expect(status("OUT_OF_SYNC")).to.equal("syncOutOfSync");
    expect(status("NOT_SYNCED")).to.equal("syncNotSynced");
    expect(status(undefined)).to.equal("syncUnknown");
    expect(status("SOMETHING_NEW")).to.equal("SOMETHING_NEW");
  });

  it("shows the state of a context and no file rows for it", () => {
    const r = rows({
      id: "2",
      name: "Acme",
      path: "/Acme",
      typeId: "organization",
      primaryType: "CONTEXT",
      state: "ACTIVE",
    });
    expect(r.state).to.equal("Active");
    expect(r).to.not.have.any.keys("size", "versioned", "workspaceStatus");
  });

  it("shows no file rows for a folder", () => {
    const r = rows({
      id: "10",
      name: "adam",
      path: "/Acme/adam",
      typeId: "folder",
      primaryType: "FOLDER",
    });
    expect(r).to.not.have.any.keys("size", "locked", "checkedOut");
  });
});
