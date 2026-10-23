// The one line a person reads instead of opening the task.
//
// These exist because "File exists" and "App is running" were the whole of what a condition
// trigger showed: true of the TYPE, and useless about the task, which watches one file.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { condSubject, condChildCount, scriptFirstLine } = await import(
    '../frontend/js/features/settings/sched-summary.js'
);

describe('condSubject', () => {
    test('a path is named by its last segment, not by where it lives', () => {
        // The rest is the folder it happens to sit in, and on Windows that is most of the
        // characters — a summary made of C:\\Users\\… tells you nothing at a glance.
        assert.equal(
            condSubject({ type: 'fileExists', params: { path: 'C:\\games\\dcs\\Logs\\dcs.log' } }),
            'dcs.log',
        );
        assert.equal(condSubject({ type: 'fileExists', params: { path: '/var/log/x.log' } }), 'x.log');
    });

    test('other subjects come through whole', () => {
        assert.equal(condSubject({ type: 'appRunning', params: { app: 'DCS.exe' } }), 'DCS.exe');
        assert.equal(condSubject({ type: 'online', params: { url: 'https://example.com' } }), 'https://example.com');
    });

    test('an array subject is joined rather than printed as [object Object]', () => {
        assert.equal(condSubject({ type: 'dayOfWeek', params: { days: ['mon', 'tue'] } }), 'mon, tue');
    });

    test('the FIRST identifying key wins, so a path beats a free-text value', () => {
        assert.equal(
            condSubject({ type: 'fileContains', params: { value: 'needle', path: 'a/b/hay.txt' } }),
            'hay.txt',
        );
    });

    test('nothing identifying, or no condition at all, is empty rather than a guess', () => {
        assert.equal(condSubject({ type: 'always', params: {} }), '');
        assert.equal(condSubject({ type: 'always' }), '');
        assert.equal(condSubject(undefined), '');
        // Present but blank is the same as absent: a summary reading "File exists — " is
        // worse than one reading "File exists".
        assert.equal(condSubject({ type: 'fileExists', params: { path: '   ' } }), '');
    });

    test('a long subject is cut with an ellipsis, not left to break the row', () => {
        const r = condSubject({ type: 'appRunning', params: { app: 'x'.repeat(80) } }, 10);
        assert.equal(r.length, 10);
        assert.ok(r.endsWith('…'));
    });
});

describe('condChildCount', () => {
    test('all/any report how many they hold; everything else reports -1', () => {
        assert.equal(condChildCount({ type: 'all', params: { conditions: [1, 2, 3] } }), 3);
        assert.equal(condChildCount({ type: 'any', params: { conditions: [] } }), 0);
        // -1 and not 0, because "an `all` with nothing in it" and "not an `all`" are
        // different things and the caller renders them differently.
        assert.equal(condChildCount({ type: 'fileExists', params: {} }), -1);
        assert.equal(condChildCount(undefined), -1);
    });

    test('a malformed all is 0, not a crash', () => {
        assert.equal(condChildCount({ type: 'all', params: {} }), 0);
        assert.equal(condChildCount({ type: 'all', params: { conditions: 'nope' } }), 0);
    });
});

describe('scriptFirstLine', () => {
    test('skips blank lines and comments — a probe is not its licence header', () => {
        assert.equal(
            scriptFirstLine('\n# checks the player count\n\nimport sys\nsys.exit(0)', 'python'),
            'import sys',
        );
        assert.equal(scriptFirstLine('// header\nprocess.exit(0)', 'node'), 'process.exit(0)');
    });

    test('cmd comments are a WORD, and case does not matter', () => {
        // `REM` is the one engine whose comment marker is not a symbol, which is exactly the
        // case a single hardcoded '#' would have got wrong.
        assert.equal(scriptFirstLine('REM what this does\nexit /b 0', 'cmd'), 'exit /b 0');
        assert.equal(scriptFirstLine('rem lowercase too\nexit /b 0', 'cmd'), 'exit /b 0');
        assert.equal(scriptFirstLine(':: the other one\nexit /b 0', 'cmd'), 'exit /b 0');
    });

    test('a # in PowerShell is a comment; the same text in node is not', () => {
        assert.equal(scriptFirstLine('# nope\nWrite-Host 1', 'powershell'), 'Write-Host 1');
        assert.equal(scriptFirstLine('#!/usr/bin/env node\nconsole.log(1)', 'node'), '#!/usr/bin/env node');
    });

    test('nothing but comments, or nothing at all, is empty', () => {
        assert.equal(scriptFirstLine('# only\n# comments', 'python'), '');
        assert.equal(scriptFirstLine('', 'python'), '');
        assert.equal(scriptFirstLine('   \n\n', 'python'), '');
    });

    test('an unknown engine still skips the two common markers', () => {
        assert.equal(scriptFirstLine('# a\n// b\nreal()', 'perl'), 'real()');
    });

    test('a long line is cut, not left to stretch the row', () => {
        const r = scriptFirstLine('x'.repeat(200), 'python', 20);
        assert.equal(r.length, 20);
        assert.ok(r.endsWith('…'));
    });
});
