#!/usr/bin/env bash
# One-shot: publish the fine-tuned Audora stager on Modal (vLLM + LoRA, scale-to-zero).
# Prereq: `modal setup` done once (browser login). Usage: scripts/modal-deploy.sh <ftjob-id> [auth-token]
set -euo pipefail
cd "$(dirname "$0")/.."
JOB="${1:?usage: scripts/modal-deploy.sh <ftjob-id> [auth-token]}"
ADAPTER="evals/results/ft-${JOB}/adapter"
TOKEN="${2:-$(openssl rand -hex 24)}"
MODAL="${MODAL_BIN:-.venv-ft/bin/modal}"
[ -f "$ADAPTER/adapter_model.safetensors" ] || { echo "adapter not found at $ADAPTER (run scripts/download-checkpoint.mjs first)"; exit 1; }

echo "== secret"
$MODAL secret create audora-serve AUTH_TOKEN="$TOKEN" --force >/dev/null
echo "== volumes"
$MODAL volume create audora-adapters >/dev/null 2>&1 || true
$MODAL volume create audora-hf-cache >/dev/null 2>&1 || true
echo "== upload adapter ($(du -sh "$ADAPTER" | cut -f1))"
$MODAL volume put audora-adapters "$ADAPTER" /stager --force
echo "== deploy"
OUT=$($MODAL deploy scripts/serve-lora-modal.py 2>&1 | tee /dev/stderr)
URL=$(echo "$OUT" | grep -Eo 'https://[a-z0-9.-]+\.modal\.run' | head -1)
[ -n "$URL" ] || { echo "could not find the deployed URL in the output above"; exit 1; }
echo "== wiring .env → $URL/v1"
python3 - "$URL" "$TOKEN" <<'PY'
import sys, re, pathlib
url, token = sys.argv[1], sys.argv[2]
p = pathlib.Path('.env'); s = p.read_text() if p.exists() else ''
s = re.sub(r'^MODAL_BASE_URL=.*$', '', s, flags=re.M)
s = re.sub(r'^MODAL_API_KEY=.*$', '', s, flags=re.M)
s = s.rstrip() + f"\n# fine-tuned stager on Modal (scripts/modal-deploy.sh)\nMODAL_BASE_URL={url}/v1\nMODAL_API_KEY={token}\n"
p.write_text(s)
PY
echo "== smoke test (cold start can take a few minutes while vLLM loads the base model)"
for i in $(seq 1 40); do
  code=$(curl -s -o /tmp/modal-smoke.json -w '%{http_code}' -m 120 "$URL/v1/chat/completions" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
    -d '{"model":"stager","max_tokens":8,"temperature":0,"messages":[{"role":"user","content":"Reply with the single word: ready"}]}' || true)
  if [ "$code" = "200" ]; then echo "ready: $(head -c 300 /tmp/modal-smoke.json)"; break; fi
  echo "  waiting ($code)…"; sleep 15
done
echo "Done. Run:  EVAL_MODELS=modal:stager EVAL_MODES=semantic EVAL_TAG=finetuned-8b-modal npm run eval -- evals/autostage.eval.ts"
