// mod-drawer-view.ts — the markup of a mod's details, as a side drawer beside the library.
//
// It was a panel opened INSIDE the mod's card: the card grew to the height of five folded
// sections, the list under it jumped down, the virtual list (fixed row heights) lost track of
// where its rows were, and every field — name, hashes, content id, links — was an open input in
// one long column. Now the library stays where it is and the mod opens beside it:
//
//   header   name, version · author · state, and the three things you do to a mod (enable or
//            disable it, check for an update, open its folder), with ‹ › to the next mod and ×
//   tabs     Overview (the description, rendered) · Details (the editable fields) · Files
//            (integrity, content id, the list) · Conflicts & order · Updates & links
//   footer   Save / Cancel, shown where editing happens and whenever something is unsaved
//
// Markup only: mods-details.ts mounts it and wires every control. The ids the tutorial and the
// rest of the app look for (detail-name, btn-save-detail, btn-browse-archive…) are kept.

import { t } from '../../core/i18n.js';
import { actAttrs, actAttrsStop } from '../../core/inline-actions.js';
import { escHtml, escAttr, escJs } from '../../core/utils.js';
import { uiIcon } from '../../ui/icons.js';

export type DrawerTab = 'overview' | 'details' | 'files' | 'conflicts' | 'updates';
export const DRAWER_TABS: DrawerTab[] = ['overview', 'details', 'files', 'conflicts', 'updates'];
const TAB_KEY: Record<DrawerTab, string> = {
    overview: 'mdd.tab.overview', details: 'mdd.tab.details', files: 'mdd.tab.files',
    conflicts: 'mdd.tab.conflicts', updates: 'mdd.tab.updates',
};

export interface DrawerCtx {
    links: Array<{ url: string; link_type?: string; label?: string }>;
    repoLink: string | null;
    origin: string;
    hasPrev: boolean;
    hasNext: boolean;
}

/** The header: identity, state and the primary actions. Re-drawn on its own after a toggle. */
export function drawerHeaderHtml(mod: any, ctx: DrawerCtx): string {
    const on = !!mod.enabled;
    const meta = [
        `<span class="mdd-ver">v${escHtml(mod.version || '?')}</span>`,
        mod.author ? `<span>${escHtml(mod.author)}</span>` : '',
        `<span class="mdd-state ${on ? 'is-on' : 'is-off'}" data-tasky="${escAttr(mod.mod_folder_path || '')}" data-tasky-icon="folder" data-tasky-literal="1">${escHtml(t(on ? 'mdd.stateOn' : 'mdd.stateOff'))}</span>`,
    ].filter(Boolean).join('<span class="mdd-dot" aria-hidden="true">·</span>');
    return `
      <div class="mdd-top">
        <div class="mdd-icon" aria-hidden="true">${uiIcon('package', 20)}</div>
        <div class="mdd-id">
          <h2 class="mdd-name" id="mdd-title" data-tasky="${escAttr(escJs(mod.name))}" data-tasky-icon="package" data-tasky-literal="1">${escHtml(mod.name)}</h2>
          <div class="mdd-meta">${meta}</div>
        </div>
        <div class="mdd-nav">
          <button type="button" class="mdd-icon-btn" id="btn-detail-prev" aria-label="${escAttr(t('mdd.prev'))}" data-tooltip="${escAttr(t('mdd.prev'))}"${ctx.hasPrev ? '' : ' disabled'}>${uiIcon('chevron-up', 16)}</button>
          <button type="button" class="mdd-icon-btn" id="btn-detail-next" aria-label="${escAttr(t('mdd.next'))}" data-tooltip="${escAttr(t('mdd.next'))}"${ctx.hasNext ? '' : ' disabled'}>${uiIcon('chevron-down', 16)}</button>
          <button type="button" class="mdd-icon-btn" id="btn-close-detail-inner" aria-label="${escAttr(t('mdd.close'))}" data-tooltip="${escAttr(t('mdd.closeTip'))}">${uiIcon('close', 16)}</button>
        </div>
      </div>
      <div class="mdd-actions">
        <button type="button" class="btn btn-sm ${on ? 'btn-secondary' : 'btn-primary'}" id="btn-detail-toggle">${uiIcon('power', 14)}<span>${escHtml(t(on ? 'mdd.disable' : 'mdd.enable'))}</span></button>
        <button type="button" class="btn btn-sm btn-secondary" ${actAttrsStop('bmmMenuCheckModUpdate', mod.id)}>${uiIcon('refresh', 14)}<span>${escHtml(t('mod.checkUpdate'))}</span></button>
        <button type="button" class="btn btn-sm btn-secondary" id="btn-detail-folder">${uiIcon('open-folder', 14)}<span>${escHtml(t('mdd.openFolder'))}</span></button>
      </div>`;
}

