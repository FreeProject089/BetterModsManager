// The SSH servers form's checks and the SSH error sentences (frontend/src/features/repo/
// ssh-validate.ts), against the COMPILED module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const { parseHostInput, isValidHost, validateSshDraft, modeString, fillSshMessage } =
    await import(pathToFileURL(join(here, '../frontend/js/features/repo/ssh-validate.js')).href);

const ok = { host: 'nas.local', port: 22, user: 'me', keyPath: 'C:/k/id_ed25519', remoteDir: '/srv/repo', auth: 'key' };

test('a pasted user@host:port is split into its fields', () => {
    assert.deepEqual(parseHostInput('me@nas.local:2222'), { host: 'nas.local', user: 'me', port: 2222 });
    assert.deepEqual(parseHostInput('ssh://me@192.168.1.20'), { host: '192.168.1.20', user: 'me' });
    assert.deepEqual(parseHostInput('sftp://192.168.1.20:22/var/www'), { host: '192.168.1.20', port: 22 });
    assert.deepEqual(parseHostInput('[::1]:2200'), { host: '::1', port: 2200 });
    assert.deepEqual(parseHostInput('fe80::1'), { host: 'fe80::1' });
    assert.deepEqual(parseHostInput('  host  '), { host: 'host' });
});

test('hosts: names, IPv4, IPv6; not URLs, not spaces, not 999.x', () => {
    for (const h of ['nas', 'nas.local', 'repo.example.com', '192.168.1.20', '::1', 'fe80::1', '2001:db8::5']) assert.equal(isValidHost(h), true, h);
    for (const h of ['', 'http://x', 'a b', '999.1.1.1', '-bad.com', 'x/y', 'a@b']) assert.equal(isValidHost(h), false, h);
});

test('a complete draft has no errors', () => {
    assert.deepEqual(validateSshDraft(ok), {});
    assert.deepEqual(validateSshDraft({ ...ok, auth: 'password', keyPath: '' }), {});
    // A relative folder is the account's home: allowed.
    assert.deepEqual(validateSshDraft({ ...ok, remoteDir: 'repo' }), {});
});

test('each wrong field says which', () => {
    assert.equal(validateSshDraft({ ...ok, host: '' }).host, 'sshsrv.errHostEmpty');
    assert.equal(validateSshDraft({ ...ok, host: 'http://nas' }).host, 'sshsrv.errHost');
    assert.equal(validateSshDraft({ ...ok, port: 0 }).port, 'sshsrv.errPort');
    assert.equal(validateSshDraft({ ...ok, port: 70000 }).port, 'sshsrv.errPort');
    assert.equal(validateSshDraft({ ...ok, port: null }).port, undefined);
    assert.equal(validateSshDraft({ ...ok, user: '' }).user, 'sshsrv.errUserEmpty');
    assert.equal(validateSshDraft({ ...ok, user: 'me@nas' }).user, 'sshsrv.errUser');
    assert.equal(validateSshDraft({ ...ok, keyPath: '' }).keyPath, 'sshsrv.errKeyPath');
    assert.equal(validateSshDraft({ ...ok, remoteDir: '' }).remoteDir, 'sshsrv.errDirEmpty');
});

test('the profile name: ssh://name/ safe, and not someone else\'s', () => {
    assert.equal(validateSshDraft(ok, 'prod').name, undefined);
    assert.equal(validateSshDraft(ok, 'my server').name, 'sshsrv.errName');
    assert.equal(validateSshDraft(ok, 'prod', ['prod']).name, 'sshsrv.errNameTaken');
});

test('unix mode bits as rwx', () => {
    assert.equal(modeString(0o755), 'rwxr-xr-x');
    assert.equal(modeString(0o640), 'rw-r-----');
    assert.equal(modeString(null), '');
});

test('backend error codes become sentences with their placeholders filled', () => {
    const dict = {
        'repo.ssh.errConnect': 'Could not reach {host}: {detail}',
        'repo.ssh.errHostKeyChanged': 'Fingerprint changed ({fp}).',
        'repo.ssh.errAuthRejected': 'The server refused the key.',
    };
    const tr = (k) => dict[k] ?? k;
    assert.equal(fillSshMessage('repo.ssh.errConnect|nas.local|Connection refused', tr), 'Could not reach nas.local: Connection refused');
    assert.equal(fillSshMessage('repo.ssh.errHostKeyChanged|SHA256:abc', tr), 'Fingerprint changed (SHA256:abc).');
    assert.equal(fillSshMessage('repo.ssh.errAuthRejected|extra', tr), 'The server refused the key. (extra)');
    assert.equal(fillSshMessage('something raw', tr), 'something raw');
});
