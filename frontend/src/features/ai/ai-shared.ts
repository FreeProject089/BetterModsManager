// ai-shared.ts — what the three AI surfaces (settings card, suggestion dialog, report check)
// share: the stylesheet, the words for sources and reasons, the settings round-trip, and the
// BetterCommunity credentials handed to Rust.
//
// No network here. Every provider call is a Tauri command that goes through the Rust gate
// (commands/ai_core.rs): with the master switch off, nothing leaves the machine, whatever this
// page asks for. That is on purpose — a rule enforced in the webview is a rule a page can skip.
import { invoke } from '../../core/api.js';
import { t } from '../../core/i18n.js';
import { bcRoot } from '../../core/links-config.js';
import type { AiSettings } from './ai-model.js';

export function ensureAiCss(): void {
    if (typeof document === 'undefined' || document.getElementById('ai-css')) return;
    const link = document.createElement('link');
    link.id = 'ai-css';
    link.rel = 'stylesheet';
    link.href = 'css/ai.css';
    document.head.appendChild(link);
}

export interface AiView { settings: AiSettings; status: any }

export async function loadAiView(): Promise<AiView | null> {
    try { return (await invoke('ai_get_settings')) as AiView; } catch { return null; }
}

/** Source badge words. Keys written out so the i18n gate can see every one of them. */
export function sourceLabel(src: string): string {
    switch (src) {
        case 'file': return t('ai.src.file');
        case 'folder': return t('ai.src.folder');
        case 'laya': return t('ai.src.laya');
        case 'embedded': return t('ai.src.embedded');
        case 'bettercommunity': return t('ai.src.bettercommunity');
        case 'api': return t('ai.src.api');
        default: return src;
    }
}

export function fieldLabel(f: string): string {
    switch (f) {
        case 'name': return t('ai.field.name');
        case 'version': return t('ai.field.version');
        case 'author': return t('ai.field.author');
        case 'description': return t('ai.field.description');
        case 'tags': return t('ai.field.tags');
        case 'links': return t('ai.field.links');
        case 'language': return t('ai.field.language');
        case 'nsfw': return t('ai.field.nsfw');
        default: return f;
    }
}

/** A Rust note ("bettercommunity:rate_limited", "classifier:ai_off", an `ai.url.*` key) in words. */
export function reasonText(note: string): string {
    const raw = String(note || '');
    // The built-in engine: "embedded:<reason>[:<detail>]".
    if (raw.startsWith('embedded:')) {
        const why = raw.split(':')[1] || '';
        const emb: Record<string, string> = {
            absent: t('ai.reason.embAbsent'),
            corrupt: t('ai.reason.embCorrupt'),
            not_published: t('ai.reason.embNotPublished'),
            hash_mismatch: t('ai.reason.embHash'),
            incomplete: t('ai.reason.embIncomplete'),
            runtime: t('ai.reason.embRuntime'),
            runtime_path: t('ai.reason.embRuntime'),
            in_use: t('ai.reason.embInUse'),
            busy: t('ai.reason.embInUse'),
            question_too_long: t('ai.reason.embTooLong'),
        };
        return `${t('ai.src.embedded')} — ${emb[why] || t('ai.reason.embFailed', { why })}`;
    }
    if (raw === 'cancelled') return t('ai.reason.cancelled');
    const reason = raw.includes(':') ? raw.slice(raw.lastIndexOf(':') + 1) : raw;
    const who = raw.includes(':') ? raw.slice(0, raw.indexOf(':')) : '';
    const whoLabel = who === 'bettercommunity' ? t('ai.src.bettercommunity') : who === 'laya' ? t('ai.src.laya') : who === 'api' || who === 'generative' ? t('ai.src.api') : '';
    const words: Record<string, string> = {
        ai_off: t('ai.reason.aiOff'),
        killed: t('ai.reason.killed'),
        feature_off: t('ai.reason.featureOff'),
        no_provider: t('ai.reason.noProvider'),
        no_consent: t('ai.reason.noConsent'),
        not_signed_in: t('ai.reason.notSignedIn'),
        disabled: t('ai.reason.disabled'),
        busy: t('ai.reason.busy'),
        rate_limited: t('ai.reason.rateLimited'),
        unavailable: t('ai.reason.unavailable'),
        unreachable: t('ai.reason.unreachable'),
        timeout: t('ai.reason.timeout'),
        insufficient: t('ai.reason.insufficient'),
        no_model: t('ai.reason.noModel'),
        bad_response: t('ai.reason.badResponse'),
        bad_json: t('ai.reason.badResponse'),
    };
    const url: Record<string, string> = {
        'ai.url.invalid': t('ai.url.invalid'),
        'ai.url.scheme': t('ai.url.scheme'),
        'ai.url.userinfo': t('ai.url.userinfo'),
        'ai.url.notLoopback': t('ai.url.notLoopback'),
        'ai.url.httpsRequired': t('ai.url.httpsRequired'),
        'ai.url.privateHost': t('ai.url.privateHost'),
        'ai.url.notBetterCommunity': t('ai.url.notBetterCommunity'),
    };
    const key = Object.keys(url).find((k) => raw.includes(k));
    const text = key ? url[key] : (words[reason] || (/^http_\d+$/.test(reason) ? t('ai.reason.http', { code: reason.slice(5) }) : reason));
    return whoLabel ? `${whoLabel} — ${text}` : text;
}

/**
 * Arguments for a command that may talk to BetterCommunity: the site root and this install's
 * creator proof. Only computed when BetterCommunity is the chosen provider — a proof is a
 * signature, and nobody needs one made for a request that will not happen. Rust re-checks the
 * base against bettercommunity.ch before attaching anything.
 */
export async function bcAuthArgs(settings: AiSettings | null | undefined): Promise<Record<string, unknown>> {
    if (!settings || settings.classifier !== 'bettercommunity') return {};
    const base = bcRoot();
    const headers: Record<string, string> = {};
    try {
        const id = String(await invoke('get_creator_id') || '');
        if (id && id !== '—') {
            headers['X-Creator-ID'] = id;
            const { creatorProofFor } = await import('../../core/canvas-fingerprint.js');
            const proof = await creatorProofFor(new URL(base).origin);
            if (proof) headers['X-Creator-Proof'] = proof;
        }
    } catch { /* anonymous: the server answers not_signed_in / disabled, which we show */ }
    return { bcBase: base, bcHeaders: headers };
}

/** Open the AI documentation page (bundled BMM Docs page, else the in-app article). */
export function openAiDocs(): void {
    const w = window as any;
    if (typeof w.openDocsPage === 'function') { w.openDocsPage('features/ai'); return; }
    if (typeof w.openDocsArticleById === 'function') { w.openDocsArticleById('ai-optional'); return; }
    (document.querySelector('.nav-item[data-view="docs"]') as HTMLElement | null)?.click();
}
