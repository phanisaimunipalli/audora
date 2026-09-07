"""
Serve the Nebius-trained LoRA adapter for the Audora stager on Modal with vLLM (OpenAI-compatible),
scale-to-zero, so the fine-tune can be A/B'd by `npm run eval` at cents per run.

Setup (once):
  pip install modal && modal setup                       # Modal account + token (self-serve)
  scripts/modal-deploy.sh <ftjob-id>                     # secret + volumes + adapter upload + deploy + .env

Deploy by hand:
  modal deploy scripts/serve-lora-modal.py
  → prints https://<workspace>--audora-stager-server.modal.run ; put <url>/v1 in .env as MODAL_BASE_URL
    and the AUTH_TOKEN from the `audora-serve` secret as MODAL_API_KEY, then
    EVAL_MODELS=modal:stager EVAL_MODES=semantic npm run eval -- evals/autostage.eval.ts

Base model: Qwen/Qwen3-8B (must match the adapter's base). GPU: L4 (24 GB) fits an 8B in bf16.
The Modal endpoint itself is unauthenticated; vLLM enforces the bearer token (--api-key).
"""
import os

import modal

BASE_MODEL = os.environ.get("BASE_MODEL", "Qwen/Qwen3-8B")
ADAPTER_NAME = "stager"
PORT = 8000
MINUTES = 60

image = (
    modal.Image.from_registry("nvidia/cuda:12.9.0-devel-ubuntu22.04", add_python="3.12")
    .entrypoint([])
    .uv_pip_install("vllm==0.21.0", "huggingface_hub[hf_transfer]")
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1", "HF_XET_HIGH_PERFORMANCE": "1"})
)

app = modal.App("audora-stager")
adapters = modal.Volume.from_name("audora-adapters", create_if_missing=True)
hf_cache = modal.Volume.from_name("audora-hf-cache", create_if_missing=True)
vllm_cache = modal.Volume.from_name("audora-vllm-cache", create_if_missing=True)


@app.server(
    image=image,
    gpu="L4",
    scaledown_window=5 * MINUTES,  # scale to zero after 5 idle minutes
    startup_timeout=15 * MINUTES,
    timeout=60 * MINUTES,
    secrets=[modal.Secret.from_name("audora-serve")],
    volumes={
        "/adapters": adapters,
        "/root/.cache/huggingface": hf_cache,
        "/root/.cache/vllm": vllm_cache,
    },
    port=PORT,
    target_concurrency=8,
    unauthenticated=True,
)
class Server:
    @modal.enter()
    def start(self):
        import subprocess

        cmd = [
            "vllm", "serve", BASE_MODEL,
            "--host", "0.0.0.0", "--port", str(PORT),
            "--dtype", "bfloat16",
            "--max-model-len", "8192",
            "--enable-lora",
            "--max-lora-rank", "64",
            "--lora-modules", f"{ADAPTER_NAME}=/adapters/{ADAPTER_NAME}",
            "--api-key", os.environ["AUTH_TOKEN"],
            "--served-model-name", BASE_MODEL,
        ]
        print("starting vllm serve", BASE_MODEL, "with LoRA", ADAPTER_NAME, flush=True)
        self.process = subprocess.Popen(cmd)

    @modal.exit()
    def stop(self):
        self.process.terminate()
