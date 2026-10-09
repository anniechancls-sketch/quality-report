/**
 * 浏览器版 ZIP 读写。使用 Web 标准 CompressionStream / DecompressionStream('deflate-raw')，
 * 不依赖任何第三方库。OOXML（.docx / .xlsx）本质就是 ZIP 容器，因此浏览器内也能直接生成与解析。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = -1;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = (CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ -1) >>> 0;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

export function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return encoder.encode(String(input ?? ''));
}

export function toText(bytes) {
  return decoder.decode(bytes);
}

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

export async function createZip(entries) {
  const { time, day } = dosDateTime();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const raw = toBytes(entry.data);
    let payload = await deflateRaw(raw);
    let method = 8;
    if (payload.length >= raw.length) {
      payload = raw;
      method = 0;
    }
    const crc = crc32(raw);

    const local = new Uint8Array(30);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, day, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    chunks.push(local, nameBytes, payload);

    const dir = new Uint8Array(46);
    const dv = new DataView(dir.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, 0x0800, true);
    dv.setUint16(10, method, true);
    dv.setUint16(12, time, true);
    dv.setUint16(14, day, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, payload.length, true);
    dv.setUint32(24, raw.length, true);
    dv.setUint16(28, nameBytes.length, true);
    dv.setUint32(42, offset, true);
    central.push(dir, nameBytes);

    offset += local.length + nameBytes.length + payload.length;
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + centralSize + end.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of [...chunks, ...central, end]) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

export async function readZip(bytes) {
  const buf = toBytes(bytes);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件');

  const count = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);
  const files = {};

  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(pointer, true) !== 0x02014b50) throw new Error('ZIP 中央目录损坏');
    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(buf.subarray(pointer + 46, pointer + 46 + nameLength));

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const payload = buf.subarray(dataStart, dataStart + compressedSize);
    files[name] = method === 8 ? await inflateRaw(payload) : payload.slice();

    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
