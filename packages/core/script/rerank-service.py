"""Local reranker service for the memory vault (on demand, GPU when available).

Scores (query, passage) pairs with BAAI/bge-reranker-v2-m3 so the recall hook can reorder keyword candidates by meaning.
Binds to 127.0.0.1 only, loads the model once, and exits by itself after IDLE_SECONDS (3 h) without requests, so a working day rarely pays the load again.

  POST /rerank {"query": "...", "docs": ["...", ...]}  ->  {"scores": [float, ...], "device": "cuda" | "cpu"}
  GET  /health                                          ->  {"ok": true}
"""

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = int(os.environ.get("RERANK_PORT", "4312"))
IDLE_SECONDS = int(os.environ.get("RERANK_IDLE_SECONDS", "10800"))
MODEL = os.environ.get("RERANK_MODEL", "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1")
MAX_DOCS = 64
# Tokens per (query, passage) pair. 320 keeps the GPU pass under about a second for 30 passages; longer passages are cut.
MAX_TOKENS = int(os.environ.get("RERANK_MAX_TOKENS", "320"))

_model = None
_device = "cpu"
_lock = threading.Lock()
_last = time.time()


def model():
    global _model, _device
    if _model is None:
        import torch
        from sentence_transformers import CrossEncoder

        _device = "cuda" if torch.cuda.is_available() else "cpu"
        kwargs = {"torch_dtype": "float16"} if _device == "cuda" else {}
        _model = CrossEncoder(MODEL, device=_device, max_length=MAX_TOKENS, model_kwargs=kwargs)
        if _device == "cuda":
            _model.model.half()  # the fp16 kwarg is not applied by every sentence-transformers version
    return _model


def touch():
    global _last
    _last = time.time()


def idle_watchdog(server):
    while True:
        time.sleep(15)
        if time.time() - _last > IDLE_SECONDS:
            server.shutdown()
            return


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        return

    def _send(self, code, body):
        raw = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        touch()
        if self.path == "/health":
            return self._send(200, {"ok": True})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        touch()
        if self.path != "/rerank":
            return self._send(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            query = payload.get("query")
            docs = payload.get("docs") or []
            if not isinstance(query, str) or not isinstance(docs, list) or not all(isinstance(d, str) for d in docs):
                return self._send(400, {"error": "query must be a string and docs a list of strings"})
            if len(docs) > MAX_DOCS:
                return self._send(400, {"error": f"too many docs in one call (max {MAX_DOCS})"})
            if not docs:
                return self._send(200, {"scores": [], "device": _device})
            with _lock:
                scores = model().predict(
                    [[query[:1000], d[:2000]] for d in docs], batch_size=16, show_progress_bar=False
                )
            self._send(200, {"scores": [float(s) for s in scores], "device": _device})
        except Exception as error:  # the client falls back to keyword order on any failure
            self._send(500, {"error": str(error)[:300]})


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    threading.Thread(target=idle_watchdog, args=(server,), daemon=True).start()
    try:
        server.serve_forever()
    finally:
        server.server_close()
