import { debugHub } from './debug.js';
import { appState } from './state.js';
import { invoke } from './api.js';
import { t, applyTranslations } from './i18n.js';

/**
 * debug-ui.js — UI Logic for BMM DevTools
 */

class DebugUI {
    constructor() {
        this.isOpen = false;
        this.activeTab = 'console';
        this.isInspecting = false;
        this.hoveredEl = null;
        this.selectedEl = null;
        this.highlightEl = null;
        this.tooltipEl = null;
        this.container = null;
        this.modalOverlay = null;
        this.crashOverlay = null;

        // Tool state
        this.a11yWarnings = false;
        this.a11yReader = false;
        this.jsEvents = false;
        this.jsDynamic = false;
        this.mutationObserver = null;
        this.a11yInterval = null;
    }

    // Helper to find elements within devtools containers
    _get(id) {
        if (!this.container) return document.getElementById(id);
        return this.container.querySelector(`#${id}`) || 
               (this.modalOverlay ? this.modalOverlay.querySelector(`#${id}`) : null) ||
               (this.crashOverlay ? this.crashOverlay.querySelector(`#${id}`) : null) ||
               document.getElementById(id);
    }

    init() {
        if (this.container) return; // Already initialized
        
        // Ensure no leftover overlay from previous failed init or duplicate call
        const existing = document.getElementById('bmm-debug-overlay');
        if (existing) existing.remove();

        this.createContainer();
        this.createContextMenu();
        this.attachListeners();
        this.translateUI();
        this.loadSources();
        this.startUpdateLoop();
        console.info('[BMM-Debug] UI Initialized. Toggle with Ctrl+Alt+D');
    }

    toggle(force) {
        // Strict lock check
        if (!appState.get('debugMode') && force !== true) return;

        if (!this.container) this.init();
        
        this.isOpen = force !== undefined ? force : !this.isOpen;
        this.container.classList.toggle('open', this.isOpen);
        
        if (this.isOpen) {
            this.updateStateView();
            // Refresh sources only if needed
            if (!this.currentSource) this.loadSources();
            
            this.translateUI();

            // Adjust z-index to be on top when opened
            this.container.style.zIndex = '200000';
        } else {
            this.toggleInspector(false);
            this.container.style.zIndex = '20000';
        }
    }

