#!/usr/bin/env node
/**
 * Put `audora` where `npx` looks for it, after `npm run build` has emitted it.
 *
 * `package.json` declares `bin: { audora: "dist-server/server/cli.js" }`, which is what a global
 * install or `npm link` reads — but npm does not link a package's own bin into its own
 * `node_modules/.bin`, and that directory is the first place `npx` looks. So without this step
 * `npx audora --help` from the repository root silently does nothing, and the one command
 * docs/CLI.md promises (`npx audora generate ./photos --open`) does not exist.
 *
 * This is deliberately the same thing npm itself would have done had `audora` been a dependency:
 * a relative symlink in `node_modules/.bin`, and the mode bit the exec needs. Nothing else is
 * touched, and a failure is a warning rather than a broken build — the tool still runs as
 * `node dist-server/server/cli.js`.
 *
 * Run as `postbuild`, so it cannot go stale: the link is refreshed every time the file it points at
 * is rebuilt.
 */
import { chmodSync, existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'dist-server', 'server', 'cli.js');
const BIN_DIR = path.join(ROOT, 'node_modules', '.bin');
const LINK = path.join(BIN_DIR, 'audora');

if (!existsSync(TARGET)) {
  console.warn(`link-bin: ${path.relative(ROOT, TARGET)} is not there yet; skipping the npx link.`);
  process.exit(0);
}

try {
  // The shebang is the first line of server/cli.ts and tsc keeps it, but only the mode bit makes
  // the kernel honour it. Node scripts run through `node` do not need this; an exec'd bin does.
  chmodSync(TARGET, 0o755);
  mkdirSync(BIN_DIR, { recursive: true });
  // lstat, never exists(): a link left pointing at a deleted file answers false and would be kept.
  try {
    lstatSync(LINK);
    rmSync(LINK, { force: true });
  } catch {
    /* nothing there, which is the normal case on a fresh checkout */
  }
  // Relative, so moving or renaming the checkout does not break it.
  symlinkSync(path.relative(BIN_DIR, TARGET), LINK);
  console.log('link-bin: npx audora → dist-server/server/cli.js');
} catch (e) {
  // Windows without developer mode refuses symlinks; so does a read-only node_modules. Neither is
  // worth failing a build over, and the message says what still works.
  console.warn(`link-bin: could not link node_modules/.bin/audora (${e instanceof Error ? e.message : String(e)}).`);
  console.warn('link-bin: run the tool as `node dist-server/server/cli.js` or `npm link` instead.');
}
