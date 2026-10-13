// Loader / intro animation (the markup and its styles are #app-loader in index.html).
//
// It lives in a file rather than in a <script> tag so that script-src can drop
// 'unsafe-inline'. That permission is what makes an injected `<img src=x onerror=...>`
// execute, and in a Tauri app execution reaches window.__TAURI__ and every command
// behind it.
//
// One short entrance, centred on the logo: the logo settles, the name and the version
// follow, a thin line fills while the app boots. It used to be a show (orbs flying in from
// the corners, an impact flash, a shockwave, two halo rings, a 720° spin, a parallax stage,
// click ripples, the name typed letter by letter); every part of it was decoration in front
// of a screen whose only job is to say « BMM is starting ».
//
// Everything is visible in the markup; the tweens animate FROM hidden, so a GSAP that never
// loads leaves a still splash, not an empty one. Under reduced motion (the OS setting, or
// Settings → Graphics « fewer animations ») nothing moves at all.
//
// app.ts kills `window.__ldTimeline` and every tween on the loader before removing it.

(function () {
    var reduce = false;
    try {
        reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
            || localStorage.getItem('bmm.reduceAnimations') === '1';
    } catch (_) { /* no matchMedia / storage: animate */ }

    /* ─── the version, read from the titlebar once the DOM is there ─── */
    function setVersion() {
        var put = function () {
            var btn = document.querySelector('.titlebar-version');
            var el = document.getElementById('ld-ver');
            if (el && btn && btn.textContent.trim()) el.textContent = btn.textContent.trim();
        };
        if (document.readyState !== 'loading') put();
        else document.addEventListener('DOMContentLoaded', put);
    }

    function playSound() {
        /* Boot sound — set a pending flag so app.ts plays it if its module loads later. */
        if (window.__bmmPlayBootSound) {
            try { window.__bmmPlayBootSound(); } catch (_) { }
        } else {
            window.__bmmBootSoundPending = true;
        }
    }

    function animate() {
        var tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
        window.__ldTimeline = tl;
        tl.from('#ld-logo-glow', { opacity: 0, scale: 0.6, duration: 0.7 }, 0)
            .from('#ld-logo', { opacity: 0, scale: 0.88, y: 8, duration: 0.55, ease: 'back.out(1.5)' }, 0.05)
            .from('#ld-brand', { opacity: 0, y: 8, duration: 0.4 }, 0.3)
            .from('#ld-ver', { opacity: 0, duration: 0.35 }, 0.42)
            .from('#ld-by', { opacity: 0, duration: 0.35 }, 0.5)
            .from('#ld-prog-track', { opacity: 0, duration: 0.3 }, 0.35)
            .to('#ld-prog', { width: '92%', duration: 1.8, ease: 'power1.inOut' }, 0.4);
        /* While the app is still booting, the glow breathes slowly; nothing else moves. */
        gsap.to('#ld-logo-glow', { opacity: 0.55, scale: 1.08, duration: 2.4, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 0.8 });
    }

    var attempts = 0;
    function start() {
        if (reduce) {
            document.getElementById('app-loader') && document.getElementById('app-loader').classList.add('ld-still');
            return;
        }
        if (typeof gsap === 'undefined') {
            if (++attempts < 40) setTimeout(start, 50);
            return; // never loaded: the still splash stays as it is
        }
        if (!document.getElementById('app-loader')) return;
        animate();
    }

    setVersion();
    playSound();
    start();
})();
