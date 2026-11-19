// Copyright © 2026, SAS Institute Inc., Cary, NC, USA.  All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// The LSAF REST API has no "create folder"; uploading a zip and expanding it
// is the only way to make one. This writes a zip holding just an empty
// directory entry. Nothing here imports `vscode`.

/** 1980-01-01 00:00, the earliest MS-DOS date (0 is not a valid date). */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
/** MS-DOS directory attribute, in the external attributes. */
const DIRECTORY_ATTRIBUTE = 0x10;
/** General purpose flag bit 11: the name is UTF-8. */
const UTF8_FLAG = 0x0800;

const encoder = new TextEncoder();

/** A zip archive with one empty folder `name/` (stored, no data). */
export function emptyFolderZip(name: string): Uint8Array {
  const entry = encoder.encode(`${name.replace(/\/+$/, "")}/`);
  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true); // local file header
  local.setUint16(4, 10, true); // version needed: 1.0
  local.setUint16(6, UTF8_FLAG, true);
  local.setUint16(12, DOS_DATE, true);
  local.setUint16(26, entry.length, true);

  const central = new DataView(new ArrayBuffer(46));
  central.setUint32(0, 0x02014b50, true); // central directory header
  central.setUint16(4, 20, true); // version made by: 2.0, MS-DOS
  central.setUint16(6, 10, true); // version needed: 1.0
  central.setUint16(8, UTF8_FLAG, true);
  central.setUint16(14, DOS_DATE, true);
  central.setUint16(28, entry.length, true);
  central.setUint32(38, DIRECTORY_ATTRIBUTE, true);
  central.setUint32(42, 0, true); // offset of the local header

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory
  end.setUint16(8, 1, true);
  end.setUint16(10, 1, true);
  end.setUint32(12, 46 + entry.length, true); // central directory size
  end.setUint32(16, 30 + entry.length, true); // central directory offset

  const parts = [
    new Uint8Array(local.buffer),
    entry,
    new Uint8Array(central.buffer),
    entry,
    new Uint8Array(end.buffer),
  ];
  const zip = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    zip.set(part, offset);
    offset += part.length;
  }
  return zip;
}
