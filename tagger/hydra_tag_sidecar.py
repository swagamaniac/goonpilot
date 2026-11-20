"""Optional local tagging sidecar for Goonpilot. Usage: python -I hydra_tag_sidecar.py <port> <model repo folder>

The model repo folder is a clone of the Hydra 3.5 model (Apache-2.0, by Project RedRocket) that you downloaded yourself; it must
contain models/hydra-3.5.safetensors, the data/ folder and the `hydra` python package. See the wiki page "Image analysis".

  GET  /health -> {"ok": true, "model": "hydra-3.5-tags@1024", "device", "tags": true}
  POST /tags   (raw image bytes) -> {"t": [[tag, confidence 0..1], ...]}   confidence = how far above that tag's own calibrated threshold
  POST /quit   (needs header x-goonpilot: 1)

Binds 127.0.0.1 only. No outbound network (Hugging Face offline flags are set). Exits by itself after 20 minutes without requests."""
import os, sys, json, time, gc, threading
os.environ.setdefault("HF_HUB_OFFLINE", "1"); os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("CUDA_MODULE_LOADING", "LAZY")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8788
REPO = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "hydra")
sys.path.insert(0, REPO); os.chdir(REPO)  # -I leaves the script folder off sys.path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import torch
from hydra import image
from hydra.model import load_model

SEQLEN = int(os.environ.get("GOONPILOT_HYDRA_TAG_SEQLEN", "1024"))  # more patches = better tags, slower (about 0.4 s/image on a GTX 1070)
CATS = {"general", "species", "character", "lore"}  # no meta / copyright
MAX_OUT, MAX_BODY, IDLE_EXIT_S = 100, 20_000_000, 20 * 60
MODEL_NAME = "hydra-3.5-tags@%d" % SEQLEN
dev = "cuda" if torch.cuda.is_available() else "cpu"
model = load_model("models/hydra-3.5.safetensors", legacy_metadata_dir="./data").to(device=dev, dtype=torch.float32).eval()
gc.collect()
cal = model.calibrate()
thr = torch.tensor([cal[l.label][1] for l in model.labels], dtype=torch.float32, device=dev)
allowed = torch.tensor([l.category in CATS for l in model.labels], dtype=torch.bool, device=dev)
names = [l.label for l in model.labels]
lock = threading.Lock()  # one forward pass at a time
last = [time.time()]


def tag(buf):
    img = model.load_image(buf, SEQLEN)  # ICC -> sRGB, alpha on white, aspect-preserving fit
    with lock, torch.inference_mode():
        patches, sizes = image.stack([img], 16, SEQLEN, device=dev)
        probs = model(model.from_srgb(patches), sizes).float()[0]
        margin = ((probs - thr) / (1 - thr).clamp(min=1e-6)).clamp(0, 1)
        ix = ((probs >= thr) & allowed).nonzero().reshape(-1)
        ix = ix[margin[ix].argsort(descending=True)][:MAX_OUT]
        return [[names[i], round(float(margin[i]), 3)] for i in ix.tolist()]


class H(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def log_message(self, *a): pass

    def do_GET(self):
        last[0] = time.time()
        if self.path == "/health": self._send(200, {"ok": True, "model": MODEL_NAME, "device": dev, "tags": True})
        else: self._send(404, {"error": "not found"})

    def do_POST(self):
        last[0] = time.time()
        if self.path == "/quit":
            if self.headers.get("x-goonpilot") != "1": return self._send(403, {"error": "forbidden"})
            self._send(200, {"ok": True}); threading.Timer(0.2, lambda: os._exit(0)).start(); return
        if self.path != "/tags": return self._send(404, {"error": "not found"})
        try:
            n = int(self.headers.get("content-length") or 0)
            if n <= 0 or n > MAX_BODY: return self._send(413, {"error": "bad size"})
            raw = self.rfile.read(n)
            try: t = tag(raw)
            except Exception:
                if dev == "cuda":
                    try: torch.cuda.empty_cache()
                    except Exception: pass
                return self._send(500, {"error": "could not tag this image"})
            self._send(200, {"t": t})
        except Exception as ex: self._send(500, {"error": str(ex)[:200]})


def watch():
    while True:
        time.sleep(30)
        if time.time() - last[0] > IDLE_EXIT_S: os._exit(0)


if __name__ == "__main__":
    threading.Thread(target=watch, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H); srv.daemon_threads = True
    print("ready", PORT, MODEL_NAME, dev, flush=True)
    srv.serve_forever()
