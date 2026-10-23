// Running external commands with every byte of output kept in the step's log file.
//
// Node 24 refuses to spawn a .cmd/.bat without a shell, and npm / npx / gource are .cmd shims
// on Windows, so those go through cmd.exe with each argument quoted. Everything else is spawned
// directly (no shell, no quoting surprises around « Better Project »).

import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { c } from './util.mjs';

const isWin = process.platform === 'win32';
const SHIMS = new Set(['npm', 'npx', 'gource']);

const quoteWin = (a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '""')}"`);

export class Logger {
  constructor(file) { this.file = file; if (file) mkdirSync(dirname(file), { recursive: true }); }
  write(s) { if (this.file) appendFileSync(this.file, s); }
  line(s = '') { this.write(s + '\n'); }
  /** Log AND print. */
  info(s = '') { this.line(s); console.log(s); }
  warn(s) { this.line('WARN ' + s); console.log(c.yellow('  ! ' + s)); }
  ok(s) { this.line('OK   ' + s); console.log(c.green('  ✓ ' + s)); }
  fail(s) { this.line('FAIL ' + s); console.log(c.red('  ✗ ' + s)); }
}

/**
 * Run a command, streaming its output to the console (unless quiet) and to the log.
 * Resolves { code, out } and never rejects for a non-zero exit: the caller decides.
 */
export function run(cmd, args = [], { cwd, log, env, quiet = false, shell, input } = {}) {
  const useShell = shell ?? (isWin && (SHIMS.has(cmd) || /\.(cmd|bat)$/i.test(cmd)));
  const display = `${cmd} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`;
  log?.line(`\n$ ${display}${cwd ? `   (in ${cwd})` : ''}`);
  if (!quiet) console.log(c.dim(`  $ ${display}`));
  return new Promise((resolve) => {
    let child;
    const opts = { cwd, env: { ...process.env, ...env }, windowsHide: true };
    if (useShell && isWin) {
      const line = [cmd, ...args].map(quoteWin).join(' ');
      child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...opts, windowsVerbatimArguments: true });
    } else {
      child = spawn(cmd, args, opts);
    }
    let out = '';
    const onData = (d) => {
      const s = d.toString();
      out += s;
      log?.write(s);
      if (!quiet) process.stdout.write(c.dim(s.replace(/^(?=.)/gm, '    ')));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    if (input != null) { child.stdin.end(input); } else child.stdin.end();
    child.on('error', (e) => { log?.line(`spawn error: ${e.message}`); resolve({ code: -1, out: out + e.message }); });
    child.on('close', (code) => { log?.line(`[exit ${code}]`); resolve({ code: code ?? -1, out }); });
  });
}

/** Run and return trimmed stdout, or null when the command is missing or fails. */
export function capture(cmd, args = [], { cwd } = {}) {
  try {
    const useShell = isWin && (SHIMS.has(cmd) || /\.(cmd|bat)$/i.test(cmd));
    if (useShell) {
      const line = [cmd, ...args].map(quoteWin).join(' ');
      return execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { cwd, encoding: 'utf8', windowsVerbatimArguments: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
    }
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, maxBuffer: 256 * 1024 * 1024 }).trim();
  } catch {
    return null;
  }
}
