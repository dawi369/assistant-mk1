type ZipEntry = { name: string; content: Uint8Array };

const encoder = new TextEncoder();

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

const crc32 = (bytes: Uint8Array) => {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff]!;
  return (value ^ 0xffffffff) >>> 0;
};

const u16 = (value: number) => new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
const u32 = (value: number) =>
  new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);

const join = (parts: readonly Uint8Array[]) => {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
};

export const textZipEntry = (name: string, value: string): ZipEntry => ({
  name,
  content: encoder.encode(value),
});

export const createStoredZip = (entries: readonly ZipEntry[]) => {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const checksum = crc32(entry.content);
    const local = join([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(checksum),
      u32(entry.content.byteLength),
      u32(entry.content.byteLength),
      u16(name.byteLength),
      u16(0),
      name,
      entry.content,
    ]);
    localParts.push(local);
    centralParts.push(
      join([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(0),
        u32(checksum),
        u32(entry.content.byteLength),
        u32(entry.content.byteLength),
        u16(name.byteLength),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += local.byteLength;
  }

  const central = join(centralParts);
  return join([
    ...localParts,
    central,
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.byteLength),
    u32(offset),
    u16(0),
  ]);
};
