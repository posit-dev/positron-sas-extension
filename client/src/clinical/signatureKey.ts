// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The signature key: the QR code that links an authenticator app to the
// user's account, so that the app's PINs can sign files. SAS Clinical
// Acceleration Repository's web app gets it from
// POST repository/signatureKeys, which answers with a base64 PNG (not in the
// public API documentation). The image holds the user's one-time password
// secret: never log it, write it to a file or show it in the Viewer.
//
// No vscode import, so it is unit-tested directly.
import { escape } from "./report/html";

const PNG_BASE64_PREFIX = "iVBORw0KGgo";
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * The base64 PNG in a signatureKeys response. The web app uses the body as
 * is; a JSON string, an object with the image, or a data URL are accepted
 * too. Errors never include the response, which may hold the secret.
 */
export function parseQrImage(data: unknown): string {
  let value: unknown = data;
  if (typeof value === "string") {
    const text = value.trim();
    if (text.startsWith('"') || text.startsWith("{")) {
      try {
        value = JSON.parse(text);
      } catch {
        value = text;
      }
    }
  }
  if (value && typeof value === "object") {
    const record: object = value;
    value = ["image", "qrCode", "data"]
      .map((key) => (key in record ? Reflect.get(record, key) : undefined))
      .find((v) => v !== undefined);
  }
  if (typeof value !== "string") {
    throw new Error("The server did not return a QR code.");
  }
  const image = value
    .replace(/^data:image\/png;base64,/i, "")
    .replace(/\s/g, "");
  if (!BASE64.test(image) || !image.startsWith(PNG_BASE64_PREFIX)) {
    throw new Error("The server did not return a QR code.");
  }
  return image;
}

export interface SignatureKeyLabels {
  title: string;
  description: string;
  steps: string[];
  alt: string;
  note: string;
}

/**
 * The page that shows the QR code: no scripts, and a content security
 * policy that allows only the inline image and styles.
 */
export function renderSignatureKeyPage(
  image: string,
  labels: SignatureKeyLabels,
): string {
  if (!BASE64.test(image)) {
    throw new Error("Not a base64 image.");
  }
  const steps = labels.steps.map((s) => `<li>${escape(s)}</li>`).join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<meta name="referrer" content="no-referrer">
<title>${escape(labels.title)}</title>
<style>
body { font-family: var(--vscode-font-family, sans-serif); font-size: var(--vscode-font-size, 13px); color: var(--vscode-foreground); padding: 16px 24px; max-width: 640px; }
h1 { font-size: 1.4em; font-weight: 600; }
.qr { display: inline-block; background: #fff; padding: 16px; border: 1px solid #d3d3d3; border-radius: 4px; margin: 8px 0 16px; }
.qr img { display: block; width: 240px; height: 240px; image-rendering: pixelated; }
ol { padding-left: 1.4em; line-height: 1.6; }
.note { color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<h1>${escape(labels.title)}</h1>
<p>${escape(labels.description)}</p>
<div class="qr"><img src="data:image/png;base64,${image}" alt="${escape(labels.alt)}"></div>
<ol>${steps}</ol>
<p class="note">${escape(labels.note)}</p>
</body>
</html>`;
}
