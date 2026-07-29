// @ts-nocheck
/**
 * kofi-modal.ts — "support the project on Ko-fi" reminder.
 *
 * Shown on EVERY start (after onboarding), unless the user explicitly opted out
 * via "Don't show again". Deliberately styled differently from the standard BMM
 * modals: warm Ko-fi gradient, mascot, soft card — a friendly nudge, not a dialog.
 *
 *   • "Maybe later"        → just closes; shows again next launch.
 *   • "Don't show again"   → sets localStorage `bmm_kofi_optout` so it never shows.
 */
import { t } from '../core/i18n.js';
import { getLinks } from '../core/links-config.js';

const OPTOUT_KEY = 'bmm_kofi_optout';

function kofiUrl(): string {
    try { return getLinks().kofi || 'https://ko-fi.com/I2I31ZIPPG'; }
    catch { return 'https://ko-fi.com/I2I31ZIPPG'; }
}

/** Show the reminder on each start, unless the user opted out or onboarding is up. */
export function maybeShowKofiReminder(): void {
    try {
        if (localStorage.getItem(OPTOUT_KEY) === '1') return;
        // Don't pile on top of the first-run onboarding overlay.
        if (document.getElementById('onboarding-overlay')) return;
        // Give the app a moment to settle visually.
        setTimeout(showKofiReminder, 1200);
    } catch { /* localStorage unavailable — skip silently */ }
}

export function showKofiReminder(): void {
    if (document.getElementById('kofi-overlay')) return;
    injectStyles();
    const KOFI_URL = kofiUrl();

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
          <div class="kofi-tiers" role="group">
            <a class="kofi-tier" href="${KOFI_URL}" target="_blank" rel="noopener noreferrer" data-kofi-go><span class="kofi-tier-amt">☕</span><span class="kofi-tier-lbl">1</span></a>
            <a class="kofi-tier kofi-tier--pop" href="${KOFI_URL}" target="_blank" rel="noopener noreferrer" data-kofi-go><span class="kofi-pop">${t('kofi.popular') || 'Popular'}</span><span class="kofi-tier-amt">☕☕☕</span><span class="kofi-tier-lbl">3</span></a>
            <a class="kofi-tier" href="${KOFI_URL}" target="_blank" rel="noopener noreferrer" data-kofi-go><span class="kofi-tier-amt">☕☕☕☕☕</span><span class="kofi-tier-lbl">5</span></a>
          </div>
          <div class="kofi-tier-hint">${t('kofi.tierHint') || 'Pick an amount — it opens Ko-fi.'}</div>
          <a class="kofi-btn-primary" href="${KOFI_URL}" target="_blank" rel="noopener noreferrer" id="kofi-go">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2 7h15a4 4 0 0 1 0 8h-1.1A6 6 0 0 1 10 19H7a5 5 0 0 1-5-5V7zm15 6a2 2 0 0 0 0-4h-1v4h1z"/></svg>
            <span>${t('kofi.support') || 'Support on Ko-fi'}</span>
          </a>
          <div class="kofi-secondary-row">
            <button class="kofi-btn-ghost" id="kofi-later">${t('kofi.later') || 'Maybe later'}</button>
            <button class="kofi-btn-ghost kofi-btn-optout" id="kofi-optout">${t('kofi.dontShow') || "Don't show again"}</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('app-window-outer')?.appendChild(overlay) || document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    // Escape must dismiss it: the card declares role="dialog" aria-modal="true", so without
    // a key handler a keyboard user was stuck behind an overlay they couldn't close.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    const close = () => {
        document.removeEventListener('keydown', onKey, true);
        overlay.classList.remove('open');
        overlay.classList.add('closing');
        overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
        setTimeout(() => overlay.remove(), 400);
    };
    document.addEventListener('keydown', onKey, true);
    // "Maybe later" / X → close, will show again next launch.
    overlay.querySelector('#kofi-close')?.addEventListener('click', close);
    overlay.querySelector('#kofi-later')?.addEventListener('click', close);
    // "Don't show again" → persist opt-out so it never reappears.
    overlay.querySelector('#kofi-optout')?.addEventListener('click', () => {
        try { localStorage.setItem(OPTOUT_KEY, '1'); } catch {}
        close();
    });
    // Both the main button and the amount chips open Ko-fi, then close the reminder.
    overlay.querySelectorAll('#kofi-go, [data-kofi-go]').forEach((el) => el.addEventListener('click', () => setTimeout(close, 150)));
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    // Focus lands inside the dialog so the first Tab stays in it rather than walking the app.
    (overlay.querySelector('#kofi-close') as HTMLElement | null)?.focus();
}

