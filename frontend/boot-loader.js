// Start-up intro (the markup and its styles are #app-loader in index.html).
//
// It lives in a file rather than in a <script> tag so that script-src can drop
// 'unsafe-inline'. That permission is what makes an injected `<img src=x onerror=...>`
// execute, and in a Tauri app execution reaches window.__TAURI__ and every command
// behind it.
//
// Three styles, chosen in Settings → Graphics & display (localStorage `bmm.introStyle`):
//   · classic (default) — « Convergence », the original intro, back by the owner's request:
//     three orbs fly in from the corners and meet behind Tasky, an impact (flash, shockwave,
//     two halo rings), Tasky spins in and settles, the wordmark lands letter by letter with
//     the BMM mark, then the version and « By BetterCommunity ». While BMM boots the orbs
//     orbit, the glow breathes, a ring pulses, the stage follows the mouse, a click ripples.
//     When the app is ready Tasky turns happy for a beat, then the splash fades.
//   · logo — the short, quiet entrance centred on the BMM logo (Oct 2026).
//   · off — the theme's background only, gone as soon as the app is ready.
//
// What changed from the original « Convergence »:
//   · only transform and opacity move. The original animated `filter: brightness(4) blur(6px)`
//     on Tasky and kept blur(32px)/blur(18px) filters on two full-size glows, all repainted
//     every frame; the glows are plain radial gradients now and the « hot » entrance is a
//     white flare over Tasky that fades out;
//   · rings are drawn at their final size and scaled DOWN to start (the shockwave was a 6 px
//     ring scaled ×40: a blurry, 60 px thick bitmap). Tasky is a 384 px copy instead of the
//     4000 × 4000 PNG (a 64 MB decode on the boot path for an 80 px picture). The mark is the
//     SVG logo. All crisp at any DPI;
//   · colours are theme tokens (accent, cyan, brand amber, text), not #00c2ff / #fbbf24;
//   · it ends when the app is ready, not on a fixed delay: once the impact has happened
//     (a floor, so it never flashes), whatever is left of the entrance is played fast and
//     the splash fades. The app no longer waits 800 ms after it is ready;
//   · skippable: a click or any key jumps to the end; if the app is already ready the
//     splash goes at once;
//   · the orbit ticker is removed with the loader (it used to stay registered forever);
//   · under reduced motion (the OS setting, or Settings → Graphics « Reduce animations »),
//     or when the window starts hidden, nothing moves: a still splash, a short fade;
//   · the version line shows the real version (it read a .titlebar-version that no longer
//     exists, so it was always empty).
//
// Everything is visible in the markup; the tweens animate FROM hidden, so a GSAP that never
// loads leaves a still splash, not an empty one.
//
// app.ts calls `window.__bmmIntro.ready()` when BMM is up. The intro removes itself.

