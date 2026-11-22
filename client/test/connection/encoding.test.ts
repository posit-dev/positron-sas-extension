// Copyright © 2026, Posit Software, PBC. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { expect } from "chai";

import {
  PUT_SESSION_ENCODING,
  SessionEncoding,
  decodeHtml,
  htmlCharset,
  parseSessionEncoding,
  toCodecName,
} from "../../src/connection/encoding";

/** Bytes from text (as UTF-8) and single byte values, in order. */
const bytes = (...parts: (string | number)[]): Buffer =>
  Buffer.from(
    parts.flatMap((part) =>
      typeof part === "string" ? [...Buffer.from(part)] : [part],
    ),
  );

describe("session encoding", () => {
  describe("toCodecName", () => {
    it("maps SAS encoding names to codecs", () => {
      expect(toCodecName("utf-8")).to.equal("utf8");
      expect(toCodecName("wlatin1")).to.equal("windows-1252");
      expect(toCodecName("latin1")).to.equal("latin1");
      expect(toCodecName("LATIN9")).to.equal("iso-8859-15");
      expect(toCodecName("shift-jis")).to.equal("cp932");
      expect(toCodecName("euc-cn")).to.equal("gbk");
    });

    it("has a codec for every encoding the SAS Analytics Pro launchers start", () => {
      // &SYSENCODING of sas_u8, sas_en, sas_de, sas_pl, sas_tr, sas_ar,
      // sas_ru, sas_iw, sas_ja, sas_ja.sjis, sas_ko, sas_zh and sas_zt, and of
      // -encoding wlatin1. Only sas_zt.euc (euc-tw) has none.
      for (const name of [
        "utf-8",
        "latin1",
        "wlatin1",
        "latin9",
        "latin2",
        "latin5",
        "arabic",
        "cyrillic",
        "hebrew",
        "euc-jp",
        "shift-jis",
        "euc-kr",
        "euc-cn",
        "ms-950",
      ]) {
        expect(toCodecName(name), name).to.be.a("string");
      }
    });

    it("takes a codec name as it is", () => {
      expect(toCodecName("windows-1250")).to.equal("windows-1250");
    });

    it("has no codec for unknown names", () => {
      expect(toCodecName("no-such-encoding")).to.be.undefined;
      expect(toCodecName(" ")).to.be.undefined;
    });
  });

  describe("SessionEncoding", () => {
    it("uses the shared UTF-8 encoding for utf-8", () => {
      expect(SessionEncoding.fromSasName("utf-8")).to.equal(
        SessionEncoding.UTF8,
      );
      expect(SessionEncoding.fromSasName("no-such-encoding")).to.be.undefined;
    });

    it("encodes and decodes wlatin1", () => {
      const wlatin1 = SessionEncoding.fromSasName("wlatin1");
      const { bytes, lossy } = wlatin1.encode("ä€");

      expect([...bytes]).to.deep.equal([0xe4, 0x80]);
      expect(lossy).to.be.false;
      expect(wlatin1.decode(bytes)).to.equal("ä€");
    });

    it("tells when a character is not in the encoding", () => {
      const latin1 = SessionEncoding.fromSasName("latin1");

      expect(latin1.encode("€").lossy).to.be.true;
      expect(latin1.input("€").lossy).to.be.true;
    });

    it("gives a UTF-8 session the text itself", () => {
      expect(SessionEncoding.UTF8.input("ä")).to.deep.equal({
        data: "ä",
        lossy: false,
      });
    });

    it("decodes a character split over two chunks", () => {
      const decoder = SessionEncoding.UTF8.streamDecoder();

      expect(decoder.write(Buffer.from([0x61, 0xc3]))).to.equal("a");
      expect(decoder.write(Buffer.from([0xa4, 0x62]))).to.equal("äb");
    });
  });

  describe("parseSessionEncoding", () => {
    it("reads the encoding SAS writes", () => {
      expect(parseSessionEncoding("x\nSASENC wlatin1 SASENCEND\n")).to.equal(
        "wlatin1",
      );
      expect(parseSessionEncoding("SASENCutf-8SASENCEND")).to.equal("utf-8");
    });

    it("does not take the source echo for the encoding", () => {
      expect(parseSessionEncoding(`12   ${PUT_SESSION_ENCODING}`)).to.be
        .undefined;
    });
  });

  describe("HTML results", () => {
    it("finds the charset in the head", () => {
      expect(
        htmlCharset(Buffer.from('<meta charset="windows-1252">')),
      ).to.equal("windows-1252");
      expect(
        htmlCharset(
          Buffer.from(
            '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
          ),
        ),
      ).to.equal("utf-8");
      expect(htmlCharset(Buffer.from("<html><body>"))).to.be.undefined;
      expect(htmlCharset(Buffer.from('<meta charset="no-such">'))).to.be
        .undefined;
    });

    it("decodes in the charset of the file, else in the session encoding", () => {
      const wlatin1 = SessionEncoding.fromSasName("wlatin1");
      const utf8File = bytes('<meta charset="utf-8">', "ä");

      expect(decodeHtml(utf8File, wlatin1)).to.include("ä");
      expect(decodeHtml(Buffer.from([0xe4]), wlatin1)).to.equal("ä");
    });
  });
});