function tabsHtml(active: DrawerTab): string {
    return `<div class="mdd-tabs" role="tablist" aria-label="${escAttr(t('mdd.tabsLabel'))}">${DRAWER_TABS.map((k) => `
        <button type="button" class="mdd-tab" role="tab" id="mdd-tab-${k}" data-tab="${k}" aria-controls="mdd-pane-${k}" aria-selected="${k === active}" tabindex="${k === active ? 0 : -1}">${escHtml(t(TAB_KEY[k]))}${k === 'conflicts' ? '<span class="mdd-tab-n conflict-badge-container"></span>' : ''}</button>`).join('')}
      </div>`;
}

/** Overview: what the mod is. Read-only; the description is filled by mods-details.ts (B.MD). */
export function overviewHtml(mod: any, ctx: DrawerCtx): string {
    const files = (mod.installed_files || []).length;
    return `
      <div class="mdd-desc md-body" id="mdd-desc-view"></div>
      <dl class="mdd-facts">
        <dt>${escHtml(t('detail.origin'))}</dt><dd>${escHtml(ctx.origin)}</dd>
        <dt>${escHtml(t('detail.author'))}</dt><dd>${mod.author ? escHtml(mod.author) : `<span class="mdd-muted">${escHtml(t('mdd.none'))}</span>`}</dd>
        <dt>${escHtml(t('mdd.tab.files'))}</dt><dd>${escHtml(t('mod.filesCount', { count: String(files) }))}</dd>
        <dt>${escHtml(t('detail.tags'))}</dt><dd class="mdd-chips" id="mdd-tags-view"></dd>
        <dt>${escHtml(t('mdd.requires'))}</dt><dd class="mdd-chips" id="mdd-deps-view"></dd>
      </dl>
      <button type="button" class="btn btn-ghost btn-sm mdd-goto" data-goto="details">${uiIcon('edit', 14)}<span>${escHtml(t('mdd.editDetails'))}</span></button>`;
}

