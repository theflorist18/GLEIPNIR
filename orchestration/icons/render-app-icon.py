"""Render the web favicon from its SVG master (design brief §3.6) — Windows host tool.

    py -3.11 orchestration/icons/render-app-icon.py

Writes frontend/public/favicon.ico (frames 16/32/48: the light-scheme mark on transparent, the
fallback for browsers that ignore /favicon.svg). Rasterises frontend/public/favicon.svg at
1024 px in headless Chrome over the DevTools protocol (transparent background, forced light
colour scheme) and downsamples with Pillow (LANCZOS); BMP frames. Needs Chrome, Pillow and
`websockets`. Placeholder until the designers' hand-hinted masters land (brief §3.12): swap the
SVG and re-run. The Bench app icon is Tk's own quill (extract-tk-icon.py), not rendered here.
"""
import asyncio
import base64
import io
import json
import os
import subprocess
import tempfile
import time
import urllib.request

import websockets
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PORT = 9334
PX = 1024
SVG = os.path.join(REPO, "frontend", "public", "favicon.svg")
ICO = os.path.join(REPO, "frontend", "public", "favicon.ico")
SIZES = [16, 32, 48]


def page(svg_path):
    svg = open(svg_path, encoding="utf-8").read()
    return (f"<!doctype html><html><head><meta charset='utf-8'><style>html,body{{margin:0;background:transparent}}"
            f"svg{{width:{PX}px;height:{PX}px;display:block}}</style></head><body>{svg}</body></html>")


async def render(ws_url, html_file):
    async with websockets.connect(ws_url, max_size=2 ** 26) as ws:
        mid = 0

        async def send(method, params=None):
            nonlocal mid
            mid += 1
            await ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
            while True:
                msg = json.loads(await ws.recv())
                if msg.get("id") == mid:
                    if "error" in msg:
                        raise RuntimeError(msg["error"])
                    return msg.get("result", {})

        await send("Page.enable")
        await send("Emulation.setDeviceMetricsOverride", {"width": PX, "height": PX, "deviceScaleFactor": 1, "mobile": False})
        await send("Emulation.setDefaultBackgroundColorOverride", {"color": {"r": 0, "g": 0, "b": 0, "a": 0}})
        await send("Emulation.setEmulatedMedia", {"features": [{"name": "prefers-color-scheme", "value": "light"}]})
        await send("Page.navigate", {"url": "file:///" + html_file.replace("\\", "/")})
        for _ in range(40):
            r = await send("Runtime.evaluate", {"expression": "document.readyState", "returnByValue": True})
            if r["result"]["value"] == "complete":
                break
            await asyncio.sleep(0.1)
        await asyncio.sleep(0.3)
        shot = await send("Page.captureScreenshot", {"format": "png", "clip": {"x": 0, "y": 0, "width": PX, "height": PX, "scale": 1}})
        return Image.open(io.BytesIO(base64.b64decode(shot["data"]))).convert("RGBA")


def main():
    tmp = tempfile.mkdtemp(prefix="gleipnir-icon-")
    html_file = os.path.join(tmp, "favicon.html")
    with open(html_file, "w", encoding="utf-8") as f:
        f.write(page(SVG))
    proc = subprocess.Popen([CHROME, "--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars",
                             f"--remote-debugging-port={PORT}", f"--user-data-dir={tmp}\\profile",
                             "--allow-file-access-from-files", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(75):
            try:
                pages = [t for t in json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list")) if t["type"] == "page"]
                if pages:
                    break
            except Exception:  # noqa: BLE001 — not listening yet
                pass
            time.sleep(0.2)
        else:
            raise SystemExit("chrome did not start")
        img = asyncio.run(render(pages[0]["webSocketDebuggerUrl"], html_file))
    finally:
        proc.kill()
    assert img.getpixel((0, 0))[3] == 0, "corner is not transparent — background override failed"
    frames = [img.resize((s, s), Image.LANCZOS) for s in SIZES]
    frames[-1].save(ICO, format="ICO", sizes=[(s, s) for s in SIZES], append_images=frames[:-1], bitmap_format="bmp")
    print(f"wrote {os.path.relpath(ICO, REPO)}  frames {SIZES}  {os.path.getsize(ICO)} bytes")


if __name__ == "__main__":
    main()
