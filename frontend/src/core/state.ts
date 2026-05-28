/**
 * state.ts — Centralized application state manager
 * Uses a publish-subscribe mechanism to broadcast state changes.
 */

import type { ModEntry, TagDef } from '../types/models.js';

type StateChangeCallback = (value: any) => void;

export interface AppStateShape {
    allMods: ModEntry[];
    displayedMods: ModEntry[];
    activeProfileId: string | null;
    searchQuery: string;
    currentCategory: string;
    sortMode: string;
    isSelecting: boolean;
    selectedModIds: Set<string>;
    userTags: TagDef[];
    currentFilter: string;
    currentSort: string;
    selectedModId: string | null;
    processingMods: Set<string>;
    isGlobalProcessing: boolean;
    conflictCache: Record<string, any[]>;
    cachedActiveProfileId: string | null;
    isCompact: boolean;
    debugMode: boolean;
    currentTagFilter: string;
    [key: string]: unknown;
}

class StateManager {
    state: AppStateShape;
    listeners: Map<string, StateChangeCallback[]>;
    onChange?: (key: string, value: any) => void;

    constructor(initialState: AppStateShape) {
        this.state = initialState;
        this.listeners = new Map();
    }

    /**
     * Subscribe to changes for a specific key
     */
    subscribe(key: string, callback: StateChangeCallback): void {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, []);
        }
        this.listeners.get(key)!.push(callback);
    }

    /**
     * Set a state value and notify listeners
     */
    set(key: string, value: any): void {
        (this.state as any)[key] = value;
        if (this.onChange) this.onChange(key, value);
        this.notify(key, value);
    }

    /**
     * Get a state value
     */
    get(key: string): any {
        return (this.state as any)[key];
    }

    /**
     * Notify listeners of a change
     */
    notify(key: string, value: any): void {
        const keyListeners = this.listeners.get(key) || [];
        keyListeners.forEach(cb => cb(value));
    }

    /**
     * Flushes heavy caches to free memory — both JS-side state and the
     * Rust-side mod_files_cache/conflict_index/hash index.
     */
    flushMemory(): void {
        console.log("[STATE] Flushing memory caches...");
        this.state.conflictCache = {};
        this.notify('conflictCache', {});
        // Ask Rust to free its caches too.  Best-effort, silent on error.
        try {
            const w: any = window;
            const inv = w.__TAURI__?.invoke || w.invoke;
            if (inv) inv('flush_mem_caches').catch(() => {});
        } catch {}
    }
}

// Instantiate a global singleton state
export const appState = new StateManager({
    allMods: [],
    displayedMods: [],
    activeProfileId: null,
    searchQuery: '',
    currentCategory: 'ALL',
    sortMode: 'name-asc',
    isSelecting: false,
    selectedModIds: new Set(),
    userTags: [],
    currentFilter: 'all',
    currentSort: 'name_asc',
    selectedModId: null,
    processingMods: new Set(),
    isGlobalProcessing: false,
    conflictCache: {},
    cachedActiveProfileId: null,
    isCompact: localStorage.getItem('bmm-view-compact') === 'true',
    debugMode: false,
    currentTagFilter: 'all'
});
