"""
Serve the fine-tuned Audora stager (Qwen3-8B + LoRA adapter) locally on Apple Silicon as a minimal
OpenAI-compatible /v1/chat/completions endpoint, so `npm run eval` can A/B it through the proxy:

  python3.12 -m venv .venv-ft && . .venv-ft/bin/activate
  pip install torch transformers peft accelerate safetensors huggingface_hub
  python scripts/serve-lora-local.py --adapter evals/results/ft-<job>/adapter --port 8008
  # .env:  MODAL_BASE_URL=http://127.0.0.1:8008/v1   MODAL_API_KEY=local
  # then:  EVAL_MODELS=modal:stager npm run eval -- evals/autostage.eval.ts

Non-streaming, single request at a time, JSON output is the model's job (it was trained on JSON only).
`response_format` is accepted and ignored. Thinking is disabled for Qwen3 (enable_thinking=False).
"""
import argparse
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

parser = argparse.ArgumentParser()
parser.add_argument("--base", default=os.environ.get("BASE_MODEL", "Qwen/Qwen3-8B"))
parser.add_argument("--adapter", required=True)
parser.add_argument("--port", type=int, default=8008)
parser.add_argument("--no-adapter", action="store_true", help="serve the plain base model (baseline)")
args = parser.parse_args()

device = "mps" if torch.backends.mps.is_available() else "cpu"
dtype = torch.bfloat16 if device == "mps" else torch.float32
print(f"loading {args.base} on {device} ({dtype}) …", flush=True)
tok = AutoTokenizer.from_pretrained(args.base)
model = AutoModelForCausalLM.from_pretrained(args.base, torch_dtype=dtype, low_cpu_mem_usage=True).to(device)
if not args.no_adapter:
    print(f"attaching adapter {args.adapter} …", flush=True)
    model = PeftModel.from_pretrained(model, args.adapter)
    model = model.merge_and_unload()  # faster inference; adapter is small
model.eval()
served_name = "stager" if not args.no_adapter else "base"
lock = threading.Lock()
print("ready", flush=True)


def generate(messages, max_tokens=900, temperature=0.4):
    prompt = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True, enable_thinking=False)
    ids = tok(prompt, return_tensors="pt").to(device)
    with torch.no_grad():
        out = model.generate(
            **ids,
            max_new_tokens=max_tokens,
            do_sample=temperature > 0,
            temperature=max(temperature, 1e-3),
            top_p=0.95,
            pad_token_id=tok.eos_token_id,
        )
    new = out[0][ids["input_ids"].shape[1]:]
    text = tok.decode(new, skip_special_tokens=True)
    # strip any stray <think> blocks
    if "</think>" in text:
        text = text.split("</think>", 1)[1]
    return text.strip(), int(ids["input_ids"].shape[1]), int(new.shape[0])


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quieter
        pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/v1/models"):
            return self._json(200, {"object": "list", "data": [{"id": served_name, "object": "model"}]})
        return self._json(404, {"error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/v1/chat/completions"):
            return self._json(404, {"error": "not found"})
        n = int(self.headers.get("content-length", "0"))
        req = json.loads(self.rfile.read(n) or b"{}")
        t0 = time.time()
        with lock:
            text, p_tok, c_tok = generate(req.get("messages", []), int(req.get("max_tokens", 900)), float(req.get("temperature", 0.4)))
        self._json(
            200,
            {
                "id": f"chatcmpl-local-{int(t0)}",
                "object": "chat.completion",
                "model": served_name,
                "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": p_tok, "completion_tokens": c_tok, "total_tokens": p_tok + c_tok},
                "local_ms": int((time.time() - t0) * 1000),
            },
        )


HTTPServer(("127.0.0.1", args.port), H).serve_forever()
