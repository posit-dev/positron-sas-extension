// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import * as iconv from "iconv-lite";

/**
 * SAS encoding names (the values of &SYSENCODING) and the iconv-lite codec
 * for each. Names not listed here are tried as codec names as they are.
 */
const SAS_TO_CODEC: Record<string, string> = {
  "utf-8": "utf8",
  utf8: "utf8",
  "us-ascii": "ascii",
  ascii: "ascii",
  ansi1252: "windows-1252",
  latin1: "latin1",
  wlatin1: "windows-1252",
  latin2: "iso-8859-2",
  wlatin2: "windows-1250",
  latin9: "iso-8859-15",
  latin5: "iso-8859-9",
  wturkish: "windows-1254",
  cyrillic: "iso-8859-5",
  wcyrillic: "windows-1251",
  greek: "iso-8859-7",
  wgreek: "windows-1253",
  hebrew: "iso-8859-8",
  whebrew: "windows-1255",
  arabic: "iso-8859-6",
  warabic: "windows-1256",
  wbaltic: "windows-1257",
  wvietnamese: "windows-1258",
  thai: "windows-874",
  "shift-jis": "cp932",
  sjis: "cp932",
  "ms-932": "cp932",
  "euc-jp": "euc-jp",
  "euc-cn": "gbk",
  "ms-936": "gbk",
  gb2312: "gbk",
  "euc-kr": "cp949",
  "ms-949": "cp949",
  big5: "big5",
  "ms-950": "big5",
  pcoem437: "cp437",
  pcoem850: "cp850",
  pcoem852: "cp852",
  pcoem866: "cp866",
};

/** The iconv-lite codec for a SAS encoding name, or undefined if none fits. */
export function toCodecName(sasEncoding: string): string | undefined {
  const name = sasEncoding.trim().toLowerCase();
  if (!name) {
    return undefined;
  }
  const codec = SAS_TO_CODEC[name] ?? name;
  return iconv.encodingExists(codec) ? codec : undefined;
}

/** A decoder that keeps a partial character of one chunk for the next. */
export interface StreamDecoder {
  write(chunk: Buffer): string;
}

/** The result of encoding text for SAS. */
export interface EncodedText {
  bytes: Buffer;
  /** True if a character has no equivalent in the encoding (it became ?). */
  lossy: boolean;
}

/**
 * The encoding of a SAS session: what SAS writes to the log and the result
 * files, and what it expects for the code it reads.
 */
export class SessionEncoding {
  static readonly UTF8 = new SessionEncoding("utf-8", "utf8");

  private constructor(
    /** The SAS name, such as wlatin1. */
    readonly name: string,
    /** The iconv-lite codec, such as windows-1252. */
    readonly codec: string,
  ) {}

  /** The encoding for a SAS name, or undefined if there is no codec for it. */
  static fromSasName(sasEncoding: string): SessionEncoding | undefined {
    const codec = toCodecName(sasEncoding);
    if (!codec) {
      return undefined;
    }
    return codec === "utf8"
      ? SessionEncoding.UTF8
      : new SessionEncoding(sasEncoding.trim().toLowerCase(), codec);
  }

  streamDecoder(): StreamDecoder {
    const decoder = iconv.getDecoder(this.codec);
    return { write: (chunk) => decoder.write(chunk) };
  }

  decode(bytes: Buffer): string {
    return iconv.decode(bytes, this.codec);
  }

  /**
   * Text to write to SAS. A UTF-8 session gets the string itself, as before
   * the session encoding was detected.
   */
  input(text: string): { data: string | Buffer; lossy: boolean } {
    if (this.codec === "utf8") {
      return { data: text, lossy: false };
    }
    const { bytes, lossy } = this.encode(text);
    return { data: bytes, lossy };
  }

  encode(text: string): EncodedText {
    const bytes = iconv.encode(text, this.codec);
    const lossy =
      this.codec !== "utf8" && iconv.decode(bytes, this.codec) !== text;
    return { bytes, lossy };
  }
}

/** How many bytes of an HTML file to look at for its charset. */
const CHARSET_SNIFF_BYTES = 2048;

/**
 * The codec named by the charset in an HTML file's head, or undefined if
 * there is none, or none that iconv-lite knows.
 */
export function htmlCharset(html: Buffer): string | undefined {
  // The head is ASCII in every encoding SAS writes it in.
  const head = html.subarray(0, CHARSET_SNIFF_BYTES).toString("latin1");
  const charset = /<meta[^>]*charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head)?.[1];
  return charset && iconv.encodingExists(charset) ? charset : undefined;
}

/**
 * Decodes an HTML result file: in the charset the file names, else in the
 * session's encoding. ODS HTML5 writes UTF-8, with a charset meta tag, in
 * every session encoding (seen with SAS Analytics Pro), so the session
 * encoding is only the fallback.
 */
export function decodeHtml(html: Buffer, encoding: SessionEncoding): string {
  const charset = htmlCharset(html);
  return charset ? iconv.decode(html, charset) : encoding.decode(html);
}

export const ENCODING_START_TAG = "SASENC";
export const ENCODING_END_TAG = "SASENCEND";

/**
 * Data step statements that write the session encoding between the tags,
 * for a data step that writes to the log the connection reads. The source
 * echo of these lines doesn't match parseSessionEncoding.
 */
export const PUT_SESSION_ENCODING = `length e $ 32; e = "&sysencoding";
    put '${ENCODING_START_TAG}' e '${ENCODING_END_TAG}';`;

/** The SAS encoding name written by PUT_SESSION_ENCODING, if text has it. */
export function parseSessionEncoding(text: string): string | undefined {
  return new RegExp(
    `${ENCODING_START_TAG}\\s*([\\w-]+)\\s*${ENCODING_END_TAG}`,
  ).exec(text)?.[1];
}

/**
 * How long a new session waits for SAS to report its encoding before it
 * goes on with UTF-8.
 */
export const ENCODING_DETECT_TIMEOUT_MS = 30_000;
