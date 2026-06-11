// @ts-nocheck
/**
 * kofi-modal.ts — One-time "support the project on Ko-fi" reminder.
 *
 * Shown once, on a normal start (NOT during the first-run onboarding, which is
 * already busy with the language picker + Tutorial Hub). Deliberately styled
 * differently from the standard BMM modals: warm Ko-fi gradient, mascot, soft
 * card — so it reads as a friendly nudge, not a system dialog.
 *
 * Gated by localStorage `bmm_kofi_reminded` so it never nags twice.
 */
import { t } from '../core/i18n.js';

const KOFI_URL  = 'https://ko-fi.com/I2I31ZIPPG';
const SEEN_KEY  = 'bmm_kofi_reminded';

/** Show the reminder once, unless onboarding is currently running. */
export function maybeShowKofiReminder(): void {
    try {
        if (localStorage.getItem(SEEN_KEY) === '1') return;
        // Don't pile on top of the first-run onboarding overlay.
        if (document.getElementById('onboarding-overlay')) return;
        // Give the app a moment to settle visually.
        setTimeout(showKofiReminder, 1200);
    } catch { /* localStorage unavailable — skip silently */ }
}

export function showKofiReminder(): void {
    if (document.getElementById('kofi-overlay')) return;
    localStorage.setItem(SEEN_KEY, '1');
    injectStyles();

    const overlay = document.createElement('div');
    overlay.id = 'kofi-overlay';
    overlay.className = 'kofi-overlay';
    overlay.innerHTML = `
      <div class="kofi-card" role="dialog" aria-modal="true" aria-labelledby="kofi-title">
        <div class="kofi-glow"></div>
        <button class="kofi-close" id="kofi-close" aria-label="${t('common.close') || 'Close'}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>

        <div class="kofi-mascot">
          <img src="assets/Tasky_Happy.png" alt="Tasky" />
          <span class="kofi-heart">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M12 21s-7.5-4.9-10-9.2C.3 8.6 2 5 5.4 5c2 0 3.4 1.1 4.6 2.6C11.2 6.1 12.6 5 14.6 5 18 5 19.7 8.6 18 11.8 15.5 16.1 12 21 12 21z"/></svg>
          </span>
        </div>

        <h3 class="kofi-title" id="kofi-title">${t('kofi.title') || 'Enjoying Better Mods Manager?'}</h3>
        <p class="kofi-text">${t('kofi.text') || 'BMM is free and made on my own time. If it saves you some, a small tip on Ko-fi keeps the project alive and ad-free. No pressure — it stays 100% free either way. 💛'}</p>

        <div class="kofi-actions">
          <a class="kofi-btn-primary" href="${KOFI_URL}" target="_blank" rel="noopener noreferrer" id="kofi-go">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2 7h15a4 4 0 0 1 0 8h-1.1A6 6 0 0 1 10 19H7a5 5 0 0 1-5-5V7zm15 6a2 2 0 0 0 0-4h-1v4h1z"/></svg>
            <span>${t('kofi.support') || 'Support on Ko-fi'}</span>
          </a>
          <button class="kofi-btn-ghost" id="kofi-later">${t('kofi.later') || 'Maybe later'}</button>
        </div>
      </div>
    `;
    document.getElementById('app-window-outer')?.appendChild(overlay) || document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    const close = () => {
        overlay.classList.remove('open');
        overlay.classList.add('closing');
        overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
        setTimeout(() => overlay.remove(), 400);
    };
    overlay.querySelector('#kofi-close')?.addEventListener('click', close);
    overlay.querySelector('#kofi-later')?.addEventListener('click', close);
    overlay.querySelector('#kofi-go')?.addEventListener('click', () => setTimeout(close, 150));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

function injectStyles(): void {
    if (document.getElementById('kofi-modal-styles')) return;
    const s = document.createElement('style');
    s.id = 'kofi-modal-styles';
    s.textContent = `
    .kofi-overlay{position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;
      background:rgba(10,8,12,0.55);backdrop-filter:blur(6px);opacity:0;transition:opacity .3s ease}
    .kofi-overlay.open{opacity:1}
    .kofi-overlay.closing{opacity:0}
    .kofi-card{position:relative;width:min(420px,92vw);padding:34px 30px 26px;border-radius:22px;text-align:center;
      background:linear-gradient(160deg,#2a1d24 0%, var(--bg-elevated,#181420) 60%);
      border:1px solid rgba(255,107,74,0.35);
      box-shadow:0 24px 70px rgba(255,94,91,0.18),0 8px 30px rgba(0,0,0,0.5);
      transform:translateY(18px) scale(.96);opacity:0;transition:transform .35s cubic-bezier(.2,.9,.3,1.2),opacity .3s ease}
    .kofi-overlay.open .kofi-card{transform:translateY(0) scale(1);opacity:1}
    .kofi-glow{position:absolute;top:-40%;left:50%;width:280px;height:280px;transform:translateX(-50%);pointer-events:none;
      background:radial-gradient(circle,rgba(255,107,74,0.35),transparent 70%);filter:blur(10px)}
    .kofi-close{position:absolute;top:14px;right:14px;width:30px;height:30px;border-radius:9px;border:none;cursor:pointer;
      display:flex;align-items:center;justify-content:center;color:var(--text-muted,#9aa);background:rgba(255,255,255,0.06);transition:.15s}
    .kofi-close:hover{background:rgba(255,255,255,0.14);color:#fff}
    .kofi-mascot{position:relative;width:96px;height:96px;margin:4px auto 14px}
    .kofi-mascot img{width:96px;height:96px;object-fit:contain;filter:drop-shadow(0 6px 14px rgba(0,0,0,.4))}
    .kofi-heart{position:absolute;right:-6px;bottom:-2px;width:36px;height:36px;border-radius:50%;
      display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#ff6b4a,#ff5e5b);
      box-shadow:0 4px 12px rgba(255,94,91,0.5);animation:kofi-beat 1.4s ease-in-out infinite}
    @keyframes kofi-beat{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}
    .kofi-title{margin:0 0 8px;font-size:19px;font-weight:800;color:var(--text-primary,#fff)}
    .kofi-text{margin:0 0 22px;font-size:13.5px;line-height:1.6;color:var(--text-secondary,#c8c8d4)}
    .kofi-actions{display:flex;flex-direction:column;gap:10px}
    .kofi-btn-primary{display:flex;align-items:center;justify-content:center;gap:9px;text-decoration:none;
      padding:12px 18px;border-radius:13px;font-size:14px;font-weight:800;color:#fff;cursor:pointer;
      background:linear-gradient(135deg,#ff6b4a,#ff5e5b);box-shadow:0 8px 22px rgba(255,94,91,0.4);transition:.18s}
    .kofi-btn-primary:hover{transform:translateY(-2px);box-shadow:0 12px 28px rgba(255,94,91,0.55)}
    .kofi-btn-ghost{padding:9px;border:none;background:transparent;cursor:pointer;font-size:12.5px;
      color:var(--text-muted,#8a8a96);font-weight:600;transition:.15s}
    .kofi-btn-ghost:hover{color:var(--text-secondary,#c8c8d4)}
    `;
    document.head.appendChild(s);
}
