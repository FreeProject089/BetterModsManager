/**
 * kit.ts — tiny, dependency-free UI helper layer.
 *
 * BMM builds its UI with template strings + manual DOM. It's too late to adopt a
 * framework, so this module standardizes the small patterns we keep hand-rolling
 * (buttons, badges, cards, form rows, meta lines) so every *new* or *edited*
 * screen inherits the 4-pt spacing grid, the semantic colours and the
 * default/hover/disabled/loading states for free — without a big-bang rewrite.
 *
 * Everything returns a `TrustedHtml` (from core/utils) so factories compose:
 *   el.innerHTML = safeHtml`${button({ label: name })}`;   // safe context
 *   el.innerHTML = `${button({ label: name })}`;            // plain literal (toString)
 * Dynamic text passed into a factory is auto-escaped; SVG icons are passed as
 * `trustedHtml(...)` so they're emitted verbatim.
 *
 * Styling lives in css/kit.css and consumes the design tokens (--space-*,
 * --bmm-info/-success/-warning/-danger/-accent + -dim, --bmm-text-*).
 */
import { escHtml, escAttr, safeHtml, trustedHtml, TrustedHtml } from '../core/utils.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
export type Size = 'xs' | 'sm' | 'md';
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';

type AttrVal = string | number | boolean | undefined | null;
type Attrs = Record<string, AttrVal>;

/** Serialize an attribute record → a trusted ` k="v"` string (keys + values
 *  escaped). `true` → boolean attribute; `false`/`null`/`undefined` → skipped. */
function attrs(a?: Attrs): TrustedHtml {
    if (!a) return trustedHtml('');
    const parts: string[] = [];
    for (const [k, v] of Object.entries(a)) {
        if (v === undefined || v === null || v === false) continue;
        if (v === true) { parts.push(escAttr(k)); continue; }
        parts.push(`${escAttr(k)}="${escAttr(String(v))}"`);
    }
    return trustedHtml(parts.length ? ' ' + parts.join(' ') : '');
}

/** Coerce a factory input (trusted markup or plain text) into safe markup. */
function frag(v: TrustedHtml | string | undefined | null): TrustedHtml {
    if (v == null) return trustedHtml('');
    return v instanceof TrustedHtml ? v : trustedHtml(escHtml(String(v)));
}

/** Inline loading spinner — reuses the app-wide `spin` keyframe. */
export function spinner(size = 14): TrustedHtml {
    return trustedHtml(
        `<svg class="kit-spin" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
        `stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>`,
    );
}

export interface ButtonOpts {
    label: string;
    variant?: ButtonVariant;   // default 'secondary'
    size?: Size;               // default 'md'
    icon?: TrustedHtml | string; // trusted SVG markup, or plain text
    disabled?: boolean;
    loading?: boolean;         // shows a spinner + disables
    type?: 'button' | 'submit';
    id?: string;
    class?: string;
    attrs?: Attrs;             // extra attributes, e.g. { 'data-act': 'save' }
}

/** A button with consistent variant/size/state styling (uses the existing .btn
 *  classes so it matches the rest of the app). */
export function button(o: ButtonOpts): TrustedHtml {
    const cls = ['btn', `btn-${o.variant || 'secondary'}`];
    if (o.size && o.size !== 'md') cls.push(`btn-${o.size}`);
    if (o.class) cls.push(o.class);
    const icon: TrustedHtml | '' = o.loading
        ? spinner(o.size === 'xs' ? 12 : 14)
        : o.icon != null ? frag(o.icon) : '';
    return trustedHtml(safeHtml`<button type="${o.type || 'button'}" class="${trustedHtml(cls.join(' '))}"${
        o.id ? trustedHtml(` id="${escAttr(o.id)}"`) : ''
    }${o.disabled || o.loading ? trustedHtml(' disabled') : ''}${attrs(o.attrs)}>${icon}<span>${o.label}</span></button>`);
}

/** A small semantic pill. `tone` maps to the semantic colour tokens. */
export function badge(label: string, tone: Tone = 'neutral', opts?: { icon?: TrustedHtml }): TrustedHtml {
    return trustedHtml(
        safeHtml`<span class="${trustedHtml('kit-badge kit-badge-' + tone)}">${opts?.icon ?? ''}${label}</span>`,
    );
}

export interface CardOpts {
    body: TrustedHtml | string;
    title?: string;
    class?: string;
    attrs?: Attrs;
}

/** A padded surface on the 4-pt grid (theme-aware). */
export function card(o: CardOpts): TrustedHtml {
    return trustedHtml(safeHtml`<div class="${trustedHtml('kit-card' + (o.class ? ' ' + o.class : ''))}"${attrs(o.attrs)}>${
        o.title ? trustedHtml(safeHtml`<div class="kit-card-title">${o.title}</div>`) : ''
    }${frag(o.body)}</div>`);
}

export interface FieldOpts {
    label: string;
    input: TrustedHtml | string;   // the control markup (trusted)
    hint?: string;
    htmlFor?: string;
}

/** A labelled form row (label → control → optional hint). */
export function field(o: FieldOpts): TrustedHtml {
    return trustedHtml(safeHtml`<div class="kit-field"><label class="kit-field-label"${
        o.htmlFor ? trustedHtml(` for="${escAttr(o.htmlFor)}"`) : ''
    }>${o.label}</label>${frag(o.input)}${
        o.hint ? trustedHtml(safeHtml`<span class="kit-field-hint">${o.hint}</span>`) : ''
    }</div>`);
}

/** A muted, dot-separated meta line (e.g. category · version · size). Falsy
 *  items are dropped so callers can inline conditionals. */
export function meta(items: (TrustedHtml | string | undefined | null | false)[]): TrustedHtml {
    const parts = items
        .filter((x): x is TrustedHtml | string => Boolean(x))
        .map(x => (x instanceof TrustedHtml ? x.value : escHtml(String(x))));
    return trustedHtml(`<div class="kit-meta">${parts.join('<span class="kit-meta-sep">·</span>')}</div>`);
}

// ── Imperative DOM factory (for code that builds nodes, not strings) ───────────

export interface ElProps {
    class?: string;
    text?: string;                       // textContent (safe)
    html?: TrustedHtml;                  // innerHTML (trusted only)
    attrs?: Attrs;
    on?: Record<string, EventListener>;  // event listeners
    style?: Partial<CSSStyleDeclaration>;
}

/** Create an element with props/attrs/listeners/children in one call. */
export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    props: ElProps = {},
    ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (props.class) node.className = props.class;
    if (props.text != null) node.textContent = props.text;
    if (props.html) node.innerHTML = props.html.value;
    if (props.attrs) {
        for (const [k, v] of Object.entries(props.attrs)) {
            if (v === undefined || v === null || v === false) continue;
            node.setAttribute(k, v === true ? '' : String(v));
        }
    }
    if (props.style) Object.assign(node.style, props.style);
    if (props.on) for (const [ev, fn] of Object.entries(props.on)) node.addEventListener(ev, fn);
    for (const c of children) node.append(c);
    return node;
}
