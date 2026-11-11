// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Show HTML in Positron's Viewer pane, as a file that Posit Assistant can read
// (#74), unlike a webview set to an HTML string.
import { Uri, env, extensions } from "vscode";

import { getPositronApi } from "./index";
import type { OutputFiles } from "./outputFiles";
import type { PreviewPanel } from "./positron-types";

/**
 * Resolve once a Viewer panel is visible (true), or after `timeoutMs` (false),
 * whichever comes first: a slow or failed Viewer must not hold anything up.
 */
export function waitUntilVisible(
  panel: PreviewPanel,
  timeoutMs = 3000,
): Promise<boolean> {
  if (panel.visible) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const done = (visible: boolean) => {
      clearTimeout(timer);
      listener.dispose();
      resolve(visible);
    };
    const timer = setTimeout(() => done(panel.visible), timeoutMs);
    const listener = panel.onDidChangeViewState(() => {
      if (panel.visible) {
        done(true);
      }
    });
  });
}

/**
 * previewHtml serves the file through Positron's built-in proxy extension.
 * Positron activates it on demand, but while the window is still starting the
 * command can be missing and the panel then never shows, without an error on
 * this side. Activating it first avoids that.
 */
async function activateProxy(): Promise<void> {
  try {
    await extensions.getExtension("positron.positron-proxy")?.activate();
  } catch {
    // previewHtml may still work; the fallback covers it when it does not.
  }
}

export interface ViewerOptions {
  /** View type and title of the fallback webview panel. */
  viewType: string;
  title: string;
  preserveFocus?: boolean;
  /** Name of the HTML file, without the counter and extension. */
  fileName?: string;
}

/**
 * Show `html` in the Viewer: written to a file of `files` and opened with
 * previewHtml, or set on a preview webview when that is not possible.
 * Resolves once it is showing (or after a timeout); never rejects. Returns
 * false outside Positron, where the caller shows the HTML itself.
 */
export async function showHtmlInViewer(
  html: string,
  files: OutputFiles,
  { viewType, title, preserveFocus = true, fileName }: ViewerOptions,
): Promise<boolean> {
  const api = getPositronApi();
  if (!api) {
    return false;
  }
  const showAsWebview = () => {
    const panel = api.window.createPreviewPanel(viewType, title, preserveFocus);
    panel.webview.html = html;
  };
  if (typeof api.window.previewHtml !== "function") {
    showAsWebview();
    return true;
  }
  try {
    const file = await files.write(html, fileName);
    await activateProxy();
    const panel = api.window.previewHtml(file);
    // Long enough for the proxy's first start; only a failure waits this long.
    if (!(await waitUntilVisible(panel, 10_000))) {
      // The Viewer failed on its side (it reports no error here): show the
      // HTML directly instead of leaving an empty or missing panel.
      console.error(`${title}: the Viewer did not show ${file}.`);
      panel.dispose();
      showAsWebview();
    }
  } catch (error) {
    console.error(`${title}: cannot open the HTML file:`, error);
    showAsWebview();
  }
  return true;
}

/**
 * Show the page at `url` (a URL on this machine, such as one of a
 * ViewerServer) in the Viewer, reached through env.asExternalUri so it also
 * works in Posit Workbench. Resolves true once it is showing; false outside
 * Positron or when the Viewer does not show it, and the caller falls back.
 */
export async function showUrlInViewer(url: string): Promise<boolean> {
  const api = getPositronApi();
  if (!api || typeof api.window.previewUrl !== "function") {
    return false;
  }
  try {
    const external = await env.asExternalUri(Uri.parse(url));
    await activateProxy();
    const panel = api.window.previewUrl(external);
    if (await waitUntilVisible(panel, 10_000)) {
      return true;
    }
    console.error(`The Viewer did not show ${url}.`);
    panel.dispose();
  } catch (error) {
    console.error(`The Viewer cannot show ${url}:`, error);
  }
  return false;
}
