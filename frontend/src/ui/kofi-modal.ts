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
import { escHtml, escAttr } from '../core/utils.js';
import { isDialogOnScreen } from './dialog-traffic.js';

const OPTOUT_KEY = 'bmm_kofi_optout';
/**
 * "Maybe later" used to mean "ask me again in four hours, or whenever you next open BMM" —
 * which, for a dialog that shows on EVERY start, is not a later at all. The only way to stop
 * it was "never". A month is the middle option the two buttons were missing, and it is what
 * people already assume "later" means.
 */
const SNOOZE_KEY = 'bmm_kofi_snooze_until';
const SNOOZE_DAYS = 30;

/** One drawn cup, reused for every tier.
 *
 *  The tiers used to be ☕, ☕☕☕ and ☕☕☕☕☕ — repeated emoji standing in for an
 *  amount. Three problems, the same three the tutorial's emoji had: the glyph is
 *  whatever the platform's font decides, so the row looks different on every machine;
 *  it cannot take a colour from the theme; and counting cups is a worse way to read
 *  "3" than the numeral 3. One consistent cup, and the number does the talking. */
const CUP_SVG = '<svg class="kofi-cup" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8z"/><path d="M17 9h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M7 2.5c0 1-.8 1.3-.8 2.3M10.5 2.5c0 1-.8 1.3-.8 2.3M14 2.5c0 1-.8 1.3-.8 2.3"/></svg>';

function kofiUrl(): string {
    try { return getLinks().kofi || 'https://ko-fi.com/I2I31ZIPPG'; }
    catch { return 'https://ko-fi.com/I2I31ZIPPG'; }
}

/**
 * Does the reminder want to show this launch? The opt-out and the month-long snooze, and
 * nothing about timing — WHEN is the start-up queue's decision (ui/nudge-queue.ts), so this
 * can never land on top of another card.
 */
export function kofiWanted(): boolean {
    try {
        if (localStorage.getItem(OPTOUT_KEY) === '1') return false;
        const until = Number(localStorage.getItem(SNOOZE_KEY) || 0);
        // NaN and a clock moved backwards both land here as "not snoozed", which is the safe
        // way round: a corrupt value shows the reminder rather than silencing it forever.
        return !(until > Date.now());
    } catch { return false; }
}

