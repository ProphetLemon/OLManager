#!/usr/bin/env python3 -I
"""Measure how well public/map.webp lines up with the engine's map coordinates.

Usage (from the repo root):
    python3 -I scripts/rift-map/measure-alignment.py <out-dir>

It decodes the image with ffmpeg, reads the lane polylines from
src/lib/match/live/mapGeometry.ts and the structure / pit positions from
src/lib/match/lolMapLayout.ts, and reports:
  * the share of densely sampled lane points that land on walkable pixels
    (anything that is not the black jungle wall or the black outside),
  * the mean clearance of those points to the nearest wall, in image pixels,
  * the same for towers, plus how many base structures land on base pixels,
  * the best translation and scale of the image against the game coordinates
    (search grid), so a mismatch can be fixed with a transform on the image.
It also writes overlay.png (lanes, structures and pits drawn on the image).
Needs numpy and ffmpeg; no other dependency.
"""
import math
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SIZE = 1200


def load_rgb():
    raw = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", str(ROOT / "public/map.webp"),
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, np.uint8).reshape(SIZE, SIZE, 3).astype(int)


def parse_lanes():
    src = (ROOT / "src/lib/match/live/mapGeometry.ts").read_text()
    block = src[src.index("export const LANES"):src.index("export const LANE_KEYS")]
    lanes = {}
    for key in ("top", "mid", "bot"):
        m = re.search(rf"{key}: line\((.*?)\),\n", block, re.S)
        pts = [(int(a), int(b)) for a, b in re.findall(r"\[(\d+),\s*(\d+)\]", m.group(1))]
        lanes[key] = [(x / 1000, y / 1000) for x, y in pts]
    return lanes


def parse_layout():
    src = (ROOT / "src/lib/match/lolMapLayout.ts").read_text()
    structs = [
        dict(id=i, side=s, lane=l, x=float(x), y=float(y))
        for i, s, l, x, y in re.findall(
            r'id: "([^"]+)", side: "(\w+)", lane: "(\w+)".*?x: ([\d.]+), y: ([\d.]+)', src)
    ]
    pits = {
        i: (float(x), float(y))
        for i, x, y in re.findall(r'id: "(baron-pit|dragon-pit)".*?x: ([\d.]+), y: ([\d.]+)', src)
    }
    return structs, pits


def densify(poly, step=0.004):
    out = []
    for (x0, y0), (x1, y1) in zip(poly, poly[1:]):
        n = max(1, int(math.hypot(x1 - x0, y1 - y0) / step))
        out += [(x0 + (x1 - x0) * t / n, y0 + (y1 - y0) * t / n) for t in range(n)]
    out.append(poly[-1])
    return out


def classify(img):
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    lum = (r * 3 + g * 6 + b) // 10
    dark = (lum < 70) & (b - r < 40)
    river = (b - r > 40) & (b > 120)
    return dark, river


def clearance(dark, max_r=60):
    """Distance in pixels to the nearest dark pixel, by repeated erosion (octagonal)."""
    free = ~dark
    out = np.zeros(free.shape, np.float32)
    cur = free.copy()
    for step in range(1, max_r + 1):
        p = np.pad(cur, 1, constant_values=False)
        n4 = p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]
        if step % 2 == 0:
            n4 = n4 & p[:-2, :-2] & p[:-2, 2:] & p[2:, :-2] & p[2:, 2:]
        cur = cur & n4
        out[cur] = step
        if not cur.any():
            break
    return out


def sample(arr, pts, dx=0.0, dy=0.0, s=1.0):
    xs = np.array([min(SIZE - 1, max(0, round(((x - .5) * s + .5 + dx) * SIZE))) for x, _ in pts])
    ys = np.array([min(SIZE - 1, max(0, round(((y - .5) * s + .5 + dy) * SIZE))) for _, y in pts])
    return arr[ys, xs]


