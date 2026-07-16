// @ts-nocheck
/**
 * tutorial-data.ts — All tutorial definitions for BMM.
 *
 * HOW TO CREATE A NEW TUTORIAL
 * ─────────────────────────────
 * 1. Add a TutorialDef object to the TUTORIALS array below.
 * 2. Give it a unique `id`, icon, color, and parts.
 * 3. Each part has steps; steps use i18n keys for title and text.
 * 4. For interactive steps, add an `action` with the event name from BMM_ACTIONS.
 * 5. Add the corresponding translation keys to en.json and fr.json.
 * 6. Done — the hub picks it up automatically.
 */

import type { TutorialDef } from './tutorial-types.js';
import { BMM_ACTIONS } from './tutorial-events.js';

// ── Icons (reusable SVG snippets) ────────────────────────────────────────────

const ICON = {
    profile: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    scan:    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
    map:     `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>`,
    modpack: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`,
    activate:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>`,
    shield:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>`,
    conflict:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
    share:   `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
    repo:    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/></svg>`,
    plugin:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`,
    api:     `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    library: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
    rocket:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>`,
    bench:   `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
    bug:     `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>`,
    catalog: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 9l1-5h16l1 5"/><path d="M5 9v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M9 13h6"/></svg>`,
    translate:`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`,
    palette: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.563-2.512 5.563-5.563C22 6.012 17.5 2 12 2z"/></svg>`,
    disk:    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/></svg>`,
};

// ── Tutorial: BMM Modding Basics ─────────────────────────────────────────────

const BASICS: TutorialDef = {
    id: 'basics',
    title_key: 'tut.basics.meta.title',
    desc_key:  'tut.basics.meta.desc',
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
    color: 'var(--accent)',
    assets: [
        {
            id: 'flappy-game',
            name_key: 'tut.assets.flappy.name',
            desc_key:  'tut.assets.flappy.desc',
            type: 'game',
            usage_key: 'tut.assets.flappy.usage',
        },
        {
            id: 'snake-game',
            name_key: 'tut.assets.snake.name',
            desc_key:  'tut.assets.snake.desc',
            type: 'game',
            usage_key: 'tut.assets.snake.usage',
        },
        {
            id: 'tut-mods-pack',
            name_key: 'tut.assets.mods.name',
            desc_key:  'tut.assets.mods.desc',
            type: 'mod',
            usage_key: 'tut.assets.mods.usage',
        },
    ],
    parts: [
        // ── Part 1 : Profiles ──────────────────────────────────────
        {
            id: 'profiles',
            title_key: 'tut.basics.profiles.title',
            steps: [
                {
                    id: 's1',
                    title_key: 'tut.basics.profiles.s1.title',
                    text_key:  'tut.basics.profiles.s1.text',
                    nav: 'profiles',
                },
                {
                    id: 's2',
                    title_key: 'tut.basics.profiles.s2.title',
                    text_key:  'tut.basics.profiles.s2.text',
                    nav: 'profiles',
                    selector: 'btn-new-profile',
                    modal_selector: 'btn-confirm-profile',
                    // Every field of the New Profile modal, explained + numbered.
                    modal_fields: [
                        { sel: 'prof-name',        key: 'tut.basics.profiles.f.name' },
                        { sel: 'prof-game',        key: 'tut.basics.profiles.f.game' },
                        { sel: 'prof-color',       key: 'tut.basics.profiles.f.color' },
                        { sel: 'prof-icon-grid',   key: 'tut.basics.profiles.f.icon' },
                        { sel: 'prof-game-path',   key: 'tut.basics.profiles.f.gamedir' },
                        { sel: 'prof-mods-path',   key: 'tut.basics.profiles.f.modsdir' },
                        { sel: 'prof-backup-path', key: 'tut.basics.profiles.f.backupdir' },
                        { sel: 'btn-confirm-profile', key: 'tut.basics.profiles.f.create' },
                    ],
                    action: { event: BMM_ACTIONS.PROFILE_CREATED, desc_key: 'tut.basics.profiles.s2.action' },
                },
                {
                    id: 'edit',
                    title_key: 'tut.basics.profiles.edit.title',
                    text_key:  'tut.basics.profiles.edit.text',
                    nav: 'profiles',
                    icon: ICON.profile,
                    selector: 'btn-edit-profile',
                    modal_selector: 'btn-confirm-edit-profile',
                    optional: true,
                    // Same fields as creation — edit/customise any of them anytime.
                    modal_fields: [
                        { sel: 'edit-prof-name',         key: 'tut.basics.profiles.f.name' },
                        { sel: 'edit-prof-game',         key: 'tut.basics.profiles.f.game' },
                        { sel: 'edit-prof-color',        key: 'tut.basics.profiles.f.color' },
                        { sel: 'edit-prof-icon-grid',    key: 'tut.basics.profiles.f.icon' },
                        { sel: 'edit-prof-game-path',    key: 'tut.basics.profiles.f.gamedir' },
                        { sel: 'edit-prof-mods-path',    key: 'tut.basics.profiles.f.modsdir' },
                        { sel: 'edit-prof-backup-path',  key: 'tut.basics.profiles.f.backupdir' },
                        { sel: 'btn-confirm-edit-profile', key: 'tut.basics.profiles.f.save' },
                    ],
                    action: { event: BMM_ACTIONS.PROFILE_EDITED, desc_key: 'tut.basics.profiles.edit.action' },
                },
                {
                    id: 's3',
                    title_key: 'tut.basics.profiles.s3.title',
                    text_key:  'tut.basics.profiles.s3.text',
                    nav: 'profiles',
                    icon: ICON.profile,
                },
                {
                    id: 's4',
                    title_key: 'tut.basics.profiles.s4.title',
                    text_key:  'tut.basics.profiles.s4.text',
                    nav: 'profiles',
                },
            ],
        },
        // ── Part 2 : Mod Scanning ──────────────────────────────────
        {
            id: 'scan',
            title_key: 'tut.basics.scan.title',
            steps: [
                {
                    id: 's0',
                    title_key: 'tut.basics.scan.s0.title',
                    text_key:  'tut.basics.scan.s0.text',
                    nav: 'profiles',
                    icon: ICON.profile,
                },
                {
                    id: 's1',
                    title_key: 'tut.basics.scan.s1.title',
                    text_key:  'tut.basics.scan.s1.text',
                    nav: 'library',
                    icon: ICON.scan,
                },
                {
                    id: 's2',
                    title_key: 'tut.basics.scan.s2.title',
                    text_key:  'tut.basics.scan.s2.text',
                    nav: 'library',
                    selector: 'btn-scan-mods',
                    action: { event: BMM_ACTIONS.MODS_SCANNED, desc_key: 'tut.basics.scan.s2.action' },
                },
                {
                    id: 's3',
                    title_key: 'tut.basics.scan.s3.title',
                    text_key:  'tut.basics.scan.s3.text',
                    nav: 'library',
                    selector: 'btn-add-mod',
                    modal_selector: 'btn-confirm-add-mod',
                    optional: true,
                    modal_fields: [
                        { sel: 'mod-name',             key: 'tut.basics.scan.f.name' },
                        { sel: 'mod-folder',           key: 'tut.basics.scan.f.folder' },
                        { sel: 'mod-version',          key: 'tut.basics.scan.f.version' },
                        { sel: 'mod-author',           key: 'tut.basics.scan.f.author' },
                        { sel: 'mod-desc',             key: 'tut.basics.scan.f.desc' },
                        { sel: 'mod-tag',              key: 'tut.basics.scan.f.tag' },
                        { sel: 'mod-dependency-input', key: 'tut.basics.scan.f.deps' },
                        { sel: 'btn-confirm-add-mod',  key: 'tut.basics.scan.f.add' },
                    ],
                    action: { event: BMM_ACTIONS.MOD_ADDED, desc_key: 'tut.basics.scan.s3.action' },
                },
            ],
        },
        // ── Part 2b : Mod Details ──────────────────────────────────
        {
            id: 'moddetails',
            title_key: 'tut.basics.moddetails.title',
            steps: [
                {
                    id: 's1',
                    title_key: 'tut.basics.moddetails.s1.title',
                    text_key:  'tut.basics.moddetails.s1.text',
                    nav: 'library',
                    icon: ICON.library,
                    // The library toolbar — search + filters + sort.
                    fields: [
                        { sel: 'mod-search',        key: 'tut.basics.moddetails.f.search' },
                        { sel: 'mod-status-filter', key: 'tut.basics.moddetails.f.status' },
                        { sel: 'mod-tag-filter',    key: 'tut.basics.moddetails.f.tag' },
                        { sel: 'mod-sort',          key: 'tut.basics.moddetails.f.sort' },
                    ],
                },
                {
                    // Open the detail panel — detected as an action.
                    id: 's2',
                    title_key: 'tut.basics.moddetails.s2.title',
                    text_key:  'tut.basics.moddetails.s2.text',
                    nav: 'library',
                    selector: 'mod-card',
                    action: { event: BMM_ACTIONS.MOD_DETAIL_OPENED, desc_key: 'tut.basics.moddetails.s2.action' },
                },
                {
                    // Metadata block — name / version / author and the inline edit (pencil).
                    id: 's3',
                    title_key: 'tut.basics.moddetails.s3.title',
                    text_key:  'tut.basics.moddetails.s3.text',
                    nav: 'library',
                    fields: [
                        { sel: 'btn-save-detail', key: 'tut.basics.moddetails.f.edit' },
                    ],
                },
                {
                    // Integrity + content-id — the trust/identity tools.
                    id: 's4',
                    title_key: 'tut.basics.moddetails.s4.title',
                    text_key:  'tut.basics.moddetails.s4.text',
                    nav: 'library',
                    fields: [
                        { sel: 'btn-verify-mod-integrity', key: 'tut.basics.moddetails.f.verify' },
                        { sel: 'btn-copy-content-id',      key: 'tut.basics.moddetails.f.contentid' },
                    ],
                },
                {
                    // Files + update links — inspect contents, wire an update source.
                    id: 's5',
                    title_key: 'tut.basics.moddetails.s5.title',
                    text_key:  'tut.basics.moddetails.s5.text',
                    nav: 'library',
                    fields: [
                        { sel: 'btn-browse-archive', key: 'tut.basics.moddetails.f.browse' },
                        { sel: 'btn-add-link',       key: 'tut.basics.moddetails.f.link' },
                    ],
                },
                {
                    id: 's6',
                    title_key: 'tut.basics.moddetails.s6.title',
                    text_key:  'tut.basics.moddetails.s6.text',
                    nav: 'library',
                    icon: ICON.library,
                },
            ],
        },
        // ── Part 3 : Mapping ───────────────────────────────────────
        {
            id: 'map',
            title_key: 'tut.basics.map.title',
            steps: [
                {
                    // Concept first — WHY the mapper exists.
                    id: 's1',
                    title_key: 'tut.basics.map.s1.title',
                    text_key:  'tut.basics.map.s1.text',
                    nav: 'mapper',
                    icon: ICON.map,
                },
                {
                    // Pick a profile → loads that game's folder tree on the right.
                    id: 's2',
                    title_key: 'tut.basics.map.s2.title',
                    text_key:  'tut.basics.map.s2.text',
                    nav: 'mapper',
                    selector: 'mapper-profile-select',
                },
                {
                    // The two-panel layout: mod structure (left) vs game folders (right).
                    id: 's3',
                    title_key: 'tut.basics.map.s3.title',
                    text_key:  'tut.basics.map.s3.text',
                    nav: 'mapper',
                    fields: [
                        { sel: 'mapper-mods-panel', key: 'tut.basics.map.f.modpanel' },
                        { sel: 'mapper-game-panel', key: 'tut.basics.map.f.gamepanel' },
                    ],
                },
                {
                    // Pick a mod → its file tree appears on the left. Detected as an action.
                    id: 's4',
                    title_key: 'tut.basics.map.s4.title',
                    text_key:  'tut.basics.map.s4.text',
                    nav: 'mapper',
                    selector: 'mapper-mod-select',
                    action: { event: BMM_ACTIONS.MAPPER_MOD_SELECTED, desc_key: 'tut.basics.map.s4.action' },
                },
                {
                    // THE core interaction: select left, double-click right.
                    id: 's5',
                    title_key: 'tut.basics.map.s5.title',
                    text_key:  'tut.basics.map.s5.text',
                    nav: 'mapper',
                    fields: [
                        { sel: 'mapper-mod-tree',  key: 'tut.basics.map.f.modtree' },
                        { sel: 'mapper-game-tree', key: 'tut.basics.map.f.gametree' },
                    ],
                },
                {
                    // Preview the full diagnostic before touching anything.
                    id: 's6',
                    title_key: 'tut.basics.map.s6.title',
                    text_key:  'tut.basics.map.s6.text',
                    nav: 'mapper',
                    selector: 'btn-mapper-preview',
                    action: { event: BMM_ACTIONS.MAPPER_OPENED, desc_key: 'tut.basics.map.s6.action' },
                },
                {
                    // Apply — the Save button only appears once you've made changes.
                    id: 's7',
                    title_key: 'tut.basics.map.s7.title',
                    text_key:  'tut.basics.map.s7.text',
                    nav: 'mapper',
                },
            ],
        },
        // ── Part 4 : Modpacks ──────────────────────────────────────
        {
            id: 'modpacks',
            title_key: 'tut.basics.modpacks.title',
            steps: [
                {
                    id: 's1',
                    title_key: 'tut.basics.modpacks.s1.title',
                    text_key:  'tut.basics.modpacks.s1.text',
                    nav: 'modpacks',
                    icon: ICON.modpack,
                },
                {
                    id: 's2',
                    title_key: 'tut.basics.modpacks.s2.title',
                    text_key:  'tut.basics.modpacks.s2.text',
                    nav: 'modpacks',
                    selector: 'modpack-create-btn',
                    modal_selector: 'editor-save',
                    modal_fields: [
                        { sel: 'mp-name',          key: 'tut.basics.modpacks.f.name' },
                        { sel: 'mp-desc',          key: 'tut.basics.modpacks.f.desc' },
                        { sel: 'mp-game',          key: 'tut.basics.modpacks.f.game' },
                        { sel: 'mp-multi',         key: 'tut.basics.modpacks.f.multi' },
                        { sel: 'btn-add-mods-pack', key: 'tut.basics.modpacks.f.addmods' },
                        { sel: 'editor-save',      key: 'tut.basics.modpacks.f.save' },
                    ],
                    action: { event: BMM_ACTIONS.MODPACK_CREATED, desc_key: 'tut.basics.modpacks.s2.action' },
                },
                {
                    // Apply a pack in one click — the demo "Example Modpack" is the target.
                    id: 's3',
                    title_key: 'tut.basics.modpacks.s3.title',
                    text_key:  'tut.basics.modpacks.s3.text',
                    nav: 'modpacks',
                    selector: 'btn-apply',
                    action: { event: BMM_ACTIONS.MODPACK_APPLIED, desc_key: 'tut.basics.modpacks.s3.action' },
                },
            ],
        },
        // ── Part 5 : Activation ────────────────────────────────────
        {
            id: 'activate',
            title_key: 'tut.basics.activate.title',
            steps: [
                {
                    id: 's1',
                    title_key: 'tut.basics.activate.s1.title',
                    text_key:  'tut.basics.activate.s1.text',
                    nav: 'library',
                    icon: ICON.activate,
                },
                {
                    id: 's2',
                    title_key: 'tut.basics.activate.s2.title',
                    text_key:  'tut.basics.activate.s2.text',
                    nav: 'library',
                    selector: 'mod-toggle',
                    action: { event: BMM_ACTIONS.MOD_ACTIVATED, desc_key: 'tut.basics.activate.s2.action' },
                },
                {
                    id: 's3',
                    title_key: 'tut.basics.activate.s3.title',
                    text_key:  'tut.basics.activate.s3.text',
                    nav: 'library',
                    selector: 'mod-toggle',
                    action: { event: BMM_ACTIONS.MOD_DEACTIVATED, desc_key: 'tut.basics.activate.s3.action' },
                },
                {
                    id: 's4',
                    title_key: 'tut.basics.activate.s4.title',
                    text_key:  'tut.basics.activate.s4.text',
                    nav: 'library',
                },
            ],
        },
        // ── Part 6 : Integrity ─────────────────────────────────────
        {
            id: 'integrity',
            title_key: 'tut.basics.integrity.title',
            steps: [
                {
                    id: 's1',
                    title_key: 'tut.basics.integrity.s1.title',
                    text_key:  'tut.basics.integrity.s1.text',
                    nav: 'library',
                    icon: ICON.shield,
                },
                {
                    id: 's2',
                    title_key: 'tut.basics.integrity.s2.title',
                    text_key:  'tut.basics.integrity.s2.text',
                    nav: 'library',
                    selector: 'btn-verify-integrity',
                    action: { event: BMM_ACTIONS.INTEGRITY_CHECK, desc_key: 'tut.basics.integrity.s2.action' },
                },
                {
                    id: 's3',
                    title_key: 'tut.basics.integrity.s3.title',
                    text_key:  'tut.basics.integrity.s3.text',
                    nav: 'library',
                    icon: ICON.shield,
                },
            ],
        },
        // ── Part 7 : Conflicts & Storage ───────────────────────────
        {
            id: 'conflicts',
            title_key: 'tut.basics.conflicts.title',
            steps: [
                {
                    // Point at the REAL badge — the two demo mods share Mods/shared/config.ini.
                    id: 's1',
                    title_key: 'tut.basics.conflicts.s1.title',
                    text_key:  'tut.basics.conflicts.s1.text',
                    nav: 'library',
                    icon: ICON.conflict,
                    selector: 'tag-conflict',
                },
                {
                    // Resolving: click the badge → the conflict resolver shows which mod wins.
                    id: 's1b',
                    title_key: 'tut.basics.conflicts.s1b.title',
                    text_key:  'tut.basics.conflicts.s1b.text',
                    nav: 'library',
                },
                {
                    id: 's2',
                    title_key: 'tut.basics.conflicts.s2.title',
                    text_key:  'tut.basics.conflicts.s2.text',
                    nav: 'settings',
                },
            ],
        },
        // ── Part 8 : Shared Folders (optional) ────────────────────
        {
            id: 'shared',
            title_key: 'tut.basics.shared.title',
            steps: [
                {
                    id: 's1',
                    title_key: 'tut.basics.shared.s1.title',
                    text_key:  'tut.basics.shared.s1.text',
                    nav: 'profiles',
                    optional: true,
                },
                {
                    id: 's2',
                    title_key: 'tut.basics.shared.s2.title',
                    text_key:  'tut.basics.shared.s2.text',
                    nav: 'profiles',
                    optional: true,
                },
            ],
        },
    ],
};

// ── Tutorial: BMM Advanced P1 ────────────────────────────────────────────────

const ADVANCED: TutorialDef = {
    id: 'advanced',
    title_key: 'tut.advanced.meta.title',
    desc_key:  'tut.advanced.meta.desc',
    // lucide: book-open-text
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7v14"/><path d="M16 12h2"/><path d="M16 8h2"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/><path d="M6 12h2"/><path d="M6 8h2"/></svg>`,
    color: '#f59e0b',
    parts: [
        // ── Part 1 : .MM Lists ─────────────────────────────────────
        {
            id: 'mm',
            title_key: 'tut.advanced.mm.title',
            steps: [
                {
                    id: 's1',
                    title_key: 'tut.advanced.mm.s1.title',
                    text_key:  'tut.advanced.mm.s1.text',
                    nav: 'modlists',
                    icon: ICON.share,
                },
                {
                    id: 's2',
                    title_key: 'tut.advanced.mm.s2.title',
                    text_key:  'tut.advanced.mm.s2.text',
                    nav: 'modlists',
                    selector: 'btn-export-mm',
                    action: { event: BMM_ACTIONS.MODLIST_EXPORTED, desc_key: 'tut.advanced.mm.s2.action' },
                },
                {
                    id: 's3',
                    title_key: 'tut.advanced.mm.s3.title',
                    text_key:  'tut.advanced.mm.s3.text',
                    nav: 'modlists',
                    selector: 'btn-import-mm',
                    action: { event: BMM_ACTIONS.MODLIST_IMPORTED, desc_key: 'tut.advanced.mm.s3.action' },
                },
            ],
        },
        // ── Part 2 : Server Repository ─────────────────────────────
        {
            id: 'repo',
            title_key: 'tut.advanced.repo.title',
            steps: [
                {
                    // Concept + the two tabs (Sync / Host).
                    id: 's1',
                    title_key: 'tut.advanced.repo.s1.title',
                    text_key:  'tut.advanced.repo.s1.text',
                    nav: 'repo',
                    icon: ICON.repo,
                    fields: [
                        { sel: 'btn-repo-tab-sync', key: 'tut.advanced.repo.f.tabsync' },
                        { sel: 'btn-repo-tab-host', key: 'tut.advanced.repo.f.tabhost' },
                    ],
                },
                {
                    // Sync = JOIN someone's repo. This tab is active by default, so its
                    // fields are visible — point at them.
                    id: 's2',
                    title_key: 'tut.advanced.repo.s2.title',
                    text_key:  'tut.advanced.repo.s2.text',
                    nav: 'repo',
                    fields: [
                        { sel: 'repo-sync-url',         key: 'tut.advanced.repo.f.url' },
                        { sel: 'repo-sync-game-path',   key: 'tut.advanced.repo.f.gamedir' },
                        { sel: 'repo-sync-mods-path',   key: 'tut.advanced.repo.f.modsdir' },
                        { sel: 'repo-sync-backup-path', key: 'tut.advanced.repo.f.backupdir' },
                    ],
                },
                {
                    // Host = SHARE your library. Point at the Host tab button (always
                    // visible); its panel is described in prose so we don't depend on it
                    // being the active tab.
                    id: 's3',
                    title_key: 'tut.advanced.repo.s3.title',
                    text_key:  'tut.advanced.repo.s3.text',
                    nav: 'repo',
                    selector: 'btn-repo-tab-host',
                },
                {
                    id: 's4',
                    title_key: 'tut.advanced.repo.s4.title',
                    text_key:  'tut.advanced.repo.s4.text',
                    nav: 'repo',
                },
            ],
        },
        // ── Part 3 : Modpacks (complete) ───────────────────────────
        {
            id: 'modpacks',
            title_key: 'tut.advanced.modpacks.title',
            steps: [
                {
                    id: 's1',
                    title_key: 'tut.advanced.modpacks.s1.title',
                    text_key:  'tut.advanced.modpacks.s1.text',
                    nav: 'modpacks',
                    icon: ICON.modpack,
                },
                {
                    id: 's2',
                    title_key: 'tut.advanced.modpacks.s2.title',
                    text_key:  'tut.advanced.modpacks.s2.text',
                    nav: 'modpacks',
                },
                {
                    id: 's3',
                    title_key: 'tut.advanced.modpacks.s3.title',
                    text_key:  'tut.advanced.modpacks.s3.text',
                    nav: 'modpacks',
                },
            ],
        },
        // ── Part 4 : Mod Library (complete) ────────────────────────
        {
            id: 'library',
            title_key: 'tut.advanced.library.title',
            steps: [
                {
                    id: 's1',
                    title_key: 'tut.advanced.library.s1.title',
                    text_key:  'tut.advanced.library.s1.text',
                    nav: 'library',
                    icon: ICON.library,
                },
                {
                    id: 's2',
                    title_key: 'tut.advanced.library.s2.title',
                    text_key:  'tut.advanced.library.s2.text',
                    nav: 'library',
                },
                {
                    id: 's3',
                    title_key: 'tut.advanced.library.s3.title',
                    text_key:  'tut.advanced.library.s3.text',
                    nav: 'library',
                    selector: 'btn-browse-archive',
                },
            ],
        },
    ],
};

