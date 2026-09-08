-- The job queue's claim: one worker takes up to n due jobs, atomically, without two workers ever
-- taking the same one. See docs/BACKEND.md §4 and server/worker.ts, which is the only caller.
--
-- Conventions this function relies on:
--   * `run_after` is BOTH the schedule and the lease. A claim pushes it five minutes out, so a
--     worker that dies mid-job leaves a row that becomes claimable again on its own; a worker that
--     wants to poll a provider operation again in five seconds sets it to now() + 5s itself.
--   * A `running` job with a due `run_after` is therefore claimable. That is what makes polling
--     work: the generate job stays `running` (so the app's progress bar keeps its meaning) and
--     comes back to a worker every five seconds. Restart state lives in the world row
--     (`provider_operation_id`), never in a worker's memory, so a re-claim resumes rather than
--     resubmitting — which is what keeps rule 5 ("never generate twice") true across a crash.
--   * `attempts` counts real starts, not polls: it is incremented only when the row was `queued`.
--     A poll must never burn one of the three attempts a job is allowed.
--   * `security definer` with execute granted to `service_role` only: `anon` and `authenticated`
--     must not be able to claim jobs, and the server is the only party that runs the queue.

create or replace function public.claim_jobs(worker text, n int)
returns setof public.jobs
language sql
security definer
set search_path = public
as $$
  with due as (
    select j.id
      from public.jobs j
     where j.run_after <= now()
       and j.status in ('queued', 'running')
     order by j.run_after, j.created_at
     limit greatest(coalesce(n, 0), 0)
       for update skip locked
  )
  update public.jobs j
     set status     = 'running',
         locked_by  = worker,
         locked_at  = now(),
         started_at = coalesce(j.started_at, now()),
         -- Column references on the right of SET read the OLD row, so this is the status the job
         -- had before this claim.
         attempts   = j.attempts + case when j.status = 'queued' then 1 else 0 end,
         run_after  = now() + interval '5 minutes'
   where j.id in (select id from due)
  returning j.*;
$$;

comment on function public.claim_jobs(text, int) is
  'Claim up to n due jobs for a worker (queued, or running with an expired lease). See server/worker.ts.';

-- Unstick or retry one job by hand. The worker does not use this — it patches jobs through
-- PostgREST like every other row — but an operator needs a one-liner for a job a dead worker left
-- running, and QA needs one to replay a failure:
--   select public.release_job('<uuid>', 'queued', null);
-- The parameters are `new_status` / `err` rather than `status` / `error` because a bare name would
-- resolve to the column of the same name and `set status = status` would be a silent no-op. An
-- invalid status is refused by the table's own check constraint.
create or replace function public.release_job(job uuid, new_status text, err text)
returns public.jobs
language sql
security definer
set search_path = public
as $$
  update public.jobs j
     set status      = new_status,
         error       = err,
         locked_by   = null,
         locked_at   = null,
         run_after   = now(),
         finished_at = case when new_status in ('done', 'failed') then now() else null end
   where j.id = job
  returning j.*;
$$;

comment on function public.release_job(uuid, text, text) is
  'Operator escape hatch: force one job to a status and clear its lock. Not used by the worker.';

-- Nothing but the server may run the queue. Two grants have to be taken away before the one below
-- means anything: PUBLIC gets execute on every new function by default, and a Supabase project's
-- default privileges hand `anon` and `authenticated` execute on new functions in `public` as well —
-- revoking PUBLIC alone leaves those two, which was checked against a local project rather than
-- assumed.
revoke all on function public.claim_jobs(text, int) from public, anon, authenticated;
revoke all on function public.release_job(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_jobs(text, int) to service_role;
grant execute on function public.release_job(uuid, text, text) to service_role;
