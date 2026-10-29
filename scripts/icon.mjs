// The listing icon (.claude-plugin/icon.png): the office cat on the worker's desk at night, 24 × 24
// pixels in the night palette (hooks/palette.ts), each pixel 64 × 64, written as an RGB PNG with
// node's zlib. Run from anywhere: node scripts/icon.mjs [out.png]
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
const N = 24, S = 64
const C = {
  wall: 0x1a1728, floor: 0x2a2433, frame: 0x4a4060, sky: 0x0d1030, star: 0xfff3c4, city: 0x161433,
  lit: 0xe8b878, wire: 0x3d3650, bulbA: 0xf2d29a, bulbB: 0xe8a87c, deskTop: 0x8a6a4a, desk: 0x6b4a32,
  leg: 0x4a3222, lamp: 0xa8875f, mon: 0x55506a, screen: 0x0a0e0a, cat: 0x8a8399, catDark: 0x6b6577,
  eye: 0xf4efe6, nose: 0xd98a9a, mug: 0x5a93b5, mugShade: 0x2d5e7e, steam: 0x9a94a8, steam2: 0x6f6a80,
  read: 0x9fb4ff, shell: 0x5cc8c0, edit: 0xf2a65a, search: 0xc9a0ff,
}
const px = Array.from({ length: N }, () => Array(N).fill(C.wall))
const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px[y][x] = c }
const set = (x, y, c) => { px[y][x] = c }
// The window, top right: frame, night sky, two stars, the city across the street with lit windows.
rect(12, 1, 22, 10, C.frame); rect(13, 2, 21, 9, C.sky)
set(15, 3, C.star); set(20, 4, C.star)
for (const [x, h] of [[13, 2], [14, 3], [15, 3], [16, 1], [17, 2], [18, 4], [19, 4], [20, 2], [21, 3]]) rect(x, 10 - h, x, 9, C.city)
set(14, 8, C.lit); set(18, 7, C.lit); set(21, 8, C.lit)
// String lights along the top of the wall, left of the window.
rect(0, 1, 11, 1, C.wire)
for (const [i, x] of [1, 4, 7, 10].entries()) set(x, 2, i % 2 ? C.bulbB : C.bulbA)
// The monitor with code on its screen.
rect(1, 8, 10, 15, C.mon); rect(2, 9, 9, 14, C.screen)
rect(3, 10, 6, 10, C.read); rect(4, 11, 8, 11, C.shell); rect(4, 12, 6, 12, C.edit); rect(3, 13, 7, 13, C.search)
rect(5, 16, 6, 16, C.mon) // the stand
// The desk, lamplit under the monitor, and the floor.
rect(0, 17, 23, 17, C.deskTop); rect(1, 17, 9, 17, C.lamp); rect(0, 18, 23, 19, C.desk)
rect(1, 20, 2, 22, C.leg); rect(21, 20, 22, 22, C.leg); rect(0, 23, 23, 23, C.floor)
// The cat, sitting on the desk facing out, its tail wrapped round its feet.
const cat = [
  'k.....k',
  'kk...kk',
  'kkkkkkk',
  'kekkkek',
  'kkknkkk',
  '.kkkkk.',
  '.kkkkk.',
  'kkkkkkk',
  'kdkkkdkkk',
]
cat.forEach((row, dy) => [...row].forEach((ch, dx) => {
  const c = { k: C.cat, e: C.eye, n: C.nose, d: C.catDark }[ch]
  if (c) set(12 + dx, 8 + dy, c)
}))
set(20, 15, C.cat) // the tail's tip, curling up
// A mug with steam curling off it.
rect(21, 15, 22, 16, C.mug); set(21, 16, C.mugShade); set(23, 15, C.mug)
set(22, 14, C.steam); set(21, 13, C.steam2); set(22, 12, C.steam)
// Encode.
const W = N * S, raw = Buffer.alloc((W * 3 + 1) * W)
for (let y = 0; y < W; y++) {
  const o = y * (W * 3 + 1); raw[o] = 0
  for (let x = 0; x < W; x++) { const c = px[Math.floor(y / S)][Math.floor(x / S)]; raw[o + 1 + x * 3] = c >> 16; raw[o + 2 + x * 3] = (c >> 8) & 255; raw[o + 3 + x * 3] = c & 255 }
}
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc = b => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const k = Buffer.alloc(4); k.writeUInt32BE(crc(td)); return Buffer.concat([l, td, k]) }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 2
writeFileSync(process.argv[2] ?? new URL('../.claude-plugin/icon.png', import.meta.url), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]))
