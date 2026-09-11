#!/usr/bin/env node
/// <reference types="node" />
/**
 * `audora` — the command line tool (docs/CLI.md).
 *
 *   npx audora generate ./photos --open      photos in, one localhost URL out
 *   npx audora list                          the units generated so far
 *   npx audora open <id>                     print (and open) a unit's URL
 *   npx audora serve                         start the production server if nothing answers
 *
 * This file is the *terminal*: argument parsing, the cost question, the progress lines, the URL,
 * the browser opener and the server probe. Everything that decides anything lives in
 * server/localGenerate.ts (the flow) and server/local.ts (the store), so the interesting parts are
 * testable without a terminal, a network or a provider.
 *
 * Conventions this file relies on:
 * - **No dependencies.** `node:util`'s `parseArgs`, `node:child_process` and `node:readline` are
 *   the whole toolbox; the package ships `bin: {audora: dist-server/server/cli.js}` and tsc keeps
 *   the shebang above, which must stay the first line of this file.
 * - **The opener is never a shell.** `spawn(cmd, [url], {shell: false})` on all three platforms, so
 *   a URL can never become a command line.
 * - **Compiled paths.** This file only ever runs as `dist-server/server/cli.js`, so the repository
 *   root — where `.audora`, `.env` and `dist-server` live — is two directories up, exactly as
 *   server/prod.ts resolves it.
 *
 * Exit codes: 0 done, 1 something failed, 2 the command line was wrong.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { listUnits, localPaths, localRoot, readUnit, tourUrl, type LocalPaths, type LocalUnit } from './local.js';
import { ONLY_ROOM, generateLocal, type GenerateIo } from './localGenerate.js';
import type { RecipeTier } from './recipe.js';

/* ---------- where things are ---------- */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROD_SERVER = path.join(ROOT, 'dist-server', 'server', 'prod.js');

/** The dev server's port, and the production server's. docs/CLI.md: the URL points at one of the two. */
export const DEV_PORT = 5173;
export const PROD_PORT = 10000;

/** How long a port probe waits before deciding nothing is there. */
const PROBE_TIMEOUT_MS = 700;
/** How long `serve` waits for a server it just started. */
const SERVE_READY_MS = 20_000;

/* ---------- the environment ---------- */

/**
 * `.env` under the repository root, then the process environment, which wins. The same two lines
 * server/prod.ts uses — the CLI needs `WORLDLABS_API_KEY`, `MARBLE_MOCK` and
 * `MARBLE_MAX_GENERATIONS` from exactly where the server reads them.
 */