function injectStyles(): void {
    if (document.getElementById('kofi-modal-styles')) return;
    const s = document.createElement('style');
    s.id = 'kofi-modal-styles';
    s.textContent = `
    .kofi-overlay{position:fixed;inset:0;z-index:10050;display:flex;align-items:center;justify-content:center;
      --kofi-brand:#ff6b4a;--kofi-brand-2:#ff5e5b;--kofi-on-brand:#fff;
      background:rgba(var(--bmm-surface-r),var(--bmm-surface-g),var(--bmm-surface-b),0.55);
      backdrop-filter:blur(6px);opacity:0;transition:opacity .3s ease}
    .kofi-overlay.open{opacity:1}
    .kofi-overlay.closing{opacity:0}
    .kofi-card{position:relative;width:min(420px,92vw);padding:34px 30px 26px;border-radius:22px;text-align:center;overflow:hidden;
      background:linear-gradient(160deg, color-mix(in srgb, var(--kofi-brand) 12%, var(--bmm-bg-elevated)) 0%, var(--bmm-bg-elevated) 60%);
      border:1px solid rgba(255,107,74,0.35);
      box-shadow:0 24px 70px rgba(255,94,91,0.18),0 8px 30px rgba(0,0,0,0.5);
      transform:translateY(18px) scale(.96);opacity:0;transition:transform .35s cubic-bezier(.2,.9,.3,1.2),opacity .3s ease}
    .kofi-overlay.open .kofi-card{transform:translateY(0) scale(1);opacity:1}
    .kofi-glow{position:absolute;top:-40%;left:50%;width:280px;height:280px;transform:translateX(-50%);pointer-events:none;
      background:radial-gradient(circle,rgba(255,107,74,0.35),transparent 70%);filter:blur(10px)}
    @media (prefers-reduced-motion: reduce){.kofi-heart{animation:none}.kofi-card{transition:opacity .2s ease}}
    .kofi-close{position:absolute;top:14px;right:14px;width:30px;height:30px;border-radius:9px;border:none;cursor:pointer;
      display:flex;align-items:center;justify-content:center;color:var(--bmm-text-muted);background:var(--bmm-s05);transition:.15s}
    .kofi-close:hover{background:var(--bmm-s10);color:var(--bmm-text-primary)}
    .kofi-mascot{position:relative;width:96px;height:96px;margin:4px auto 14px}
    .kofi-mascot img{width:96px;height:96px;object-fit:contain;filter:drop-shadow(0 6px 14px rgba(0,0,0,.4))}
    .kofi-heart{position:absolute;right:-6px;bottom:-2px;width:36px;height:36px;border-radius:50%;
      display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#ff6b4a,#ff5e5b);
      box-shadow:0 4px 12px rgba(255,94,91,0.5);animation:kofi-beat 1.4s ease-in-out infinite}
    @keyframes kofi-beat{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}
    .kofi-title{margin:0 0 8px;font-size:19px;font-weight:800;color:var(--bmm-text-primary)}
    .kofi-text{margin:0 0 22px;font-size:13.5px;line-height:1.6;color:var(--bmm-text-secondary)}
    .kofi-actions{display:flex;flex-direction:column;gap:10px}
    /* Anchored amount chips: the middle "popular" tier sits larger + highlighted so it
       becomes the mental reference point (contrast/anchoring). All open Ko-fi. */
    .kofi-tiers{display:flex;align-items:flex-end;justify-content:center;gap:10px;margin-bottom:2px}
    .kofi-tier{position:relative;display:flex;flex-direction:column;align-items:center;gap:3px;text-decoration:none;cursor:pointer;
      padding:10px 12px;min-width:64px;border-radius:13px;color:var(--bmm-text-secondary);
      border:1px solid var(--bmm-s10);background:var(--bmm-s05);transition:.16s}
    .kofi-tier:hover{transform:translateY(-2px);border-color:rgba(255,107,74,0.5);color:var(--bmm-text-primary)}
    .kofi-tier-amt{font-size:13px;line-height:1;letter-spacing:-1px}
    .kofi-tier-lbl{font-size:15px;font-weight:800;color:var(--bmm-text-primary)}
    .kofi-tier--pop{padding:14px 14px 12px;border-color:rgba(255,107,74,0.55);
      background:linear-gradient(160deg,rgba(255,107,74,0.16),rgba(255,94,91,0.06));box-shadow:0 6px 18px rgba(255,94,91,0.2)}
    .kofi-tier--pop .kofi-tier-amt{font-size:15px}
    .kofi-tier--pop .kofi-tier-lbl{font-size:18px}
    .kofi-pop{position:absolute;top:-9px;left:50%;transform:translateX(-50%);white-space:nowrap;
      font-size:9px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;padding:2px 7px;border-radius:999px;color:var(--kofi-on-brand);
      background:linear-gradient(135deg,#ff6b4a,#ff5e5b);box-shadow:0 3px 8px rgba(255,94,91,0.45)}
    .kofi-tier-hint{font-size:11px;color:var(--bmm-text-muted);margin:-2px 0 6px}
    .kofi-secondary-row{display:flex;align-items:center;justify-content:center;gap:14px;margin-top:2px}
    .kofi-btn-optout{opacity:0.7;font-size:11.5px}
    .kofi-btn-optout:hover{opacity:1;text-decoration:underline}
    .kofi-btn-primary{display:flex;align-items:center;justify-content:center;gap:9px;text-decoration:none;
      padding:12px 18px;border-radius:13px;font-size:14px;font-weight:800;color:var(--kofi-on-brand);cursor:pointer;
      background:linear-gradient(135deg,#ff6b4a,#ff5e5b);box-shadow:0 8px 22px rgba(255,94,91,0.4);transition:.18s}
    .kofi-btn-primary:hover{transform:translateY(-2px);box-shadow:0 12px 28px rgba(255,94,91,0.55)}
    .kofi-btn-ghost{padding:9px;border:none;background:transparent;cursor:pointer;font-size:12.5px;
      color:var(--bmm-text-muted);font-weight:600;transition:.15s}
    .kofi-btn-ghost:hover{color:var(--bmm-text-secondary)}
    `;
    document.head.appendChild(s);
}
