"""Copy Tk's own window icon (the blue quill) out of the Tk DLL into a multi-frame .ico.

    py -3.11 orchestration/icons/extract-tk-icon.py [out.ico]

The Bench app uses Tk's default icon on purpose (author's choice, 2026-09-29): this script writes
it as `orchestration/icons/gleipnir-bench.ico` so `iconbitmap(default=…)` plus an AppUserModelID
show the same quill in the title bar, every dialog, the taskbar and Alt-Tab (without the ICO the
taskbar shows pythonw's / the py launcher's icon). Reads the RT_GROUP_ICON / RT_ICON resources
byte-for-byte; nothing is re-rendered. Windows only (ctypes + kernel32).
"""
import ctypes
import os
import struct
import sys

k32 = ctypes.windll.kernel32
LOAD_LIBRARY_AS_DATAFILE = 0x2
RT_ICON, RT_GROUP_ICON = 3, 14
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "gleipnir-bench.ico")
DLLS = os.path.join(os.path.dirname(sys.executable), "DLLs")
DLL = next((os.path.join(DLLS, f) for f in os.listdir(DLLS) if f.lower().startswith("tk8") and f.lower().endswith(".dll")), None)
if not DLL:
    sys.exit(f"no tk8*.dll under {DLLS}")

k32.LoadLibraryExW.restype = ctypes.c_void_p
k32.FindResourceW.restype = ctypes.c_void_p
k32.FindResourceW.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
k32.LoadResource.restype = ctypes.c_void_p
k32.LoadResource.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
k32.LockResource.restype = ctypes.c_void_p
k32.LockResource.argtypes = [ctypes.c_void_p]
k32.SizeofResource.restype = ctypes.c_uint32
k32.SizeofResource.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
ENUM = ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)
k32.EnumResourceNamesW.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ENUM, ctypes.c_void_p]

h = k32.LoadLibraryExW(DLL, None, LOAD_LIBRARY_AS_DATAFILE)
if not h:
    sys.exit(f"cannot load {DLL}")


def res_bytes(rtype, name):
    r = k32.FindResourceW(h, name, rtype)
    if not r:
        raise RuntimeError(f"resource {name} of type {rtype} not found")
    data = k32.LockResource(k32.LoadResource(h, r))
    return ctypes.string_at(data, k32.SizeofResource(h, r))


groups = []


def on_name(_h, _t, name, _p):
    groups.append(name if name >> 16 else int(name))  # int id or pointer to a wide string
    return 1


k32.EnumResourceNamesW(h, RT_GROUP_ICON, ENUM(on_name), None)
if not groups:
    sys.exit("the Tk DLL has no group icon")
g = groups[0]
grp = res_bytes(RT_GROUP_ICON, g if isinstance(g, int) else ctypes.c_wchar_p(ctypes.wstring_at(g)))
_, _, count = struct.unpack_from("<HHH", grp, 0)
entries = []
for i in range(count):
    w, hgt, colors, _, planes, bits, size, rid = struct.unpack_from("<BBBBHHIH", grp, 6 + 14 * i)
    entries.append((w or 256, hgt or 256, colors, planes, bits, res_bytes(RT_ICON, rid)))

with open(OUT, "wb") as f:
    f.write(struct.pack("<HHH", 0, 1, len(entries)))
    offset = 6 + 16 * len(entries)
    for w, hgt, colors, planes, bits, data in entries:
        f.write(struct.pack("<BBBBHHII", w % 256, hgt % 256, colors, 0, planes, bits, len(data), offset))
        offset += len(data)
    for e in entries:
        f.write(e[5])
print(f"{os.path.basename(DLL)} group {g!r}: " + ", ".join(f"{w}x{hgt}@{bits}bpp" for w, hgt, _, _, bits, _ in entries))
print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes)")