(function () {
    var root = document.getElementById('app-loader');
    if (!root) return;

    var STYLES = { classic: 1, logo: 1, off: 1 };
    var style = 'classic';
    var reduce = false;
    try {
        var saved = localStorage.getItem('bmm.introStyle');
        if (saved && STYLES[saved]) style = saved;
    } catch (_) { /* no storage: the default */ }
    try {
        reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
            || localStorage.getItem('bmm.reduceAnimations') === '1';
    } catch (_) { /* no matchMedia / storage: animate */ }
    // Started minimised or behind another window: nobody sees a show, so there is none.
    if (document.hidden) reduce = true;

    var G = window.gsap;
    window.__ldTimeline = null;
    var still = reduce || !G || style === 'off';

    root.setAttribute('data-intro', style);
    if (still) root.classList.add('ld-still');

    var logo = document.getElementById('ld-logo');
    var HAPPY = 'assets/brand/tasky-happy-splash.webp';
    if (style === 'logo' && logo) logo.src = 'assets/brand/bmm-logo-tile.svg';
    if (style === 'classic' && !still) {
        // Decoded now, so the happy face at the end swaps in without a blank frame.
        try { var hp = new Image(); hp.src = HAPPY; if (hp.decode) hp.decode().catch(function () { }); } catch (_) { }
    }

    var t0 = performance.now();
    var tl = null;            // the entrance
    var prog = null;          // the progress line's slow fill
    var loops = [];           // breathing, bob, pulse: killed at the end
    var tickerFn = null;      // classic orbit
    var orbDefs = null;
    var appReady = false, skipped = false, finishing = false, gone = false;
    var timers = [];
    function later(fn, ms) { var id = setTimeout(fn, ms); timers.push(id); return id; }

    /* ─── the version, straight from Tauri ─── */
    try {
        var getVersion = window.__TAURI__ && window.__TAURI__.app && window.__TAURI__.app.getVersion;
        if (getVersion) getVersion().then(function (v) {
            var el = document.getElementById('ld-ver');
            if (el && v) el.textContent = 'V' + v;
        }).catch(function () { });
    } catch (_) { }

    /* ─── boot sound (app.ts plays it if its module loads later) ─── */
    if (window.__bmmPlayBootSound) {
        try { window.__bmmPlayBootSound(); } catch (_) { }
    } else {
        window.__bmmBootSoundPending = true;
    }

    /* ─── the wordmark, one span per letter (classic only; the words stand without JS) ─── */
    function splitBrand() {
        var words = root.querySelectorAll('#ld-brand .ld-word');
        for (var i = 0; i < words.length; i++) {
            var w = words[i], text = w.textContent;
            w.textContent = '';
            for (var j = 0; j < text.length; j++) {
                var s = document.createElement('span');
                s.className = 'ld-char';
                s.textContent = text[j];
                w.appendChild(s);
            }
        }
    }

    /* ─── classic: « Convergence » ─── */
    function classic() {
        splitBrand();
        var wrap = document.getElementById('ld-logo-wrap');
        var r = wrap.getBoundingClientRect();
        var lx = r.left + r.width / 2, ly = r.top + r.height / 2;
        var W = window.innerWidth, H = window.innerHeight;
        // Orbs live inside the logo wrap: their x/y are relative to Tasky's centre.
        var orbs = [
            { id: '#ld-orb-0', sx: 30 - lx, sy: 30 - ly, r: 52, spd: 0.85, off: 0 },
            { id: '#ld-orb-1', sx: W - lx - 30, sy: H - ly - 30, r: 64, spd: -0.58, off: Math.PI * 0.65 },
            { id: '#ld-orb-2', sx: W - lx - 30, sy: 30 - ly, r: 56, spd: 0.42, off: Math.PI * 1.4 },
        ];
        orbs.forEach(function (d) { G.set(d.id, { x: d.sx, y: d.sy, opacity: 0 }); });
        orbDefs = orbs;

        tl = G.timeline({ defaults: { ease: 'power3.out' } });
        tl.fromTo('#ld-bg-glow', { opacity: 0 }, { opacity: 1, duration: 1.2, ease: 'power2.out' }, 0);

        // 0.15 — the orbs fly in from the corners
        orbs.forEach(function (d, i) {
            tl.to(d.id, { opacity: 1, duration: 0.12 }, 0.15 + i * 0.05);
            tl.to(d.id, { x: 0, y: 0, duration: 0.52, ease: 'power3.in' }, 0.15 + i * 0.05);
        });

        // 0.68 — impact
        tl.to('#ld-flash', { opacity: 1, duration: 0.05, yoyo: true, repeat: 1, ease: 'none' }, 0.68);
        tl.fromTo('#ld-wave', { opacity: 0.9, scale: 0.02 }, { opacity: 0, scale: 1, duration: 0.75, ease: 'power2.out', immediateRender: false }, 0.69);
        tl.fromTo('#ld-halo', { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(2.5)' }, 0.71);
        tl.to('#ld-halo', { opacity: 0, scale: 1.4, duration: 0.55, ease: 'power2.in' }, 1.1);
        tl.fromTo('#ld-halo2', { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(1.8)' }, 0.74);
        tl.to('#ld-halo2', { opacity: 0, scale: 1.5, duration: 0.6, ease: 'power2.in' }, 1.2);
        tl.fromTo('#ld-logo-glow', { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.5 }, 0.72);

        // 0.69 — Tasky appears hot (the flare) and spins in
        tl.fromTo('#ld-logo', { opacity: 0 }, { opacity: 1, duration: 0.12, ease: 'none' }, 0.69);
        tl.fromTo('#ld-logo', { scale: 0.85, rotationY: 0, transformPerspective: 500 },
            { scale: 1, rotationY: 720, duration: 0.65, ease: 'power2.out' }, 0.69);
        tl.fromTo('#ld-flare', { opacity: 1, scale: 1.1 }, { opacity: 0, scale: 0.8, duration: 0.55, ease: 'power2.out', immediateRender: false }, 0.69);

        // 0.78 — the orbs start orbiting
        tl.call(function () { startOrbit(orbs); }, null, 0.78);

        // 1.0 — the wordmark, letter by letter; the mark lands with the first letters
        tl.fromTo('#ld-brand .ld-char', { opacity: 0, y: 22, rotationX: -60, scale: 0.82 },
            { opacity: 1, y: 0, rotationX: 0, scale: 1, duration: 0.5, stagger: { each: 0.033, ease: 'power2.out' }, ease: 'back.out(2)' }, 1.0);
        tl.fromTo('#ld-mark', { opacity: 0, scale: 0.55, rotation: -30 },
            { opacity: 1, scale: 1, rotation: 0, duration: 0.55, ease: 'back.out(2.2)' }, 1.0);

        // 1.4 — version, then the credit (last and quietest)
        tl.fromTo('#ld-ver', { opacity: 0, x: 6 }, { opacity: 1, x: 0, duration: 0.4 }, 1.4);
        tl.fromTo('#ld-by', { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.45 }, 1.52);
        tl.fromTo('#ld-prog-track', { opacity: 0 }, { opacity: 1, duration: 0.3 }, 1.55);

        // The line fills slowly towards 90 %; the last 10 % is the app really being ready.
        prog = G.fromTo('#ld-prog', { scaleX: 0 }, { scaleX: 0.9, duration: 3.2, ease: 'power2.out', delay: 1.6 });

        // While BMM boots: the glow breathes, Tasky bobs, a ring pulses now and then.
        loops.push(G.to('#ld-logo-glow', { scale: 1.2, opacity: 0.7, duration: 2.8, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 1.35 }));
        loops.push(G.to('#ld-logo-wrap', { y: -4, duration: 2.2, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 1.0 }));
        loops.push(G.timeline({ repeat: -1, repeatDelay: 1.8, delay: 1.4 })
            .fromTo('#ld-pulse', { scale: 0.37, opacity: 0.55 }, { scale: 1, opacity: 0, duration: 1.5, ease: 'power2.out', immediateRender: false }));

        parallax();
    }

    function startOrbit(defs) {
        if (tickerFn || gone) return;
        var t1 = G.ticker.time, BLEND = 0.55;
        var setters = defs.map(function (d) {
            return { d: d, x: G.quickSetter(d.id, 'x', 'px'), y: G.quickSetter(d.id, 'y', 'px') };
        });
        tickerFn = function () {
            var t = G.ticker.time - t1;
            var b = Math.min(t / BLEND, 1), s = b * b * (3 - 2 * b);   // smoothstep from the meeting point
            for (var i = 0; i < setters.length; i++) {
                var o = setters[i], a = o.d.off + t * o.d.spd;
                o.x(Math.cos(a) * o.d.r * s);
                o.y(Math.sin(a) * o.d.r * 0.38 * s);
            }
        };
        G.ticker.add(tickerFn);
    }

    function parallax() {
        var bx = G.quickTo('#ld-bg-glow', 'x', { duration: 1.0, ease: 'power2.out' });
        var by = G.quickTo('#ld-bg-glow', 'y', { duration: 1.0, ease: 'power2.out' });
        var sx = G.quickTo('#ld-stage', 'x', { duration: 0.7, ease: 'power2.out' });
        var sy = G.quickTo('#ld-stage', 'y', { duration: 0.7, ease: 'power2.out' });
        root.addEventListener('mousemove', function (e) {
            var dx = (e.clientX - innerWidth / 2) / (innerWidth / 2);
            var dy = (e.clientY - innerHeight / 2) / (innerHeight / 2);
            bx(dx * 90); by(dy * 90); sx(dx * 10); sy(dy * 10);
        });
        var w = document.getElementById('ld-logo-wrap');
        w.addEventListener('mouseenter', function () { G.to('#ld-logo', { scale: 1.1, duration: 0.3, ease: 'back.out(2)', overwrite: 'auto' }); });
        w.addEventListener('mouseleave', function () { G.to('#ld-logo', { scale: 1, duration: 0.5, ease: 'elastic.out(1,0.35)', overwrite: 'auto' }); });
    }

    function ripple(e) {
        if (still || style !== 'classic') return;
        var r = document.createElement('div');
        r.className = 'ld-ripple';
        r.style.left = e.clientX - root.getBoundingClientRect().left + 'px';
        r.style.top = e.clientY - root.getBoundingClientRect().top + 'px';
        root.appendChild(r);
        G.fromTo(r, { opacity: 0.9, scale: 0.05 }, { opacity: 0, scale: 1, duration: 0.55, ease: 'power2.out', onComplete: function () { r.remove(); } });
    }

    /* ─── logo: the short entrance ─── */
    function logoIntro() {
        tl = G.timeline({ defaults: { ease: 'power3.out' } });
        tl.from('#ld-logo-glow', { opacity: 0, scale: 0.6, duration: 0.7 }, 0)
            .from('#ld-logo', { opacity: 0, scale: 0.88, y: 8, duration: 0.55, ease: 'back.out(1.5)' }, 0.05)
            .from('#ld-brand', { opacity: 0, y: 8, duration: 0.4 }, 0.3)
            .from('#ld-ver', { opacity: 0, duration: 0.35 }, 0.42)
            .from('#ld-by', { opacity: 0, duration: 0.35 }, 0.5)
            .from('#ld-prog-track', { opacity: 0, duration: 0.3 }, 0.35);
        prog = G.fromTo('#ld-prog', { scaleX: 0 }, { scaleX: 0.9, duration: 2.2, ease: 'power2.out', delay: 0.4 });
        loops.push(G.to('#ld-logo-glow', { opacity: 0.55, scale: 1.08, duration: 2.4, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 0.8 }));
    }

    /* ─── the end ─── */
    // The shortest time the splash stays, so a fast boot does not flash it: just past the
    // impact for classic, the logo settled for logo. Skipping, still and off have none.
    function floorMs() {
        if (still || skipped) return 0;
        return style === 'classic' ? 1150 : 550;
    }

    function finish() {
        if (finishing || gone) return;
        finishing = true;
        var hold = 0;
        if (G && !still) {
            // Whatever is left of the entrance plays in at most ~0.35 s.
            if (tl && tl.progress() < 1) {
                var left = tl.duration() - tl.time();
                if (skipped) tl.progress(1);
                else { tl.timeScale(Math.max(1, left / 0.35)); hold = Math.min(left, 0.35) * 1000; }
            }
            if (prog) prog.kill();
            G.to('#ld-prog', { scaleX: 1, duration: 0.25, ease: 'power1.out' });
        }
        // Classic: Tasky turns happy for a beat once BMM is ready (unless a theme gave the
        // splash its own picture, or the user is in a hurry).
        if (style === 'classic' && !still && !skipped && logo && !logo.dataset.bmmOrig) {
            later(function () { logo.src = HAPPY; }, hold);
            hold += 380;
        }
        later(fadeOut, hold);
    }

    function fadeOut() {
        if (gone) return;
        gone = true;
        root.classList.add('ld-out');
        root.setAttribute('aria-busy', 'false');
        detach();
        var ms = 700;
        try {
            var d = getComputedStyle(root).transitionDuration.split(',')[0];
            ms = (parseFloat(d) || 0) * (/ms$/.test(d) ? 1 : 1000) + 60;
        } catch (_) { }
        setTimeout(cleanup, ms);
    }

    function cleanup() {
        timers.forEach(clearTimeout);
        if (G) {
            if (tickerFn) G.ticker.remove(tickerFn);
            if (tl) tl.kill();
            if (prog) prog.kill();
            loops.forEach(function (l) { l.kill(); });
            var targets = Array.prototype.slice.call(root.querySelectorAll('*'));
            targets.push(root);
            G.killTweensOf(targets);
        }
        root.remove();
        window.__ldTimeline = null;
        try { document.dispatchEvent(new CustomEvent('bmm:intro-done')); } catch (_) { }
    }

    function maybeFinish() {
        if (!appReady || finishing) return;
        var wait = floorMs() - (performance.now() - t0);
        if (wait > 0) later(maybeFinish, wait);
        else finish();
    }

    /* ─── skipping: a click or any key ─── */
    function skip() {
        if (skipped || gone) return;
        skipped = true;
        if (tl && tl.progress() < 1) tl.progress(1);
        if (orbDefs) startOrbit(orbDefs);   // the jump may pass over the call that starts it
        if (appReady) {
            if (finishing) fadeOut();   // even the happy beat
            else finish();
        }
    }
    function onClick(e) { ripple(e); skip(); }
    function onKey(e) {
        if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
        skip();
    }
    function detach() {
        root.removeEventListener('click', onClick);
        window.removeEventListener('keydown', onKey, true);
    }
    root.addEventListener('click', onClick);
    window.addEventListener('keydown', onKey, true);

    /* ─── go ─── */
    window.__bmmIntro = {
        style: style,
        /** BMM is up: end the intro as soon as it may. */
        ready: function () { appReady = true; maybeFinish(); },
        skip: skip,
    };

    if (!still) {
        try {
            if (style === 'classic') classic();
            else logoIntro();
            window.__ldTimeline = tl;
        } catch (err) {
            // A broken animation must never hide the splash's content.
            try { if (tl) tl.progress(1).kill(); } catch (_) { }
            root.classList.add('ld-still');
            still = true;
        }
    }
})();