// ── Tutorial: Other Features ─────────────────────────────────────────────────

const OTHER: TutorialDef = {
    id: 'other',
    title_key: 'tut.other.meta.title',
    desc_key:  'tut.other.meta.desc',
    // Book (lucide book) with a wrench on the cover — "extra tools".
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><g transform="translate(8.3 6.4) scale(0.34)"><path vector-effect="non-scaling-stroke" d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></g></svg>`,
    color: '#22c55e',
    parts: [
        // ── Part 1 : BMM Launchpack ────────────────────────────────
        {
            id: 'launchpack',
            title_key: 'tut.other.launchpack.title',
            steps: [
                {
                    id: 's1',
                    title_key: 'tut.other.launchpack.s1.title',
                    text_key:  'tut.other.launchpack.s1.text',
                    icon: ICON.rocket,
                    nav: 'settings',
                    selector: 'btn-create-launchpack',
                    modal_selector: 'lp-btn-confirm',
                    modal_fields: [
                        { sel: 'lp-input-name',     key: 'tut.other.launchpack.f.name' },
                        { sel: 'lp-btn-add-exe',    key: 'tut.other.launchpack.f.apps' },
                        { sel: 'lp-btn-select-icon', key: 'tut.other.launchpack.f.icon' },
                        { sel: 'lp-btn-confirm',    key: 'tut.other.launchpack.f.create' },
                    ],
                },
                {
                    id: 's2',
                    title_key: 'tut.other.launchpack.s2.title',
                    text_key:  'tut.other.launchpack.s2.text',
                },
            ],
        },
        // ── Part 2 : Storage & Smart I/O ───────────────────────────
        {
            id: 'storage',
            title_key: 'tut.other.storage.title',
            steps: [
                {
                    id: 's1',
                    title_key: 'tut.other.storage.s1.title',
                    text_key:  'tut.other.storage.s1.text',
                    nav: 'settings',
                    icon: ICON.disk,
                    selector: 'settings-storage-section',
                },
                {
                    id: 's2',
                    title_key: 'tut.other.storage.s2.title',
                    text_key:  'tut.other.storage.s2.text',
                    nav: 'settings',
                    selector: 'btn-open-storage',
                },
                {
                    id: 's3',
                    title_key: 'tut.other.storage.s3.title',
                    text_key:  'tut.other.storage.s3.text',
                    nav: 'settings',
                },
            ],
        },
        // ── Part 3 : Data & Backup ─────────────────────────────────
        {
            id: 'backup',
            title_key: 'tut.other.backup.title',
            steps: [
                {
                    id: 's1',
                    title_key: 'tut.other.backup.s1.title',
                    text_key:  'tut.other.backup.s1.text',
                    nav: 'settings',
                    icon: ICON.shield,
                    selector: 'btn-export-data',
                },
                {
                    id: 's2',
                    title_key: 'tut.other.backup.s2.title',
                    text_key:  'tut.other.backup.s2.text',
                    nav: 'settings',
                    selector: 'btn-export-data',
                },
                {
                    id: 's3',
                    title_key: 'tut.other.backup.s3.title',
                    text_key:  'tut.other.backup.s3.text',
                    nav: 'settings',
                    selector: 'btn-import-data',
                },
            ],
        },
        // ── Part 4 : Benchmark ─────────────────────────────────────
        {
            id: 'benchmark',
            title_key: 'tut.other.benchmark.title',
            steps: [
                {
                    id: 's1',
                    title_key: 'tut.other.benchmark.s1.title',
                    text_key:  'tut.other.benchmark.s1.text',
                    nav: 'settings',
                    icon: ICON.bench,
                    selector: 'btn-open-benchmark',
                },
                {
                    id: 's2',
                    title_key: 'tut.other.benchmark.s2.title',
                    text_key:  'tut.other.benchmark.s2.text',
                    nav: 'settings',
                },
            ],
        },
        // ── Part 3 : Bug Report ────────────────────────────────────
        {
            id: 'bugreport',
            title_key: 'tut.other.bugreport.title',
            steps: [
                {
                    id: 's1',
                    title_key: 'tut.other.bugreport.s1.title',
                    text_key:  'tut.other.bugreport.s1.text',
                    icon: ICON.bug,
                },
                {
                    id: 's2',
                    title_key: 'tut.other.bugreport.s2.title',
                    text_key:  'tut.other.bugreport.s2.text',
                },
            ],
        },
        // ── Part 4 : Plugins & API ─────────────────────────────────
        {
            id: 'pluginsapi',
            title_key: 'tut.other.pluginsapi.title',
            steps: [
                {
                    id: 's1',
                    title_key: 'tut.other.pluginsapi.s1.title',
                    text_key:  'tut.other.pluginsapi.s1.text',
                    nav: 'plugins',
                    icon: ICON.plugin,
                },
                {
                    id: 's2',
                    title_key: 'tut.other.pluginsapi.s2.title',
                    text_key:  'tut.other.pluginsapi.s2.text',
                    nav: 'plugins',
                    optional: true,
                    action: { event: BMM_ACTIONS.PLUGIN_INSTALLED, desc_key: 'tut.other.pluginsapi.s2.action' },
                },
                {
                    id: 's3',
                    title_key: 'tut.other.pluginsapi.s3.title',
                    text_key:  'tut.other.pluginsapi.s3.text',
                    nav: 'plugins',
                    icon: ICON.shield,
                },
                {
                    id: 's4',
                    title_key: 'tut.other.pluginsapi.s4.title',
                    text_key:  'tut.other.pluginsapi.s4.text',
                    nav: 'plugins',
                    icon: ICON.api,
                    optional: true,
                    action: { event: BMM_ACTIONS.SCRIPT_GENERATED, desc_key: 'tut.other.pluginsapi.s4.action' },
                },
                {
                    id: 's5',
                    title_key: 'tut.other.pluginsapi.s5.title',
                    text_key:  'tut.other.pluginsapi.s5.text',
                    nav: 'plugins',
                    icon: ICON.api,
                },
                {
                    id: 's6',
                    title_key: 'tut.other.pluginsapi.s6.title',
                    text_key:  'tut.other.pluginsapi.s6.text',
                    // The API token lives in Settings → Identity, not the Plugins page.
                    nav: 'settings',
                    optional: true,
                    // The local-API config fields (Settings → Identity).
                    fields: [
                        { sel: 'sic-api-token', key: 'tut.other.pluginsapi.f.token' },
                        { sel: 'sic-api-url',   key: 'tut.other.pluginsapi.f.url' },
                        { sel: 'sic-api-port',  key: 'tut.other.pluginsapi.f.port' },
                        { sel: 'btn-sic-copy-token', key: 'tut.other.pluginsapi.f.copy' },
                    ],
                    action: { event: BMM_ACTIONS.API_TOKEN_COPIED, desc_key: 'tut.other.pluginsapi.s6.action' },
                },
            ],
        },
        // ── Part 5 : App Catalog ───────────────────────────────────
        {
            id: 'appcatalog',
            title_key: 'tut.other.appcatalog.title',
            steps: [
                {
                    id: 's1',
                    title_key: 'tut.other.appcatalog.s1.title',
                    text_key:  'tut.other.appcatalog.s1.text',
                    nav: 'apps',
                    icon: ICON.catalog,
                    selector: 'nav-apps',
                },
                {
                    id: 's2',
                    title_key: 'tut.other.appcatalog.s2.title',
                    text_key:  'tut.other.appcatalog.s2.text',
                    nav: 'apps',
                    selectors: ['apps-search', 'apps-filter-cat'],
                },
                {
                    id: 's3',
                    title_key: 'tut.other.appcatalog.s3.title',
                    text_key:  'tut.other.appcatalog.s3.text',
                    nav: 'apps',
                    selector: 'apps-content',
                    icon: ICON.shield,
                },
                {
                    id: 's4',
                    title_key: 'tut.other.appcatalog.s4.title',
                    text_key:  'tut.other.appcatalog.s4.text',
                    nav: 'apps',
                    selector: 'apps-tabs',
                },
            ],
        },
        // ── Part 6 : Translation Tool ──────────────────────────────
        {
            id: 'translate',
            title_key: 'tut.other.translate.title',
            steps: [
                {
                    id: 's1',
                    title_key: 'tut.other.translate.s1.title',
                    text_key:  'tut.other.translate.s1.text',
                    nav: 'settings',
                    icon: ICON.translate,
                },
                {
                    id: 's2',
                    title_key: 'tut.other.translate.s2.title',
                    text_key:  'tut.other.translate.s2.text',
                    nav: 'settings',
                    selector: 'btn-open-i18n-sandbox',
                    modal_selector: 'modal-i18n-sandbox',
                    modal_fields: [
                        { sel: 'i18n-base-lang',   key: 'tut.other.translate.f.base' },
                        { sel: 'i18n-new-lang',    key: 'tut.other.translate.f.target' },
                        { sel: 'i18n-pick-screen', key: 'tut.other.translate.f.pick' },
                        { sel: 'i18n-key-list',    key: 'tut.other.translate.f.keys' },
                        { sel: 'i18n-export',      key: 'tut.other.translate.f.export' },
                    ],
                },
                {
                    id: 's3',
                    title_key: 'tut.other.translate.s3.title',
                    text_key:  'tut.other.translate.s3.text',
                    nav: 'settings',
                    icon: ICON.share,
                },
                {
                    id: 's4',
                    title_key: 'tut.other.translate.s4.title',
                    text_key:  'tut.other.translate.s4.text',
                    nav: 'settings',
                },
            ],
        },
        // ── Part 7 : Theme System ──────────────────────────────────
        {
            id: 'themes',
            title_key: 'tut.other.themes.title',
            steps: [
                {
                    id: 's1',
                    title_key: 'tut.other.themes.s1.title',
                    text_key:  'tut.other.themes.s1.text',
                    nav: 'settings',
                    icon: ICON.palette,
                },
                {
                    id: 's2',
                    title_key: 'tut.other.themes.s2.title',
                    text_key:  'tut.other.themes.s2.text',
                    nav: 'settings',
                    selector: 'btn-open-theme-editor',
                    modal_selector: 'bte-save',
                    modal_fields: [
                        { sel: 'bte-pick-token',  key: 'tut.other.themes.f.pick' },
                        { sel: 'bte-import-file', key: 'tut.other.themes.f.import' },
                        { sel: 'bte-save',        key: 'tut.other.themes.f.save' },
                        { sel: 'bte-save-as',     key: 'tut.other.themes.f.saveas' },
                        { sel: 'bte-export',      key: 'tut.other.themes.f.export' },
                    ],
                },
                {
                    id: 's3',
                    title_key: 'tut.other.themes.s3.title',
                    text_key:  'tut.other.themes.s3.text',
                    nav: 'settings',
                    icon: ICON.palette,
                },
                {
                    id: 's4',
                    title_key: 'tut.other.themes.s4.title',
                    text_key:  'tut.other.themes.s4.text',
                    nav: 'settings',
                    icon: ICON.share,
                },
            ],
        },
        // ── Part : Update sources ──────────────────────────────────
        {
            id: 'updates',
            title_key: 'tut.other.updates.title',
            steps: [
                {
                    id: 's1',
                    title_key: 'tut.other.updates.s1.title',
                    text_key:  'tut.other.updates.s1.text',
                    nav: 'library',
                    icon: ICON.repo,
                },
                {
                    id: 's2',
                    title_key: 'tut.other.updates.s2.title',
                    text_key:  'tut.other.updates.s2.text',
                    nav: 'library',
                    icon: ICON.share,
                },
                {
                    id: 's3',
                    title_key: 'tut.other.updates.s3.title',
                    text_key:  'tut.other.updates.s3.text',
                    nav: 'repo',
                },
            ],
        },
        // ── Part : Scheduling & Automation ─────────────────────────
        {
            id: 'automation',
            title_key: 'tut.other.automation.title',
            steps: [
                {
                    id: 's1',
                    title_key: 'tut.other.automation.s1.title',
                    text_key:  'tut.other.automation.s1.text',
                    nav: 'settings',
                    icon: ICON.activate,
                },
                {
                    id: 's2',
                    title_key: 'tut.other.automation.s2.title',
                    text_key:  'tut.other.automation.s2.text',
                    nav: 'settings',
                    // Clicking "Load example" builds a real, ready-to-use simple-loop
                    // automation (createExampleAutomation) and opens it, so the fields
                    // below actually contain a working loop the user can inspect.
                    selector: 'sched-example-btn',
                    modal_selector: 'sched-save',
                    modal_fields: [
                        { sel: 'sched-name',    key: 'tut.other.automation.f.name' },
                        { sel: 'sched-trigger', key: 'tut.other.automation.f.trigger' },
                        { sel: 'sched-steps',   key: 'tut.other.automation.f.steps' },
                        { sel: 'sched-save',    key: 'tut.other.automation.f.save' },
                    ],
                },
                {
                    id: 's3',
                    title_key: 'tut.other.automation.s3.title',
                    text_key:  'tut.other.automation.s3.text',
                    nav: 'settings',
                    icon: ICON.modpack,
                },
                {
                    id: 's4',
                    title_key: 'tut.other.automation.s4.title',
                    text_key:  'tut.other.automation.s4.text',
                    nav: 'settings',
                    icon: ICON.share,
                },
            ],
        },
    ],
};

// ── Registry ─────────────────────────────────────────────────────────────────

/** All available tutorials — add new ones here. */
export const TUTORIALS: TutorialDef[] = [BASICS, ADVANCED, OTHER];

/** Get all step keys for a tutorial (used for completion counting). */
export function getAllStepKeys(tutorial: TutorialDef): string[] {
    return tutorial.parts.flatMap(p => p.steps.map(s => `${p.id}:${s.id}`));
}
