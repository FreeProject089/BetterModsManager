// webview-env.ts — the half of a bug report the backend cannot see.
//
// export_diagnostics reports the process: version, OS, memory, log lines. All true,
// all insufficient, because a large class of "the app is broken" reports is not
// about the process at all — it is about the environment the WEBVIEW was handed.
//
// The case that motivated this: a spinner that would not turn. It survived a
// compositor-promotion fix and a keyframes-shadowing fix before the actual cause
// turned up — Windows' Accessibility > "Animation effects" switch, reaching the
// WebView as prefers-reduced-motion, where a global rule pairs a 0.01ms duration
// with animation-iteration-count: 1 and stops every looping indicator dead. Three
// wrong diagnoses, and one line in a diagnostics file would have ended it at the
// first. Everything below is chosen on the same test: does it silently change how
// the app behaves, while being invisible in a screenshot and absent from the logs?

/** A media query's current answer, as a plain boolean. */
function mq(q: string): boolean {
    try { return window.matchMedia(q).matches; } catch { return false; }
}

/** Recent uncaught errors and rejections. Installed by initWebviewErrorTrap(). */
const _errors: { at: string; kind: string; message: string; source?: string }[] = [];

export function initWebviewErrorTrap(): void {
    const push = (kind: string, message: string, source?: string) => {
        _errors.push({ at: new Date().toISOString(), kind, message: String(message).slice(0, 500), source });
        // Only the most recent matter, and an unbounded array in a long session is
        // itself a leak — the diagnostics tool must not become the problem.
        if (_errors.length > 50) _errors.splice(0, _errors.length - 50);
    };
    window.addEventListener('error', e => push('error', e.message, `${e.filename}:${e.lineno}`));
    window.addEventListener('unhandledrejection', e => push('unhandledrejection', String((e as PromiseRejectionEvent).reason)));
}

export function collectWebviewEnv(): Record<string, unknown> {
    return {
        userAgent: navigator.userAgent,
        language: navigator.language,
        // Preferences the OS imposes. Each one silently rewrites how the app looks or
        // animates, and none of them is visible in a screenshot of the bug.
        prefersReducedMotion: mq('(prefers-reduced-motion: reduce)'),
        prefersColorScheme: mq('(prefers-color-scheme: dark)') ? 'dark' : 'light',
        prefersContrast: mq('(prefers-contrast: more)') ? 'more' : 'no-preference',
        forcedColors: mq('(forced-colors: active)'),
        // Geometry, because "it overlaps" and "it is cut off" are almost always a
        // width the reporter never thought to mention.
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        devicePixelRatio: window.devicePixelRatio,
        // The app's own switches that change rendering wholesale.
        docked: document.body.classList.contains('bmm-docked'),
        noAnim: document.body.classList.contains('bmm-no-anim'),
        theme: document.documentElement.getAttribute('data-theme')
            || document.body.getAttribute('data-theme') || null,
        bodyClasses: Array.from(document.body.classList).join(' '),
        localStorageKeys: (() => { try { return Object.keys(localStorage).length; } catch { return null; } })(),
        recentErrors: _errors.slice(-25),
    };
}
