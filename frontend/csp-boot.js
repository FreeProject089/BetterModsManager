// Applies the user's extra Content-Security-Policy, if they set one.
//
// WHY IT LOOKS LIKE THIS
//
// A `<meta http-equiv="Content-Security-Policy">` is only honoured while the document is
// being PARSED. One inserted later - from a module, after DOMContentLoaded, from a settings
// screen - is ignored by every browser engine. So an app that wants a user-configurable
// policy has to write it during head parsing, which rules out asking the Rust side for it:
// that call is async, and parsing will not wait.
//
// localStorage is the one store readable synchronously at this point, so the settings
// screen writes there as well as into app settings, and this reads it back on the next
// launch. That is why the setting says "takes effect after a restart" rather than
// pretending to apply live.
//
// This is a SEPARATE FILE and not an inline <script> on purpose: an inline script needs
// `'unsafe-inline'` in script-src, and the entire point of this feature is letting somebody
// remove that. An inline injector would stop running the moment it succeeded - locking the
// user out of the setting that locked them out.
//
// WHAT IT CAN AND CANNOT DO
//
// The static policy in index.html is already in force. A second policy does not replace it:
// the browser enforces EVERY policy it was given, so the effective result is the
// intersection - the strictest of each. This setting can therefore only ever TIGHTEN.
// That asymmetry is deliberate. A settings screen that could loosen a CSP is a settings
// screen an attacker with script execution would visit first.
(function () {
    'use strict';
    var KEY = 'bmm.csp.extra';
    var policy;
    try {
        policy = localStorage.getItem(KEY);
    } catch (e) {
        return; // storage unavailable (private mode, disabled) - keep the shipped policy
    }
    if (!policy) return;

    policy = String(policy).trim();
    if (!policy) return;

    // A policy is directives separated by `;`. Anything containing a quote, a `<` or a
    // newline is not one, and would only get here by a bad paste or a corrupted store -
    // refuse rather than write markup-adjacent text into the head.
    if (/[<>"\r\n]/.test(policy)) {
        try { localStorage.removeItem(KEY); } catch (e) { /* nothing further to do */ }
        return;
    }
    // Bounded: a policy is a few hundred characters. A megabyte in this key is corruption.
    if (policy.length > 4096) return;

    var meta = document.createElement('meta');
    meta.setAttribute('http-equiv', 'Content-Security-Policy');
    meta.setAttribute('content', policy);
    // Appended to <head> while it is still being parsed, which is the only moment this
    // works. document.head exists here because this script is inside <head> itself.
    document.head.appendChild(meta);
})();
