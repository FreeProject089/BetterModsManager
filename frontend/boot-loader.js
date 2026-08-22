// Loader / intro animation, lifted verbatim out of index.html.
//
// It lives in a file rather than in a <script> tag so that script-src can drop
// 'unsafe-inline'. That permission is what makes an injected `<img src=x onerror=...>`
// execute, and in a Tauri app execution reaches window.__TAURI__ and every command
// behind it. Nothing here changed; only where it lives.
//
// Loaded at the same position in <head> as the block it replaces, so it still runs
// after gsap.min.js -- and it polls for gsap anyway.

(function () {
    /* ─── wait for GSAP ─── */
    let _att = 0;
    function tryInit() {
        if (typeof gsap === 'undefined') { if (++_att < 80) setTimeout(tryInit, 50); return; }
        initLoader();
    }

    /* ─── grab BMM version from titlebar ─── */
    function getVersion() {
        return new Promise(resolve => {
            const check = () => {
                const btn = document.querySelector('.titlebar-version');
                resolve(btn ? btn.textContent.trim() : 'V1.0.0 — FAB');
            };
            if (document.readyState !== 'loading') check();
            else document.addEventListener('DOMContentLoaded', check);
        });
    }

    /* ─── split brand into char spans ─── */
    function buildBrand() {
        const wrap = document.getElementById('ld-brand');
        if (!wrap) return;
        [{ text: 'Better', cls: 'ld-w1' }, { text: 'Mod.Manager', cls: 'ld-w2' }].forEach(part => {
            const word = document.createElement('div');
            word.style.cssText = 'display:flex;align-items:baseline;overflow:visible;';
            [...part.text].forEach(ch => {
                const s = document.createElement('span');
                s.textContent = ch; s.className = 'ld-char ' + part.cls;
                word.appendChild(s);
            });
            wrap.appendChild(word);
        });
    }

    /* ─── main ─── */
    function initLoader() {
        buildBrand();
        getVersion().then(ver => {
            const el = document.getElementById('ld-ver');
            if (el) el.textContent = ver + '  —  FAB';
        });

        /* Wait 2 frames so brand layout is stable, then measure logo center */
        requestAnimationFrame(() => requestAnimationFrame(() => startAnimation()));
    }

    function startAnimation() {
        /* Fire boot sound — set pending flag so app.ts plays it if module loads later */
        if (window.__bmmPlayBootSound) {
            try { window.__bmmPlayBootSound(); } catch(_){}
        } else {
            window.__bmmBootSoundPending = true;
        }

        /* Compute logo center in screen coords → orb start positions */
        const wrap = document.getElementById('ld-logo-wrap');
        const rect = wrap ? wrap.getBoundingClientRect() : { left: 0, top: 0, width: 100, height: 100 };
        const lx = rect.left + rect.width / 2; // logo center X on screen
        const ly = rect.top + rect.height / 2; // logo center Y on screen
        const W = window.innerWidth, H = window.innerHeight;

        /* Orbs live INSIDE logo-wrap → x,y are relative to logo center */
        const orbDefs = [
            { id: 'ld-orb-0', sx: 30 - lx, sy: 30 - ly, r: 52, spd: 0.85, off: 0 },
            { id: 'ld-orb-1', sx: W - lx - 30, sy: H - ly - 30, r: 64, spd: -0.58, off: Math.PI * 0.65 },
            { id: 'ld-orb-2', sx: W - lx - 30, sy: 30 - ly, r: 56, spd: 0.42, off: Math.PI * 1.4 },
        ];
        orbDefs.forEach(d => gsap.set('#' + d.id, { x: d.sx, y: d.sy, opacity: 0 }));
        gsap.set('#ld-stage', { x: 0, y: 0 });

        const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
        /* Exposed so app.ts can kill the whole timeline when the loader is
           removed early (prevents "GSAP target not found" warnings). */
        window.__ldTimeline = tl;

        /* 0.0 — ambient bg glow */
        tl.to('#ld-bg-glow', { opacity: 1, duration: 1.2, ease: 'power2.out' }, 0);

        /* 0.15 — orbs fly from corners toward logo */
        orbDefs.forEach((d, i) => {
            tl.to('#' + d.id, { opacity: 1, duration: 0.12 }, 0.15 + i * 0.05);
            tl.to('#' + d.id, { x: 0, y: 0, duration: 0.52, ease: 'power3.in' }, 0.15 + i * 0.05);
        });

        /* 0.68 — IMPACT */
        tl.to('#ld-flash', { opacity: 1, duration: 0.04, yoyo: true, repeat: 1, ease: 'none' }, 0.68);
        tl.fromTo('#ld-wave',
            { opacity: 0.9, scale: 0 },
            { opacity: 0, scale: 40, duration: 0.7, ease: 'power2.out' },
            0.69);

        /* 0.71 — halo rings pop in then fade out */
        tl.fromTo('#ld-halo',
            { opacity: 0, scale: 0.6 },
            { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(2.5)' },
            0.71);
        tl.to('#ld-halo', { opacity: 0, scale: 1.5, duration: 0.55, ease: 'power2.in' }, 1.1);

        tl.fromTo('#ld-halo2',
            { opacity: 0, scale: 0.5 },
            { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(1.8)' },
            0.74);
        tl.to('#ld-halo2', { opacity: 0, scale: 1.8, duration: 0.6, ease: 'power2.in' }, 1.2);

        /* 0.72 — diffuse glow expands */
        tl.fromTo('#ld-logo-glow', { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.5 }, 0.72);

        /* 0.69 — logo opacity snaps on early so the spin is visible */
        tl.fromTo('#ld-logo',
            { opacity: 0, scale: 0.85, filter: 'brightness(4) blur(6px)', rotateY: 0, transformPerspective: 500 },
            { opacity: 1, duration: 0.12, ease: 'none' },
            0.69);
        /* spin + settle continues after opacity is already up */
        tl.to('#ld-logo',
            { scale: 1, filter: 'brightness(1) blur(0px)', rotateY: 720, transformPerspective: 500, duration: 0.65, ease: 'power2.out' },
            0.69);

        /* 0.78 — orbs begin orbiting */
        tl.call(() => startOrbit(orbDefs), null, 0.78);

        /* 1.0 — brand chars stagger in */
        tl.call(() => {
            /* Loader may already be gone on very fast boots — skip quietly
               instead of letting GSAP warn about missing targets. */
            if (!document.querySelector('.ld-char')) return;
            gsap.fromTo('.ld-char',
                { opacity: 0, y: 22, rotateX: -60, scale: 0.82 },
                {
                    opacity: 1, y: 0, rotateX: 0, scale: 1,
                    duration: 0.5, stagger: { each: 0.033, ease: 'power2.out' }, ease: 'back.out(2)'
                }
            );
        }, null, 1.0);

        /* 1.4 — version */
        tl.fromTo('#ld-ver', { opacity: 0, x: 6 }, { opacity: 1, x: 0, duration: 0.4 }, 1.4);

        /* 1.55 — progress */
        tl.to('#ld-prog', { opacity: 1, duration: 0.3 }, 1.55);
        tl.to('#ld-prog', { width: '100%', duration: 2.0, ease: 'power1.inOut' }, 1.6);

        /* ── continuous animations after settle ── */

        /* diffuse glow breathes */
        gsap.to('#ld-logo-glow', {
            scale: 1.2, opacity: 0.7, duration: 2.8,
            ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 1.35
        });

        /* logo bob */
        gsap.to('#ld-logo', {
            y: -4, duration: 2.2, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 1.0
        });

        /* periodic outward pulse ring */
        function doPulse() {
            if (!document.getElementById('app-loader')) return; // loader removed — stop
            gsap.fromTo('#ld-pulse',
                { scale: 0.95, opacity: 0.55 },
                {
                    scale: 2.6, opacity: 0, duration: 1.5, ease: 'power2.out',
                    onComplete: () => {
                        if (document.getElementById('app-loader')) gsap.delayedCall(1.8, doPulse);
                    }
                }
            );
        }
        gsap.delayedCall(1.4, doPulse);

        setupMouse();
        setupHover();
        setupClickRipple();
    }

    /* ─── elliptical orbit via ticker ─── */
    let _orbActive = false, _orbT0 = 0;
    function startOrbit(defs) {
        _orbActive = true; _orbT0 = gsap.ticker.time;
        const BLEND = 0.55; // seconds to grow radius from 0→full
        gsap.ticker.add(() => {
            if (!_orbActive) return;
            // Stop if loader was removed from DOM (prevents "target not found" warnings)
            if (!document.getElementById('app-loader')) { _orbActive = false; return; }
            const t = gsap.ticker.time - _orbT0;
            const blend = Math.min(t / BLEND, 1);
            const s = blend * blend * (3 - 2 * blend); // smoothstep
            defs.forEach(d => {
                const el = document.getElementById(d.id);
                if (!el) return;
                const a = d.off + t * d.spd;
                gsap.set(el, { x: Math.cos(a) * d.r * s, y: Math.sin(a) * d.r * 0.38 * s });
            });
        });
    }

    /* ─── mouse parallax (quickTo) ─── */
    function setupMouse() {
        const bx = gsap.quickTo('#ld-bg-glow', 'x', { duration: 1.0, ease: 'power2.out' });
        const by = gsap.quickTo('#ld-bg-glow', 'y', { duration: 1.0, ease: 'power2.out' });
        const sx = gsap.quickTo('#ld-stage', 'x', { duration: 0.7, ease: 'power2.out' });
        const sy = gsap.quickTo('#ld-stage', 'y', { duration: 0.7, ease: 'power2.out' });
        document.getElementById('app-loader').addEventListener('mousemove', e => {
            const dx = (e.clientX - innerWidth / 2) / (innerWidth / 2);
            const dy = (e.clientY - innerHeight / 2) / (innerHeight / 2);
            bx(dx * 90); by(dy * 90);
            sx(dx * 10); sy(dy * 10);
        });
    }

    /* ─── logo hover pulse ─── */
    function setupHover() {
        const w = document.getElementById('ld-logo-wrap');
        if (!w) return;
        w.addEventListener('mouseenter', () => gsap.to('#ld-logo', { scale: 1.1, duration: 0.3, ease: 'back.out(2)' }));
        w.addEventListener('mouseleave', () => gsap.to('#ld-logo', { scale: 1, duration: 0.5, ease: 'elastic.out(1,0.35)' }));
    }

    /* ─── click → ripple at cursor ─── */
    function setupClickRipple() {
        document.getElementById('app-loader').addEventListener('click', e => {
            const r = document.createElement('div');
            r.style.cssText = `position:absolute;left:${e.clientX}px;top:${e.clientY}px;
            width:6px;height:6px;margin:-3px;border-radius:50%;pointer-events:none;z-index:10;
            border:1.5px solid rgba(0,194,255,0.8);box-shadow:0 0 10px rgba(0,194,255,0.4);`;
            document.getElementById('app-loader').appendChild(r);
            gsap.fromTo(r,
                { opacity: 0.9, scale: 0 },
                { opacity: 0, scale: 18, duration: 0.55, ease: 'power2.out', onComplete: () => r.remove() }
            );
        });
    }

    tryInit();
})();
