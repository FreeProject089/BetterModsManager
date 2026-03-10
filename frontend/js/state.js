/**
 * state.js — Centralized application state manager
 * Uses a publish-subscribe mechanism to broadcast state changes.
 */

class StateManager {
    constructor(initialState = {}) {
        this.state = initialState;
        this.listeners = new Map();
    }

    /**
     * Subscribe to changes for a specific key
     * @param {string} key - State key
     * @param {function} callback - Callback function
     */
    subscribe(key, callback) {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, []);
        }
        this.listeners.get(key).push(callback);
    }

    /**
     * Set a state value and notify listeners
     * @param {string} key - State key
     * @param {any} value - New value
     */
    set(key, value) {
        this.state[key] = value;
        this.notify(key, value);
    }

    /**
     * Get a state value
     * @param {string} key - State key
     */
    get(key) {
        return this.state[key];
    }

    /**
     * Notify listeners of a change
     * @param {string} key - State key
     * @param {any} value - New value
     */
    notify(key, value) {
        const keyListeners = this.listeners.get(key) || [];
        keyListeners.forEach(cb => cb(value));
    }
}

// Instantiate a global singleton state
export const appState = new StateManager({
    allMods: [], // All raw mods from backend
    displayedMods: [], // Mods currently filtered and sorted
    activeProfileId: null,
    searchQuery: '',
    currentCategory: 'ALL',
    sortMode: 'name-asc',
    // UI state
    isSelecting: false,
    selectedModIds: new Set(),

    // Extracted from mods.js
    userTags: [],
    currentFilter: 'all',
    currentSort: 'name_asc',
    selectedModId: null,
    processingMods: new Set(),
    conflictCache: {},
    isCompact: localStorage.getItem('bmm-view-compact') === 'true'
});
