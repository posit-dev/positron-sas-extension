// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Guards for the LSAF contributions in package.json: nothing LSAF shows
// unless an LSAF server was detected (SAS.lsaf.available), `when` clauses
// only use keys the code sets, and every command is declared, hidden from the
// palette unless meant for it, and registered.
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

let root = __dirname;
while (!fs.existsSync(path.join(root, "package.nls.json"))) {
  root = path.dirname(root);
}
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const contributes = pkg.contributes;

interface MenuEntry {
  command?: string;
  submenu?: string;
  when?: string;
  group?: string;
}

const isLsafCommand = (command: string | undefined) =>
  !!command && command.startsWith("SAS.lsaf.");
const menu = (name: string): MenuEntry[] => contributes.menus[name] ?? [];
const lsafEntries = (name: string) =>
  menu(name).filter((entry) => isLsafCommand(entry.command));
const declared: string[] = contributes.commands
  .map((c: { command: string }) => c.command)
  .filter(isLsafCommand);

/** Evaluate an LSAF view menu's `when` for an item, view and context keys. */
export function shown(
  name: "view/item/context" | "view/title",
  view: string,
  contextValue: string,
  keys: string[] = ["SAS.lsaf.available", "SAS.lsaf.signedIn"],
): string[] {
  return lsafEntries(name)
    .filter((entry) => {
      let expr = (entry.when ?? "true")
        .replace(/view == (\w+)/g, (_m, v) => String(v === view))
        .replace(/viewItem =~ \/([^/]+)\//g, (_m, re) =>
          String(new RegExp(re).test(contextValue)),
        )
        .replace(/SAS\.lsaf\.\w+/g, (key) => String(keys.includes(key)));
      expect(expr, entry.when).to.match(/^[truefals()|&! ]+$/);
      expr = expr.replace(/\btrue\b/g, "1").replace(/\bfalse\b/g, "0");
      return Boolean(eval(expr));
    })
    .map(
      (entry) => `${entry.command}${entry.group === "inline" ? "@inline" : ""}`,
    );
}

describe("LSAF package.json contributions", () => {
  it("shows the views only when LSAF is detected", () => {
    const views = contributes.views["sas-lsaf-view-container"];
    expect(views.map((v: { id: string }) => v.id)).to.deep.equal([
      "lsafrepositoryprovider",
      "lsafworkspaceprovider",
      "lsafjobsprovider",
    ]);
    for (const view of views) {
      expect(view.when, view.id).to.match(/\bSAS\.lsaf\.available\b/);
    }
    for (const welcome of contributes.viewsWelcome.filter(
      (w: { view: string }) => w.view.startsWith("lsaf"),
    )) {
      expect(welcome.when).to.match(/\bSAS\.lsaf\.available\b/);
    }
  });

  it("keeps every LSAF command out of the palette unless LSAF is detected", () => {
    const palette = new Map(
      lsafEntries("commandPalette").map((entry) => [entry.command, entry.when]),
    );
    for (const command of declared) {
      expect(palette.has(command), `${command} needs a palette entry`).to.equal(
        true,
      );
      const when = palette.get(command) ?? "";
      expect(
        when === "false" || /\bSAS\.lsaf\.available\b/.test(when),
        `${command}: ${when}`,
      ).to.equal(true);
    }
  });

  it("requires LSAF in every editor and explorer menu", () => {
    for (const name of Object.keys(contributes.menus)) {
      if (name.startsWith("view/") || name === "commandPalette") {
        continue;
      }
      for (const entry of lsafEntries(name)) {
        expect(entry.when, `${name} ${entry.command}`).to.match(
          /\bSAS\.lsaf\.available\b/,
        );
      }
    }
  });

  it("puts LSAF view commands on LSAF views only", () => {
    for (const name of ["view/title", "view/item/context"]) {
      for (const entry of lsafEntries(name)) {
        expect(entry.when, entry.command).to.match(
          /^view == lsaf\w+provider\b/,
        );
      }
    }
  });

  it("declares every command its menus use", () => {
    for (const name of Object.keys(contributes.menus)) {
      for (const entry of lsafEntries(name)) {
        expect(declared, `${name}: ${entry.command}`).to.include(entry.command);
      }
    }
  });

  it("registers every declared command", () => {
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        const file = path.join(dir, name);
        if (fs.statSync(file).isDirectory()) {
          walk(file);
        } else if (file.endsWith(".ts")) {
          sources.push(fs.readFileSync(file, "utf8"));
        }
      }
    };
    walk(path.join(root, "client", "src", "lsaf"));
    const code = sources.join("\n");
    for (const command of declared) {
      expect(code, command).to.include(`"${command}"`);
    }
  });

  it("titles every command", () => {
    const nls = JSON.parse(
      fs.readFileSync(path.join(root, "package.nls.json"), "utf8"),
    );
    for (const entry of contributes.commands.filter((c: { command: string }) =>
      isLsafCommand(c.command),
    )) {
      const key = String(entry.title).replace(/^%|%$/g, "");
      expect(nls[key], entry.command).to.be.a("string");
    }
  });
});
