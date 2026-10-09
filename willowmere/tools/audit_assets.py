#!/usr/bin/env python3
"""Willowmere — tools/audit_assets.py
Audit every PNG in willowmere/assets/art/.

Rules (per the test-harness spec):
- The five atlas files must OPEN and match the exact size table:
      tiles.png 256x128, decor.png 352x128, chars.png 384x432,
      props.png 512x416, ui.png 160x112
- A wrong size is a hard failure: exit 1, printing the file and the
  expected-vs-actual delta.
- Any stray PNG (not in the table) must open and contain at least one
  non-transparent pixel.
- The _backup subdirectory is skipped.

Uses Pillow (PIL) when importable; otherwise falls back to a pure-stdlib
PNG reader (zlib + struct) that decodes IHDR and, when needed, the full
IDAT pixel data (bit depth 8, non-interlaced) for the opacity check.

Run from the workspace root:  python willowmere/tools/audit_assets.py
"""

import os
import struct
import sys
import zlib

try:
    from PIL import Image  # type: ignore
    HAVE_PIL = True
except Exception:  # ImportError or a broken Pillow install
    HAVE_PIL = False

EXPECTED = {
    "tiles.png": (256, 128),
    "decor.png": (352, 128),
    "chars.png": (384, 432),
    "props.png": (512, 416),
    "ui.png": (160, 112),
}

ART_DIR = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "art")
)

PNG_SIG = b"\x89PNG\r\n\x1a\n"

# PNG colour types -> bytes per pixel (bit depth 8)
BPP = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}


# ---------------------------------------------------------------- stdlib path

def read_ihdr(data):
    """Return (width, height, bit_depth, colour_type, interlace) or raise."""
    if len(data) < 33 or data[:8] != PNG_SIG:
        raise ValueError("not a PNG (bad signature)")
    length, ctype = struct.unpack(">I4s", data[8:16])
    if ctype != b"IHDR" or length != 13:
        raise ValueError("first chunk is not IHDR")
    w, h, bd, ct, comp, filt, inter = struct.unpack(">IIBBBBB", data[16:29])
    return w, h, bd, ct, inter


def iter_chunks(data):
    """Yield (type, payload) for every chunk after the signature."""
    pos = 8
    while pos + 8 <= len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        ctype = data[pos + 4:pos + 8]
        payload = data[pos + 8:pos + 8 + length]
        yield ctype, payload
        pos += 12 + length  # length + type + payload + CRC
        if ctype == b"IEND":
            break


def paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def unfilter(raw, w, h, bpp):
    """Reverse PNG scanline filters; returns list of bytearray rows."""
    stride = w * bpp
    rows, prev = [], None
    pos = 0
    for _ in range(h):
        if pos + 1 + stride > len(raw):
            raise ValueError("truncated IDAT data")
        ftype = raw[pos]
        row = bytearray(raw[pos + 1:pos + 1 + stride])
        pos += 1 + stride
        for x in range(stride):
            a = row[x - bpp] if x >= bpp else 0
            b = prev[x] if prev is not None else 0
            c = prev[x - bpp] if (prev is not None and x >= bpp) else 0
            if ftype == 0:
                pass
            elif ftype == 1:
                row[x] = (row[x] + a) & 0xFF
            elif ftype == 2:
                row[x] = (row[x] + b) & 0xFF
            elif ftype == 3:
                row[x] = (row[x] + ((a + b) >> 1)) & 0xFF
            elif ftype == 4:
                row[x] = (row[x] + paeth(a, b, c)) & 0xFF
            else:
                raise ValueError("unknown filter type %d" % ftype)
        prev = row
        rows.append(row)
    return rows