/** Details: the editable fields. Every change shows the Save / Cancel bar. */
export function detailsHtml(mod: any): string {
    // Literal ids: the tutorial points at them (check-tutorial reads the markup).
    const label = (forId: string, key: string, counter = '') =>
        `<label class="mdd-label" for="${forId}"><span>${escHtml(t(key))}</span>${counter}</label>`;
    const count = (id: string, max: number) => `<span class="mdd-count" id="${id}">0/${max}</span>`;
    return `
      <div class="mdd-field">
        ${label('detail-name', 'detail.name', count('counter-name', 100))}
        <input type="text" id="detail-name" class="input-field" value="${escAttr(mod.name || '')}" maxlength="100">
      </div>
      <div class="mdd-grid">
        <div class="mdd-field">
          ${label('detail-version', 'detail.version')}
          <input type="text" id="detail-version" class="input-field" value="${escAttr(mod.version || '')}" maxlength="30">
        </div>
        <div class="mdd-field">
          ${label('detail-author', 'detail.author', count('counter-author', 50))}
          <input type="text" id="detail-author" class="input-field" value="${escAttr(mod.author || '')}" maxlength="50">
        </div>
      </div>
      <div class="mdd-field">
        <label class="mdd-label" for="detail-desc"><span>${escHtml(t('detail.description'))}</span><span class="mdd-count" id="counter-desc">0/2000</span></label>
        <textarea id="detail-desc" class="input-field" rows="5" maxlength="2000"></textarea>
        <p class="mdd-hint">${escHtml(t('mdd.descHint'))}</p>
      </div>
      <div class="mdd-field" id="detail-tags-container">
        <span class="mdd-label">${escHtml(t('detail.tags'))}</span>
        <div class="mdd-chips" id="detail-tags-list"></div>
        <div id="detail-tag-picker" class="mdd-picker">
          <button type="button" id="detail-tag-open" class="input-field mdd-picker-btn">
            <span>${escHtml(t('detail.selectTag'))}</span>${uiIcon('chevron-down', 12)}
          </button>
          <div id="detail-tag-menu" class="bmm-tag-menu" style="display:none"></div>
        </div>
      </div>
      <div class="mdd-field">
        <label class="mdd-label" for="detail-dep-input">${escHtml(t('mdd.requires'))}</label>
        <div class="mdd-chips" id="detail-deps-list"></div>
        <div class="mdd-picker">
          <input type="text" id="detail-dep-input" class="input-field" placeholder="${escAttr(t('mod.addDepPlaceholder'))}">
          <div id="detail-dep-suggestions" class="glass mdd-suggest" style="display:none"></div>
        </div>
      </div>
      <div class="mdd-ai-slot"></div>`;
}

/** Files: integrity, the content id, the list, and the two tools. */
export function filesHtml(mod: any): string {
    const isShaInvalid = !!mod.file_hashes_invalid;
    const isMissing = !mod.file_hashes || Object.keys(mod.file_hashes).length === 0;
    const hasCid = !!mod.content_id;
    const declared = hasCid && !/^[0-9a-f]{32}$/.test(mod.content_id);
    const cidState = !hasCid ? 'missing' : declared ? 'declared' : !isMissing ? 'precise' : 'approximate';
    const shaState = isShaInvalid ? 'is-bad' : isMissing ? 'is-none' : 'is-ok';
    const shaText = isShaInvalid ? t('hashes.status.invalid') : isMissing ? t('hashes.status.missing') : t('hashes.status.verified');
    const cidTone = cidState === 'missing' ? 'is-none' : cidState === 'approximate' ? 'is-warn' : 'is-ok';
    const list: string[] = mod.installed_files || [];
    return `
      <div class="mdd-rows">
        <div class="mdd-row">
          <div class="mdd-row-main">
            <div class="mdd-row-title">${escHtml(t('settings.shaTitle'))}</div>
            <div class="mdd-row-desc"><span class="mdd-status ${shaState}">${escHtml(shaText)}</span>${mod.file_hashes_timestamp ? ` · ${escHtml(new Date(mod.file_hashes_timestamp).toLocaleString())}` : ''}</div>
          </div>
          <div class="mdd-row-ctl">
            <button type="button" class="mdd-icon-btn" id="btn-recalculate-sha" ${actAttrs('recalculateModSha', mod.id)} data-tasky="mods.sha.recalculate" data-tasky-icon="refresh">${uiIcon('reapply', 14)}</button>
            <button type="button" class="mdd-icon-btn mdd-danger" ${actAttrs('deleteModHashes', mod.id)} data-tasky="mods.sha.delete" data-tasky-icon="trash">${uiIcon('delete', 14)}</button>
          </div>
        </div>
        <div class="mdd-row" id="content-id-box">
          <div class="mdd-row-main">
            <div class="mdd-row-title">${escHtml(t('mdd.contentId'))} <span class="mdd-status ${cidTone}" id="content-id-status-label">${escHtml(t(`detail.cid.${cidState}`))}</span></div>
            <div class="mdd-row-desc mdd-mono" id="content-id-value" data-tooltip="${escAttr(mod.content_id || '')}">${hasCid ? escHtml(mod.content_id) : '—'}</div>
            <div class="mdd-row-desc" id="content-id-hint">${escHtml(t(`detail.cid.${cidState}.hint`))}</div>
          </div>
          <div class="mdd-row-ctl">
            ${hasCid ? `<button type="button" class="mdd-icon-btn btn-copy-content-id" data-content-id="${escAttr(mod.content_id)}" aria-label="${escAttr(t('mdd.copyCid'))}" data-tooltip="${escAttr(t('mdd.copyCid'))}">${uiIcon('copy', 14)}</button>` : ''}
            ${cidState === 'missing' || cidState === 'approximate' ? `<button type="button" class="mdd-icon-btn" id="btn-compute-content-id" ${actAttrs('recalculateModSha', mod.id)} aria-label="${escAttr(t('mdd.computeCid'))}" data-tooltip="${escAttr(t('mdd.computeCid'))}">${uiIcon('reapply', 14)}</button>` : ''}
          </div>
        </div>
      </div>
      <div class="mdd-files-head">
        <span class="mdd-label">${escHtml(t('mod.filesCount', { count: String(list.length) }))}</span>
        <span class="mdd-files-acts">
          <button type="button" id="btn-browse-archive" class="btn btn-xs btn-secondary">${uiIcon('folders', 12)}<span>${escHtml(t('mod.exploreArchive'))}</span></button>
          <button type="button" id="btn-verify-mod-integrity" class="btn btn-xs btn-secondary">${uiIcon('shield-check', 12)}<span>${escHtml(t('mod.verifyIntegrityDeep'))}</span></button>
        </span>
      </div>
      ${list.length ? `<ul class="mdd-files">${list.slice(0, 50).map((f) => `<li>${escHtml(f)}</li>`).join('')}${list.length > 50
        ? `<li class="mdd-muted">${escHtml(t('mod.archiveMoreFiles', { count: String(list.length - 50) }))}</li>` : ''}</ul>`
        : `<p class="mdd-muted">${escHtml(t('detail.noFiles'))}</p>`}`;
}

