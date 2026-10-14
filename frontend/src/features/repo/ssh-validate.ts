// The SSH servers form's checks, without a DOM, so the node tests drive them directly
// (tests/ssh-validate.test.mjs).
//
// Every problem is an i18n key per field, said next to the field it is about: « a host, a user
// and a base folder are needed » in one line under the buttons did not say WHICH, and a port
// of 0 or 99999 went through to the backend, which answered with a socket error.

export interface SshDraft {
    host: string;
    port?: number | null;
    user: string;
    keyPath: string;
    remoteDir: string;
    auth?: 'key' | 'password';
}

export type SshField = 'name' | 'host' | 'port' | 'user' | 'keyPath' | 'remoteDir';
export type SshErrors = Partial<Record<SshField, string>>;

/**
 * What was pasted into the host field, split: `me@nas.local:2222`, `ssh://me@host`,
 * `[::1]:22`, `192.168.1.20`. Only the parts present are returned; the form fills the user
 * and port fields from them when those are empty.
 */
export function parseHostInput(raw: string): { host: string; user?: string; port?: number } {
    let s = String(raw ?? '').trim().replace(/^(ssh|sftp):\/\//i, '');
    s = s.replace(/\/.*$/, '');
    let user: string | undefined;
    const at = s.lastIndexOf('@');
    if (at > 0) { user = s.slice(0, at); s = s.slice(at + 1); }
    let port: number | undefined;
    const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(s);
    if (v6) {
        s = v6[1];
        if (v6[2]) port = Number(v6[2]);
    } else {
        // One colon is host:port; two or more is a bare IPv6 address, which carries no port.
        const m = /^([^:]+):(\d+)$/.exec(s);
        if (m) { s = m[1]; port = Number(m[2]); }
    }
    const out: { host: string; user?: string; port?: number } = { host: s };
    if (user) out.user = user;
    if (port !== undefined && Number.isInteger(port)) out.port = port;
    return out;
}

const HOST_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.?$/;
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

/** A host name, an IPv4 or an IPv6 address (without brackets). */
export function isValidHost(h: string): boolean {
    const s = String(h ?? '').trim();
    if (!s || s.length > 253) return false;
    if (IPV4_RE.test(s)) return true;
    if (s.includes(':')) return /^[0-9A-Fa-f:.]+(%[\w.-]+)?$/.test(s) && (s.match(/:/g) || []).length >= 2;
    // A dotted quad that is not a valid IPv4 (999.1.1.1) is a typo, not a host name.
    if (/^[\d.]+$/.test(s)) return false;
    return HOST_RE.test(s);
}

/**
 * The problems with a draft, per field. `name` and `taken` check the profile name when given
 * (`taken` = the other profiles' names, so a rename cannot overwrite one).
 */
export function validateSshDraft(d: SshDraft, name?: string, taken: string[] = []): SshErrors {
    const e: SshErrors = {};
    if (name !== undefined) {
        const n = String(name).trim();
        if (n && !/^[\w.-]{1,40}$/.test(n)) e.name = 'sshsrv.errName';
        else if (n && taken.includes(n)) e.name = 'sshsrv.errNameTaken';
    }
    if (!String(d.host ?? '').trim()) e.host = 'sshsrv.errHostEmpty';
    else if (!isValidHost(d.host)) e.host = 'sshsrv.errHost';
    const p = d.port == null || (d.port as unknown) === '' ? 22 : Number(d.port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) e.port = 'sshsrv.errPort';
    const u = String(d.user ?? '').trim();
    if (!u) e.user = 'sshsrv.errUserEmpty';
    else if (/[\s@:/]/.test(u)) e.user = 'sshsrv.errUser';
    if ((d.auth || 'key') === 'key' && !String(d.keyPath ?? '').trim()) e.keyPath = 'sshsrv.errKeyPath';
    const dir = String(d.remoteDir ?? '').trim();
    // Relative is allowed: SFTP reads it from the account's home folder, which is what
    // `repo` typed alone means to anyone who has used scp.
    if (!dir) e.remoteDir = 'sshsrv.errDirEmpty';
    else if (/[\u0000-\u001f]/.test(dir)) e.remoteDir = 'sshsrv.errDir';
    return e;
}

/** `rwxr-xr-x` for 0o755. */
export function modeString(mode: number | null | undefined): string {
    if (mode == null || !Number.isFinite(mode)) return '';
    const bits = 'rwxrwxrwx';
    let s = '';
    for (let i = 0; i < 9; i++) s += (mode & (1 << (8 - i))) ? bits[i] : '-';
    return s;
}

/**
 * `key|arg1|arg2` → the translated sentence with its `{placeholders}` filled IN ORDER by the
 * arguments. Pure (the translator is passed in) so the node tests pin it.
 *
 * It used to append the arguments after a dash and leave the placeholders as they were, so
 * « Could not reach {host}: {detail} — nas.local Connection refused » is what people read.
 * Arguments beyond the placeholders still follow, in brackets; an unknown key is shown raw.
 */
export function fillSshMessage(raw: string, tr: (k: string) => string): string {
    const [key, ...rest] = String(raw).split('|');
    const msg = tr(key);
    // tr() returning the key unchanged means there is no translation; the raw text is then
    // more use than the key name.
    if (msg === key) return raw;
    const names: string[] = [];
    for (const m of msg.matchAll(/\{(\w+)\}/g)) if (!names.includes(m[1])) names.push(m[1]);
    const vals = new Map(names.map((n, i) => [n, rest[i]]));
    const filled = msg.replace(/\{(\w+)\}/g, (all, n: string) => (vals.get(n) ?? all));
    const extra = rest.slice(names.length).filter(Boolean);
    return extra.length ? `${filled} (${extra.join(' ')})` : filled;
}
