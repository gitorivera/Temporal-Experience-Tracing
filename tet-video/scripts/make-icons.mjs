// Genera los íconos de la PWA (public/icons) sin dependencias: rasteriza
// una curva y un punto con antialiasing y escribe PNG con zlib.
// Uso: node scripts/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [0x1d, 0x6f, 0x93];
const TRACE = [0xff, 0x7a, 0xa5];
const SUN = [0xff, 0xc4, 0x3d];

// Geometría en unidades 0..1, dentro de la zona segura de íconos "maskable" (80 % central).
const curve = [];
for (let i = 0; i <= 64; i++) {
  const x = 0.2 + (0.52 * i) / 64;
  const u = (x - 0.2) / 0.52;
  curve.push([x, 0.56 - 0.16 * Math.sin(u * Math.PI * 1.6) * (0.6 + 0.4 * u)]);
}
const dot = curve[curve.length - 1];
const TRACE_HALF = 0.032;
const DOT_R = 0.075;

function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
const cover = (d, px) => Math.max(0, Math.min(1, 0.5 - d / px)); // d con signo: negativo = dentro

function render(size) {
  const px = 1 / size;
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filtro PNG: ninguno
    for (let x = 0; x < size; x++) {
      const fx = (x + 0.5) * px, fy = (y + 0.5) * px;
      let d = Infinity;
      for (let i = 1; i < curve.length; i++) d = Math.min(d, segDist(fx, fy, curve[i - 1], curve[i]));
      let c = mix(BG, TRACE, cover(d - TRACE_HALF, px));
      c = mix(c, SUN, cover(Math.hypot(fx - dot[0], fy - dot[1]) - DOT_R, px));
      raw[o++] = Math.round(c[0]); raw[o++] = Math.round(c[1]); raw[o++] = Math.round(c[2]);
    }
  }
  return png(size, size, raw);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">
<rect width="1" height="1" rx="0.2" fill="${hex(BG)}"/>
<polyline points="${curve.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(' ')}" fill="none" stroke="${hex(TRACE)}" stroke-width="${2 * TRACE_HALF}" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="${dot[0].toFixed(4)}" cy="${dot[1].toFixed(4)}" r="${DOT_R}" fill="${hex(SUN)}"/>
</svg>
`;

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('icon-192.png', out), render(192));
writeFileSync(new URL('icon-512.png', out), render(512));
writeFileSync(new URL('icon.svg', out), svg);
console.log('Íconos escritos en public/icons/');