    createContainer() {
        // Double check removal
        const old = document.getElementById('bmm-debug-overlay');
        if (old) old.remove();

        const div = document.createElement('div');
        div.id = 'bmm-debug-overlay';
        div.innerHTML = `
            <div class="debug-header">
                <div class="debug-title">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/></svg>
                    BMM DEVTOOLS
                </div>
                <div class="debug-controls">
                    <button class="debug-btn" id="debug-btn-inspect" title="Inspect Element">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="22" x2="12" y2="18"/></svg>
                    </button>
                    <button class="debug-btn" id="debug-btn-export" title="Export Session">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                    </button>
                    <button class="debug-btn" id="dbg-clear-all" title="Clear All">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
                    </button>
                    <button class="debug-btn" id="debug-btn-close" title="Close">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            </div>
            <div class="debug-tabs">
                <div class="debug-tab active" data-tab="console" data-i18n="dev.tab.console">Console</div>
                <div class="debug-tab" data-tab="timeline" data-i18n="dev.tab.timeline">Timeline</div>
                <div class="debug-tab" data-tab="debugger" data-i18n="dev.tab.debugger">Debugger</div>
                <div class="debug-tab" data-tab="inspect-view" data-i18n="dev.tab.inspect">Inspect</div>
                <div class="debug-tab" data-tab="sources" data-i18n="dev.tab.sources">Sources</div>
                <div class="debug-tab" data-tab="state" data-i18n="dev.tab.state">State</div>
                <div class="debug-tab" data-tab="playground" data-i18n="dev.tab.playground">Playground</div>
            </div>
            <div class="debug-content">
                <div class="debug-pane active" id="pane-console">
                    <div class="console-tools" style="padding:8px; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; gap:8px">
                    <input type="text" id="console-search" data-i18n-placeholder="dev.placeholder.search" placeholder="Search..." style="flex:1; background:rgba(0,0,0,0.2); border:1px solid var(--debug-border); border-radius:4px; color:white; font-size:10px; padding:4px 8px; outline:none">
                        <button class="debug-btn" id="console-clear-manual" data-i18n-title="dev.btn.clearConsole" title="Clear Console">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
                        </button>
                    </div>
                    <div id="console-logs" style="flex:1; overflow-y:auto"></div>
                </div>
                <div class="debug-pane" id="pane-timeline">
                    <div class="timeline-filters" style="padding:8px; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; gap:6px; align-items:center">
                        <button class="filter-btn active" data-filter="all" data-i18n="dev.label.all">ALL</button>
                        <button class="filter-btn" data-filter="ipc" data-i18n="dev.label.ipc">IPC</button>
                        <button class="filter-btn" data-filter="logs" data-i18n="dev.label.logs">LOGS</button>
                        <button class="filter-btn" data-filter="tasks" data-i18n="dev.label.tasks">TASKS</button>
                        <button class="filter-btn" data-filter="error" data-i18n="dev.label.error">ERR</button>
                        <div style="flex:1"></div>
                        <button class="debug-btn" id="timeline-clear-manual" data-i18n-title="dev.btn.clearHistory" title="Clear History">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
                        </button>
                    </div>
                    <div id="timeline-list" style="flex:1; overflow-y:auto"></div>
                </div>
                <div class="debug-pane" id="pane-debugger">
                    <div class="debugger-layout" style="display:flex; height:100%; flex-direction:column">
                        <div class="debugger-subtabs" style="display:flex; border-bottom:1px solid rgba(255,255,255,0.05); background:rgba(0,0,0,0.1)">
                            <div class="debug-subtab active" data-sub="js" data-i18n="dev.subtab.js">JS</div>
                            <div class="debug-subtab" data-sub="rust" data-i18n="dev.subtab.rust">RUST</div>
                            <div class="debug-subtab" data-sub="html" data-i18n="dev.subtab.html">HTML</div>
                            <div class="debug-subtab" data-sub="css" data-i18n="dev.subtab.css">CSS</div>
                        </div>
                        <div class="debugger-subcontent" style="flex:1; position:relative; overflow:hidden">
                            <div class="debug-subpane active" id="subpane-js" style="height:100%; display:flex; flex-direction:column">
                                <div style="padding:12px 16px; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.2)">
                                    <div>
                                        <div style="font-size:13px; font-weight:600; color:white; margin-bottom:2px" data-i18n="dev.title.js">Vanilla JS Debugger</div>
                                        <div style="font-size:11px; color:var(--text-muted)" data-i18n="dev.msg.jsDesc">Press F12 to open Chrome DevTools or inspect below.</div>
                                    </div>
                                    <button class="debug-btn debug-btn-primary" id="js-open-devtools" style="font-size:10px; padding:4px 12px" data-i18n="dev.btn.openDevtools">OPEN DEVTOOLS</button>
                                </div>
                                <div style="flex:1; overflow-y:auto; padding:8px" id="js-errors">
                                    <div style="color:var(--text-muted); font-size:10px" data-i18n="dev.msg.noJsErrors">No JS errors recorded.</div>
                                </div>
                                <div style="height:150px; border-top:1px solid var(--debug-border); display:flex; flex-direction:column">
                                    <div style="padding:4px 8px; font-size:10px; color:var(--text-muted); background:rgba(0,0,0,0.2); display:flex; justify-content:space-between">
                                        <span data-i18n="dev.label.repl">REPL & Watchers</span>
                                        <button class="debug-btn debug-btn-ghost" id="js-add-watcher" style="padding:0; font-size:10px; height:auto" data-i18n="dev.btn.addWatcher">ADD</button>
                                    </div>
                                    <div style="flex:1; overflow-y:auto; padding:4px" id="js-watchers"></div>
                                    <div style="display:flex; border-top:1px solid var(--debug-border)">
                                        <span style="color:var(--debug-accent); padding:4px 8px; font-family:'JetBrains Mono'; font-size:11px">&gt;</span>
                                        <input type="text" id="js-repl-input" style="flex:1; background:transparent; border:none; color:white; font-family:'JetBrains Mono'; font-size:11px; outline:none" data-i18n-placeholder="dev.placeholder.eval" placeholder="Evaluate an expression...">
                                    </div>
                                </div>
                            </div>
                            <div class="debug-subpane" id="subpane-rust" style="height:100%; display:flex; flex-direction:column; display:none">
                                <div style="padding:12px 16px; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.2)">
                                    <div>
                                        <div style="font-size:13px; font-weight:600; color:white; margin-bottom:2px" data-i18n="dev.title.rust">Rust Debugger (GDB/LLDB)</div>
                                        <div style="font-size:11px; color:var(--text-muted)" data-i18n="dev.msg.rustDesc">Attach a native debugger or view backend logs.</div>
                                    </div>
                                    <div style="display:flex; gap:8px">
                                        <button class="debug-btn debug-btn-ghost" id="rust-copy-lldb" style="font-size:10px; padding:4px 12px; border:1px solid rgba(255,255,255,0.1)" data-i18n="dev.btn.copyCmd">COPY CMD</button>
                                        <button class="debug-btn debug-btn-primary" id="rust-refresh-logs" style="font-size:10px; padding:4px 12px" data-i18n="dev.btn.refreshLogs">REFRESH LOGS</button>
                                    </div>
                                </div>
                                <div style="flex:1; overflow-y:auto; padding:8px; font-family:'JetBrains Mono'; font-size:10px; user-select:text" id="rust-logs-container">
                                    <div style="color:var(--text-muted)" data-i18n="dev.msg.clickRefresh">Click Refresh to load logs...</div>
                                </div>
                            </div>
                            <div class="debug-subpane" id="subpane-html" style="height:100%; overflow-y:auto; padding:8px; display:none">
                                <div style="margin-bottom:8px; display:flex; gap:8px">
                                    <button class="debug-btn" id="html-refresh-dom" style="font-size:10px; padding:2px 8px" data-i18n="dev.btn.refreshDom">Generate DOM Tree</button>
                                    <button class="debug-btn debug-btn-ghost" id="html-collapse-all" style="font-size:10px; padding:2px 8px" data-i18n="dev.btn.collapseAll">Collapse All</button>
                                </div>
                                <div id="html-dom-tree" style="font-family:'JetBrains Mono'; font-size:11px"></div>
                            </div>
                            <div class="debug-subpane" id="subpane-css" style="height:100%; display:flex; flex-direction:column; display:none">
                                <div style="flex:1; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:16px">
                                    <div style="background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.05); border-radius:6px; padding:16px;">
                                        <div style="font-size:11px; text-transform:uppercase; letter-spacing:1px; color:var(--text-muted); margin-bottom:16px; font-weight:700" data-i18n="dev.title.design">Design & Accessibility Tools</div>
                                        <div id="dbg-css-toggles-grid" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:12px; margin-bottom:16px">
                                            <div class="debug-toggle-row">
                                                <div class="debug-toggle-info">
                                                    <div class="debug-toggle-title" data-i18n="dev.tool.cssPink.title">CSS Debugging</div>
                                                    <div class="debug-toggle-desc" data-i18n="dev.tool.cssPink.desc">Outline all elements.</div>
                                                </div>
                                                <div style="display:flex; align-items:center; gap:4px">
                                                    <input type="color" id="dbg-css-color" value="#ff1493" style="width:20px; height:20px; border:none; padding:0; cursor:pointer; border-radius:4px">
                                                    <input type="checkbox" id="dbg-css-pink" class="debug-switch debug-switch-pink">
                                                </div>
                                            </div>

                                            <div class="debug-toggle-row">
                                                <div class="debug-toggle-info">
                                                    <div class="debug-toggle-title" data-i18n="dev.tool.zIndex.title">Z-Index Layers</div>
                                                    <div class="debug-toggle-desc" data-i18n="dev.tool.zIndex.desc">Layer viewer.</div>
                                                </div>
                                                <input type="checkbox" id="dbg-css-zindex" class="debug-switch debug-switch-pink">
                                            </div>

                                            <div class="debug-toggle-row">
                                                <div class="debug-toggle-info">
                                                    <div class="debug-toggle-title" data-i18n="dev.tool.cssEvents.title">Event Components</div>
                                                    <div class="debug-toggle-desc" data-i18n="dev.tool.cssEvents.desc">Highlights elements with events (onclick, href) in green.</div>
                                                </div>
                                                <input type="checkbox" id="dbg-css-events" class="debug-switch debug-switch-blue">
                                            </div>

                                            <div class="debug-toggle-row">
                                                <div class="debug-toggle-info">
                                                    <div class="debug-toggle-title" data-i18n="dev.tool.cssInteractive.title">Interactive Components (Hi-Vis)</div>
                                                    <div class="debug-toggle-desc" data-i18n="dev.tool.cssInteractive.desc">Highlights all graphical interface hitboxes.</div>
                                                </div>
                                                <input type="checkbox" id="dbg-css-interactive" class="debug-switch debug-switch-blue">
                                            </div>

                                            <div class="debug-toggle-row">
                                                <div class="debug-toggle-info">
                                                    <div class="debug-toggle-title" data-i18n="dev.tool.a11yWarnings.title">Live Accessibility Warnings</div>
                                                    <div class="debug-toggle-desc" data-i18n="dev.tool.a11yWarnings.desc">Signals missing alt/label attributes.</div>
                                                </div>
                                                <input type="checkbox" id="dbg-a11y-warnings" class="debug-switch debug-switch-warning">
                                            </div>

                                            <div class="debug-toggle-row">
                                                <div class="debug-toggle-info">
                                                    <div class="debug-toggle-title" data-i18n="dev.tool.a11yReader.title">Screen Reader Simulation</div>
                                                    <div class="debug-toggle-desc" data-i18n="dev.tool.a11yReader.desc">Displays what assistive tools see.</div>
                                                </div>
                                                <input type="checkbox" id="dbg-a11y-reader" class="debug-switch debug-switch-pink">
                                            </div>

                                            <div class="debug-toggle-row">
                                                <div class="debug-toggle-info">
                                                    <div class="debug-toggle-title" data-i18n="dev.tool.jsEvents.title">Event Overlay (All types)</div>
                                                    <div class="debug-toggle-desc" data-i18n="dev.tool.jsEvents.desc">Highlights elements with JS listeners.</div>
                                                </div>
                                                <input type="checkbox" id="dbg-js-events" class="debug-switch debug-switch-blue">
                                            </div>

                                            <div class="debug-toggle-row">
                                                <div class="debug-toggle-info">
                                                    <div class="debug-toggle-title" data-i18n="dev.tool.a11yHardcoded.title">Hardcoded Text</div>
                                                    <div class="debug-toggle-desc" data-i18n="dev.tool.a11yHardcoded.desc">Detects non-i18n text.</div>
                                                </div>
                                                <input type="checkbox" id="dbg-a11y-hardcoded" class="debug-switch debug-switch-warning">
                                            </div>

                                            <div class="debug-toggle-row">
                                                <div class="debug-toggle-info">
                                                    <div class="debug-toggle-title" data-i18n="dev.tool.cssGrid.title">Layout Grid</div>
                                                    <div class="debug-toggle-desc" data-i18n="dev.tool.cssGrid.desc">Customizable grid.</div>
                                                </div>
                                                <input type="checkbox" id="dbg-css-grid" class="debug-switch debug-switch-blue">
                                            </div>
                                        </div>

                                        <div id="dbg-grid-config" style="display:none; padding-top:12px; border-top:1px dashed rgba(255,255,255,0.1)">
                                            <div style="margin-bottom:12px">
                                                <div style="display:flex; justify-content:space-between; margin-bottom:4px">
                                                    <div id="dbg-label-grid-h" style="font-size:12px; font-weight:600; color:white" data-i18n="dev.label.gridH">Horizontal Spacing</div>
                                                    <div style="font-size:12px; color:var(--text-muted)"><span id="dbg-grid-h-val">16</span>px</div>
                                                </div>
                                                <input type="range" id="dbg-grid-h" min="0" max="64" value="16" class="custom-range" style="width:100%; --val:25%">
                                            </div>
                                            <div>
                                                <div style="display:flex; justify-content:space-between; margin-bottom:4px">
                                                    <div id="dbg-label-grid-v" style="font-size:12px; font-weight:600; color:white" data-i18n="dev.label.gridV">Vertical Spacing</div>
                                                    <div style="font-size:12px; color:var(--text-muted)"><span id="dbg-grid-v-val">16</span>px</div>
                                                </div>
                                                <input type="range" id="dbg-grid-v" min="0" max="64" value="16" class="custom-range" style="width:100%; --val:25%">
                                            </div>
                                        </div>
                                    </div>

                                    <div style="display:flex; justify-content:space-between; align-items:center; padding:0 4px">
                                        <select id="css-stylesheet-select" style="background:rgba(0,0,0,0.3); border:1px solid var(--debug-border); color:white; padding:4px; font-size:11px; border-radius:4px; outline:none; max-width:200px">
                                            <option value="" data-i18n="dev.msg.selectStylesheet">Select a stylesheet...</option>
                                        </select>
                                        <input type="text" id="css-rule-search" data-i18n-placeholder="dev.placeholder.filter" placeholder="Filter..." style="background:rgba(0,0,0,0.3); border:1px solid var(--debug-border); padding:4px 8px; font-size:11px; color:white; border-radius:4px; outline:none; width:120px">
                                    </div>

                                    <div style="flex:1; overflow-y:auto; min-height:100px" id="css-rules-container">
                                        <div style="color:var(--text-muted); font-size:10px; text-align:center; margin-top:20px" data-i18n="dev.msg.selectStylesheet">Select a stylesheet to view/edit rules, or use the Inspect panel.</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="debug-pane" id="pane-inspect-view">
                    <div id="inspect-header" style="padding:8px 16px; border-bottom:1px solid var(--debug-border); display:none; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.02)">
                        <span style="font-size:10px; font-weight:700; color:var(--text-muted)" data-i18n="dev.label.inspector">INSPECTOR</span>
                                <button class="debug-btn debug-btn-ghost" id="inspect-btn-clear" style="font-size:10px; padding:4px 10px" data-i18n="dev.btn.clearSelection">CLEAR SELECTION</button>
                    </div>
                    <div id="inspect-content" style="padding:16px; border-bottom:1px solid var(--debug-border); overflow-y:auto; height:100%">
                        <div style="color:var(--text-muted); font-size:11px" data-i18n="dev.msg.selectElement">Select an element to inspect...</div>
                    </div>
                </div>
                <div class="debug-pane" id="pane-sources">
                    <div class="sources-layout">
                        <div class="sources-tree-container" style="display:flex; flex-direction:column; border-right:1px solid var(--debug-border); background:rgba(0,0,0,0.1)">
                            <div style="padding:8px; border-bottom:1px solid var(--debug-border); display:flex; justify-content:space-between; align-items:center">
                                <span style="font-size:10px; font-weight:700; color:var(--text-muted)" data-i18n="dev.label.project">PROJECT</span>
                                <button class="debug-btn" id="sources-refresh" data-i18n-title="dev.btn.refreshFiles" title="Refresh Files">
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                                </button>
                            </div>
                            <div class="sources-tree" style="flex:1; overflow-y:auto; padding:8px 0"></div>
                        </div>
                        <div class="sources-editor">
                            <div id="sources-code-container" style="height:100%; position:relative">
                                <pre id="sources-code" style="margin:0; padding:16px; font-family:'JetBrains Mono'; font-size:11px; color:var(--text-muted)" data-i18n="dev.msg.selectSourceFile">Select a file to view source...</pre>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="debug-pane" id="pane-state"></div>
                <div class="debug-pane" id="pane-playground">
                    <div style="padding:16px">
                        <div style="margin-bottom:12px; font-size:10px; color:var(--text-muted); display:flex; justify-content:space-between">
                            <span data-i18n="dev.label.hotPatch">HOT-PATCH: CSS / JS</span>
                            <div style="display:flex; gap:8px">
                                <button id="playground-reset" class="debug-btn debug-btn-ghost" style="color:var(--debug-accent); font-size:10px; padding:2px 6px" data-i18n="dev.btn.reset">RESET</button>
                                <button id="playground-export" class="debug-btn debug-btn-ghost" style="color:var(--debug-success); font-size:10px; padding:2px 6px" data-i18n="dev.btn.exportPatch">EXPORT PATCH</button>
                            </div>
                        </div>
                        <textarea id="playground-code" style="width:100%; height:120px; background:rgba(0,0,0,0.3); border:1px solid var(--debug-border); border-radius:8px; color:var(--debug-accent); font-family:inherit; padding:12px; font-size:11px; outline:none" data-i18n-placeholder="dev.placeholder.playground" placeholder="/* Enter CSS or JS here... */"></textarea>
                        <div style="margin-top:12px; display:flex; gap:8px">
                            <button class="debug-btn debug-btn-primary" style="flex:1" id="playground-apply-css" data-i18n="dev.btn.applyCss">APPLIQUER CSS</button>
                            <button class="debug-btn debug-btn-success" style="flex:1" id="playground-run-js" data-i18n="dev.btn.runJs">EXÉCUTER JS</button>
                        </div>
                        <div style="margin-top:20px; font-size:10px; color:var(--text-muted)" data-i18n="dev.label.activePatches">ACTIVE PATCHES</div>
                        <div id="patch-tree" style="margin-top:8px; display:flex; flex-direction:column; gap:6px"></div>
                    </div>
                </div>
            </div>
            <div class="debug-footer">
                <div class="metric-item"><span data-i18n="dev.metric.fps">FPS: </span><b id="dbg-fps">0</b></div>
                <div class="metric-item"><span data-i18n="dev.metric.heap">Heap: </span><b id="dbg-mem">0MB</b></div>
                <div class="metric-item"><span data-i18n="dev.metric.pid">PID: </span><b id="dbg-pid">-</b></div>
                <div class="metric-item"><span data-i18n="dev.metric.uptime">Uptime: </span><b id="dbg-uptime">0s</b></div>
            </div>
            <div class="debug-resizer"></div>
        `;
        document.body.appendChild(div);
        this.container = div;

        // Modal components
        const modalOverlay = document.createElement('div'); // Declare modalOverlay here
        modalOverlay.className = 'debug-modal-overlay';
        modalOverlay.innerHTML = `
            <div id="debug-modal-content" class="debug-modal-content">
                <h3 id="debug-modal-title" style="margin:0 0 12px 0; font-size:18px; color:var(--text-primary); font-weight:800" data-i18n="dev.modal.confirmTitle">Confirm Action</h3>
                <p id="debug-modal-text" style="margin:0 0 24px 0; font-size:14px; color:var(--text-secondary); line-height:1.6; opacity:0.8" data-i18n="dev.modal.confirmText">Are you sure?</p>
                <div id="debug-modal-input-container" style="display:none; margin-bottom:24px">
                    <input type="text" id="debug-modal-input" style="width:100%; padding:12px; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:white; outline:none; font-family:'JetBrains Mono'">
                </div>
                <div style="display:flex; justify-content:flex-end; gap:12px">
                    <button id="debug-modal-cancel" class="debug-btn debug-btn-ghost" style="padding:10px 20px" data-i18n="common.cancel">Cancel</button>
                    <button id="debug-modal-confirm" class="debug-btn debug-btn-primary" style="padding:10px 32px" data-i18n="common.ok">OK</button>
                </div>
            </div>
        `;
        this.modalOverlay = modalOverlay;
        this.container.appendChild(modalOverlay); // Append to DevTools container instead of body!

        // Load persisted position/size
        this.loadPosition();

        // Create Crash Overlay
        const crashDiv = document.createElement('div');
        crashDiv.className = 'debug-crash-overlay';
        crashDiv.innerHTML = `
            <div style="background: radial-gradient(circle at center, rgba(239, 68, 68, 0.15) 0%, transparent 70%); position: absolute; top:0; left:0; right:0; bottom:0; z-index:-1; pointer-events:none;"></div>
            <img src="assets/Tasky.png" style="width:120px; height:auto; filter: grayscale(1) contrast(2) brightness(0.6) sepia(1) hue-rotate(-50deg) drop-shadow(0 0 30px rgba(239, 68, 68, 0.3)); margin-bottom:32px; opacity:0.8; animation: pulse-tasky 4s infinite;">
            <div class="crash-title" style="letter-spacing: 0.2em; font-size: 28px; font-weight: 900; background: linear-gradient(to bottom, #ffffff, #94a3b8); -webkit-background-clip: text; -webkit-text-fill-color: transparent;" data-i18n="dev.crash.title">SYSTEM HALT</div>
            <div class="crash-subtitle" style="color: var(--danger); font-weight: 800; font-family: var(--font-mono); margin-bottom: 24px; text-shadow: 0 0 15px rgba(239, 68, 68, 0.4);" data-i18n="dev.crash.subtitle">CRITICAL_LEVEL_EXCEPTION // KERNEL_PANIC_PREVENTED</div>
            
            <div class="crash-details" id="crash-details" style="background: rgba(0,0,0,0.4); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 12px; padding: 24px; margin: 20px 0; max-width: 600px; line-height: 1.6; font-size: 13px; color: #cbd5e1; box-shadow: inset 0 2px 10px rgba(0,0,0,0.5);" data-i18n="dev.crash.details">
                An unhandled exception has occurred. A debug dump has been saved to your local storage.
            </div>

            <div style="display:flex; flex-direction:column; align-items:center; gap:24px; margin-top: 40px; width: 100%; max-width: 480px;">
                <div style="display:flex; flex-direction:row; align-items:center; justify-content:center; gap:16px; width:100%;">
                    <button class="debug-btn" style="flex:1; background: linear-gradient(135deg, rgba(239,68,68,0.9), rgba(185,28,28,0.9)); color:white; padding:16px; border-radius:12px; font-weight:800; border:1px solid rgba(248, 113, 113, 0.5); cursor:pointer; box-shadow: 0 8px 32px rgba(239, 68, 68, 0.3); text-transform: uppercase; letter-spacing: 0.1em; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); font-size: 13px; backdrop-filter: blur(8px);" data-i18n="dev.crash.reload">
                        RELOAD APPLICATION
                    </button>
                    <button class="debug-btn" style="flex:1; background: rgba(30,41,59,0.5); color:#f8fafc; padding:16px; border-radius:12px; border:1px solid rgba(255,255,255,0.1); cursor:pointer; font-weight: 700; backdrop-filter: blur(12px); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); text-transform: uppercase; letter-spacing: 0.05em; font-size: 13px; box-shadow: 0 4px 16px rgba(0,0,0,0.2);" id="crash-copy-dump" data-i18n="dev.crash.copyDump">
                        COPY DUMP
                    </button>
                </div>
                
                <button class="debug-btn" style="background:none; color:rgba(239, 68, 68, 0.7); font-size:12px; font-weight: 600; text-decoration:none; border:none; cursor:pointer; transition: all 0.2s; padding: 10px 20px; border-radius: 8px; white-space: nowrap; display: inline-block; width: max-content;" id="crash-dismiss" data-i18n="dev.crash.dismiss">
                    Dismiss & Continue (Unstable System State)
                </button>
            </div>

            <div style="margin-top:60px; font-size:10px; color:rgba(255,255,255,0.2); font-family:var(--font-mono); border-top: 1px solid rgba(255,255,255,0.05); padding-top: 24px; letter-spacing: 1px; width: 80%; text-align: center;">BMM_OS_DEBUG_v0.9.8 // ${new Date().toISOString()}</div>
        `;
        this.container.appendChild(crashDiv); // Append to DevTools container
        this.crashOverlay = crashDiv;

        this.crashOverlay.querySelector('#crash-copy-dump').onclick = () => {
            const dump = localStorage.getItem('bmm_last_crash_dump');
            navigator.clipboard.writeText(dump);
            const btn = this.crashOverlay.querySelector('#crash-copy-dump');
            const originalText = btn.textContent;
            btn.textContent = 'COPIED!';
            btn.style.borderColor = 'var(--debug-success)';
            btn.style.color = 'var(--debug-success)';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.borderColor = 'rgba(255,255,255,0.1)';
                btn.style.color = 'white';
            }, 2000);
        };

        this.crashOverlay.querySelector('#crash-dismiss').onclick = () => {
            if (confirm(t('dev.crash.dismissConfirm'))) {
                this.crashOverlay.classList.remove('active');
            }
        };

        // Highlight & Tooltip for inspector
        this.highlightEl = document.createElement('div');
        this.highlightEl.className = 'debug-inspect-highlight';
        this.highlightEl.style.display = 'none';
        document.body.appendChild(this.highlightEl);

        this.tooltipEl = document.createElement('div');
        this.tooltipEl.className = 'debug-inspect-tooltip';
        this.tooltipEl.style.display = 'none';
        document.body.appendChild(this.tooltipEl);

        this.translateUI();
    }

    showConfirm(title, text, onConfirm) {
        if (!this.container) this.init();
        if (!this.isOpen) return; // Don't show DevTools modals if DevTools is closed

        const overlay = this.modalOverlay;
        const titleEl = this._get('debug-modal-title');
        const textEl = this._get('debug-modal-text');
        const confirmBtn = this._get('debug-modal-confirm');
        const cancelBtn = this._get('debug-modal-cancel');
        const inputContainer = this._get('debug-modal-input-container');

        titleEl.textContent = title || t('dev.modal.confirmTitle');
        textEl.textContent = text || t('dev.modal.confirmText');
        inputContainer.style.display = 'none';
        cancelBtn.style.display = 'block'; // Ensure cancel button is visible for confirm

        const close = () => {
            overlay.classList.remove('active');
            setTimeout(() => { if (!overlay.classList.contains('active')) overlay.style.display = 'none'; }, 300);
        };

        overlay.style.display = 'flex';
        setTimeout(() => overlay.classList.add('active'), 10);

        confirmBtn.onclick = () => {
            if (onConfirm) onConfirm();
            close();
        };
        cancelBtn.onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
    }

    showPrompt(title, text, defaultValue, onConfirm) {
        if (!this.container) this.init();
        if (!this.isOpen) return;

        const overlay = this.modalOverlay;
        const titleEl = this._get('debug-modal-title');
        const textEl = this._get('debug-modal-text');
        const inputContainer = this._get('debug-modal-input-container');
        const input = this._get('debug-modal-input');
        const confirmBtn = this._get('debug-modal-confirm');
        const cancelBtn = this._get('debug-modal-cancel');
        
        titleEl.textContent = title || t('dev.modal.confirmTitle');
        textEl.textContent = text || t('dev.modal.confirmText');
        inputContainer.style.display = 'block';
        input.value = defaultValue || '';
        cancelBtn.style.display = 'block'; // Ensure cancel button is visible for prompt

        const close = () => {
            overlay.classList.remove('active');
            setTimeout(() => { if (!overlay.classList.contains('active')) overlay.style.display = 'none'; }, 300);
        };

        overlay.style.display = 'flex';
        setTimeout(() => {
            overlay.classList.add('active');
            input.focus();
        }, 10);

        cancelBtn.onclick = close;
        confirmBtn.onclick = () => {
            if (onConfirm) onConfirm(input.value);
            close();
        };
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
    }

    showAlert(title, text) {
        if (!this.container) this.init();
        // Allow alerts if explicitly triggered, but they will only be visible if DevTools is open
        // OR we can explicitly open DevTools for important alerts? 
        // User said they are visible when NOT activated, so we should probably not show them or open DevTools.
        if (!this.isOpen) return; 

        const overlay = this.modalOverlay;
        const titleEl = this._get('debug-modal-title');
        const textEl = this._get('debug-modal-text');
        const confirmBtn = this._get('debug-modal-confirm');
        const cancelBtn = this._get('debug-modal-cancel');
        const inputContainer = this._get('debug-modal-input-container');

        titleEl.textContent = title || t('common.error');
        textEl.textContent = text;
        cancelBtn.style.display = 'none'; // Only OK for alert
        inputContainer.style.display = 'none';

        const close = () => {
            overlay.classList.remove('active');
            setTimeout(() => { 
                if (!overlay.classList.contains('active')) {
                    overlay.style.display = 'none';
                    cancelBtn.style.display = 'block'; // Restore for next calls
                }
            }, 300);
        };

        overlay.style.display = 'flex';
        setTimeout(() => overlay.classList.add('active'), 10);

        confirmBtn.onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
    }

    attachListeners() {
        // Tab switching
        this.container.querySelectorAll('.debug-tab').forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
        });

        // Live language update
        document.addEventListener('langChanged', () => {
            this.translateUI();
        });

        // Debugger Sub-tab switching
        this.container.querySelectorAll('.debug-subtab').forEach(t => {
            t.addEventListener('click', () => {
                const subId = t.dataset.sub;
                this.switchDebuggerSubtab(subId);
            });
        });

        // Debugger JS
        this._get('js-open-devtools')?.addEventListener('click', async () => {
            try {
                if (window.__TAURI__ && window.__TAURI__.tauri) {
                    await window.__TAURI__.tauri.invoke('plugin:devtools|open');
                }
            } catch (e) {
                console.log("F12 is the standard fallback for opening DevTools.", e);
                this.showAlert('Vanilla JS Debugger', "Tauri devtools API couldn't be invoked automatically. Please press F12 on your keyboard to open the Chrome DevTools inspector.");
            }
        });

        this._get('js-add-watcher')?.addEventListener('click', () => {
            const input = this._get('js-repl-input');
            const cmd = input?.value.trim();
            if (cmd) {
                this.evalJSCommand(cmd);
                if (input) input.value = '';
            }
        });

        this._get('js-repl-input')?.addEventListener('keydown', e => {
            if (e.key === 'Enter') {
                const val = e.target.value.trim();
                if (val) {
                    this.evalJSCommand(val);
                    e.target.value = '';
                }
            }
        });

        // Debugger Rust
        this._get('rust-copy-lldb')?.addEventListener('click', () => {
            const isWindows = navigator.userAgent.includes('Windows');
            const cmd = isWindows ? 'rust-gdb target/debug/better-mods-manager.exe' : 'rust-lldb target/debug/better-mods-manager';
            this.copyToClipboard(cmd);
            this.showAlert('Rust Debugger Command Copied', `Copied: ${cmd}\n\nPaste this in your terminal to attach LLDB/GDB. You must run the app in debug mode.`);
        });

        this._get('rust-refresh-logs')?.addEventListener('click', () => this.refreshRustLogs());

        // Debugger HTML
        this._get('html-refresh-dom')?.addEventListener('click', () => this.buildDomTree());
        this._get('html-collapse-all')?.addEventListener('click', () => {
            const tree = this._get('html-dom-tree');
            if (tree) {
                tree.querySelectorAll('.dom-children').forEach(el => el.style.display = 'none');
                tree.querySelectorAll('.dom-toggle').forEach(el => el.textContent = '▶');
            }
        });

        // Debugger CSS
        this._get('css-stylesheet-select')?.addEventListener('change', e => this.loadStylesheet(e.target.value));
        this._get('css-rule-search')?.addEventListener('input', e => this.filterCSSRules(e.target.value));

        // Debugger CSS - A11y & Design Tools
        this._get('dbg-css-pink')?.addEventListener('change', e => {
            document.body.classList.toggle('bmm-debug-pink', e.target.checked);
        });

        this._get('dbg-css-color')?.addEventListener('input', e => {
            document.documentElement.style.setProperty('--bmm-dbg-color', e.target.value);
        });

        this._get('dbg-css-interactive')?.addEventListener('change', e => {
            document.body.classList.toggle('bmm-debug-interactive', e.target.checked);
        });

        this._get('dbg-css-zindex')?.addEventListener('change', e => {
            if (e.target.checked) {
                document.querySelectorAll('*').forEach(el => {
                    if(!el.style) return;
                    const z = window.getComputedStyle(el).zIndex;
                    if (z !== 'auto' && z !== '0') {
                        el.dataset.bmmZIndex = z;
                        el.classList.add('bmm-show-zindex');
                    }
                });
            } else {
                document.querySelectorAll('.bmm-show-zindex').forEach(el => {
                    el.classList.remove('bmm-show-zindex');
                    delete el.dataset.bmmZIndex;
                });
            }
        });

        this._get('dbg-css-events')?.addEventListener('change', e => {
            this.toggleJSEvents(e.target.checked);
        });

        this._get('dbg-a11y-hardcoded')?.addEventListener('change', e => {
            this.toggleHardcodedDetector(e.target.checked);
        });

        this._get('dbg-a11y-warnings')?.addEventListener('change', e => {
            this.toggleA11yWarnings(e.target.checked);
        });

        this._get('dbg-a11y-reader')?.addEventListener('change', e => {
            this.toggleA11yReader(e.target.checked);
        });

        this._get('dbg-js-events')?.addEventListener('change', e => {
            this.toggleJSEvents(e.target.checked);
        });

        const updateGrid = () => {
            const gridEl = document.getElementById('bmm-layout-grid');
            if (!gridEl) return;
            const hInput = document.getElementById('dbg-grid-h');
            const vInput = document.getElementById('dbg-grid-v');
            if (!hInput || !vInput) return;
            
            const h = hInput.value;
            const v = vInput.value;
            
            hInput.style.setProperty('--val', ((h / 64) * 100) + '%');
            vInput.style.setProperty('--val', ((v / 64) * 100) + '%');

            const hValSpan = document.getElementById('dbg-grid-h-val');
            const vValSpan = document.getElementById('dbg-grid-v-val');
            if (hValSpan) hValSpan.textContent = h;
            if (vValSpan) vValSpan.textContent = v;
            
            const hBg = h > 0 ? `linear-gradient(rgba(255,255,255,0.15) 1px, transparent 1px)` : '';
            const vBg = v > 0 ? `linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px)` : '';
            const bgStr = [hBg, vBg].filter(Boolean).join(', ');
            
            gridEl.style.backgroundImage = bgStr;
            gridEl.style.backgroundSize = `${v > 0 ? v : 10}px ${h > 0 ? h : 10}px`;
        };

        this._get('dbg-css-grid')?.addEventListener('change', e => {
            const config = document.getElementById('dbg-grid-config');
            if (config) config.style.display = e.target.checked ? 'block' : 'none';
            
            let gridEl = document.getElementById('bmm-layout-grid');
            if (e.target.checked) {
                if (!gridEl) {
                    gridEl = document.createElement('div');
                    gridEl.id = 'bmm-layout-grid';
                    document.body.appendChild(gridEl);
                }
                updateGrid();
            } else if (gridEl) {
                gridEl.remove();
            }
        });

        this._get('dbg-grid-h')?.addEventListener('input', updateGrid);
        this._get('dbg-grid-v')?.addEventListener('input', updateGrid);

        // Sources Tree Toggle
        // Controls
        this.container.querySelector('#debug-btn-close').addEventListener('click', () => this.toggle(false));
        this.container.querySelector('#dbg-clear-all').addEventListener('click', () => {
            this.showConfirm('Clear Everything', 'This will wipe all console logs and the activity timeline. Proceed?', () => {
                debugHub.recordLog('info', ['[System] History cleared by user']);
                debugHub.logs = [];
                debugHub.ipcCalls = [];
                debugHub.actions = [];
                const logs = this.container.querySelector('#console-logs');
                const timeline = this.container.querySelector('#timeline-list');
                if (logs) logs.innerHTML = '';
                if (timeline) timeline.innerHTML = '';
            });
        });
        this.container.querySelector('#debug-btn-inspect').addEventListener('click', () => this.toggleInspector());
        this.container.querySelector('#debug-btn-export').addEventListener('click', () => this.exportSession());

        this._get('console-clear-manual').addEventListener('click', () => {
             this._get('console-logs').innerHTML = '';
             debugHub.logs = [];
        });

        this._get('timeline-clear-manual').addEventListener('click', () => {
             this._get('timeline-list').innerHTML = '';
             debugHub.ipcCalls = [];
             debugHub.actions = [];
        });

        this._get('sources-refresh').addEventListener('click', () => this.loadSources());

        // Context Menu in Sources
        this.container.querySelector('.sources-editor').addEventListener('contextmenu', e => {
            if (this.currentSource) {
                e.preventDefault();
                this.showContextMenu(e.clientX, e.clientY, [
                    { label: 'Copy Content', action: () => this.copyToClipboard(this.currentSource.data) },
                    { label: 'Download File', action: () => this.downloadFile(this.currentSource.name, this.currentSource.data) }
                ]);
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && this.isInspecting) {
                this.toggleInspector(false);
            }
        });
        this._get('console-search').addEventListener('input', e => {
            const query = e.target.value.toLowerCase();
            this.container.querySelectorAll('#console-logs .log-entry').forEach(entry => {
                const text = entry.textContent.toLowerCase();
                entry.style.display = text.includes(query) ? 'flex' : 'none';
            });
        });

        document.addEventListener('click', e => {
            if (this.isInspecting || e.target.closest('#bmm-debug-overlay')) return;
            const target = e.target.closest('button, .nav-item, input, select') || e.target;
            debugHub.recordAction('CLICK', target, target.innerText?.trim() || target.value || '');
        }, true);

        this._get('inspect-btn-clear').addEventListener('click', () => this.clearSelection());

        this._get('playground-apply-css').addEventListener('click', () => {
            try {
                const code = this._get('playground-code').value;
                debugHub.applyPatch('CSS', code);
            } catch (err) {
                this.showAlert('CSS Error', err.message || 'Invalid CSS syntax.');
            }
        });

        this._get('playground-run-js').addEventListener('click', () => {
            try {
                const code = this._get('playground-code').value;
                debugHub.applyPatch('JS', code);
            } catch (err) {
                this.showAlert('JS Error', err.message || 'Execution failed.');
            }
        });

        this._get('playground-reset').addEventListener('click', () => {
            this._get('playground-code').value = '';
            // Remove all CSS patches
            debugHub.patches.filter(p => p.type === 'CSS').forEach(p => debugHub.removePatch(p.id));
        });

        this._get('playground-export').addEventListener('click', () => {
            const content = debugHub.patches.map(p => `/* Patch ${p.id} (${p.type}) */\n${p.content}`).join('\n\n');
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `bmm-patches-${Date.now()}.txt`;
            a.click();
        });

        // Patch tree interaction
        this._get('patch-tree').addEventListener('click', e => {
            const btn = e.target.closest('.patch-remove');
            if (btn) {
                const id = btn.dataset.id;
                debugHub.removePatch(id);
            }
        });

        // Timeline filters
        this.container.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.applyTimelineFilter(btn.dataset.filter);
            });
        });

        // Editable State logic
        const statePane = this.container.querySelector('#pane-state');
        statePane.addEventListener('click', e => {
            const el = e.target.closest('.state-row');
            if (!el) return;
            
            const key = el.dataset.key;
            const currentValue = appState.get(key);
            this.showPrompt(`Edit state: ${key}`, `Enter new value for '${key}':`, JSON.stringify(currentValue), (newValue) => {
                if (newValue !== null) {
                    try {
                        appState.set(key, JSON.parse(newValue));
                        this.updateStateView();
                    } catch (e) {
                        this.showAlert('Error', 'Invalid JSON format.');
                    }
                }
            });
        });

        // Drag logic
        const header = this.container.querySelector('.debug-header');
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        header.addEventListener('mousedown', e => {
            if (e.target.closest('.debug-btn')) return;
            e.preventDefault();
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = this.container.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            this.container.style.transition = 'none';
            this.container.style.bottom = 'auto';
            this.container.style.right = 'auto';
            this.container.style.left = initialLeft + 'px';
            this.container.style.top = initialTop + 'px';
        });

        // Resize logic
        const resizer = this.container.querySelector('.debug-resizer');
        let isResizing = false;
        let initialWidth, initialHeight;

        resizer.addEventListener('mousedown', e => {
            e.preventDefault();
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            initialWidth = this.container.offsetWidth;
            initialHeight = this.container.offsetHeight;
            this.container.style.transition = 'none';
        });

        document.addEventListener('mousemove', e => {
            if (isDragging) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                this.container.style.left = (initialLeft + dx) + 'px';
                this.container.style.top = (initialTop + dy) + 'px';
            }
            if (isResizing) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                this.container.style.width = (initialWidth + dx) + 'px';
                this.container.style.height = (initialHeight + dy) + 'px';
            }
        });

        document.addEventListener('mouseup', () => {
            if (isDragging || isResizing) {
                isDragging = false;
                isResizing = false;
                this.container.style.transition = '';
                this.savePosition();
            }
        });

        // Debug Hub events
        debugHub.subscribe(event => {
            if (event.type === 'log') this.appendLog(event.data);
            if (event.type === 'ipc' || event.type === 'action') this.updateTimeline(event.data);
            if (event.type === 'clear') {
                this._get('console-logs').innerHTML = '';
                this._get('timeline-list').innerHTML = '';
                debugHub.logs = [];
                debugHub.ipcCalls = [];
                debugHub.actions = [];
            }
            if (event.type === 'state') {
                this.updateStateView();
                this.translateUI();
            }
            if (event.type === 'metrics') this.updateMetrics(event.data);
            if (event.type === 'patches') this.updatePatchTree();
            if (event.type === 'crash') {
                this.crashOverlay.classList.add('active');
                this._get('crash-details').textContent = event.data.msg || 'Unknown internal error';
            }
        });

        // Inspector mouse move
        document.addEventListener('mousemove', e => {
            if (!this.isInspecting) return;
            
            // Find element under cursor (excluding debug overlay)
            const el = document.elementFromPoint(e.clientX, e.clientY);
            if (el && !el.closest('#bmm-debug-overlay') && !el.classList.contains('debug-inspect-highlight')) {
                this.highlightElement(el);
            }
        });

        document.addEventListener('click', e => {
            if (!this.isInspecting) return;
            e.preventDefault();
            e.stopPropagation();
            const target = this.hoveredEl;
            if (!target) return; // FIX: Prevent crash if clicking empty space

            this.selectElement(target);
            
            console.debug('[Inspector] Selected:', target);

            // Auto-fill playground with current styles for quick editing
            const computed = window.getComputedStyle(target);
            const styleSnippet = `/* Edit styles for ${target.tagName.toLowerCase()} */\n` + 
                `selector {\n  background: ${computed.backgroundColor};\n  color: ${computed.color};\n  border: ${computed.border};\n}`;
            const playground = this._get('playground-code');
            if (playground) playground.value = styleSnippet;
        }, true);
    }

    translateUI() {
        if (!this.container) return;
        applyTranslations(this.container);
    }

    toggleInspector(force) {
        this.isInspecting = force !== undefined ? force : !this.isInspecting;
        const btn = this._get('debug-btn-inspect');
        btn.classList.toggle('active', this.isInspecting);
        document.body.style.cursor = this.isInspecting ? 'crosshair' : '';
        
        if (!this.isInspecting) {
            if (this.highlightEl) this.highlightEl.style.display = 'none';
            if (this.tooltipEl) this.tooltipEl.style.display = 'none';
            btn.classList.remove('active');
        } else {
            btn.classList.add('active');
        }
    }

    appendLog(item) {
        const logs = this._get('console-logs');
        if (!logs) return;

        const entry = document.createElement('div');
        entry.className = `log-entry ${item.level}`;
        entry.innerHTML = `<span style="opacity:0.5; font-size:9px">[${new Date().toLocaleTimeString()}]</span> <span>${this.escapeHtml(item.message)}</span>`;
        logs.appendChild(entry);
        
        // Auto-scroll if at bottom
        if (logs.scrollHeight - logs.scrollTop - logs.clientHeight < 50) {
            logs.scrollTop = logs.scrollHeight;
        }
    }

    highlightElement(el) {
        this.hoveredEl = el;
        const rect = el.getBoundingClientRect();
        
        this.highlightEl.style.display = 'block';
        this.highlightEl.style.top = rect.top + 'px';
        this.highlightEl.style.left = rect.left + 'px';
        this.highlightEl.style.width = rect.width + 'px';
        this.highlightEl.style.height = rect.height + 'px';

        this.tooltipEl.style.display = 'block';
        this.tooltipEl.style.top = (rect.top - 24) + 'px';
        this.tooltipEl.style.left = rect.left + 'px';
        
        // Fix: safely handle className (especially for SVG elements where it's an object)
        const classAttr = el.getAttribute('class');
        const classStr = (typeof classAttr === 'string' && classAttr) 
            ? '.' + classAttr.trim().split(/\s+/).join('.') 
            : '';
        this.tooltipEl.textContent = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${classStr}`;
    }

    updatePatchTree() {
        const list = this._get('patch-tree');
        list.innerHTML = debugHub.patches.map(p => `
            <div class="patch-row" style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); padding:6px 10px; border-radius:4px; font-size:10px">
                <span style="color:var(--debug-accent)">${p.type}: ${p.id}</span>
                <button class="patch-remove" data-id="${p.id}" style="background:none; border:none; color:var(--debug-error); cursor:pointer">REMOVE</button>
            </div>
        `).join('') || '<div style="color:var(--text-muted); font-size:10px">No active patches.</div>';
    }

    switchTab(tabId) {
        this.activeTab = tabId;
        this.container.querySelectorAll('.debug-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tabId);
        });
        this.container.querySelectorAll('.debug-pane').forEach(p => {
            p.classList.toggle('active', p.id === `pane-${tabId}`);
        });
        this.savePosition();
        if (tabId === 'inspect-view' && !this.selectedEl) {
            this.clearSelection();
        }
        if (tabId === 'debugger') {
            const activeSub = this.container.querySelector('.debug-subtab.active');
            if (activeSub) this.switchDebuggerSubtab(activeSub.dataset.sub);
        }
    }

    switchDebuggerSubtab(subId) {
        this.container.querySelectorAll('.debug-subtab').forEach(t => {
            t.classList.toggle('active', t.dataset.sub === subId);
        });
        this.container.querySelectorAll('.debug-subpane').forEach(p => {
            p.style.display = p.id === `subpane-${subId}` ? 'flex' : 'none';
        });

        if (subId === 'css') {
            this.loadStylesheetsList();
        }
    }

    loadStylesheetsList() {
        const select = this._get('css-stylesheet-select');
        if (!select) return;
        
        // Preserve current selection if possible
        const currentVal = select.value;
        select.innerHTML = '<option value="">Sélectionner une feuille...</option>';
        
        let found = false;
        Array.from(document.styleSheets).forEach((sheet, i) => {
            try {
                // Must access cssRules to trigger CORS error early
                if (!sheet.cssRules) return;
                let name = sheet.href ? sheet.href.split('/').pop() : 'inline style';
                if (name.includes('debug.css')) return; // Ignore debug styles
                
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = `[${i}] ${name} (${sheet.cssRules.length} règles)`;
                select.appendChild(opt);
                if (currentVal && currentVal == i) found = true;
            } catch (e) {
                // CORS or restricted
            }
        });
        
        if (found) select.value = currentVal;
    }

    loadStylesheet(sheetIndex) {
        const container = this._get('css-rules-container');
        if (!container) return;

        if (sheetIndex === '') {
            container.innerHTML = '<div style="color:var(--text-muted); font-size:10px; text-align:center; margin-top:20px">Sélectionnez une feuille de style.</div>';
            return;
        }

        try {
            const sheet = document.styleSheets[sheetIndex];
            const rules = sheet.cssRules;
            let html = '';

            for (let r = 0; r < rules.length; r++) {
                const rule = rules[r];
                if (rule.type !== CSSRule.STYLE_RULE) continue;
                
                // Format the cssText
                const cssText = rule.cssText;
                const match = cssText.match(/\{([\s\S]*)\}/);
                let styles = match ? match[1].trim() : '';
                
                // Add minor syntax highlighting manually
                styles = styles.split(';').map(s => s.trim()).filter(s => s).map(s => {
                    const parts = s.split(':');
                    if (parts.length < 2) return s;
                    return `<span style="color:#9cdcfe">${parts[0].trim()}</span>: <span style="color:#ce9178">${parts.slice(1).join(':').trim()}</span>;`;
                }).join('<br>  ');

                if (styles) styles = '  ' + styles;

                // Live Edit Structure
                html += `
                    <div class="css-rule-block" style="margin-bottom:12px; font-family:'JetBrains Mono'; font-size:11px; padding:8px; border-radius:4px; background:rgba(255,255,255,0.02); border:1px solid var(--debug-border)">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px">
                            <div style="color:var(--debug-accent); font-weight:700">${this.escapeHtml(rule.selectorText || '')} {</div>
                            <button class="rule-inspect-btn" data-selector="${this.escapeHtml(rule.selectorText || '')}" title="Inspect matching element" style="background:none; border:none; color:var(--debug-accent); cursor:pointer; padding:4px; border-radius:4px; display:flex; align-items:center; transition:background 0.2s">
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.94-.49-7-3.85-7-7.93s3.06-7.44 7-7.93V19.93z"></path></svg>
                            </button>
                        </div>
                        <div class="live-css-editor" contenteditable="true" spellcheck="false" data-sheet="${sheetIndex}" data-rule="${r}" data-selector="${this.escapeHtml(rule.selectorText || '')}" style="outline:none; padding:4px; border:1px dashed transparent; transition:border 0.2s" onfocus="this.style.borderColor='var(--debug-accent)'" onblur="this.style.borderColor='transparent'">${styles.replace(/<span.*?>/g, '').replace(/<\/span>/g, '')}</div>
                        <div style="color:var(--debug-accent); font-weight:700; margin-top:4px">}</div>
                    </div>
                `;
            }

            container.innerHTML = html || '<div style="color:var(--text-muted); font-size:10px; text-align:center">Aucune règle CSS standard trouvée.</div>';

            // Attach Live CSS Modifiers
            container.querySelectorAll('.live-css-editor').forEach(editor => {
                editor.addEventListener('input', (e) => {
                    const sheetIdx = e.target.dataset.sheet;
                    const ruleIdx = e.target.dataset.rule;
                    const selector = e.target.dataset.selector;
                    const liveStyles = e.target.innerText;
                    
                    const overrideId = `live-override-${sheetIdx}-${ruleIdx}`;
                    let overrideNode = document.getElementById(overrideId);
                    if (!overrideNode) {
                        overrideNode = document.createElement('style');
                        overrideNode.id = overrideId;
                        document.head.appendChild(overrideNode);
                    }
                    overrideNode.textContent = `${selector} { ${liveStyles} }`;
                });
            });

            // Attach Rule Inspection
            container.querySelectorAll('.rule-inspect-btn').forEach(btn => {
                btn.onclick = () => {
                    this.inspectSelector(btn.dataset.selector);
                };
            });

            // Re-apply search filter if any
            const query = this._get('css-rule-search')?.value.toLowerCase() || '';
            if (query) this.filterCSSRules(query);

        } catch (e) {
            container.innerHTML = `<div style="color:var(--debug-error); font-size:10px">Impossible de lire la feuille: ${e.message}</div>`;
        }
    }

    filterCSSRules(query) {
        const container = this._get('css-rules-container');
        if (!container) return;
        query = query.toLowerCase();
        container.querySelectorAll('.css-rule-block').forEach(block => {
            const text = block.textContent.toLowerCase();
            block.style.display = text.includes(query) ? 'block' : 'none';
        });
    }

    inspectSelector(selector) {
        try {
            const match = document.querySelector(selector);
            if (match) {
                this.selectElement(match);
                this.switchTab('inspect-view');
            } else {
                console.warn('[BMM-Debug] No element matches selector:', selector);
            }
        } catch (e) {
            console.error('[BMM-Debug] Invalid selector or error during inspection:', e);
        }
    }

    guessSourceFile(el) {
        // Simple heuristic: look for parent section IDs or common BMM components
        const section = el.closest('section, div[id]');
        if (section && section.id) {
            if (section.id.startsWith('doc-')) return 'frontend/index.html (Documentation)';
            if (section.id === 'mod-list') return 'frontend/js/app.js (Mod Loading)';
            if (section.id === 'settings-pane') return 'frontend/js/settings.js';
            return `frontend/index.html #${section.id}`;
        }
        
        if (el.classList.contains('nav-item')) return 'frontend/js/navigation.js';
        
        return 'frontend/index.html';
    }

    applyTimelineFilter(filter) {
        this.container.querySelectorAll('#timeline-list .ipc-entry').forEach(entry => {
            const isRPC = entry.querySelector('.rpc');
            const isAction = entry.querySelector('.action');
            const isError = entry.querySelector('.error');

            let visible = true;
            if (filter === 'rpc') visible = !!isRPC;
            else if (filter === 'action') visible = !!isAction;
            else if (filter === 'error') visible = !!isError;

            entry.style.display = visible ? 'flex' : 'none';
        });
    }

    updateTimeline(item) {
        const pane = this._get('timeline-list');
        let entry = this._get(`timeline-${item.id}`);
        
        if (!entry) {
            entry = document.createElement('div');
            entry.id = `timeline-${item.id}`;
            entry.className = 'ipc-entry'; // Reuse styles
            pane.prepend(entry);
        }

        const isIPC = !!item.command;
        const time = item.duration ? item.duration + 'ms' : new Date(item.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

        entry.innerHTML = `
            <div class="ipc-cmd ${isIPC ? 'rpc' : 'action'}">
                ${isIPC ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>' : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M15 18l-6-6 6-6"/></svg>'}
                ${isIPC ? item.command : item.type}
            </div>
            <div class="ipc-status ${item.status || 'info'}">${isIPC ? item.status : item.target}</div>
            <div class="ipc-time">${time}</div>
        `;
    }

    clearSelection() {
        this.selectedEl = null;
        this._get('inspect-header').style.display = 'none';
        this._get('inspect-content').innerHTML = '<div style="color:var(--text-muted); font-size:11px">Select an element to inspect...</div>';
        if (this.highlightEl) this.highlightEl.style.display = 'none';
        if (this.tooltipEl) this.tooltipEl.style.display = 'none';
    }

    selectElement(target) {
        if (!target) return;
        this.selectedEl = target;
        this.toggleInspector(false);
        this.switchTab('inspect-view');

        this._get('inspect-header').style.display = 'flex';
        const pane = this._get('inspect-content');
        pane.innerHTML = ''; // Clear previous content
        const sourceGuess = this.guessSourceFile(target);
        const computed = window.getComputedStyle(target);
        
        // Commmon CSS properties for the editor
        const commonProps = ['background', 'color', 'border', 'display', 'margin', 'padding', 'width', 'height', 'font-size', 'font-weight', 'position', 'opacity', 'flex', 'grid'];

        pane.innerHTML = `
            <div style="background:rgba(255,255,255,0.03); padding:12px; border-radius:8px; margin-bottom:16px; border:1px solid rgba(255,255,255,0.05)">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px">
                    <div>
                        <div style="font-weight:700; color:var(--debug-accent); font-size:14px; font-family:'JetBrains Mono'">&lt;${target.tagName.toLowerCase()}&gt;</div>
                        <div style="color:var(--text-muted); font-size:10px">${target.id ? '#' + target.id : ''} ${Array.from(target.classList).map(c => '.' + c).join(' ')}</div>
                    </div>
                    <div style="display:flex; gap:4px">
                        <button class="debug-btn" id="inspect-copy-node" title="Copy HTML" style="padding:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                        <button class="debug-btn" id="inspect-send-playground" title="Send to Playground" style="padding:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l2.233 2.233L21 2z"/></svg></button>
                    </div>
                </div>
                <div style="font-size:10px; color:var(--text-muted); margin-bottom:4px">SOURCE GUESS</div>
                <div style="color:var(--debug-success); font-family:'JetBrains Mono'; font-size:11px; background:rgba(0,0,0,0.2); padding:4px 8px; border-radius:4px">${sourceGuess}</div>
            </div>
            
            <div style="font-size:11px; font-weight:700; color:var(--text-muted); margin-bottom:8px; display:flex; align-items:baseline; gap:6px">
                LIVE STYLES
                <span style="font-weight:400; font-size:9px; opacity:0.6">(Auto-applies on change)</span>
            </div>

            <div id="style-editor-list" style="display:flex; flex-direction:column; gap:8px">
                ${commonProps.map(prop => {
                    const jsProp = prop.replace(/-([a-z])/g, g => g[1].toUpperCase());
                    const value = computed[jsProp];
                    const isColorOrBackground = prop.includes('color') || prop.includes('background');
                    
                    // Smarter color detection: if background has images/shorthands, use background-color for helper
                    const helperProp = prop === 'background' ? 'background-color' : prop;
                    const colorValue = computed[helperProp.replace(/-([a-z])/g, g => g[1].toUpperCase())];

                    return `
                        <div style="display:grid; grid-template-columns:1fr 1fr ${isColorOrBackground ? '20px' : ''}; gap:8px; align-items:center">
                            <div style="color:var(--debug-accent); font-family:'JetBrains Mono'; font-size:10px; display:flex; align-items:center; gap:4px">
                                ${prop}
                                <a href="https://developer.mozilla.org/en-US/docs/Web/CSS/${prop}" target="_blank" style="opacity:0.4; color:inherit; text-decoration:none">
                                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6m4-10h7v7m-11 4L22 2"/></svg>
                                </a>
                            </div>
                            <input type="text" 
                                   class="style-edit-input" 
                                   data-prop="${prop}" 
                                   value="${value}" 
                                   style="background:rgba(0,0,0,0.2); border:1px solid var(--border); border-radius:4px; color:white; font-size:10px; padding:4px 8px; font-family:'JetBrains Mono'; outline:none">
                            ${isColorOrBackground ? `<input type="color" class="style-color-helper" data-prop="${prop}" data-helper-prop="${helperProp}" style="width:16px; height:20px; padding:0; border:none; background:none; cursor:pointer" value="${colorValue.startsWith('rgb') ? this.rgbToHex(colorValue) : colorValue}">` : ''}
                        </div>
                    `;
                }).join('')}
                
                <div style="margin-top:12px; border-top:1px solid rgba(255,255,255,0.05); padding-top:12px">
                    <button class="debug-btn" id="inspect-add-prop" style="width:100%; border-style:dashed; opacity:0.6; font-size:10px">+ ADD CUSTOM PROPERTY</button>
                </div>
            </div>
        `;

        // Tooltip update
        this.highlightEl.style.display = 'block';

        // Listeners for live edit
        pane.querySelectorAll('.style-edit-input').forEach(input => {
            input.oninput = (e) => {
                target.style[input.dataset.prop] = e.target.value;
                debugHub.recordAction('STYLE_EDIT', { target: target.tagName, prop: input.dataset.prop, value: e.target.value });
            };
        });

        pane.querySelectorAll('.style-color-helper').forEach(helper => {
            helper.oninput = (e) => {
                const targetProp = helper.dataset.helperProp || helper.dataset.prop;
                const input = pane.querySelector(`.style-edit-input[data-prop="${helper.dataset.prop}"]`);
                
                // If we are editing shorthand background, we update just the background-color part if possible,
                // but usually simpler to just apply to the helperProp directly.
                target.style[targetProp] = e.target.value;
                if (helper.dataset.prop === targetProp) {
                    input.value = e.target.value;
                }
                debugHub.recordAction('STYLE_COLOR_EDIT', { target: target.tagName, prop: targetProp, value: e.target.value });
            };
        });

        this._get('inspect-add-prop').onclick = () => {
            this.showPrompt('Custom Property', 'Enter CSS property name (e.g. border-radius):', '', (prop) => {
                if (prop) {
                    this.showPrompt('Property Value', `Enter value for ${prop}:`, '', (value) => {
                        if (value) {
                            target.style[prop] = value;
                            this.updateInspectView(target);
                            debugHub.recordAction('STYLE_ADD', { target: target.tagName, prop, value });
                        }
                    });
                }
            });
        };

        this._get('inspect-copy-node').onclick = () => {
            navigator.clipboard.writeText(target.outerHTML);
            console.info('[Inspector] Copied HTML to clipboard');
        };
        
        this._get('inspect-send-playground').onclick = () => {
            this.switchTab('playground');
            const styleSnippet = `/* Edit styles for ${target.tagName.toLowerCase()} */\n` + 
                `selector {\n  background: ${computed.backgroundColor};\n  color: ${computed.color};\n  border: ${computed.border};\n}`;
            this._get('playground-code').value = styleSnippet;
        };
    }

    rgbToHex(rgb) {
        if (!rgb || !rgb.startsWith('rgb')) return rgb;
        const [r, g, b] = rgb.match(/\d+/g).map(Number);
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    updateStateView() {
        const pane = this._get('pane-state');
        const state = appState.state;
        let html = '<div style="padding:16px; font-family:inherit">';
        
        for (const [key, value] of Object.entries(state)) {
            const displayValue = typeof value === 'object' ? JSON.stringify(value) : value;
            html += `
                <div class="state-row" style="margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; padding:4px 8px; border-radius:4px; transition:background 0.2s" data-key="${key}">
                    <span style="color:var(--text-muted)">${key}:</span>
                    <span style="color:var(--debug-accent); font-weight:600; text-align:right; max-width:60%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${this.escapeHtml(String(displayValue))}</span>
                </div>
            `;
        }
        
        html += '</div>';
        pane.innerHTML = html;

        // Add hover effect
        pane.querySelectorAll('.state-row').forEach(row => {
            row.addEventListener('mouseenter', () => row.style.background = 'rgba(255,255,255,0.05)');
            row.addEventListener('mouseleave', () => row.style.background = '');
        });
    }


    clearUI() {
        this._get('pane-console').innerHTML = '';
        this._get('pane-network').innerHTML = '';
        this.updateStateView();
    }

    escapeHtml(str) {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // --- ADVANCED A11Y & DEBUG TOOLS ---

    toggleA11yWarnings(enabled) {
        this.a11yWarnings = enabled;
        if (enabled) {
            this.auditA11y();
            this.a11yInterval = setInterval(() => this.auditA11y(), 2000);
            console.info('[BMM-Debug] Live A11y Warnings enabled.');
        } else {
            if (this.a11yInterval) clearInterval(this.a11yInterval);
            document.querySelectorAll('.bmm-a11y-error-outline').forEach(el => {
                el.classList.remove('bmm-a11y-error-outline');
                el.removeAttribute('title');
            });
        }
    }

    auditA11y() {
        if (!this.a11yWarnings) return;
        
        // 1. Missing ALT on images
        document.querySelectorAll('img').forEach(img => {
            if (!img.hasAttribute('alt') || img.alt.trim() === '') {
                img.classList.add('bmm-a11y-error-outline');
                img.title = "A11y Warning: Image missing alt attribute";
            } else {
                img.classList.remove('bmm-a11y-error-outline');
            }
        });

        // 2. Buttons without labels/text
        document.querySelectorAll('button').forEach(btn => {
            const hasText = btn.innerText.trim().length > 0;
            const hasLabel = btn.hasAttribute('aria-label') || btn.hasAttribute('title');
            if (!hasText && !hasLabel) {
                btn.classList.add('bmm-a11y-error-outline');
                btn.title = "A11y Warning: Button has no visible text and no aria-label";
            } else {
                btn.classList.remove('bmm-a11y-error-outline');
            }
        });

        // 3. Inputs without labels
        document.querySelectorAll('input:not([type="hidden"]), select, textarea').forEach(input => {
            if (input.id) {
                const label = document.querySelector(`label[for="${input.id}"]`);
                if (!label && !input.hasAttribute('aria-label') && !input.hasAttribute('placeholder')) {
                    input.classList.add('bmm-a11y-error-outline');
                    input.title = "A11y Warning: Form field has no associated label or aria-label";
                } else {
                    input.classList.remove('bmm-a11y-error-outline');
                }
            } else if (!input.hasAttribute('aria-label') && !input.hasAttribute('placeholder')) {
                    input.classList.add('bmm-a11y-error-outline');
                    input.title = "A11y Warning: Form field has no associated label or aria-label";
            } else {
                input.classList.remove('bmm-a11y-error-outline');
            }
        });
    }

    toggleA11yReader(enabled) {
        this.a11yReader = enabled;
        if (enabled) {
            this._a11yMouseOver = (e) => {
                const target = e.target;
                if (target.closest('#bmm-debug-overlay')) return;

                let readerOverlay = document.getElementById('bmm-a11y-reader-overlay');
                if (!readerOverlay) {
                    readerOverlay = document.createElement('div');
                    readerOverlay.id = 'bmm-a11y-reader-overlay';
                    readerOverlay.className = 'bmm-a11y-reader-label';
                    document.body.appendChild(readerOverlay);
                }

                const rect = target.getBoundingClientRect();
                const accessibleName = target.getAttribute('aria-label') || target.getAttribute('alt') || (target.innerText || target.textContent || "").trim() || target.getAttribute('title') || target.tagName.toLowerCase();
                
                readerOverlay.textContent = `Accessible: "${accessibleName}"`;
                readerOverlay.style.display = 'block';
                readerOverlay.style.top = (rect.bottom + window.scrollY + 5) + 'px';
                readerOverlay.style.left = (rect.left + window.scrollX) + 'px';
            };
            this._a11yMouseOut = () => {
                const overlay = document.getElementById('bmm-a11y-reader-overlay');
                if (overlay) overlay.style.display = 'none';
            };
            document.addEventListener('mouseover', this._a11yMouseOver);
            document.addEventListener('mouseout', this._a11yMouseOut);
            console.info('[BMM-Debug] A11y Reader Simulation enabled.');
        } else {
            document.removeEventListener('mouseover', this._a11yMouseOver);
            document.removeEventListener('mouseout', this._a11yMouseOut);
            const overlay = document.getElementById('bmm-a11y-reader-overlay');
            if (overlay) overlay.remove();
        }
    }

    toggleJSEvents(enabled) {
        this.jsEvents = enabled;
        if (enabled) {
            document.querySelectorAll('*').forEach(el => {
                if (el.hasAttribute('data-bmm-events') || el.onclick) {
                    el.classList.add('bmm-js-event-node');
                    const events = el.getAttribute('data-bmm-events') || 'inline click';
                    el.title = `JS Events: ${events}`;
                }
            });
            console.info('[BMM-Debug] Event Listener Overlay enabled.');
        } else {
            document.querySelectorAll('.bmm-js-event-node').forEach(el => {
                el.classList.remove('bmm-js-event-node');
                el.removeAttribute('title');
            });
        }
    }


    toggleHardcodedDetector(enabled) {
        this.hardcodedDetector = enabled;
        if (enabled) {
            this.auditHardcoded();
            this.hardcodedInterval = setInterval(() => this.auditHardcoded(), 3000);
            console.info('[BMM-Debug] Hardcoded Text Detector enabled.');
        } else {
            if (this.hardcodedInterval) clearInterval(this.hardcodedInterval);
            document.querySelectorAll('.bmm-hardcoded-error').forEach(el => {
                el.classList.remove('bmm-hardcoded-error');
                el.removeAttribute('title');
            });
        }
    }

    auditHardcoded() {
        if (!this.hardcodedDetector) return;

        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                // Skip if inside debug overlay
                if (node.parentElement?.closest('#bmm-debug-overlay')) return NodeFilter.FILTER_REJECT;
                // Skip script/style
                if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(node.parentElement?.tagName)) return NodeFilter.FILTER_REJECT;
                // Skip icons, symbols, or very short strings (usually UI decor)
                if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
                // Skip if already has i18n
                if (node.parentElement?.closest('[data-i18n], [data-i18n-placeholder], [data-i18n-title]')) return NodeFilter.FILTER_REJECT;
                
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        const nodes = [];
        let curr;
        while (curr = walk.nextNode()) nodes.push(curr);

        nodes.forEach(textNode => {
            const parent = textNode.parentElement;
            if (parent && !parent.classList.contains('bmm-hardcoded-error')) {
                parent.classList.add('bmm-hardcoded-error');
                parent.dataset.bmmHardcoded = textNode.textContent.trim();
            }
        });
    }

    savePosition() {
        const rect = this.container.getBoundingClientRect();
        const data = {
            top: rect.top,
            left: rect.left,
            width: this.container.offsetWidth,
            height: this.container.offsetHeight,
            activeTab: this.activeTab
        };
        localStorage.setItem('bmm-debug-ui', JSON.stringify(data));
    }

    loadPosition() {
        try {
            const data = JSON.parse(localStorage.getItem('bmm-debug-ui'));
            if (data) {
                if (data.top !== undefined) {
                    this.container.style.bottom = 'auto';
                    this.container.style.right = 'auto';
                    this.container.style.top = data.top + 'px';
                    this.container.style.left = data.left + 'px';
                }
                if (data.width) this.container.style.width = data.width + 'px';
                if (data.height) this.container.style.height = data.height + 'px';
                if (data.activeTab) this.activeTab = data.activeTab;
            }
        } catch (e) {}
    }

    exportSession() {
        const session = {
            timestamp: new Date().toISOString(),
            logs: debugHub.logs,
            ipc: debugHub.ipcCalls,
            state: appState.state
        };
        const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bmm-debug-session-${Date.now()}.json`;
        a.click();
        console.info('[BMM-Debug] Session exported successfully');
    }

    async loadSources() {
        try {
            const { invoke } = window.__TAURI__.tauri;
            const files = await invoke('get_project_files');
            this.renderFileTree(files);
        } catch (e) {
            console.error('[BMM-Debug] Failed to load sources:', e);
            document.querySelector('.sources-tree').innerHTML = `<div style="color:var(--debug-error); font-size:10px">Failed to load project files.</div>`;
        }
    }

    renderFileTree(files, container = document.querySelector('.sources-tree'), level = 0) {
        if (level === 0) container.innerHTML = '';
        
        files.forEach(file => {
            const row = document.createElement('div');
            row.style.paddingLeft = (level * 12 + 4) + 'px';
            row.style.fontSize = '11px';
            row.style.cursor = 'pointer';
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.gap = '6px';
            row.style.paddingY = '2px';
            row.className = 'tree-row';
            
            const icon = file.is_dir 
                ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
                : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>';
            
            row.innerHTML = `<span style="color:var(--text-muted); opacity:0.7">${icon}</span> <span>${file.name}</span>`;
            
            if (!file.is_dir) {
                row.onclick = () => this.openSourceFile(file.path, row);
            } else if (file.children) {
                const childContainer = document.createElement('div');
                childContainer.style.display = 'block'; // Or 'none' for collapsed by default
                row.onclick = () => {
                    const isHidden = childContainer.style.display === 'none';
                    childContainer.style.display = isHidden ? 'block' : 'none';
                };
                container.appendChild(row);
                container.appendChild(childContainer);
                this.renderFileTree(file.children, childContainer, level + 1);
                return;
            }
            
            container.appendChild(row);
        });
    }

    async openSourceFile(path, row) {
        document.querySelectorAll('.tree-row').forEach(r => r.classList.remove('active'));
        if (row) row.classList.add('active');

        this.currentSource = { path, name: path.split(/[\\/]/).pop(), data: null };
        const editorArea = document.querySelector('.sources-editor');
        if (!window.__TAURI__) return;
        const { invoke } = window.__TAURI__.tauri;

        editorArea.innerHTML = `<div style="padding:20px; color:var(--text-muted)">${t('common.loading')}</div>`;

        try {
            const data = await invoke('read_project_file', { path });
            this.currentSource.data = data;
            
            const ext = path.split('.').pop().toLowerCase();
            const isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext);
            const isVideo = ['mp4', 'webm', 'ogg'].includes(ext);

            if (isImage) {
                editorArea.innerHTML = `
                    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; padding:20px; background:rgba(0,0,0,0.3)">
                        <img src="${data}" style="max-width:90%; max-height:80%; box-shadow:0 10px 30px rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.1); border-radius:4px; margin-bottom:12px">
                        <div style="color:var(--text-muted); font-size:10px; font-family:'JetBrains Mono'">${path}<br>Clic droit pour télécharger</div>
                    </div>
                `;
            } else if (isVideo) {
                editorArea.innerHTML = `
                    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; padding:20px; background:rgba(0,0,0,0.3)">
                        <video src="${data}" controls style="max-width:90%; max-height:80%; box-shadow:0 10px 30px rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.1); border-radius:4px; margin-bottom:12px"></video>
                        <div style="color:var(--text-muted); font-size:10px; font-family:'JetBrains Mono'">${path}</div>
                    </div>
                `;
            } else {
                const highlighted = this.highlightCode(data, ext);
                editorArea.innerHTML = `<pre id="sources-code" style="margin:0; padding:16px; font-family:'JetBrains Mono'; font-size:11px; color:var(--text-primary); white-space:pre-wrap; line-height:1.5">${highlighted}</pre>`;
            }

            editorArea.oncontextmenu = (e) => {
                e.preventDefault();
                
                this.showContextMenu(e.clientX, e.clientY, [
                    { 
                        label: t('common.copy'), 
                        action: () => {
                            if (isImage || isVideo) {
                                this.copyToClipboard(data);
                            } else {
                                navigator.clipboard.writeText(data).then(() => {
                                    this.showAlert(t('common.success'), t('dev.msg.contentCopied'));
                                });
                            }
                        }
                    },
                    { 
                        label: t('common.downloadFile'), 
                        action: () => this.downloadFile(path.split(/[\\/]/).pop(), data)
                    }
                ]);
            };

        } catch (e) {
            console.error('[BMM-Debug] Failed to read source file:', e);
            editorArea.innerHTML = `<div style="padding:20px; color:var(--debug-error)">${t('common.error')}: ${e}</div>`;
        }
    }

    highlightCode(code, ext) {
        if (!code) return '';
        
        // Single-pass replacement using a special token mapping to avoid double-processing tags
        let h = this.escapeHtml(code);
        let tokens = [];
        const pushToken = (style, val) => {
            const id = `___TOKEN_${tokens.length}___`;
            tokens.push({ id, html: `<span style="color:${style}">${val}</span>` });
            return id;
        };

        // Order matters: match larger patterns first
        if (ext === 'css') {
            h = h.replace(/(\/\*[\s\S]*?\*\/)/g, m => pushToken('#6a9955', m))
                 .replace(/(@[\w-]+)/g, m => pushToken('#c586c0', m)) // Media queries
                 .replace(/([^{}\n;]+)\s*\{/g, (m, p1) => pushToken('#d7ba7d', p1) + ' {')
                 .replace(/([\w-]+)\s*:/g, (m, p1) => pushToken('#9cdcfe', p1) + ':')
                 .replace(/:\s*([^;\}]+)/g, (m, p1) => ': ' + pushToken('#ce9178', p1))
                 .replace(/(#[0-9a-fA-F]{3,8})/g, m => pushToken('#b5cea8', m)) // Hex colors
                 .replace(/(:hover|:active|:focus|:before|:after|:nth-child\([\w+n-]+\))/g, m => pushToken('#d7ba7d', m));
        } 
        else if (ext === 'js' || ext === 'ts' || ext === 'rust' || ext === 'rs') {
            const isRust = ext.startsWith('r');
            const keywords = isRust 
                ? /\b(fn|let|mut|match|if|else|loop|while|for|return|pub|use|mod|struct|enum|impl|trait|type|where|async|await|dyn|static|crate)\b/g
                : /\b(const|let|var|function|return|if|else|for|while|import|export|from|class|extends|new|async|await|try|catch|finally|this|super|case|switch|break|continue|default|typeof|instanceof|window|document|console)\b/g;

            h = h.replace(/(\/\/.*$)/gm, m => pushToken('#6a9955', m))
                 .replace(/(\/\*[\s\S]*?\*\/)/g, m => pushToken('#6a9955', m))
                 .replace(/('.*?'|".*?"|`[\s\S]*?`)/g, m => pushToken('#ce9178', m))
                 .replace(keywords, m => pushToken('#569cd6', m))
                 .replace(/\b(true|false|null|undefined|None|Some|Ok|Err|Self|self)\b/g, m => pushToken('#569cd6', m))
                 .replace(/\b(\d+)\b/g, m => pushToken('#b5cea8', m));

            if (isRust) {
                h = h.replace(/(\w+!)/g, m => pushToken('#dcdcaa', m)) // Macros
                     .replace(/('[\w]+)/g, m => pushToken('#4ec9b0', m)); // Lifetimes
            } else {
                h = h.replace(/(\w+)\(/g, (m, p1) => pushToken('#dcdcaa', p1) + '('); // Function calls
            }
        }
        else if (ext === 'html' || ext === 'svg' || ext === 'xml') {
            h = h.replace(/(&lt;!--[\s\S]*?--&gt;)/g, m => pushToken('#6a9955', m)) // Comments
                 .replace(/(&lt;\/|&lt;)([\w-]+)/g, (m, p1, p2) => p1 + pushToken('#569cd6', p2)) // Tags
                 .replace(/(&gt;)/g, m => pushToken('#569cd6', m))
                 .replace(/(\w+)=/g, (m, p1) => pushToken('#9cdcfe', p1) + '=')
                 .replace(/(".*?")/g, m => pushToken('#ce9178', m));
        }
        else if (ext === 'json') {
            h = h.replace(/(".*?")\s*:/g, (m, p1) => pushToken('#9cdcfe', p1) + ':')
                 .replace(/:\s*(".*?")/g, (m, p1) => ': ' + pushToken('#ce9178', p1))
                 .replace(/\b(true|false|null)\b/g, m => pushToken('#569cd6', m))
                 .replace(/\b(\d+)\b/g, m => pushToken('#b5cea8', m));
        }

        // Parenthesis and Brackets (all files)
        h = h.replace(/([(){}\[\]])/g, m => pushToken('#ffd700', m));

        // Final replacement of tokens
        tokens.forEach(t => {
            h = h.replace(t.id, t.html);
        });

        return h;
    }

    async updateMetrics(metrics) {
        try {
            const fps = this._get('dbg-fps');
            const mem = this._get('dbg-mem');
            const pid = this._get('dbg-pid');
            const uptime = this._get('dbg-uptime');

            const stats = await invoke('get_debug_stats');
            
            if (fps) fps.textContent = Math.round(metrics?.fps || 0);
            if (mem) mem.textContent = (stats.memory_mb || 0) + 'MB';
            if (pid) pid.textContent = stats.pid || '-';
            
            if (uptime) {
                const s = stats.uptime_secs || 0;
                const hrs = Math.floor(s / 3600);
                const mins = Math.floor((s % 3600) / 60);
                const secs = s % 60;
                uptime.textContent = `${hrs > 0 ? hrs + 'h ' : ''}${mins > 0 ? mins + 'm ' : ''}${secs}s`;
            }
        } catch (e) {
            console.error('[BMM-Debug] Metrics Update Failed:', e);
        }
    }

    createContextMenu() {
        const menu = document.createElement('div');
        menu.id = 'debug-context-menu';
        menu.style = 'position:fixed; display:none; background:rgba(30,30,30,0.95); backdrop-filter:blur(10px); border:1px solid rgba(255,255,255,0.1); border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.5); z-index:200000; padding:4px; min-width:140px; transform: scale(0.9); opacity: 0; transition: transform 0.1s, opacity 0.1s';
        document.body.appendChild(menu);
        this.contextMenu = menu;

        document.addEventListener('click', () => this.hideContextMenu());
    }

    showContextMenu(x, y, items) {
        this.contextMenu.innerHTML = items.map(item => `
            <div class="ctx-item" style="padding:8px 12px; font-size:11px; color:rgba(255,255,255,0.8); cursor:pointer; border-radius:4px; transition:all 0.1s" 
                 onmouseover="this.style.background='rgba(255,255,255,0.1)'; this.style.color='white'"
                 onmouseout="this.style.background='transparent'; this.style.color='rgba(255,255,255,0.8)'">
                ${item.label}
            </div>
        `).join('');

        // Attach actions
        this.contextMenu.querySelectorAll('.ctx-item').forEach((el, i) => {
            el.onclick = items[i].action;
        });

        this.contextMenu.style.left = x + 'px';
        this.contextMenu.style.top = y + 'px';
        this.contextMenu.style.display = 'block';
        setTimeout(() => {
            this.contextMenu.style.transform = 'scale(1)';
            this.contextMenu.style.opacity = '1';
        }, 10);
    }

    hideContextMenu() {
        if (!this.contextMenu) return;
        this.contextMenu.style.transform = 'scale(0.9)';
        this.contextMenu.style.opacity = '0';
        setTimeout(() => this.contextMenu.style.display = 'none', 100);
    }

    copyToClipboard(text) {
        if (text.startsWith('data:')) {
            // It's a base64 image, skip copy or copy base64
            navigator.clipboard.writeText(text);
            this.showAlert('Copied', 'Base64 image data copied to clipboard.');
        } else {
            navigator.clipboard.writeText(text);
            this.showAlert('Copied', 'Content copied to clipboard.');
        }
    }

    downloadFile(name, content) {
        let blob;
        if (content.startsWith('data:')) {
            const parts = content.split(';base64,');
            const mime = parts[0].split(':')[1];
            const byteString = atob(parts[1]);
            const ab = new ArrayBuffer(byteString.length);
            const ia = new Uint8Array(ab);
            for (let i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
            }
            blob = new Blob([ab], { type: mime });
        } else {
            blob = new Blob([content], { type: 'text/plain' });
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
    }

    startUpdateLoop() {
        // Refresh state view periodically when open if we aren't using deep Proxies for everything
        setInterval(() => {
            if (this.isOpen && this.activeTab === 'state') this.updateStateView();
        }, 1000);
    }

    // --- DEBUGGER TAB METHODS ---

    switchDebuggerSubtab(subId) {
        this.container.querySelectorAll('.debug-subtab').forEach(t => t.classList.toggle('active', t.dataset.sub === subId));
        this.container.querySelectorAll('.debug-subpane').forEach(p => p.style.display = p.id === `subpane-${subId}` ? 'flex' : 'none');
        
        // Lazy loading triggers
        if (subId === 'html' && this._get('html-dom-tree').innerHTML === '') {
            this.buildDomTree();
        }
        if (subId === 'css' && this._get('css-stylesheet-select').children.length <= 1) {
            this.populateStylesheets();
        }
        if (subId === 'rust' && this._get('rust-logs-container').textContent.includes('Click Refresh')) {
            this.refreshRustLogs();
        }
    }

    evalJSCommand(cmd) {
        const watchers = this._get('js-watchers');
        if (!watchers) return;
        
        const row = document.createElement('div');
        row.className = 'js-watcher-row';
        row.style.cssText = 'display:flex; justify-content:space-between; padding:4px 8px; border-bottom:1px solid rgba(255,255,255,0.05); font-family:"JetBrains Mono"; font-size:11px; align-items:center';
        
        try {
            // Using eval in devtools context is expected
            let result = eval(cmd);
            if (result && typeof result === 'object' && !(result instanceof Element)) {
                try { result = JSON.stringify(result, null, 2); } catch(e) { result = '[Object]'; }
            }
            row.innerHTML = `<span style="color:var(--text-muted)">${this.escapeHtml(cmd)}</span> <span style="color:var(--debug-success); max-width:60%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" title="${this.escapeHtml(String(result))}">${this.escapeHtml(String(result))}</span>`;
        } catch (e) {
            row.innerHTML = `<span style="color:var(--text-muted)">${this.escapeHtml(cmd)}</span> <span style="color:var(--debug-error)">${this.escapeHtml(String(e))}</span>`;
        }
        watchers.prepend(row);
    }

    async refreshRustLogs() {
        if (!window.__TAURI__) return;
        const container = this._get('rust-logs-container');
        container.innerHTML = '<div style="color:var(--text-muted)">Loading logs...</div>';
        try {
            const logs = await invoke('get_rust_logs', { maxLines: 500 });
            if (!logs || logs.length === 0) {
                container.innerHTML = '<div style="color:var(--text-muted)">No logs available.</div>';
                return;
            }
            container.innerHTML = logs.map(l => {
                let color = 'white';
                if (l.includes('[PANIC') || l.includes('ERROR')) color = 'var(--debug-error)';
                if (l.includes('[WARNING]') || l.includes('WARN')) color = 'var(--debug-warning)';
                if (l.includes('[DEBUG]')) color = 'var(--debug-accent)';
                return `<div style="color:${color}; white-space:pre-wrap; margin-bottom:2px">${this.escapeHtml(l)}</div>`;
            }).join('');
            container.scrollTop = container.scrollHeight;
        } catch (e) {
            container.innerHTML = `<div style="color:var(--debug-error)">Failed to load logs: ${e}</div>`;
        }
    }

    buildDomTree(parentEl = document.body, containerEl = this._get('html-dom-tree'), level = 0) {
        if (level === 0) {
            containerEl.innerHTML = '';
            containerEl.style.position = 'relative';
        }
        
        // Skip debug UI container itself
        if (parentEl.id === 'bmm-debug-overlay') return;

        Array.from(parentEl.children).forEach(child => {
            if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE' || child.id === 'bmm-debug-overlay') return;

            const row = document.createElement('div');
            row.className = 'dom-tree-node';
            row.style.cssText = `padding-left: ${level * 16}px; display:flex; align-items:center; gap:4px; padding-top:1px; padding-bottom:1px; border-radius:2px; transition: background 0.1s`;
            
            const hasChildren = child.children.length > 0;
            const toggleWrapper = document.createElement('span');
            toggleWrapper.style.cssText = 'width:16px; display:flex; align-items:center; justify-content:center; cursor:pointer';
            toggleWrapper.innerHTML = hasChildren ? `<span class="dom-toggle" style="color:var(--text-muted); font-size:9px">▶</span>` : '';
            
            const inspectIcon = document.createElement('span');
            inspectIcon.className = 'dom-inspect-icon';
            inspectIcon.style.cssText = 'width:14px; height:14px; opacity:0.3; cursor:pointer; color:var(--debug-accent); margin-right:4px; display:flex; align-items:center; justify-content:center';
            inspectIcon.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>`;
            inspectIcon.title = "Inspect this element";

            const tagContent = document.createElement('div');
            tagContent.style.cssText = 'flex:1; display:flex; align-items:center; gap:6px; cursor:default; overflow:hidden';
            
            const tagStr = `<span style="color:var(--debug-accent); font-weight:600">&lt;${child.tagName.toLowerCase()}&gt;</span>`;
            const idStr = child.id ? `<span style="color:#d7ba7d; font-size:10px">#${child.id}</span>` : '';
            
            // Limit classes shown to keep it readable
            const classAttr = child.getAttribute('class');
            let classStr = '';
            if (typeof classAttr === 'string' && classAttr) {
                const classes = classAttr.trim().split(/\s+/);
                const displayClasses = classes.length > 2 ? classes.slice(0, 2).concat(['...']) : classes;
                classStr = `<span style="color:#9cdcfe; font-size:10px">.${displayClasses.join('.')}</span>`;
            }

            tagContent.innerHTML = `${tagStr} ${idStr} ${classStr}`;
            
            row.appendChild(toggleWrapper);
            row.appendChild(inspectIcon);
            row.appendChild(tagContent);
            
            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'dom-children';
            childrenContainer.style.cssText = 'display:none; border-left: 1px solid rgba(255,255,255,0.05); margin-left: 7px';

            // Toggle expansion
            const doToggle = (e) => {
                if (!hasChildren) return;
                e?.stopPropagation();
                const isHidden = childrenContainer.style.display === 'none';
                childrenContainer.style.display = isHidden ? 'block' : 'none';
                const toggleBtn = toggleWrapper.querySelector('.dom-toggle');
                if (toggleBtn) toggleBtn.textContent = isHidden ? '▼' : '▶';
                if (isHidden && childrenContainer.innerHTML === '') {
                    this.buildDomTree(child, childrenContainer, level + 1);
                }
            };

            toggleWrapper.onclick = doToggle;
            tagContent.onclick = doToggle; // Clicking tag also toggles if it has children

            // Inspect icon click
            inspectIcon.onclick = (e) => {
                e.stopPropagation();
                this.selectElement(child);
                // Visual feedback
                inspectIcon.style.opacity = '1';
                setTimeout(() => inspectIcon.style.opacity = '0.3', 500);
            };

            // Highlight on hover
            row.onmouseenter = () => {
                row.style.background = 'rgba(255,255,255,0.05)';
                inspectIcon.style.opacity = '0.8';
                this.highlightElement(child);
            };
            row.onmouseleave = () => {
                row.style.background = '';
                inspectIcon.style.opacity = '0.3';
                if (this.highlightEl) this.highlightEl.style.display = 'none';
                if (this.tooltipEl) this.tooltipEl.style.display = 'none';
            };

            containerEl.appendChild(row);
            containerEl.appendChild(childrenContainer);
        });
    }

    populateStylesheets() {
        const select = this._get('css-stylesheet-select');
        select.innerHTML = '<option value="">Select Stylesheet...</option>';
        Array.from(document.styleSheets).forEach((sheet, idx) => {
            const name = sheet.href ? sheet.href.split('/').pop() : `Inline Stylesheet #${idx + 1}`;
            const opt = document.createElement('option');
            opt.value = idx;
            opt.textContent = name;
            select.appendChild(opt);
        });
    }

    loadStylesheet(indexStr) {
        if (!indexStr) {
            this._get('css-rules-container').innerHTML = '<div style="color:var(--text-muted); font-size:10px">Select a stylesheet to view rules.</div>';
            return;
        }
        
        const idx = parseInt(indexStr);
        const sheet = document.styleSheets[idx];
        const container = this._get('css-rules-container');
        
        if (!sheet) return;

        try {
            let html = '';
            Array.from(sheet.cssRules).forEach(rule => {
                if (rule.selectorText) {
                    // Extract styles safely
                    const styles = rule.style.cssText.split(';').filter(s => s.trim()).map(s => {
                        const [k, v] = s.split(':');
                        if (!k || !v) return '';
                        return `<div style="padding-left:16px"><span style="color:#9cdcfe">${k.trim()}</span>: <span style="color:#ce9178">${v.trim()}</span>;</div>`;
                    }).join('');
                    
                    html += `
                        <div class="css-rule-row" style="background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.05); border-radius:4px; padding:8px; margin-bottom:8px; font-family:'JetBrains Mono'; font-size:11px">
                            <div style="color:var(--debug-accent); font-weight:700; margin-bottom:4px">${rule.selectorText} {</div>
                            ${styles}
                            <div style="color:var(--debug-accent); font-weight:700; margin-top:4px">}</div>
                        </div>
                    `;
                }
            });
            container.innerHTML = html || '<div style="color:var(--text-muted); font-size:10px">No readable rules in this stylesheet. (CORS limitation?)</div>';
            
            // Re-apply search if exists
            const search = this._get('css-rule-search').value;
            if (search) this.filterCSSRules(search);
        } catch (e) {
            container.innerHTML = `<div style="color:var(--debug-error); font-size:10px">Blocked by browser security (CORS) or error: ${e.message}</div>`;
        }
    }

    filterCSSRules(query) {
        const q = query.toLowerCase();
        this.container.querySelectorAll('.css-rule-row').forEach(row => {
            row.style.display = row.textContent.toLowerCase().includes(q) ? 'block' : 'none';
        });
    }
}

export const debugUI = new DebugUI();
