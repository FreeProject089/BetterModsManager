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
    library: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
    rocket:  `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>`,
    bench:   `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
    bug:     `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>`,
};

// ── Tutorial: BMM Modding Basics ─────────────────────────────────────────────

const BASICS: TutorialDef = {
    id: 'basics',
    title_key: 'tut.basics.meta.title',
    desc_key:  'tut.basics.meta.desc',
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>`,
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
                    img: 'assets/Tasky_Happy.png',
                    nav: 'profiles',
                },
                {
                    id: 's2',
                    title_key: 'tut.basics.profiles.s2.title',
                    text_key:  'tut.basics.profiles.s2.text',
                    img: 'assets/Tasky.png',
                    nav: 'profiles',
                    selector: 'btn-new-profile',
                    modal_selector: 'btn-confirm-profile',
                    action: { event: BMM_ACTIONS.PROFILE_CREATED, desc_key: 'tut.basics.profiles.s2.action' },
                },
                {
                    id: 's3',
                    title_key: 'tut.basics.profiles.s3.title',
                    text_key:  'tut.basics.profiles.s3.text',
                    img: 'assets/Tasky.png',
                    nav: 'profiles',
                    icon: ICON.profile,
                },
                {
                    id: 's4',
                    title_key: 'tut.basics.profiles.s4.title',
                    text_key:  'tut.basics.profiles.s4.text',
                    img: 'assets/Tasky_Happy.png',
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
                    img: 'assets/Tasky.png',
                    nav: 'profiles',
                    icon: ICON.profile,
                },
                {
                    id: 's1',
                    title_key: 'tut.basics.scan.s1.title',
                    text_key:  'tut.basics.scan.s1.text',
                    img: 'assets/Tasky.png',
                    nav: 'library',
                    icon: ICON.scan,
                },
                {
                    id: 's2',
                    title_key: 'tut.basics.scan.s2.title',
                    text_key:  'tut.basics.scan.s2.text',
                    img: 'assets/Tasky.png',
                    nav: 'library',
                    selector: 'btn-scan-mods',
                    action: { event: BMM_ACTIONS.MODS_SCANNED, desc_key: 'tut.basics.scan.s2.action' },
                },
                {
                    id: 's3',
                    title_key: 'tut.basics.scan.s3.title',
                    text_key:  'tut.basics.scan.s3.text',
                    img: 'assets/Tasky_Happy.png',
                    nav: 'library',
                    selector: 'btn-add-mod',
                    optional: true,
                },
            ],
        },
        // ── Part 3 : Mapping ───────────────────────────────────────
        {
            id: 'map',
            title_key: 'tut.basics.map.title',
            steps: [
                {
                    id: 's1',
                    title_key: 'tut.basics.map.s1.title',
                    text_key:  'tut.basics.map.s1.text',
                    img: 'assets/Tasky.png',
                    nav: 'mapper',
                    icon: ICON.map,
                },
                {
                    id: 's2',
                    title_key: 'tut.basics.map.s2.title',
                    text_key:  'tut.basics.map.s2.text',
                    img: 'assets/Tasky.png',
                    nav: 'mapper',
                    selector: 'mapper-profile-select',
                },
                {
                    id: 's3',
                    title_key: 'tut.basics.map.s3.title',
                    text_key:  'tut.basics.map.s3.text',
                    img: 'assets/Tasky.png',
                    nav: 'mapper',
                    selector: 'mapper-mod-select',
                },
                {
                    id: 's4',
                    title_key: 'tut.basics.map.s4.title',
                    text_key:  'tut.basics.map.s4.text',
                    img: 'assets/Tasky_Happy.png',
                    nav: 'mapper',
                    selector: 'btn-mapper-preview',
                    action: { event: BMM_ACTIONS.MAPPER_OPENED, desc_key: 'tut.basics.map.s4.action' },
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
                    img: 'assets/Tasky.png',
                    nav: 'modpacks',
                    icon: ICON.modpack,
                },
                {
                    id: 's2',
                    title_key: 'tut.basics.modpacks.s2.title',
                    text_key:  'tut.basics.modpacks.s2.text',
                    img: 'assets/Tasky.png',
                    nav: 'modpacks',
                    selector: 'modpack-create-btn',
                    modal_selector: 'editor-save',
                    action: { event: BMM_ACTIONS.MODPACK_CREATED, desc_key: 'tut.basics.modpacks.s2.action' },
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
                    img: 'assets/Tasky.png',
                    nav: 'library',
                    icon: ICON.activate,
                },
                {
                    id: 's2',
                    title_key: 'tut.basics.activate.s2.title',
                    text_key:  'tut.basics.activate.s2.text',
                    img: 'assets/Tasky.png',
                    nav: 'library',
                    action: { event: BMM_ACTIONS.MOD_ACTIVATED, desc_key: 'tut.basics.activate.s2.action' },
                },
                {
                    id: 's3',
                    title_key: 'tut.basics.activate.s3.title',
                    text_key:  'tut.basics.activate.s3.text',
                    img: 'assets/Tasky.png',
                    nav: 'library',
                    action: { event: BMM_ACTIONS.MOD_DEACTIVATED, desc_key: 'tut.basics.activate.s3.action' },
                },
                {
                    id: 's4',
                    title_key: 'tut.basics.activate.s4.title',
                    text_key:  'tut.basics.activate.s4.text',
                    img: 'assets/Tasky_Happy.png',
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
                    img: 'assets/Tasky.png',
                    nav: 'library',
                    icon: ICON.shield,
                },
                {
                    id: 's2',
                    title_key: 'tut.basics.integrity.s2.title',
                    text_key:  'tut.basics.integrity.s2.text',
                    img: 'assets/Tasky_Happy.png',
                    nav: 'library',
                    selector: 'btn-verify-integrity',
                    action: { event: BMM_ACTIONS.INTEGRITY_CHECK, desc_key: 'tut.basics.integrity.s2.action' },
                },
            ],
        },
        // ── Part 7 : Conflicts & Storage ───────────────────────────
        {
            id: 'conflicts',
            title_key: 'tut.basics.conflicts.title',
            steps: [
                {
                    id: 's1',
                    title_key: 'tut.basics.conflicts.s1.title',
                    text_key:  'tut.basics.conflicts.s1.text',
                    img: 'assets/Tasky.png',
                    nav: 'library',
                    icon: ICON.conflict,
                },
                {
                    id: 's2',
                    title_key: 'tut.basics.conflicts.s2.title',
                    text_key:  'tut.basics.conflicts.s2.text',
                    img: 'assets/Tasky.png',
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
                    img: 'assets/Tasky_yeux1.png',
                    nav: 'profiles',
                    optional: true,
                },
                {
                    id: 's2',
                    title_key: 'tut.basics.shared.s2.title',
                    text_key:  'tut.basics.shared.s2.text',
                    img: 'assets/Tasky.png',
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
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/><path d="M4.93 4.93l4.24 4.24M14.83 14.83l4.24 4.24M4.93 19.07l4.24-4.24M14.83 9.17l4.24-4.24"/></svg>`,
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
                    img: 'assets/Tasky.png',
                    nav: 'modlists',
                    icon: ICON.share,
                },
                {
                    id: 's2',
                    title_key: 'tut.advanced.mm.s2.title',
                    text_key:  'tut.advanced.mm.s2.text',
                    img: 'assets/Tasky_Happy.png',
                    nav: 'modlists',
                    action: { event: BMM_ACTIONS.MODLIST_EXPORTED, desc_key: 'tut.advanced.mm.s2.action' },
                },
                {
                    id: 's3',
                    title_key: 'tut.advanced.mm.s3.title',
                    text_key:  'tut.advanced.mm.s3.text',
                    img: 'assets/Tasky.png',
                    nav: 'modlists',
                },
            ],
        },
        // ── Part 2 : Server Repository ─────────────────────────────
        {
            id: 'repo',
            title_key: 'tut.advanced.repo.title',
            steps: [
                {
                    id: 's1',
                    title_key: 'tut.advanced.repo.s1.title',
                    text_key:  'tut.advanced.repo.s1.text',
                    img: 'assets/Tasky.png',
                    nav: 'repo',
                    icon: ICON.repo,
                },
                {
                    id: 's2',
                    title_key: 'tut.advanced.repo.s2.title',
                    text_key:  'tut.advanced.repo.s2.text',
                    img: 'assets/Tasky.png',
                    nav: 'repo',
                },
                {
                    id: 's3',
                    title_key: 'tut.advanced.repo.s3.title',
                    text_key:  'tut.advanced.repo.s3.text',
                    img: 'assets/Tasky_Happy.png',
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
                    img: 'assets/Tasky.png',
                    nav: 'modpacks',
                    icon: ICON.modpack,
                },
                {
                    id: 's2',
                    title_key: 'tut.advanced.modpacks.s2.title',
                    text_key:  'tut.advanced.modpacks.s2.text',
                    img: 'assets/Tasky.png',
                    nav: 'modpacks',
                },
                {
                    id: 's3',
                    title_key: 'tut.advanced.modpacks.s3.title',
                    text_key:  'tut.advanced.modpacks.s3.text',
                    img: 'assets/Tasky_Happy.png',
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
                    img: 'assets/Tasky.png',
                    nav: 'library',
                    icon: ICON.library,
                },
                {
                    id: 's2',
                    title_key: 'tut.advanced.library.s2.title',
                    text_key:  'tut.advanced.library.s2.text',
                    img: 'assets/Tasky.png',
                    nav: 'library',
                },
                {
                    id: 's3',
                    title_key: 'tut.advanced.library.s3.title',
                    text_key:  'tut.advanced.library.s3.text',
                    img: 'assets/Tasky_Happy.png',
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
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z"/><path d="M5 16l.6 1.6L7 18l-1.4.4L5 20l-.6-1.6L3 18l1.4-.4z"/></svg>`,
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
                    img: 'assets/Tasky.png',
                    icon: ICON.rocket,
                },
                {
                    id: 's2',
                    title_key: 'tut.other.launchpack.s2.title',
                    text_key:  'tut.other.launchpack.s2.text',
                    img: 'assets/Tasky_Happy.png',
                },
            ],
        },
        // ── Part 2 : Benchmark ─────────────────────────────────────
        {
            id: 'benchmark',
            title_key: 'tut.other.benchmark.title',
            steps: [
                {
                    id: 's1',
                    title_key: 'tut.other.benchmark.s1.title',
                    text_key:  'tut.other.benchmark.s1.text',
                    img: 'assets/Tasky.png',
                    nav: 'settings',
                    icon: ICON.bench,
                },
                {
                    id: 's2',
                    title_key: 'tut.other.benchmark.s2.title',
                    text_key:  'tut.other.benchmark.s2.text',
                    img: 'assets/Tasky_Happy.png',
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
                    img: 'assets/Tasky.png',
                    icon: ICON.bug,
                },
                {
                    id: 's2',
                    title_key: 'tut.other.bugreport.s2.title',
                    text_key:  'tut.other.bugreport.s2.text',
                    img: 'assets/Tasky_Happy.png',
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
