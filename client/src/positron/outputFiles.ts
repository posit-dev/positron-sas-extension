// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

/**
 * HTML reports of a SAS session's console runs, written to a temporary
 * folder so the Viewer can open them with positron.window.previewHtml().
 * Unlike a webview set to an HTML string, an HTML file in the Viewer can be
 * read by Posit Assistant (#74). Only the newest `keep` files are kept, and
 * the folder is removed on dispose.
 */
export class OutputFiles {
  private _dir: Promise<string> | undefined;
  private _count = 0;
  private readonly _files: string[] = [];

  constructor(
    private readonly keep = 20,
    private readonly parent = tmpdir(),
  ) {}

  /** Write `html` to a new file and return its path. */
  async write(html: string): Promise<string> {
    this._dir ??= mkdtemp(join(this.parent, "positron-sas-"));
    const dir = await this._dir;
    const file = join(dir, `sas-output-${++this._count}.html`);
    await writeFile(file, html, "utf8");
    this._files.push(file);
    while (this._files.length > this.keep) {
      await rm(this._files.shift()!, { force: true });
    }
    return file;
  }

  /** Remove the folder and every file in it. A later write starts afresh. */
  async dispose(): Promise<void> {
    const pending = this._dir;
    this._dir = undefined;
    this._files.length = 0;
    const dir = await pending?.catch(() => undefined);
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
