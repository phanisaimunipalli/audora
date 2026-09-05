/**
 * Audora reconstruction pipeline, as a Render Workflow.
 *
 * Generating a world from photos is a genuine background process: it takes
 * minutes, it can fail halfway, and the expensive step costs real money.
 * A naive retry re-submits generation, which burns another 150 to 1500
 * credits and leaves a duplicate world behind.
 *
 * IDEMPOTENCY
 * -----------
 * Every submission carries a deterministic display_name:
 *
 *     audora:<roomId>:<model>
 *
 * Before submitting, submitGeneration asks Marble whether a world with that
 * name already exists. If it does, the existing world is returned and no
 * generation is charged. Marble's own worlds:list is the source of truth, so
 * there is no database to keep in sync and the guarantee survives retries,
 * process restarts and entirely separate workflow runs.
 *
 * Polling is a separate task from submitting, which is the other half of the
 * design: awaitGeneration can be retried freely because retrying a poll has
 * no side effect at all.
 */

import { task, TaskContext } from '@renderinc/sdk/workflows'

const MARBLE = 'https://api.worldlabs.ai/marble/v1'
const KEY = process.env.WORLDLABS_API_KEY ?? ''

type Model = 'marble-1.0-draft' | 'marble-1.0' | 'marble-1.1' | 'marble-1.1-plus'

interface BuildInput {
  roomId: string
  images: string[]        // base64, no data: prefix
  model?: Model
  /** Demo hook. 'poll' throws once inside awaitGeneration to prove recovery. */
  failAt?: 'poll' | null
}

const headers = () => ({ 'Content-Type': 'application/json', 'WLT-Api-Key': KEY })

const idemKey = (roomId: string, model: string) => `audora:${roomId}:${model}`

async function marble(path: string, init?: RequestInit) {
  const res = await fetch(`${MARBLE}${path}`, { ...init, headers: headers() })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`marble ${path} -> ${res.status} ${JSON.stringify(body).slice(0, 300)}`)
  }
  return body as any
}

/** Look for an already-submitted world carrying this idempotency key. */
async function findExisting(key: string) {
  const list = await marble('/worlds:list', { method: 'POST', body: '{}' })
  return (list.worlds ?? []).find((w: any) => w.display_name === key) ?? null
}

/**
 * Step 1. Submit generation, at most once per (roomId, model).
 *
 * Retrying this task is safe: the pre-flight lookup short circuits and no
 * second generation is charged.
 */
export const submitGeneration = task(
  { name: 'submitGeneration', retry: { maxRetries: 4, waitDurationMs: 2000, backoffScaling: 2 } },
  async (ctx: TaskContext, input: BuildInput) => {
    const model = input.model ?? 'marble-1.0-draft'
    const key = idemKey(input.roomId, model)

    const existing = await findExisting(key)
    if (existing) {
      console.log(`[idempotent] ${key} already submitted as world ${existing.world_id}, skipping generation`)
      return { worldId: existing.world_id, operationId: null, reused: true, model }
    }

    const images = input.images.filter(Boolean)
    if (!images.length) throw new Error('no images supplied')

    const world_prompt = images.length === 1
      ? { type: 'image', image_prompt: { source: 'data_base64', data_base64: images[0] } }
      : {
          type: 'multi-image',
          multi_image_prompt: images.map((b64) => ({ source: 'data_base64', data_base64: b64 })),
        }

    const op = await marble('/worlds:generate', {
      method: 'POST',
      body: JSON.stringify({ display_name: key, model, world_prompt }),
    })

    console.log(`[submit] ${key} -> operation ${op.operation_id}`)
    return { worldId: op.metadata?.world_id ?? null, operationId: op.operation_id, reused: false, model }
  }
)

/**
 * Step 2. Poll to completion.
 *
 * Pure read. Retrying costs nothing and never duplicates work, which is
 * exactly why submission lives in its own task.
 */
export const awaitGeneration = task(
  { name: 'awaitGeneration', retry: { maxRetries: 5, waitDurationMs: 5000, backoffScaling: 1.6 } },
  async (ctx: TaskContext, args: { operationId: string; failAt?: 'poll' | null }) => {
    // Controlled failure for the demo. Throws on the first attempt only, so
    // the retry visibly recovers against the same in-flight operation.
    if (args.failAt === 'poll' && !process.env.AUDORA_FAILED_ONCE) {
      process.env.AUDORA_FAILED_ONCE = '1'
      console.error('[demo] injected failure during poll')
      throw new Error('injected failure: poll step')
    }

    const deadline = Date.now() + 20 * 60 * 1000
    for (;;) {
      if (Date.now() > deadline) throw new Error('generation timed out after 20 minutes')
      const op = await marble(`/operations/${args.operationId}`)
      const status = op.metadata?.progress?.status ?? 'UNKNOWN'
      console.log(`[poll] ${args.operationId} ${status}`)
      if (op.error) throw new Error(`generation failed: ${JSON.stringify(op.error)}`)
      if (op.done) return { response: op.response, cost: op.cost ?? null }
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
)

/** Read a finished world straight from Marble when submission was reused. */
export const fetchWorld = task(
  { name: 'fetchWorld', retry: { maxRetries: 4, waitDurationMs: 2000, backoffScaling: 2 } },
  async (ctx: TaskContext, args: { worldId: string }) => {
    return { response: await marble(`/worlds/${args.worldId}`), cost: null }
  }
)

/**
 * Orchestrator. This is the task the app starts.
 */
export const buildWorld = task(
  { name: 'buildWorld' },
  async (ctx: TaskContext, input: BuildInput) => {
    const started = Date.now()
    const sub = await ctx.run(submitGeneration, input)

    const done = sub.reused && sub.worldId
      ? await ctx.run(fetchWorld, { worldId: sub.worldId })
      : await ctx.run(awaitGeneration, { operationId: sub.operationId!, failAt: input.failAt ?? null })

    const a = done.response?.assets ?? {}
    return {
      roomId: input.roomId,
      model: sub.model,
      reused: sub.reused,
      creditsCharged: sub.reused ? 0 : (done.cost?.total_credits ?? null),
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      worldId: done.response?.world_id ?? sub.worldId,
      marbleUrl: done.response?.world_marble_url ?? null,
      pano: a.imagery?.pano_url ?? null,
      collider: a.mesh?.collider_mesh_url ?? null,
      thumbnail: a.thumbnail_url ?? null,
      caption: a.caption ?? null,
      metricScaleFactor: a.splats?.semantics_metadata?.metric_scale_factor ?? null,
      groundPlaneOffset: a.splats?.semantics_metadata?.ground_plane_offset ?? null,
    }
  }
)