/** Conflicts & order: where it sits in the activation order (lib-order.ts), then its conflicts. */
export function conflictsHtml(): string {
    return `
      <div class="mdd-order-slot"></div>
      <h3 class="mdd-sub">${escHtml(t('detail.sectionConflicts'))}</h3>
      <div id="detail-conflicts-list" class="mdd-conflicts"><p class="mdd-muted">${escHtml(t('conflict.empty'))}</p></div>`;
}

/** Updates & links: what updates it, the two update actions, then its download links (editable). */
export function updatesHtml(mod: any, ctx: DrawerCtx): string {
    const row = (k: string, v: string) => `<div class="detail-upd-row"><span class="detail-upd-k">${escHtml(k)}</span><span class="detail-upd-v" title="${escAttr(v)}">${escHtml(v)}</span></div>`;
    const sources = [
        mod.source_repo ? row(t('detail.upd.repo'), mod.source_repo) : '',
        mod.update_url ? row(t('detail.upd.url'), mod.update_url) : '',
        ...(mod.update_sources || []).map((u: any) => row(t('detail.upd.source'), u.url || '')),
    ].join('');
    const opt = (v: string, label: string, cur?: string) => `<option value="${v}"${cur === v ? ' selected' : ''}>${escHtml(label)}</option>`;
    return `
      <div class="detail-upd-list">${sources || `<div class="detail-upd-none">${escHtml(t('detail.upd.none'))}</div>`}</div>
      <div class="mdd-inline-acts">
        <button type="button" class="btn btn-xs btn-secondary" ${actAttrsStop('bmmMenuOpenModUpdateConfig', mod.id)}>${uiIcon('settings', 12)}<span>${escHtml(t('mod.updateConfig'))}</span></button>
      </div>
      <h3 class="mdd-sub">${escHtml(t('detail.sectionLinks'))}</h3>
      <p class="mdd-hint" data-i18n="detail.linksInfo">${escHtml(t('detail.linksInfo'))}</p>
      ${ctx.repoLink ? `<div class="detail-repo-link">
        ${uiIcon('server', 14)}
        <span class="detail-repo-link-label">${escHtml(t('detail.fromRepo'))}</span>
        <a href="#" class="detail-repo-link-url" data-open-url="${escAttr(ctx.repoLink)}" title="${escAttr(ctx.repoLink)}">${escHtml(ctx.repoLink)}</a>
      </div>` : ''}
      <!-- The rows ARE the saved list: the save handler reads them back, so a derived link
           (the repo above) is never placed among them. -->
      <div id="detail-links-list" class="mdd-links">
        ${ctx.links.map((dl) => linkRowHtml(dl.url, dl.link_type || 'direct', dl.label || '', opt)).join('')}
      </div>
      <button type="button" id="btn-add-link" class="btn btn-ghost btn-sm">${uiIcon('add', 14)}<span>${escHtml(t('detail.addLink'))}</span></button>
      <!-- The protected-source block, mounted and wired by mods-details.ts. -->
      <div id="detail-links-access"></div>`;
}