function loadDotEnv(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

function environment(): Record<string, string | undefined> {
  return { ...loadDotEnv(path.join(ROOT, '.env')), ...process.env };
}

function version(): string {
  try {
    return String(JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0');
  } catch {
    return '0.0.0';
  }
}

/* ---------- parsing the options ---------- */

export class UsageError extends Error {}

/** `--tier draft|full`. Anything else is refused: the tier is in the recipe, and a silent downgrade would be a different world. */
export function parseTier(raw: string | undefined): RecipeTier {
  if (raw === undefined) return 'draft';
  if (raw === 'draft' || raw === 'full') return raw;
  throw new UsageError(`--tier must be draft or full, got ${JSON.stringify(raw)}`);
}

/** A positive number of metres in a sane range for a room dimension or a ceiling. */
function metres(raw: string, what: string, lo: number, hi: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new UsageError(`${what} must be a number of metres, got ${JSON.stringify(raw)}`);
  if (n < lo || n > hi) throw new UsageError(`${what} of ${n} m is outside ${lo}–${hi} m; give it in metres`);
  return n;
}

/**
 * `--dims living=5.3x5.8,bedroom=3.3x3.8` — printed plan dimensions per room, metres, width first.
 * A bare `--dims 5.3x5.8` (no room name) means the folder's single room; `generateLocal` refuses it
 * when there is more than one, because a dimension put on the wrong room is worse than none.
 */
export function parseDims(raw: string | undefined): Record<string, { width: number; depth: number }> | null {
  if (raw === undefined) return null;
  const out: Record<string, { width: number; depth: number }> = {};
  for (const part of raw.split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    const eq = entry.indexOf('=');
    const room = eq >= 0 ? entry.slice(0, eq).trim() : ONLY_ROOM;
    const pair = (eq >= 0 ? entry.slice(eq + 1) : entry).trim().toLowerCase();
    const m = /^([0-9]*\.?[0-9]+)\s*[x×]\s*([0-9]*\.?[0-9]+)$/.exec(pair);
    if (!m) throw new UsageError(`--dims takes room=WIDTHxDEPTH in metres, got ${JSON.stringify(entry)}`);
    if (out[room]) throw new UsageError(`--dims names ${JSON.stringify(room)} twice`);
    out[room] = { width: metres(m[1], '--dims width', 0.5, 30), depth: metres(m[2], '--dims depth', 0.5, 30) };
  }
  if (!Object.keys(out).length) throw new UsageError('--dims needs at least one room=WIDTHxDEPTH');
  return out;
}

export function parseCeiling(raw: string | undefined): number | null {
  return raw === undefined ? null : metres(raw, '--ceiling', 1.8, 6);
}

function parsePort(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new UsageError(`--port must be a port number, got ${JSON.stringify(raw)}`);
  return n;
}

/* ---------- the terminal ---------- */

const out = (line = '') => process.stdout.write(`${line}\n`);
const err = (line = '') => process.stderr.write(`${line}\n`);

/**
 * One progress line per room, rewritten in place on a terminal and printed once per change
 * anywhere else — so `audora generate | tee log` is readable and a terminal does not scroll a
 * hundred lines of percentages.
 */
class Reporter implements GenerateIo {
  private current: string | null = null;
  private last = new Map<string, string>();
  private readonly tty = Boolean(process.stdout.isTTY);

  log = (line: string): void => {
    this.endLine();
    out(line);
  };

  progress = (roomId: string, line: string): void => {
    if (this.last.get(roomId) === line) return;
    this.last.set(roomId, line);
    if (!this.tty) {
      this.current = null;
      out(line);
      return;
    }
    if (this.current !== null && this.current !== roomId) out();
    this.current = roomId;
    // Clear to the end of the line so a shorter status cannot leave the tail of a longer one behind.
    process.stdout.write(`\r${line}\u001b[K`);
  };

  /** Close an in-place line so the next ordinary line starts at column 0. */
  endLine(): void {
    if (this.current !== null && this.tty) out();
    this.current = null;
  }

  /** Only a terminal can be asked a question; without one, `generateLocal` refuses to spend. */
  confirm = process.stdin.isTTY
    ? (question: string): Promise<boolean> =>
        new Promise((resolve) => {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          rl.question(question, (answer) => {
            rl.close();
            resolve(/^y(es)?$/i.test(answer.trim()));
          });
        })
    : undefined;
}

/* ---------- the browser and the server ---------- */

/** Open a URL with the platform's own opener, never through a shell. */
export function openUrl(url: string): void {
  const [command, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    const child = spawn(command as string, args as string[], { stdio: 'ignore', detached: true, shell: false });
    child.on('error', () => {
      /* no opener on this machine: the URL is already printed */
    });
    child.unref();
  } catch {
    /* the URL is already printed, which is the part that matters */
  }
}

/**
 * Whether anything at all answers on a port. Any response counts: the dev server has no /healthz,
 * and a 404 from it is still proof that something is listening.
 *
 * Probed by the same name the printed URL uses — `localhost`, never `127.0.0.1`. Vite binds to the
 * IPv6 loopback only (`[::1]:5173`), so a v4 probe is refused while the browser, which resolves
 * `localhost` to both families, opens the page perfectly: the CLI used to tell the team nothing was
 * running while their dev server was serving the very URL it printed.
 */
export async function serverAlive(port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  try {
    await fetch(`http://localhost:${port}/healthz`, { signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch {
    return false;
  }
}

/**
 * The port the printed URL should name. Explicit wins; otherwise whichever of the two local servers
 * is actually answering, so `audora generate ./photos --open` prints a URL that works whether the
 * team is running `npm run dev` or `npm start`.
 */
async function resolvePort(explicit: number | undefined): Promise<number> {
  if (explicit !== undefined) return explicit;
  if (await serverAlive(DEV_PORT)) return DEV_PORT;
  if (await serverAlive(PROD_PORT)) return PROD_PORT;
  return DEV_PORT;
}

/* ---------- commands ---------- */

const USAGE = `audora — photos in, a walkable 3D model out (docs/CLI.md)

  audora generate <photos-dir> [options]
    --tier draft|full        draft (default, ~35 s, no metric scale) or full (~10 min, metric scale)
    --name "Unit 3"          unit name in the viewer (default: the folder name)
    --dims living=5.3x5.8    printed plan dimensions per room, metres (width x depth)
    --ceiling 2.6            printed or known ceiling height, metres (default: assumed 2.44 ±0.12)
    --address "1247 Oak St, San Francisco"   recorded on the unit, and its city reaches the prompt
    --ai                     let the vision model name a room the folder name did not (live call)
    --yes                    do not ask before spending credits
    --open                   open the URL when it is done
    --port 5173              which local server the URL points at
  audora list                units generated so far, with their URLs
  audora open <id> [--open]  print a unit's URL
  audora serve [--port]      start the production server if nothing answers on the port

  Run it from the repository root: npx finds this checkout's bin there (docs/CLI.md).
  MARBLE_MOCK=1 runs the whole flow with the simulated provider and spends nothing at all —
  no Marble generation, and no vision call either.`;

function paths(env: Record<string, string | undefined>): LocalPaths {
  return localPaths(localRoot(ROOT, env));
}

async function cmdGenerate(positionals: string[], values: Record<string, unknown>): Promise<number> {
  const dir = positionals[0];
  if (!dir) throw new UsageError('generate needs a folder of photographs: audora generate ./photos');
  const env = environment();
  const reporter = new Reporter();
  const port = await resolvePort(parsePort(values.port as string | undefined));
  // Said before anything is generated, so nobody waits ten minutes to learn the flag did nothing.
  if (values.plan !== undefined) out('The CLI does not read floor plans; pass the printed dimensions with --dims instead.');

  const result = await generateLocal({
    dir,
    paths: paths(env),
    io: reporter,
    env,
    tier: parseTier(values.tier as string | undefined),
    name: (values.name as string | undefined) ?? null,
    dims: parseDims(values.dims as string | undefined),
    ceiling: parseCeiling(values.ceiling as string | undefined),
    address: (values.address as string | undefined) ?? null,
    port,
    yes: values.yes === true,
    // Opt-in: the vision model is a live, billed call to a second vendor, and a run that has not
    // been asked for one makes none (docs/CLI.md). `--no-ai` still parses, and still means no.
    ai: values.ai === true && values['no-ai'] !== true,
  });
  reporter.endLine();

  out('');
  out(`${result.unit.name}: ${result.unit.rooms.length} room(s), ${result.generated} generated, ${result.reused} reused (${result.provider} provider)`);
  if (!(await serverAlive(port))) {
    out(`Nothing is answering on port ${port}. Start one with "npm run dev" (${DEV_PORT}) or "npx audora serve" (${PROD_PORT}), then open:`);
  }
  // The URL, on its own line, last. This is the whole output of the happy path.
  out(result.url);
  if (values.open === true && (await serverAlive(port))) openUrl(result.url);
  return 0;
}

function line(unit: LocalUnit, port: number): string[] {
  const created = String(unit.createdAt ?? '').replace('T', ' ').slice(0, 16);
  return [unit.id, unit.name, String(unit.rooms.length), unit.tier, created, tourUrl(port, unit.id)];
}

async function cmdList(values: Record<string, unknown>): Promise<number> {
  const env = environment();
  const units = listUnits(paths(env));
  if (!units.length) {
    out('No units yet. Make one with: audora generate ./photos');
    return 0;
  }
  const port = await resolvePort(parsePort(values.port as string | undefined));
  const head = ['id', 'name', 'rooms', 'tier', 'created', 'url'];
  const rows = [head, ...units.map((u) => line(u, port))];
  const widths = head.map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  for (const row of rows) out(row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]))).join('  '));
  return 0;
}

async function cmdOpen(positionals: string[], values: Record<string, unknown>): Promise<number> {
  const id = positionals[0];
  if (!id) throw new UsageError('open needs a unit id: audora open 3f9a1c2e');
  const env = environment();
  const unit = readUnit(paths(env), id);
  if (!unit) {
    err(`No unit ${id} in the local store. "audora list" shows what is there.`);
    return 1;
  }
  const port = await resolvePort(parsePort(values.port as string | undefined));
  const url = tourUrl(port, unit.id);
  if (!(await serverAlive(port))) out(`Nothing is answering on port ${port}; start one with "npx audora serve".`);
  out(url);
  if (values.open === true) openUrl(url);
  return 0;
}

/**
 * Start `node dist-server/server/prod.js` when nothing answers on the port, and wait until it does.
 * Detached and unref'd, so the server outlives the CLI — which is the point: the URL has to keep
 * working after the command returns.
 */
async function cmdServe(values: Record<string, unknown>): Promise<number> {
  const port = parsePort(values.port as string | undefined) ?? PROD_PORT;
  const url = `http://localhost:${port}`;
  if (await serverAlive(port)) {
    out(`Already answering on port ${port}.`);
    out(url);
    return 0;
  }
  if (!existsSync(PROD_SERVER)) {
    err(`${path.relative(ROOT, PROD_SERVER)} is missing. Build it first: npm run build`);
    return 1;
  }
  const child = spawn(process.execPath, [PROD_SERVER], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
    detached: true,
    shell: false,
  });
  child.unref();
  const until = Date.now() + SERVE_READY_MS;
  while (Date.now() < until) {
    if (await serverAlive(port)) {
      out(`Started the production server on port ${port} (pid ${child.pid}).`);
      out(url);
      return 0;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  err(`The server did not answer on port ${port} within ${Math.round(SERVE_READY_MS / 1000)} s. Run "npm start" to see why.`);
  return 1;
}

/* ---------- main ---------- */

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        tier: { type: 'string' },
        name: { type: 'string' },
        plan: { type: 'string' },
        dims: { type: 'string' },
        ceiling: { type: 'string' },
        address: { type: 'string' },
        ai: { type: 'boolean' },
        // Kept so an older note's command line still runs; it is the default now.
        'no-ai': { type: 'boolean' },
        yes: { type: 'boolean', short: 'y' },
        open: { type: 'boolean' },
        port: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean' },
      },
    });
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    err('');
    err(USAGE);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.version === true) {
    out(version());
    return 0;
  }
  const command = positionals[0];
  if (values.help === true || !command || command === 'help') {
    out(USAGE);
    return command || values.help === true ? 0 : 2;
  }
  const rest = positionals.slice(1);
  switch (command) {
    case 'generate':
      return cmdGenerate(rest, values);
    case 'list':
      return cmdList(values);
    case 'open':
      return cmdOpen(rest, values);
    case 'serve':
      return cmdServe(values);
    default:
      err(`Unknown command ${JSON.stringify(command)}.`);
      err('');
      err(USAGE);
      return 2;
  }
}

/**
 * Run only when this file IS the program. A test imports `main` and the helpers above without the
 * process exiting under it.
 *
 * Compared as REAL paths, because the way docs/CLI.md tells people to run this is `npx audora`, and
 * npx execs the symlink in `node_modules/.bin` — so `process.argv[1]` is the link while
 * `import.meta.url` is the file Node already resolved it to. Comparing them literally made the
 * program exit 0 and print nothing, which is the worst possible way to be broken.
 */
const realPath = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
const invokedDirectly = process.argv[1] ? realPath(process.argv[1]) === realPath(fileURLToPath(import.meta.url)) : false;
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((e: unknown) => {
      if (e instanceof UsageError) {
        err(e.message);
        err('');
        err(USAGE);
        process.exitCode = 2;
        return;
      }
      err(e instanceof Error ? e.message : String(e));
      process.exitCode = 1;
    });
}
