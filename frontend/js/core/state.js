/**
 * state.ts — Centralized application state manager
 * Uses a publish-subscribe mechanism to broadcast state changes.
 */
class StateManager {
    state;
    listeners;
    onChange;
    constructor(initialState) {
        this.state = initialState;
        this.listeners = new Map();
    }
    /**
     * Subscribe to changes for a specific key
     */
    subscribe(key, callback) {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, []);
        }
        this.listeners.get(key).push(callback);
    }
    /**
     * Set a state value and notify listeners
     */
    set(key, value) {
        this.state[key] = value;
        if (this.onChange)
            this.onChange(key, value);
        this.notify(key, value);
    }
    /**
     * Get a state value
     */
    get(key) {
        return this.state[key];
    }
    /**
     * Notify listeners of a change
     */
    notify(key, value) {
        const keyListeners = this.listeners.get(key) || [];
        keyListeners.forEach(cb => cb(value));
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
//# sourceMappingURL=state.js.map