export function linkRowHtml(url: string, type: string, label: string,
    opt: (v: string, label: string, cur?: string) => string = (v, l, c) => `<option value="${v}"${c === v ? ' selected' : ''}>${escHtml(l)}</option>`): string {
    return `<div class="mdd-link-row">
        <select class="detail-link-type input-field" aria-label="${escAttr(t('mdd.linkType'))}">
          ${opt('github', 'GitHub', type)}${opt('direct', t('detail.linkDirect'), type)}${opt('repo', t('detail.linkRepo'), type)}${opt('http', t('detail.linkHttp'), type)}${opt('other', t('detail.linkOther'), type)}
        </select>
        <input type="text" class="detail-link-url input-field" value="${escAttr(url)}" placeholder="https://" aria-label="URL">
        <input type="text" class="detail-link-label input-field" value="${escAttr(label)}" placeholder="${escAttr(t('mdd.linkLabel'))}" aria-label="${escAttr(t('mdd.linkLabel'))}">
        <button type="button" class="mdd-icon-btn mdd-danger btn-remove-link" aria-label="${escAttr(t('mdd.removeLink'))}" data-tooltip="${escAttr(t('mdd.removeLink'))}">${uiIcon('close', 14)}</button>
      </div>`;
}

/** The whole drawer. */
export function drawerHtml(mod: any, ctx: DrawerCtx, tab: DrawerTab): string {
    const pane = (k: DrawerTab, body: string) =>
        `<section class="mdd-pane${k === tab ? ' is-active' : ''}" role="tabpanel" id="mdd-pane-${k}" aria-labelledby="mdd-tab-${k}" data-pane="${k}">${body}</section>`;
    return `
      <header class="mdd-head" id="mdd-head">${drawerHeaderHtml(mod, ctx)}</header>
      ${tabsHtml(tab)}
      <div class="mdd-body" id="mod-detail-container">
        ${pane('overview', overviewHtml(mod, ctx))}
        ${pane('details', detailsHtml(mod))}
        ${pane('files', filesHtml(mod))}
        ${pane('conflicts', conflictsHtml())}
        ${pane('updates', updatesHtml(mod, ctx))}
      </div>
      <footer class="mdd-foot" id="mdd-foot">
        <span class="mdd-foot-status" id="mdd-foot-status">${escHtml(t('mdd.noChanges'))}</span>
        <button type="button" class="btn btn-ghost btn-sm" id="btn-cancel-detail" disabled>${escHtml(t('common.cancel'))}</button>
        <button type="button" class="btn btn-primary btn-sm" id="btn-save-detail" disabled>${uiIcon('save', 14)}<span>${escHtml(t('detail.save'))}</span></button>
      </footer>`;
}