/** Show the reminder on each start, unless the user opted out or onboarding is up. */
export function maybeShowKofiReminder(): void {
    try {
        if (!kofiWanted()) return;
        // Don't pile on top of anything already on screen — not just onboarding, which is
        // all this used to look for. Checked again when the timer fires, because 1200 ms is
        // long enough for a dialog to open in the gap.
        if (isDialogOnScreen()) return;
        // Give the app a moment to settle visually.
        setTimeout(() => { if (!isDialogOnScreen()) showKofiReminder(); }, 1200);
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

        <div class="kofi-top">
        <div class="kofi-mascot">
          <img src="assets/Tasky_Happy.png" alt="Tasky" />
          <span class="kofi-heart">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M12 21s-7.5-4.9-10-9.2C.3 8.6 2 5 5.4 5c2 0 3.4 1.1 4.6 2.6C11.2 6.1 12.6 5 14.6 5 18 5 19.7 8.6 18 11.8 15.5 16.1 12 21 12 21z"/></svg>
          </span>
        </div>

        <div class="kofi-say">
          <h3 class="kofi-title" id="kofi-title">${escHtml(t('kofi.title') || 'Enjoying Better Mods Manager?')}</h3>
          <p class="kofi-text">${escHtml(t('kofi.text2') || 'Free, ad-free, no account — and built on my own time. If it saves you some, a coffee keeps it going.')}</p>
          <div class="kofi-badge">${escHtml(t('kofi.freeBadge') || '100% free · No ads · No account')}</div>
        </div>
        </div>

        <div class="kofi-actions">
          <a class="kofi-btn-primary" href="${KOFI_URL}" target="_blank" rel="noopener noreferrer" id="kofi-go">
            ${CUP_SVG}
            <span>${escHtml(t('kofi.support') || 'Support on Ko-fi')}</span>
          </a>
          <div class="kofi-anchor">${escHtml(t('kofi.anchor') || 'Any amount. Nothing is locked behind it — there is no paid version.')}</div>
          <div class="kofi-secondary-row">
            <button class="kofi-btn-ghost" id="kofi-later" title="${escAttr(t('kofi.snoozeHint') || 'Hides this for a month.')}">${escHtml(t('kofi.later') || 'Maybe later')}</button>
            <span class="kofi-dot" aria-hidden="true">·</span>
            <button class="kofi-btn-ghost kofi-btn-optout" id="kofi-optout">${escHtml(t('kofi.dontShow') || "Don't show again")}</button>
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
    // The X is a dismissal, not an answer: it closes and changes nothing, so the reminder is
    // back next launch. "Maybe later" is the answer — it buys a month.
    overlay.querySelector('#kofi-close')?.addEventListener('click', close);
    overlay.querySelector('#kofi-later')?.addEventListener('click', () => {
        try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86400_000)); } catch { /* private mode: it just asks again */ }
        close();
    });
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
      /* A scrim must DIM what is behind it, so it stays dark in every theme. Deriving it from
         --bmm-surface-* made it white on the light themes — the one modal in the app that did. */
      background:rgba(0,0,0,0.7);
      backdrop-filter:blur(8px);opacity:0;transition:opacity .3s ease}
    .kofi-overlay.open{opacity:1}
    .kofi-overlay.closing{opacity:0}
    /* The card reads left-to-right now: mascot beside the words, then ONE button.
       It used to be a 520px-tall centred column — mascot, four centred lines of prose, three
       amount chips, a hint about the chips, and a button that did exactly what the chips did.
       The chips were the worst of it: 1 / 3 / 5 with a "Popular" badge, all three linking to
       the same plain Ko-fi page. No amount is passed anywhere, so picking 5 and picking 1 led
       to the identical screen — a choice that isn't one. Removed rather than faked. */
    .kofi-card{position:relative;width:min(480px,92vw);padding:30px 28px 22px;border-radius:22px;overflow:hidden;
      background:linear-gradient(160deg, color-mix(in srgb, var(--kofi-brand) 12%, var(--bmm-bg-elevated)) 0%, var(--bmm-bg-elevated) 60%);
      border:1px solid rgba(255,107,74,0.22);
      box-shadow:0 18px 50px rgba(0,0,0,0.5),0 4px 14px rgba(0,0,0,0.35),0 0 0 1px rgba(255,255,255,0.04) inset;
      transform:translateY(18px) scale(.96);opacity:0;transition:transform .35s cubic-bezier(.2,.9,.3,1.2),opacity .3s ease}
    /* A thin warm rule across the very top edge — signals the Ko-fi brand without shouting. */
    .kofi-card::before{content:"";position:absolute;top:0;left:0;right:0;height:3px;
      background:linear-gradient(90deg,transparent,var(--kofi-brand),var(--kofi-brand-2),transparent);opacity:.85}
    .kofi-overlay.open .kofi-card{transform:translateY(0) scale(1);opacity:1}
    .kofi-glow{position:absolute;top:-40%;left:50%;width:280px;height:280px;transform:translateX(-50%);pointer-events:none;
      background:radial-gradient(circle,rgba(255,107,74,0.16),transparent 68%);filter:blur(14px)}
    @media (prefers-reduced-motion: reduce){.kofi-heart{animation:none}.kofi-card{transition:opacity .2s ease}}
    .kofi-close{position:absolute;top:14px;right:14px;width:30px;height:30px;border-radius:9px;border:none;cursor:pointer;
      display:flex;align-items:center;justify-content:center;color:var(--bmm-text-muted);background:var(--bmm-s05);transition:.15s}
    .kofi-close:hover{background:var(--bmm-s10);color:var(--bmm-text-primary)}
    /* Mascot beside the text, not stacked above it: a 96px picture on its own line pushed
       every word below the fold of the eye. 72px next to the title carries the same warmth
       in a third of the height. */
    .kofi-top{display:flex;align-items:flex-start;gap:16px;margin-bottom:18px}
    .kofi-mascot{position:relative;width:72px;height:72px;flex:0 0 auto;margin-top:2px}
    .kofi-mascot img{width:72px;height:72px;object-fit:contain;filter:drop-shadow(0 6px 14px rgba(0,0,0,.4))}
    .kofi-heart{position:absolute;right:-4px;bottom:0;width:30px;height:30px;border-radius:50%;
      display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#ff6b4a,#ff5e5b);
      box-shadow:0 3px 8px rgba(255,94,91,0.35);animation:kofi-beat 1.4s ease-in-out infinite}
    .kofi-heart svg{width:17px;height:17px}
    @keyframes kofi-beat{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}
    .kofi-say{min-width:0;flex:1}
    /* Left-aligned. Four lines of centred prose is a poster, not something you read. */
    .kofi-title{margin:0 0 7px;font-size:18px;font-weight:800;line-height:1.25;color:var(--bmm-text-primary)}
    .kofi-text{margin:0 0 10px;font-size:13px;line-height:1.55;color:var(--bmm-text-secondary)}
    /* The promise, as a chip rather than another clause in the paragraph. */
    .kofi-badge{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.02em;
      padding:4px 9px;border-radius:999px;color:var(--kofi-brand);
      background:color-mix(in srgb,var(--kofi-brand) 12%,transparent);
      border:1px solid color-mix(in srgb,var(--kofi-brand) 28%,transparent)}
    .kofi-actions{display:flex;flex-direction:column;gap:8px}
    .kofi-btn-primary{display:flex;align-items:center;justify-content:center;gap:9px;text-decoration:none;
      padding:13px 18px;border-radius:13px;font-size:14px;font-weight:800;color:var(--kofi-on-brand);cursor:pointer;
      background:linear-gradient(135deg,#ff6b4a,#ff5e5b);box-shadow:0 6px 16px rgba(255,94,91,0.28);transition:.18s}
    .kofi-btn-primary .kofi-cup{width:19px;height:19px;color:currentColor}
    .kofi-btn-primary:hover{transform:translateY(-1px);box-shadow:0 8px 20px rgba(255,94,91,0.36)}
    /* Says what the button will and won't do, in place of three chips that said neither. */
    .kofi-anchor{text-align:center;font-size:11px;line-height:1.45;color:var(--bmm-text-muted)}
    .kofi-secondary-row{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:2px}
    .kofi-dot{color:var(--bmm-text-muted);opacity:.5;font-size:11px}
    /* "Later" and "never" are not the same size of decision, and now they do not look it. */
    .kofi-btn-optout{opacity:0.65;font-size:11px}
    .kofi-btn-optout:hover{opacity:1;text-decoration:underline}
    .kofi-btn-ghost{padding:8px 6px;border:none;background:transparent;cursor:pointer;font-size:12.5px;
      color:var(--bmm-text-muted);font-weight:600;transition:.15s}
    .kofi-btn-ghost:hover{color:var(--bmm-text-secondary)}
    `;
    document.head.appendChild(s);
}
