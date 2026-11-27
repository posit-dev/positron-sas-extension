import { expect } from "chai";
import proxyquire from "proxyquire";
import sinon from "sinon";

import {
  Messages,
  SAS_SERVER_ROOT_FOLDER,
} from "../../../src/components/ContentNavigator/const";
import { ContentItem } from "../../../src/components/ContentNavigator/types";
import { convertStaticFolderToContentItem } from "../../../src/components/ContentNavigator/utils";

const serverRoot = (): ContentItem =>
  convertStaticFolderToContentItem(SAS_SERVER_ROOT_FOLDER, {
    write: false,
    delete: false,
    addMember: false,
  });

const childItem = (parentFolderUri: string, name: string) => ({
  uri: `${parentFolderUri}\\${name}`,
  name,
  type: "SAS",
  category: 1,
  size: 10,
  modifiedTimeStamp: "/Date(1700000000000)/",
  engine: "",
  parentFolderUri,
});

describe("ItcServerAdapter tests", () => {
  const adapterFor = (
    output: unknown,
    fileNavigationRoot?: "USER" | "SYSTEM" | "CUSTOM",
    fileNavigationCustomRootPath?: string,
  ) => {
    const executeRawCode = sinon.stub().resolves(JSON.stringify(output));
    const ItcServerAdapter = proxyquire(
      "../../../src/connection/itc/ItcServerAdapter",
      { "./CodeRunner": { executeRawCode, runCode: sinon.stub() } },
    ).default;
    return new ItcServerAdapter(
      fileNavigationCustomRootPath,
      fileNavigationRoot,
    );
  };

  it("shows the home folder when it is empty", async () => {
    const adapter = adapterFor({
      success: true,
      data: [],
      listedPath: "C:\\Users\\sasdemo",
    });

    const items = await adapter.getChildItems(serverRoot());

    expect(items).to.have.length(1);
    expect(items[0].uri).to.equal("C:\\Users\\sasdemo");
    expect(items[0].name).to.equal("Home");
  });

  it("uses listedPath for the home folder when it has items", async () => {
    const adapter = adapterFor({
      success: true,
      data: [childItem("C:\\Users\\sasdemo", "a.sas")],
      listedPath: "C:\\Users\\sasdemo",
    });

    const items = await adapter.getChildItems(serverRoot());

    expect(items).to.have.length(1);
    expect(items[0].uri).to.equal("C:\\Users\\sasdemo");
  });

  it("keeps an empty listedPath for the SYSTEM root", async () => {
    const adapter = adapterFor(
      { success: true, data: [childItem("", "C:")], listedPath: "" },
      "SYSTEM",
    );

    const items = await adapter.getChildItems(serverRoot());

    expect(items).to.have.length(1);
    expect(items[0].uri).to.equal("");
  });

  it("falls back to parentFolderUri without listedPath", async () => {
    const adapter = adapterFor({
      success: true,
      data: [childItem("/home/sasdemo", "a.sas")],
    });

    const items = await adapter.getChildItems(serverRoot());

    expect(items).to.have.length(1);
    expect(items[0].uri).to.equal("/home/sasdemo");
  });

  it("returns no items instead of throwing without a path or items", async () => {
    const adapter = adapterFor({ success: true, data: [] });

    const items = await adapter.getChildItems(serverRoot());

    expect(items).to.deep.equal([]);
  });

  it("throws for a CUSTOM root that cannot be listed", async () => {
    const adapter = adapterFor(
      { success: false, message: "not found" },
      "CUSTOM",
      "D:\\missing",
    );

    let error: Error | undefined;
    try {
      await adapter.getChildItems(serverRoot());
    } catch (e) {
      error = e;
    }

    expect(error?.message).to.equal(Messages.FileNavigationRootUserError);
  });
});
