#!/usr/bin/env python3
"""Generate simple PNG icons for FrogSchem (pure stdlib, no PIL)."""
import struct, zlib, math

BG = (15, 23, 42)        # #0f172a
FG = (74, 222, 128)      # #4ade80
WIRE = (248, 250, 252)   # #f8fafc

def make_icon(size, path):
    # rounded-square background
    rad = size * 0.22
    px = [[BG + (255,)] * size for _ in range(size)]
    def in_round(x, y):
        # rounded rect from inset to size-inset
        m = size * 0.08
        x0, y0, x1, y1 = m, m, size - m, size - m
        if x < x0 or x > x1 or y < y0 or y > y1:
            return False
        cx = min(max(x, x0 + rad), x1 - rad)
        cy = min(max(y, y0 + rad), y1 - rad)
        return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad + 1

    def seg_dist(px_, py_, ax, ay, bx, by):
        vx, vy = bx - ax, by - ay
        wx, wy = px_ - ax, py_ - ay
        L2 = vx * vx + vy * vy
        t = 0 if L2 == 0 else max(0, min(1, (wx * vx + wy * vy) / L2))
        dx, dy = px_ - (ax + t * vx), py_ - (ay + t * vy)
        return math.hypot(dx, dy)

    # zigzag "resistor" polyline through the icon
    n = 6
    pts = []
    cx0 = size * 0.22
    cx1 = size * 0.78
    cy0 = size * 0.5
    amp = size * 0.16
    for i in range(n + 1):
        t = i / n
        x = cx0 + (cx1 - cx0) * t
        y = cy0 + (amp if i % 2 == 1 else -amp)
        pts.append((x, y))
    # wire leads
    leads = [((size*0.06, cy0), pts[0]), (pts[-1], (size*0.94, cy0))]
    thickness = size * 0.045

    for y in range(size):
        for x in range(size):
            if not in_round(x + 0.5, y + 0.5):
                px[y][x] = (0, 0, 0, 0)
                continue
            d = min(seg_dist(x + 0.5, y + 0.5, *a, *b) for a, b in zip(pts[:-1], pts[1:]))
            for a, b in leads:
                d = min(d, seg_dist(x + 0.5, y + 0.5, *a, *b))
            if d <= thickness:
                px[y][x] = FG + (255,)
            else:
                # center dot
                dc = math.hypot(x + 0.5 - size*0.5, y + 0.5 - size*0.42)
                if dc <= size * 0.055:
                    px[y][x] = WIRE + (255,)

    raw = b''.join(b'\x00' + b''.join(struct.pack('4B', *p) for p in row) for row in px)
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
    print('wrote', path, size, 'x', size)

for s, p in [(512, 'icon-512.png'), (192, 'icon-192.png'), (180, 'icon-180.png')]:
    make_icon(s, p)
