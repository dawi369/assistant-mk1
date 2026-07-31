import { describe, expect, it } from "vitest";

import { createStoredZip, textZipEntry } from "./zip-archive";

describe("workspace export ZIP", () => {
  it("creates deterministic archives with local, central, and end records", () => {
    const entries = [
      textZipEntry("manifest.json", '{"ok":true}'),
      textZipEntry("runs.ndjson", "{}\n"),
    ];
    const first = createStoredZip(entries);
    const second = createStoredZip(entries);
    expect(first).toEqual(second);
    const view = new DataView(first.buffer, first.byteOffset, first.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(
      Array.from(first).some(
        (_, index) =>
          index + 4 <= first.length &&
          new DataView(first.buffer, first.byteOffset + index, 4).getUint32(0, true) === 0x02014b50,
      ),
    ).toBe(true);
    expect(view.getUint32(first.byteLength - 22, true)).toBe(0x06054b50);
  });
});
