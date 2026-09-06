"""
Serve the Nebius-trained LoRA adapter for the Audora stager on Modal with vLLM (OpenAI-compatible),
scale-to-zero, so the fine-tune can be A/B'd by `npm run eval` at cents per run.

Setup (once):
  pip install modal && modal setup                       # Modal account + token (self-serve)
  modal secret create audora-serve AUTH_TOKEN=<random>   # bearer token the proxy will send
  node scripts/download-checkpoint.mjs <ftjob-id>        # writes evals/results/ft-<job>/adapter/*
  modal volume create audora-adapters
  modal volume put audora-adapters evals/results/ft-<job>/adapter /stager

Deploy:
  modal deploy scripts/serve-lora-modal.py
  → prints a URL like https://<user>--audora-stager-serve.modal.run ; put it in .env as
    MODAL_BASE_URL=<url>/v1 and MODAL_API_KEY=<AUTH_TOKEN>, then run
    EVAL_MODELS=modal:stager npm run eval -- evals/autostage.eval.ts

Base model: Qwen/Qwen3-8B (must match the adapter's base). GPU: L4 (24 GB) is enough for an 8B in bf16.
"""
import os
import subprocess

import modal

BASE_MODEL = os.environ.get("BASE_MODEL", "Qwen/Qwen3-8B")
ADAPTER_NAME = "stager"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("vllm==0.10.1", "huggingface_hub[hf_transfer]")
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
)

app = modal.App("audora-stager")
adapters = modal.Volume.from_name("audora-adapters", create_if_missing=True)
hf_cache = modal.Volume.from_name("audora-hf-cache", create_if_missing=True)


@app.function(
    image=image,
    gpu="L4",
    timeout=60 * 60,
    scaledown_window=300,  # scale to zero after 5 idle minutes
    secrets=[modal.Secret.from_name("audora-serve")],
    volumes={"/adapters": adapters, "/root/.cache/huggingface": hf_cache},
)
@modal.concurrent(max_inputs=8)
@modal.web_server(port=8000, startup_timeout=15 * 60)
def serve():
    cmd = [
        "vllm", "serve", BASE_MODEL,
        "--host", "0.0.0.0", "--port", "8000",
        "--dtype", "bfloat16",
        "--max-model-len", "8192",
        "--enable-lora",
        "--max-lora-rank", "64",
        "--lora-modules", f"{ADAPTER_NAME}=/adapters/{ADAPTER_NAME}",
        "--api-key", os.environ["AUTH_TOKEN"],
        "--served-model-name", BASE_MODEL,
    ]
    subprocess.Popen(cmd)