def main(out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    img = load_rgb()
    dark, river = classify(img)
    clear = clearance(dark)
    lanes = parse_lanes()
    structs, pits = parse_layout()
    dense = {k: densify(v) for k, v in lanes.items()}
    lane_pts = [p for v in dense.values() for p in v]
    towers = [(s["x"], s["y"]) for s in structs if s["lane"] != "base" or "tower" in s["id"]]
    base_pts = [(s["x"], s["y"]) for s in structs if s["lane"] == "base"]
    pit_pts = list(pits.values())

    def report(label, dx=0.0, dy=0.0, s=1.0):
        print(f"--- {label} (dx={dx * 100:+.2f}% dy={dy * 100:+.2f}% scale={s:.3f})")
        for k, v in dense.items():
            w = 1 - sample(dark, v, dx, dy, s).mean()
            c = sample(clear, v, dx, dy, s).mean()
            print(f"  lane {k:3}: walkable {w * 100:5.1f}%  mean clearance {c:5.1f}px")
        w = 1 - sample(dark, lane_pts, dx, dy, s).mean()
        print(f"  lanes all: walkable {w * 100:5.1f}%")
        tw = 1 - sample(dark, towers, dx, dy, s).mean()
        print(f"  towers+structures on lanes: walkable {tw * 100:5.1f}% (n={len(towers)})")
        bs = 1 - sample(dark, base_pts, dx, dy, s).mean()
        print(f"  base structures: walkable {bs * 100:5.1f}% (n={len(base_pts)})")
        pr = sample(river, pit_pts, dx, dy, s).mean()
        pc = sample(clear, pit_pts, dx, dy, s).mean()
        print(f"  pit centres on river pixels: {pr * 100:3.0f}%  clearance {pc:.1f}px")

    report("as is")

    # Score: lane walkable share dominates, clearance breaks ties, plus structures.
    def score(dx, dy, s):
        lw = 1 - sample(dark, lane_pts, dx, dy, s).mean()
        lc = sample(clear, lane_pts, dx, dy, s).mean() / 30
        sw = 1 - sample(dark, towers + base_pts, dx, dy, s).mean()
        pc = sample(clear, pit_pts, dx, dy, s).mean() / 30
        return lw + lc + sw + pc

    best = (score(0, 0, 1), 0.0, 0.0, 1.0)
    grid = [i * 0.0025 for i in range(-12, 13)]
    scales = [0.96 + 0.005 * i for i in range(17)]
    for s in scales:
        for dx in grid:
            for dy in grid:
                v = score(dx, dy, s)
                if v > best[0]:
                    best = (v, dx, dy, s)
    print(f"\nbest fit score {best[0]:.3f} (as is {score(0, 0, 1):.3f})")
    report("best fit", best[1], best[2], best[3])

    # Overlay: lanes (red), structures (green), pits (magenta) on the image.
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 1 1">',
           ]
    for v in lanes.values():
        svg.append('<polyline fill="none" stroke="red" stroke-width="0.004" points="%s"/>'
                   % " ".join(f"{x},{y}" for x, y in v))
    for x, y in towers + base_pts:
        svg.append(f'<circle cx="{x}" cy="{y}" r="0.007" fill="lime" stroke="black" stroke-width="0.002"/>')
    for x, y in pit_pts:
        svg.append(f'<circle cx="{x}" cy="{y}" r="0.02" fill="none" stroke="magenta" stroke-width="0.004"/>')
    svg.append("</svg>")
    (out / "overlay.svg").write_text("\n".join(svg))
    # rsvg refuses external image hrefs, so draw the marks alone and composite with ffmpeg.
    subprocess.run(["rsvg-convert", "-o", str(out / "marks.png"), str(out / "overlay.svg")], check=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(ROOT / "public/map.webp"),
                    "-i", str(out / "marks.png"), "-filter_complex", "overlay", str(out / "overlay.png")], check=True)
    print(f"\noverlay written to {out / 'overlay.png'}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "overlay-out")