def stdlib_has_opaque_pixel(data):
    """True/False when decodable, None when the fallback cannot decide."""
    w, h, bd, ct, inter = read_ihdr(data)
    if inter != 0 or bd != 8 or ct not in BPP:
        return None  # cannot decode safely without Pillow
    idat = b"".join(p for t, p in iter_chunks(data) if t == b"IDAT")
    if not idat:
        raise ValueError("no IDAT chunks")
    raw = zlib.decompress(idat)
    bpp = BPP[ct]
    rows = unfilter(raw, w, h, bpp)
    if ct in (0, 2, 3):
        return w > 0 and h > 0  # no alpha channel: every pixel is opaque
    off = bpp - 1  # alpha is the last byte of each pixel
    for row in rows:
        for x in range(off, w * bpp, bpp):
            if row[x] != 0:
                return True
    return False


# ------------------------------------------------------------------- PIL path

def pil_check(pathname):
    """Open with Pillow; return (w, h, has_opaque or None)."""
    with Image.open(pathname) as im:
        im.verify()  # structural check (raises on truncation/corruption)
    with Image.open(pathname) as im:
        im.load()
        w, h = im.size
        rgba = im.convert("RGBA")
        amin, amax = rgba.getchannel("A").getextrema()
        return w, h, (amax > 0)


# ---------------------------------------------------------------------- audit

def main():
    errors = []
    checked = 0

    print("[audit_assets] art dir: %s" % ART_DIR)
    if not os.path.isdir(ART_DIR):
        print("FAIL: art directory does not exist: %s" % ART_DIR)
        return 1

    mode = "PIL" if HAVE_PIL else "stdlib fallback (zlib+struct)"
    print("[audit_assets] decoder: %s" % mode)

    names = sorted(
        n for n in os.listdir(ART_DIR)
        if n.lower().endswith(".png")
        and os.path.isfile(os.path.join(ART_DIR, n))
    )
    # explicit skip per spec: the _backup subdirectory (and any subdir)
    for entry in os.listdir(ART_DIR):
        full = os.path.join(ART_DIR, entry)
        if os.path.isdir(full) and entry == "_backup":
            print("[audit_assets] skipping directory: %s" % entry)

    for name in names:
        path_ = os.path.join(ART_DIR, name)
        checked += 1
        try:
            with open(path_, "rb") as fh:
                data = fh.read()
            if HAVE_PIL:
                w, h, opaque = pil_check(path_)
            else:
                w, h, bd, ct, inter = read_ihdr(data)
                opaque = None  # only computed for strays
        except Exception as e:
            errors.append("%s: cannot open/decode (%s)" % (name, e))
            continue

        if name in EXPECTED:
            ew, eh = EXPECTED[name]
            if (w, h) == (ew, eh):
                print("  OK   %-12s %4dx%-4d (expected %dx%d)"
                      % (name, w, h, ew, eh))
            else:
                errors.append(
                    "%s: wrong size %dx%d, expected %dx%d "
                    "(delta w%+d, h%+d)" % (name, w, h, ew, eh, w - ew, h - eh)
                )
                print("  FAIL %-12s %4dx%-4d expected %dx%d"
                      % (name, w, h, ew, eh))
            continue

        # stray file: must open (already done) and have >=1 opaque pixel
        try:
            if opaque is None:
                opaque = stdlib_has_opaque_pixel(data)
        except Exception as e:
            errors.append("%s (stray): pixel check failed (%s)" % (name, e))
            continue
        if opaque is None:
            errors.append(
                "%s (stray): opacity unverifiable with the stdlib fallback "
                "(interlaced or bit depth != 8)" % name
            )
        elif opaque:
            print("  OK   %-12s %4dx%-4d (stray, has opaque pixels)" % (name, w, h))
        else:
            errors.append("%s (stray): fully transparent, no opaque pixel" % name)

    for missing in sorted(set(EXPECTED) - set(names)):
        errors.append("%s: MISSING from %s" % (missing, ART_DIR))
        checked += 1  # counted as an audited expectation

    print("[audit_assets] %d file(s) checked, %d error(s)" % (checked, len(errors)))
    for e in errors:
        print("FAIL: %s" % e)
    if errors:
        print("ASSETS FAIL")
        return 1
    print("ASSETS OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
