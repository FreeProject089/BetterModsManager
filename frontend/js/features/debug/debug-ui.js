// @ts-nocheck
import { debugHub } from './debug.js';
import { collectWebviewEnv } from './webview-env.js';
import { appState } from '../../core/state.js';
import { invoke } from '../../core/api.js';
import { t, applyTranslations } from '../../core/i18n.js';
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
        this._updateInterval = null;
        this._hubSub = null;
    }
    // Helper to find elements within devtools containers
    _get(id) {
        if (!this.container)
            return document.getElementById(id);
        return this.container.querySelector(`#${id}`) ||
            (this.modalOverlay ? this.modalOverlay.querySelector(`#${id}`) : null) ||
            (this.crashOverlay ? this.crashOverlay.querySelector(`#${id}`) : null) ||
            document.getElementById(id);
    }
    init() {
        if (this.container)
            return; // Already initialized
        // Ensure no leftover overlay from previous failed init or duplicate call
        const existing = document.getElementById('bmm-debug-overlay');
        if (existing)
            existing.remove();
        this.createContainer();
        // Fire-and-forget: disable prod-only tabs when not in PTB/dev mode.
        // Resolves before the user can interact with the overlay.
        invoke('is_ptb_mode').then((isPtb) => {
            if (!isPtb && this.container) {
                this.container.classList.add('debug-prod-mode');
            }
        }).catch(() => { });
        this.createContextMenu();
        this.attachListeners();
        this.translateUI();
        this.startUpdateLoop();
        console.info('[BMM-Debug] UI Initialized. Toggle with Ctrl+Alt+D');
    }
    toggle(force) {
        const willOpen = force !== undefined ? force : !this.isOpen;
        // Strict lock gates OPENING only (force === true bypasses it, e.g. a navbar
        // button). CLOSING must always work — otherwise opening it from the navbar
        // without unlocking Debug Mode would trap the overlay with no way to close.
        if (willOpen && !appState.get('debugMode') && force !== true)
            return;
        if (willOpen) {
            if (!this.container)
                this.init(); // lazy build on first open
            this._ensureStateStyles();
            // The pane is rebuilt from scratch on open, so the last signature is meaningless.
            this._stateSignature = null;
            this.isOpen = true;
            this.container.classList.add('open');
            this.refreshAllPanes();
            this.translateUI();
            this.container.style.zIndex = '200000';
        }
        else {
            // Closing → fully unload to free RAM (rebuilt next time it opens).
            this.destroy();
        }
    }
    refreshAllPanes() {
        this.updateStateView();
        this.updatePatchTree();
        this.updateMetrics(debugHub.metrics);
        // Re-populate logs from hub
        const logsPane = this._get('console-logs');
        if (logsPane) {
            logsPane.innerHTML = '';
            debugHub.logs.forEach(log => this.appendLog(log));
        }
        // Re-populate timeline from hub
        const timelinePane = this._get('timeline-list');
        if (timelinePane) {
            timelinePane.innerHTML = '';
            // _renderTimelineEntry, not updateTimeline: this runs while restoring the panel,
            // before activeTab is necessarily 'timeline', and updateTimeline now declines to
            // draw when the tab is not in front.
            debugHub.ipcCalls.forEach(call => this._renderTimelineEntry(call));
            debugHub.actions.forEach(action => this._renderTimelineEntry(action));
        }
    }
    createContainer() {
        // Double check removal
        const old = document.getElementById('bmm-debug-overlay');
        if (old)
            old.remove();
        const div = document.createElement('div');
        div.id = 'bmm-debug-overlay';
        // Keep the whole DevTools overlay OUT of the session recorder. It re-renders constantly
        // (logs, IPC, metrics) and open/close churns a huge DOM — recording all of that was a
        // major source of memory growth (and could OOM the webview on repeated open/close).
        div.classList.add('bmm-no-record');
        div.setAttribute('data-bmm-no-record', '1');
        div.innerHTML = `
            <div class="debug-header">
                <div class="debug-title">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/></svg>
                    BMM DEVTOOLS
                </div>
                <div class="debug-controls">
                    <button class="debug-btn" id="debug-btn-devtools" data-i18n-tooltip="dev.btn.openDevtools" data-tasky="dev.msg.jsDesc" data-tasky-icon="icon-help">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
                    </button>
                    <button class="debug-btn" id="debug-btn-inspect" data-tasky="dev.tool.inspectTip" data-tasky-icon="icon-help">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="22" x2="12" y2="18"/></svg>
                    </button>
                    <button class="debug-btn" id="debug-btn-export" data-tasky="dev.tool.exportTip" data-tasky-icon="help">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                    </button>
                    <button class="debug-btn" id="debug-btn-rstudio" data-tasky="dev.tool.rstudioTip" data-tasky-icon="help">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>
                    </button>
                    <button class="debug-btn" id="debug-btn-anim" data-tasky="dev.tool.animTip" data-tasky-icon="help">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M13 2 3 14h7l-1 8 10-12h-7z"/></svg>
                    </button>
                    <button class="debug-btn" id="dbg-clear-all" data-tasky="dev.tool.clearAllTip" data-tasky-icon="help">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
                    </button>
                    <button class="debug-btn" id="debug-btn-close" data-tasky="dev.tool.closeTip" data-tasky-icon="help">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                </div>
            </div>
            <div class="debug-tabs">
                <div class="debug-tab active" data-tab="console" data-i18n="dev.tab.console">Console</div>
                <div class="debug-tab" data-tab="timeline" data-i18n="dev.tab.timeline">Timeline</div>
                <div class="debug-tab" data-tab="debugger" data-i18n="dev.tab.debugger">Debugger</div>
                <div class="debug-tab" data-tab="inspect-view" data-i18n="dev.tab.inspect">Inspect</div>
                <div class="debug-tab" data-tab="state" data-i18n="dev.tab.state">State</div>
                <div class="debug-tab" data-tab="playground" data-i18n="dev.tab.playground">Playground</div>
                <div class="debug-tab" data-tab="session" data-i18n="dev.tab.session">Session</div>
            </div>
            <div class="debug-content">
                <div class="debug-pane active" id="pane-console">
                    <div class="console-tools" style="padding:8px; border-bottom:1px solid var(--bmm-s05); display:flex; gap:8px">
                    <input type="text" id="console-search" data-i18n-placeholder="dev.placeholder.search" placeholder="Search..." style="flex:1; background:rgba(0,0,0,0.2); border:1px solid var(--debug-border); border-radius:4px; color:var(--debug-text-primary); font-size:10px; padding:4px 8px; outline:none">
                        <button class="debug-btn" id="console-clear-manual" data-i18n-tooltip="dev.btn.clearConsole" data-tasky="dev.tool.clearConsoleTip" data-tasky-icon="help">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
                        </button>
                    </div>
                    <div id="console-logs" class="debug-fill-scroll"></div>
                </div>
                <div class="debug-pane" id="pane-timeline">
                    <div class="timeline-filters" style="padding:8px; border-bottom:1px solid var(--bmm-s05); display:flex; gap:6px; align-items:center">
                        <button class="filter-btn active" data-filter="all" data-i18n="dev.label.all">ALL</button>
                        <button class="filter-btn" data-filter="ipc" data-i18n="dev.label.ipc">IPC</button>
                        <button class="filter-btn" data-filter="logs" data-i18n="dev.label.logs">LOGS</button>
                        <button class="filter-btn" data-filter="tasks" data-i18n="dev.label.tasks">TASKS</button>
                        <button class="filter-btn" data-filter="error" data-i18n="dev.label.error">ERR</button>
                        <div class="debug-fill"></div>
                        <button class="debug-btn" id="timeline-clear-manual" data-i18n-tooltip="dev.btn.clearHistory" data-tasky="dev.tool.clearHistoryTip" data-tasky-icon="help">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
                        </button>
                    </div>
                    <div id="timeline-list" class="debug-fill-scroll"></div>
                </div>
                <div class="debug-pane" id="pane-debugger">
                    <div class="debugger-layout" style="display:flex; height:100%; flex-direction:column">
                        <!-- The JS debugger sub-tab was removed: the real Chrome DevTools
                             (button in the header) does everything the custom JS pane did,
                             better. RUST is now the default debugger sub-tab. -->
                        <div class="debugger-subtabs" style="display:flex; border-bottom:1px solid var(--bmm-s05); background:rgba(0,0,0,0.1)">
                            <div class="debug-subtab active" data-sub="rust" data-i18n="dev.subtab.rust">RUST</div>
                            <div class="debug-subtab" data-sub="html" data-i18n="dev.subtab.html">HTML</div>
                            <div class="debug-subtab" data-sub="css" data-i18n="dev.subtab.css">CSS</div>
                        </div>
                        <div class="debugger-subcontent" style="flex:1; position:relative; overflow:hidden">
                            <div class="debug-subpane active" id="subpane-rust" style="height:100%; flex-direction:column; display:flex">
                                <div style="padding:12px 16px; border-bottom:1px solid var(--bmm-s05); display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.2)">
                                    <div>
                                        <div style="font-size:13px; font-weight:600; color:var(--debug-text-primary); margin-bottom:2px" data-i18n="dev.title.rust">Rust Debugger (GDB/LLDB)</div>
                                        <div class="debug-label" data-i18n="dev.msg.rustDesc">Attach a native debugger or view backend logs.</div>
                                    </div>
                                    <div class="debug-row">
                                        <button class="debug-btn debug-btn-ghost debug-btn-sm" id="rust-export-diag" data-i18n="dev.btn.exportDiag">EXPORT DIAG</button>
                                        <button class="debug-btn debug-btn-ghost debug-btn-sm" id="rust-gen-report" data-i18n="dev.btn.genReport">REPORT</button>
                                        <button class="debug-btn debug-btn-ghost debug-btn-sm" id="rust-mem-snap" data-i18n="dev.btn.memSnap">MEMORY</button>
                                        <button class="debug-btn debug-btn-ghost" id="rust-copy-lldb" data-i18n="dev.btn.copyCmd">COPY CMD</button>
                                        <button class="debug-btn debug-btn-primary" id="rust-refresh-logs" style="font-size:10px; padding:4px 12px" data-i18n="dev.btn.refreshLogs">REFRESH LOGS</button>
                                    </div>
                                </div>
                                <div style="flex:1; overflow-y:auto; padding:8px; font-family:'JetBrains Mono'; font-size:10px; user-select:text" id="rust-logs-container">
                                    <div style="color:var(--text-muted)" data-i18n="dev.msg.clickRefresh">Click Refresh to load logs...</div>
                                </div>
                            </div>
                            <div class="debug-subpane" id="subpane-html" style="height:100%; overflow-y:auto; padding:8px; display:none; flex-direction:column">
                                <div style="margin-bottom:8px; display:flex; gap:8px">
                                    <button class="debug-btn" id="html-refresh-dom"  data-i18n="dev.btn.refreshDom">Generate DOM Tree</button>
                                    <button class="debug-btn debug-btn-ghost" id="html-collapse-all"  data-i18n="dev.btn.collapseAll">Collapse All</button>
                                </div>
                                <div id="html-dom-tree" style="font-family:'JetBrains Mono'; font-size:11px"></div>
                            </div>
                            <div class="debug-subpane" id="subpane-css" style="height:100%; display:flex; flex-direction:column; display:none">
                                <div style="flex:1; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:16px">
                                    <div style="background:rgba(0,0,0,0.2); border:1px solid var(--bmm-s05); border-radius:6px; padding:16px;">
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

                                        <div id="dbg-grid-config" style="display:none; padding-top:12px; border-top:1px dashed var(--bmm-s10)">
                                            <div style="margin-bottom:12px">
                                                <div class="debug-row-split">
                                                    <div id="dbg-label-grid-h" style="font-size:12px; font-weight:600; color:var(--debug-text-primary)" data-i18n="dev.label.gridH">Horizontal Spacing</div>
                                                    <div class="debug-label"><span id="dbg-grid-h-val">16</span>px</div>
                                                </div>
                                                <input type="range" id="dbg-grid-h" min="0" max="64" value="16" class="custom-range" style="width:100%; --val:25%">
                                            </div>
                                            <div>
                                                <div class="debug-row-split">
                                                    <div id="dbg-label-grid-v" style="font-size:12px; font-weight:600; color:var(--debug-text-primary)" data-i18n="dev.label.gridV">Vertical Spacing</div>
                                                    <div class="debug-label"><span id="dbg-grid-v-val">16</span>px</div>
                                                </div>
                                                <input type="range" id="dbg-grid-v" min="0" max="64" value="16" class="custom-range" style="width:100%; --val:25%">
                                            </div>
                                        </div>
                                    </div>

                                    <div style="display:flex; justify-content:space-between; align-items:center; padding:0 4px">
                                        <select id="css-stylesheet-select" style="background:rgba(0,0,0,0.3); border:1px solid var(--debug-border); color:var(--debug-text-primary); padding:4px; font-size:11px; border-radius:4px; outline:none; max-width:200px">
                                            <option value="" data-i18n="dev.msg.selectStylesheet">Select a stylesheet...</option>
                                        </select>
                                        <input type="text" id="css-rule-search" data-i18n-placeholder="dev.placeholder.filter" placeholder="Filter..." style="background:rgba(0,0,0,0.3); border:1px solid var(--debug-border); padding:4px 8px; font-size:11px; color:var(--debug-text-primary); border-radius:4px; outline:none; width:120px">
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
                    <div id="inspect-header" style="padding:8px 16px; border-bottom:1px solid var(--debug-border); display:none; justify-content:space-between; align-items:center; background:var(--bmm-s02)">
                        <span style="font-size:10px; font-weight:700; color:var(--text-muted)" data-i18n="dev.label.inspector">INSPECTOR</span>
                                <button class="debug-btn debug-btn-ghost" id="inspect-btn-clear" style="font-size:10px; padding:4px 10px" data-i18n="dev.btn.clearSelection">CLEAR SELECTION</button>
                    </div>
                    <div id="inspect-content" style="padding:16px; border-bottom:1px solid var(--debug-border); overflow-y:auto; height:100%">
                        <div class="debug-label" data-i18n="dev.msg.selectElement">Select an element to inspect...</div>
                    </div>
                </div>
                <div class="debug-pane" id="pane-state"></div>
                <!-- Filled on demand by session-pane.ts: subscribing to the recorder costs
                     nothing until someone actually looks. -->
                <div class="debug-pane" id="pane-session"></div>
                <div class="debug-pane" id="pane-playground">
                    <div style="padding:16px">
                        <div style="margin-bottom:12px; font-size:10px; color:var(--text-muted); display:flex; justify-content:space-between">
                            <span data-i18n="dev.label.hotPatch">HOT-PATCH: CSS / JS</span>
                            <div class="debug-row">
                                <button id="playground-reset" class="debug-btn debug-btn-ghost" style="color:var(--debug-accent); font-size:10px; padding:2px 6px" data-i18n="dev.btn.reset">RESET</button>
                                <button id="playground-export" class="debug-btn debug-btn-ghost" style="color:var(--debug-success); font-size:10px; padding:2px 6px" data-i18n="dev.btn.exportPatch">EXPORT PATCH</button>
                            </div>
                        </div>
                        <textarea id="playground-code" style="width:100%; height:120px; background:rgba(0,0,0,0.3); border:1px solid var(--debug-border); border-radius:8px; color:var(--debug-accent); font-family:inherit; padding:12px; font-size:11px; outline:none" data-i18n-placeholder="dev.placeholder.playground" placeholder="/* Enter CSS or JS here... */"></textarea>
                        <div style="margin-top:12px; display:flex; gap:8px">
                            <button class="debug-btn debug-btn-primary debug-fill" id="playground-apply-css" data-i18n="dev.btn.applyCss">APPLIQUER CSS</button>
                            <button class="debug-btn debug-btn-success debug-fill" id="playground-run-js" data-i18n="dev.btn.runJs">EXÉCUTER JS</button>
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
        modalOverlay.className = 'debug-modal-overlay bmm-no-record';
        modalOverlay.innerHTML = `
            <div id="debug-modal-content" class="debug-modal-content">
                <h3 id="debug-modal-title" style="margin:0 0 12px 0; font-size:18px; color:var(--text-primary); font-weight:800" data-i18n="dev.modal.confirmTitle">Confirm Action</h3>
                <p id="debug-modal-text" style="margin:0 0 24px 0; font-size:14px; color:var(--text-secondary); line-height:1.6; opacity:0.8" data-i18n="dev.modal.confirmText">Are you sure?</p>
                <div id="debug-modal-input-container" style="display:none; margin-bottom:24px">
                    <input type="text" id="debug-modal-input" style="width:100%; padding:12px; background:rgba(0,0,0,0.4); border:1px solid var(--bmm-s10); border-radius:8px; color:var(--debug-text-primary); outline:none; font-family:'JetBrains Mono'">
                </div>
                <div style="display:flex; justify-content:flex-end; gap:12px">
                    <button id="debug-modal-cancel" class="debug-btn debug-btn-ghost" style="padding:10px 20px" data-i18n="common.cancel">Cancel</button>
                    <button id="debug-modal-confirm" class="debug-btn debug-btn-primary" style="padding:10px 32px" data-i18n="common.ok">OK</button>
                </div>
            </div>
        `;
        this.modalOverlay = modalOverlay;
        // Inside #app-window-outer, NOT body. The app window is an inset rounded card with
        // a transparent margin around it (the Tasky corner); an overlay on <body> paints
        // its dark blur over that margin and the rounded corners — the "shadow on the
        // outer div" bug. The outer container carries contain:paint, so mounting inside
        // clips the overlay to the app card exactly. position:fixed still centres, since
        // contain makes the container the containing block.
        (document.getElementById('app-window-outer') || document.body).appendChild(modalOverlay);
        // Load persisted position/size
        this.loadPosition();
        // Create Crash Overlay
        const crashDiv = document.createElement('div');
        crashDiv.className = 'debug-crash-overlay bmm-no-record';
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
                    <button class="debug-btn" style="flex:1; background: linear-gradient(135deg, rgba(239,68,68,0.9), rgba(185,28,28,0.9)); color:var(--debug-text-primary); padding:16px; border-radius:12px; font-weight:800; border:1px solid rgba(248, 113, 113, 0.5); cursor:pointer; box-shadow: 0 8px 32px rgba(239, 68, 68, 0.3); text-transform: uppercase; letter-spacing: 0.1em; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); font-size: 13px; backdrop-filter: blur(8px);" data-i18n="dev.crash.reload">
                        RELOAD APPLICATION
                    </button>
                    <button class="debug-btn" style="flex:1; background: rgba(30,41,59,0.5); color:#f8fafc; padding:16px; border-radius:12px; border:1px solid var(--bmm-s10); cursor:pointer; font-weight: 700; backdrop-filter: blur(12px); transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); text-transform: uppercase; letter-spacing: 0.05em; font-size: 13px; box-shadow: 0 4px 16px rgba(0,0,0,0.2);" id="crash-copy-dump" data-i18n="dev.crash.copyDump">
                        COPY DUMP
                    </button>
                </div>

                <button class="debug-btn" style="background:none; color:rgba(239, 68, 68, 0.7); font-size:12px; font-weight: 600; text-decoration:none; border:none; cursor:pointer; transition: all 0.2s; padding: 10px 20px; border-radius: 8px; white-space: nowrap; display: inline-block; width: max-content;" id="crash-dismiss" data-i18n="dev.crash.dismiss">
                    Dismiss & Continue (Unstable System State)
                </button>
            </div>

            <div style="margin-top:60px; font-size:10px; color:rgba(255,255,255,0.2); font-family:var(--font-mono); border-top: 1px solid var(--bmm-s05); padding-top: 24px; letter-spacing: 1px; width: 80%; text-align: center;">BMM_OS_DEBUG_v0.9.8 // ${new Date().toISOString()}</div>
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
                btn.style.borderColor = 'var(--bmm-s10)';
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
        if (!this.container)
            this.init();
        if (!this.isOpen)
            return; // Don't show DevTools modals if DevTools is closed
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
            setTimeout(() => { if (!overlay.classList.contains('active'))
                overlay.style.display = 'none'; }, 300);
        };
        overlay.style.display = 'flex';
        setTimeout(() => overlay.classList.add('active'), 10);
        confirmBtn.onclick = () => {
            if (onConfirm)
                onConfirm();
            close();
        };
        cancelBtn.onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay)
            close(); };
    }
    showPrompt(title, text, defaultValue, onConfirm) {
        if (!this.container)
            this.init();
        if (!this.isOpen)
            return;
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
            setTimeout(() => { if (!overlay.classList.contains('active'))
                overlay.style.display = 'none'; }, 300);
        };
        overlay.style.display = 'flex';
        setTimeout(() => {
            overlay.classList.add('active');
            input.focus();
        }, 10);
        cancelBtn.onclick = close;
        confirmBtn.onclick = () => {
            if (onConfirm)
                onConfirm(input.value);
            close();
        };
        overlay.onclick = (e) => { if (e.target === overlay)
            close(); };
    }
    showAlert(title, text) {
        if (!this.container)
            this.init();
        // Allow alerts if explicitly triggered, but they will only be visible if DevTools is open
        // OR we can explicitly open DevTools for important alerts?
        // User said they are visible when NOT activated, so we should probably not show them or open DevTools.
        if (!this.isOpen)
            return;
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
        overlay.onclick = (e) => { if (e.target === overlay)
            close(); };
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
        // Open the real Chrome/WebView2 DevTools (header button — replaces the old JS sub-tab)
        this._get('debug-btn-devtools')?.addEventListener('click', async () => {
            try {
                await invoke('open_devtools');
            }
            catch (e) {
                console.log("F12 is the standard fallback for opening DevTools.", e);
                this.showAlert('Chrome DevTools', "Tauri devtools API couldn't be invoked automatically. Please press F12 on your keyboard to open the Chrome DevTools inspector.");
            }
        });
        // Replay Studio — record a .bmmreplay with a movable frame + pause/resume.
        this._get('debug-btn-rstudio')?.addEventListener('click', async () => {
            try {
                (await import('./replay-studio.js')).openReplayStudio();
            }
            catch (e) {
                console.log('replay studio failed to open', e);
            }
        });
        // Animation Studio — inject/define GSAP animations on live BMM elements.
        this._get('debug-btn-anim')?.addEventListener('click', async () => {
            try {
                (await import('./anim-studio.js')).openAnimStudio();
            }
            catch (e) {
                console.log('animation studio failed to open', e);
            }
        });
        // Debugger Rust
        // The production tool: one JSON with build/version/uptime/memory + the same log
        // lines this tab shows, written to app-data/diagnostics and revealed. What a bug
        // report needs, without asking the user to screenshot devtools and hunt files.
        // A report, not a dump: the same facts as the JSON export, ordered so the
        // first screen answers "what is this and what went wrong". The JSON is right
        // for a machine; this is for the moment it is actually used, which is someone
        // pasting their problem into a chat where nobody reads a wall of JSON.
        this._get('rust-gen-report')?.addEventListener('click', async () => {
            try {
                const path = await window.__TAURI__.core.invoke('generate_diagnostic_report', { frontend: collectWebviewEnv() });
                window.showToast?.((window.t?.('dev.reportSaved') || 'Diagnostic report saved') + ' — ' + path, 'success', 6000);
                window.__TAURI__.core.invoke('open_folder', { path: String(path).replace(/[\/][^\/]+$/, '') }).catch(() => { });
            }
            catch (e) {
                window.showToast?.((window.t?.('common.error') || 'Error') + ': ' + e, 'error');
            }
        });
        this._get('rust-mem-snap')?.addEventListener('click', async () => {
            const btn = this._get('rust-mem-snap');
            // It samples for 2.5s. Without saying so the button looks broken, and the
            // user presses it again — which starts a second sampling run.
            if (btn) {
                btn.disabled = true;
                btn.textContent = '…';
            }
            try {
                // performance.memory is Chromium-only and absent under some flags, so
                // it is read defensively: the process figures are the point, the JS
                // heap is the bonus that says whether a leak is ours or the webview's.
                const pm = performance.memory;
                const jsHeap = pm ? {
                    usedJSHeapSize: pm.usedJSHeapSize,
                    totalJSHeapSize: pm.totalJSHeapSize,
                    jsHeapSizeLimit: pm.jsHeapSizeLimit,
                } : null;
                const path = await window.__TAURI__.core.invoke('capture_memory_snapshot', { jsHeap });
                window.showToast?.((window.t?.('dev.memSaved') || 'Memory snapshot saved') + ' — ' + path, 'success', 6000);
                window.__TAURI__.core.invoke('open_folder', { path: String(path).replace(/[\/][^\/]+$/, '') }).catch(() => { });
            }
            catch (e) {
                window.showToast?.((window.t?.('common.error') || 'Error') + ': ' + e, 'error');
            }
            finally {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = window.t?.('dev.btn.memSnap') || 'MEMORY';
                }
            }
        });
        this._get('rust-export-diag')?.addEventListener('click', async () => {
            try {
                const path = await window.__TAURI__.core.invoke('export_diagnostics', { frontend: collectWebviewEnv() });
                window.showToast?.((window.t?.('dev.diagExported') || 'Diagnostic exported') + ' — ' + path, 'success');
                window.__TAURI__.core.invoke('open_folder', { path: String(path).replace(/[\/][^\/]+$/, '') }).catch(() => { });
            }
            catch (e) {
                window.showToast?.((window.t?.('common.error') || 'Error') + ': ' + e, 'error');
            }
        });
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
                    if (!el.style)
                        return;
                    const z = window.getComputedStyle(el).zIndex;
                    if (z !== 'auto' && z !== '0') {
                        el.dataset.bmmZIndex = z;
                        el.classList.add('bmm-show-zindex');
                    }
                });
            }
            else {
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
            if (!gridEl)
                return;
            const hInput = document.getElementById('dbg-grid-h');
            const vInput = document.getElementById('dbg-grid-v');
            if (!hInput || !vInput)
                return;
            const h = hInput.value;
            const v = vInput.value;
            hInput.style.setProperty('--val', ((h / 64) * 100) + '%');
            vInput.style.setProperty('--val', ((v / 64) * 100) + '%');
            const hValSpan = document.getElementById('dbg-grid-h-val');
            const vValSpan = document.getElementById('dbg-grid-v-val');
            if (hValSpan)
                hValSpan.textContent = h;
            if (vValSpan)
                vValSpan.textContent = v;
            const hBg = h > 0 ? `linear-gradient(rgba(255,255,255,0.15) 1px, transparent 1px)` : '';
            const vBg = v > 0 ? `linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px)` : '';
            const bgStr = [hBg, vBg].filter(Boolean).join(', ');
            gridEl.style.backgroundImage = bgStr;
            gridEl.style.backgroundSize = `${v > 0 ? v : 10}px ${h > 0 ? h : 10}px`;
        };
        this._get('dbg-css-grid')?.addEventListener('change', e => {
            const config = document.getElementById('dbg-grid-config');
            if (config)
                config.style.display = e.target.checked ? 'block' : 'none';
            let gridEl = document.getElementById('bmm-layout-grid');
            if (e.target.checked) {
                if (!gridEl) {
                    gridEl = document.createElement('div');
                    gridEl.id = 'bmm-layout-grid';
                    document.body.appendChild(gridEl);
                }
                updateGrid();
            }
            else if (gridEl) {
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
                if (logs)
                    logs.innerHTML = '';
                if (timeline)
                    timeline.innerHTML = '';
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
        // [Sources tab removed — was laggy and rarely used]
        // Keyboard shortcuts
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && this.isInspecting) {
                this.toggleInspector(false);
            }
            // 'I' key → toggle inspect (ONLY when devtools overlay is open + focus not in an input)
            if ((e.key === 'i' || e.key === 'I') && !e.ctrlKey && !e.metaKey && !e.altKey && this.isOpen) {
                const tag = document.activeElement?.tagName?.toLowerCase();
                if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
                    e.preventDefault();
                    this.container.querySelector('#debug-btn-inspect')?.click();
                }
            }
        });
        // Prevent keyboard events from inputs/textareas inside the devtools overlay
        // from propagating to global shortcuts (e.g. typing in REPL or search)
        this.container.addEventListener('keydown', e => {
            const tag = e.target?.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea') {
                e.stopPropagation();
            }
        }, true);
        this._get('console-search').addEventListener('input', e => {
            const query = e.target.value.toLowerCase();
            this.container.querySelectorAll('#console-logs .log-entry').forEach(entry => {
                const text = entry.textContent.toLowerCase();
                entry.style.display = text.includes(query) ? 'flex' : 'none';
            });
        });
        document.addEventListener('click', e => {
            if (this.isInspecting || e.target.closest('#bmm-debug-overlay'))
                return;
            const target = e.target.closest('button, .nav-item, input, select') || e.target;
            debugHub.recordAction('CLICK', target, target.innerText?.trim() || target.value || '');
        }, true);
        this._get('inspect-btn-clear').addEventListener('click', () => this.clearSelection());
        this._get('playground-apply-css').addEventListener('click', () => {
            try {
                const code = this._get('playground-code').value;
                debugHub.applyPatch('CSS', code);
            }
            catch (err) {
                this.showAlert('CSS Error', err.message || 'Invalid CSS syntax.');
            }
        });
        this._get('playground-run-js').addEventListener('click', () => {
            try {
                const code = this._get('playground-code').value;
                debugHub.applyPatch('JS', code);
            }
            catch (err) {
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
            if (!el)
                return;
            const key = el.dataset.key;
            const currentValue = appState.get(key);
            this.showPrompt(`Edit state: ${key}`, `Enter new value for '${key}':`, JSON.stringify(currentValue), (newValue) => {
                if (newValue !== null) {
                    try {
                        appState.set(key, JSON.parse(newValue));
                        this.updateStateView();
                    }
                    catch (e) {
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
            if (e.target.closest('.debug-btn'))
                return;
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
                // Clamp inside the BMM window so the panel can never be dragged out
                // of view and become ungrabbable. Keep a strip always on-screen.
                const w = this.container.offsetWidth;
                const KEEP = 160; // min visible width on either edge
                const HDR = 44; // header height kept reachable
                let nx = initialLeft + dx;
                let ny = initialTop + dy;
                nx = Math.max(KEEP - w, Math.min(nx, window.innerWidth - KEEP));
                ny = Math.max(0, Math.min(ny, window.innerHeight - HDR));
                this.container.style.left = nx + 'px';
                this.container.style.top = ny + 'px';
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
        // Debug Hub events. The callback is kept on the instance because destroy() must
        // hand this exact reference back to unsubscribe(): a close/open cycle rebuilds the
        // UI and would otherwise add a second, third, Nth permanent subscriber, each one
        // retaining the destroyed UI and its detached DOM.
        debugHub.subscribe(this._hubSub = event => {
            if (event.type === 'crash') {
                // Guarded, because this runs from window.onerror. The overlay only
                // exists once the DevTools panel has been built, so before that every
                // uncaught error in the app produced a SECOND error here — and that
                // one, thrown inside the error handler, is what surfaced. The real
                // error was reported at the same time but the handler crash sat next
                // to it looking like a separate fault, and the details element was
                // never filled either way. An error reporter that fails on the errors
                // it exists to report is worse than none.
                this.crashOverlay?.classList.add('active');
                const det = this._get('crash-details');
                if (det)
                    det.textContent = event.data?.msg || 'Unknown internal error';
                return;
            }
            // DO NOT update UI if closed (MAJOR LAG FIX)
            if (!this.isOpen)
                return;
            if (event.type === 'log')
                this.appendLog(event.data);
            if (event.type === 'ipc' || event.type === 'action')
                this.updateTimeline(event.data);
            if (event.type === 'clear') {
                const logs = this._get('console-logs');
                const timeline = this._get('timeline-list');
                if (logs)
                    logs.innerHTML = '';
                if (timeline)
                    timeline.innerHTML = '';
                // hub data already cleared by debugHub.clear()
            }
            if (event.type === 'state') {
                this.updateStateView();
            }
            if (event.type === 'metrics')
                this.updateMetrics(event.data);
            if (event.type === 'patches')
                this.updatePatchTree();
        });
        // Inspector mouse move
        document.addEventListener('mousemove', e => {
            if (!this.isInspecting)
                return;
            // Find element under cursor (excluding debug overlay)
            const el = document.elementFromPoint(e.clientX, e.clientY);
            if (el && !el.closest('#bmm-debug-overlay') && !el.classList.contains('debug-inspect-highlight')) {
                this.highlightElement(el);
            }
        });
        document.addEventListener('click', e => {
            if (!this.isInspecting)
                return;
            e.preventDefault();
            e.stopPropagation();
            const target = this.hoveredEl;
            if (!target)
                return; // FIX: Prevent crash if clicking empty space
            this.selectElement(target);
            console.debug('[Inspector] Selected:', target);
            // Auto-fill playground with current styles for quick editing
            const computed = window.getComputedStyle(target);
            const styleSnippet = `/* Edit styles for ${target.tagName.toLowerCase()} */\n` +
                `selector {\n  background: ${computed.backgroundColor};\n  color: ${computed.color};\n  border: ${computed.border};\n}`;
            const playground = this._get('playground-code');
            if (playground)
                playground.value = styleSnippet;
        }, true);
    }
    translateUI() {
        if (!this.container)
            return;
        applyTranslations(this.container);
    }
    toggleInspector(force) {
        this.isInspecting = force !== undefined ? force : !this.isInspecting;
        const btn = this._get('debug-btn-inspect');
        btn.classList.toggle('active', this.isInspecting);
        document.body.style.cursor = this.isInspecting ? 'crosshair' : '';
        if (!this.isInspecting) {
            if (this.highlightEl)
                this.highlightEl.style.display = 'none';
            if (this.tooltipEl)
                this.tooltipEl.style.display = 'none';
            btn.classList.remove('active');
        }
        else {
            btn.classList.add('active');
        }
    }
    appendLog(item) {
        const logs = this._get('console-logs');
        if (!logs)
            return;
        const entry = document.createElement('div');
        entry.className = `log-entry ${item.level}`;
        entry.innerHTML = `<span style="opacity:0.5; font-size:9px">[${new Date().toLocaleTimeString()}]</span> <span>${this.escapeHtml(item.message)}</span>`;
        logs.appendChild(entry);
        // Same cap as the timeline, same reason: the hub trims its array at 500, the
        // DOM never trimmed at all. Console appends, so the oldest is the FIRST child.
        while (logs.children.length > 400)
            logs.removeChild(logs.firstChild);
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
            <div class="patch-row" style="display:flex; justify-content:space-between; align-items:center; background:var(--bmm-s03); padding:6px 10px; border-radius:4px; font-size:10px">
                <span style="color:var(--debug-accent)">${p.type}: ${p.id}</span>
                <button class="patch-remove" data-id="${p.id}" style="background:none; border:none; color:var(--debug-error); cursor:pointer">REMOVE</button>
            </div>
        `).join('') || '<div class="debug-hint">No active patches.</div>';
    }
    switchTab(tabId) {
        const wasTimeline = this.activeTab === 'timeline';
        this.activeTab = tabId;
        // Arriving at the Timeline: everything that happened while it was hidden was
        // recorded by the hub but not drawn, so redraw from the hub. Without this the pane
        // would show a gap exactly as long as the time you spent on another tab.
        if (tabId === 'timeline' && !wasTimeline)
            this.rebuildTimeline();
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
        if (tabId === 'session') {
            const pane = this.container.querySelector('#pane-session');
            if (pane) {
                void import('./session-pane.js').then((m) => m.mountSessionPane(pane));
            }
        }
        else {
            // Stop the 2s refresh as soon as it is off screen; the subscription stays so the
            // counters keep meaning something when you come back.
            void import('./session-pane.js').then((m) => m.unmountSessionPane()).catch(() => { });
        }
        if (tabId === 'debugger') {
            const activeSub = this.container.querySelector('.debug-subtab.active');
            if (activeSub)
                this.switchDebuggerSubtab(activeSub.dataset.sub);
        }
    }
    switchDebuggerSubtab(subId) {
        this.container.querySelectorAll('.debug-subtab').forEach(t => {
            t.classList.toggle('active', t.dataset.sub === subId);
        });
        this.container.querySelectorAll('.debug-subpane').forEach(p => {
            p.style.display = p.id === `subpane-${subId}` ? 'flex' : 'none';
            if (p.id === `subpane-${subId}`)
                p.style.flexDirection = 'column';
        });
        if (subId === 'css') {
            this.loadStylesheetsList();
        }
        if (subId === 'html' && this._get('html-dom-tree').innerHTML === '') {
            this.buildDomTree();
        }
        if (subId === 'rust' && (this._get('rust-logs-container').textContent.includes('Click Refresh') || this._get('rust-logs-container').textContent.includes('Actualiser'))) {
            this.refreshRustLogs();
        }
    }
    loadStylesheetsList() {
        const select = this._get('css-stylesheet-select');
        if (!select)
            return;
        // Preserve current selection if possible
        const currentVal = select.value;
        const selectPrompt = t('dev.msg.selectStylesheet') || 'Sélectionner une feuille...';
        select.innerHTML = `<option value="">${selectPrompt}</option>`;
        let found = false;
        Array.from(document.styleSheets).forEach((sheet, i) => {
            try {
                // Must access cssRules to trigger CORS error early
                if (!sheet.cssRules)
                    return;
                let name = sheet.href ? sheet.href.split('/').pop() : 'inline style';
                if (name.includes('debug.css'))
                    return; // Ignore debug styles
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = `[${i}] ${name} (${sheet.cssRules.length} règles)`;
                select.appendChild(opt);
                if (currentVal && currentVal == i)
                    found = true;
            }
            catch (e) {
                // CORS or restricted
            }
        });
        if (found)
            select.value = currentVal;
    }
    loadStylesheet(sheetIndex) {
        const container = this._get('css-rules-container');
        if (!container)
            return;
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
                if (rule.type !== CSSRule.STYLE_RULE)
                    continue;
                // Format the cssText
                const cssText = rule.cssText;
                const match = cssText.match(/\{([\s\S]*)\}/);
                let styles = match ? match[1].trim() : '';
                // Add minor syntax highlighting manually
                styles = styles.split(';').map(s => s.trim()).filter(s => s).map(s => {
                    const parts = s.split(':');
                    if (parts.length < 2)
                        return s;
                    return `<span style="color:#9cdcfe">${parts[0].trim()}</span>: <span style="color:#ce9178">${parts.slice(1).join(':').trim()}</span>;`;
                }).join('<br>  ');
                if (styles)
                    styles = '  ' + styles;
                // Live Edit Structure
                html += `
                    <div class="css-rule-block" style="margin-bottom:12px; font-family:'JetBrains Mono'; font-size:11px; padding:8px; border-radius:4px; background:var(--bmm-s02); border:1px solid var(--debug-border)">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px">
                            <div style="color:var(--debug-accent); font-weight:700">${this.escapeHtml(rule.selectorText || '')} {</div>
                            <button class="rule-inspect-btn" data-selector="${this.escapeHtml(rule.selectorText || '')}" data-tooltip="Inspect matching element" style="background:none; border:none; color:var(--debug-accent); cursor:pointer; padding:4px; border-radius:4px; display:flex; align-items:center; transition:background 0.2s">
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.94-.49-7-3.85-7-7.93s3.06-7.44 7-7.93V19.93z"></path></svg>
                            </button>
                        </div>
                        <div class="live-css-editor" contenteditable="true" spellcheck="false" data-sheet="${sheetIndex}" data-rule="${r}" data-selector="${this.escapeHtml(rule.selectorText || '')}" style="outline:none; padding:4px; border:1px dashed transparent; transition:border 0.2s" onfocus="this.style.borderColor='var(--debug-accent)'" onblur="this.style.borderColor='transparent'">${styles.replace(/<span.*?>/g, '').replace(/<\/span>/g, '')}</div>
                        <div style="color:var(--debug-accent); font-weight:700; margin-top:4px">}</div>
                    </div>
                `;
            }
            container.innerHTML = html || '<div style="color:var(--text-muted); font-size:10px; text-align:center">Nonee règle CSS standard trouvée.</div>';
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
            if (query)
                this.filterCSSRules(query);
        }
        catch (e) {
            container.innerHTML = `<div style="color:var(--debug-error); font-size:10px">Failed to lire la feuille: ${e.message}</div>`;
        }
    }
    filterCSSRules(query) {
        const container = this._get('css-rules-container');
        if (!container)
            return;
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
            }
            else {
                console.warn('[BMM-Debug] No element matches selector:', selector);
            }
        }
        catch (e) {
            console.error('[BMM-Debug] Invalid selector or error during inspection:', e);
        }
    }
    guessSourceFile(el) {
        // Simple heuristic: look for parent section IDs or common BMM components
        const section = el.closest('section, div[id]');
        if (section && section.id) {
            if (section.id.startsWith('doc-'))
                return 'frontend/index.html (Documentation)';
            if (section.id === 'mod-list')
                return 'frontend/js/app.js (Mod Loading)';
            if (section.id === 'settings-pane')
                return 'frontend/js/settings.js';
            return `frontend/index.html #${section.id}`;
        }
        if (el.classList.contains('nav-item'))
            return 'frontend/js/navigation.js';
        return 'frontend/index.html';
    }
    applyTimelineFilter(filter) {
        this.container.querySelectorAll('#timeline-list .ipc-entry').forEach(entry => {
            const isRPC = entry.querySelector('.rpc');
            const isAction = entry.querySelector('.action');
            const isError = entry.querySelector('.error');
            let visible = true;
            if (filter === 'rpc')
                visible = !!isRPC;
            else if (filter === 'action')
                visible = !!isAction;
            else if (filter === 'error')
                visible = !!isError;
            entry.style.display = visible ? 'flex' : 'none';
        });
    }
    // Queue an item for the Timeline pane.
    //
    // This used to BE the renderer, and it ran on every single IPC call for as long as
    // DevTools was open — including while another tab was showing, where not one pixel of
    // its output could be seen. Each call did a full `entry.innerHTML = …` reparse of markup
    // carrying inline SVG, attached a listener, and PREPENDED into a list of up to 400
    // nodes, which reflows the list every time. BMM talks IPC constantly (the mini-monitor
    // alone polls every couple of seconds), so opening DevTools bought a permanent stream of
    // layout work — enough to drag the whole machine down through the WebView2 compositor,
    // not just BMM.
    //
    // There was already a `if (!this.isOpen) return;` upstream marked "MAJOR LAG FIX". This
    // is the same fix finished: closed was handled, "open but looking at another tab" was
    // not.
    //
    // Two changes. Nothing is rendered unless the Timeline tab is actually in front — the
    // hub keeps the data either way, and switchTab() rebuilds the pane from it on the way
    // in, so nothing is lost by not drawing it. And what is rendered is batched into one
    // animation frame, so a burst of twenty IPC calls costs one layout pass instead of
    // twenty.
    updateTimeline(item) {
        if (!this._get('timeline-list'))
            return;
        if (this.activeTab !== 'timeline')
            return;
        (this._tlQueue || (this._tlQueue = [])).push(item);
        if (this._tlFrame)
            return;
        this._tlFrame = requestAnimationFrame(() => {
            this._tlFrame = 0;
            const q = this._tlQueue || [];
            this._tlQueue = [];
            for (const it of q)
                this._renderTimelineEntry(it);
        });
    }
    /** Rebuild the whole pane from the hub — used when the Timeline tab comes to the front
     *  after a spell of not being rendered. */
    rebuildTimeline() {
        const pane = this._get('timeline-list');
        if (!pane)
            return;
        pane.innerHTML = '';
        debugHub.ipcCalls.forEach(call => this._renderTimelineEntry(call));
        debugHub.actions.forEach(action => this._renderTimelineEntry(action));
    }
    _renderTimelineEntry(item) {
        const pane = this._get('timeline-list');
        if (!pane)
            return;
        let entry = this._get(`timeline-${item.id}`);
        const isNew = !entry;
        if (isNew) {
            entry = document.createElement('div');
            entry.id = `timeline-${item.id}`;
            entry.className = 'ipc-entry timeline-entry';
            pane.prepend(entry);
            // The DOM list must be capped like the hub arrays are. It never was: the
            // hub keeps 500 items, but every IPC call prepended a node FOREVER — and
            // BMM talks IPC constantly (the mini-monitor alone polls every couple of
            // seconds), so an open DevTools grew by thousands of SVG-bearing nodes an
            // hour. That growth is the "ça mange trop vite". Oldest fall off the end.
            while (pane.children.length > 400)
                pane.removeChild(pane.lastChild);
        }
        const isIPC = !!item.command;
        const ts = new Date(item.timestamp);
        const hms = ts.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const ms = String(ts.getMilliseconds()).padStart(3, '0');
        const timeLabel = item.duration != null && item.duration > 0
            ? `${item.duration}ms`
            : `${hms}.${ms}`;
        // Preview: IPC → truncated args JSON; Action → details/target
        const argsStr = isIPC
            ? (() => { try {
                const s = JSON.stringify(item.args);
                return s.length > 60 ? s.slice(0, 57) + '…' : s;
            }
            catch {
                return '';
            } })()
            : (item.details ? String(item.details).slice(0, 60) : (item.target || ''));
        // Status class
        const statusCls = item.status === 'success' ? 'success'
            : item.status === 'error' ? 'error'
                : item.status === 'pending' ? 'pending'
                    : 'info';
        // Type-specific icon
        const ipcIcon = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`;
        const clickIcon = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 9l-4 11 3.5-1.5L10.5 22l4-11"/><path d="M17 2l-1 7 3 1"/></svg>`;
        const navIcon = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
        const patchIcon = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
        const actionIcon = item.type?.startsWith('PATCH') ? patchIcon
            : (item.type === 'CLICK' ? clickIcon : (item.type === 'NAV' ? navIcon
                : `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>`));
        const icon = isIPC ? ipcIcon : actionIcon;
        const label = isIPC ? item.command : item.type;
        const statusLabel = isIPC ? (item.status || 'pending') : (item.target ? String(item.target).slice(0, 18) : '—');
        // Expandable details
        const expandId = `tl-expand-${item.id}`;
        let detailBlock = '';
        if (isIPC) {
            const argsJson = (() => { try {
                return JSON.stringify(item.args, null, 2);
            }
            catch {
                return String(item.args);
            } })();
            const resultJson = (() => { try {
                return JSON.stringify(item.result, null, 2)?.slice(0, 400) || '—';
            }
            catch {
                return '—';
            } })();
            // Escape — args/results may contain HTML/SVG (e.g. icon markup) that
            // must NOT be parsed as DOM, or the browser logs SVG-parse errors.
            detailBlock = `<div id="${expandId}" class="timeline-detail" style="display:none;grid-column:1/-1;background:rgba(0,0,0,0.25);border-radius:6px;padding:8px;margin-top:4px;font-family:'JetBrains Mono';font-size:10px;color:var(--text-secondary);white-space:pre-wrap;overflow:hidden;max-height:120px;overflow-y:auto"><span class="debug-hint">ARGS</span>\n${this.escapeHtml(argsJson)}\n<span class="debug-hint">RESULT</span>\n${this.escapeHtml(resultJson)}</div>`;
        }
        else if (item.details) {
            detailBlock = `<div id="${expandId}" class="timeline-detail" style="display:none;grid-column:1/-1;background:rgba(0,0,0,0.25);border-radius:6px;padding:8px;margin-top:4px;font-family:'JetBrains Mono';font-size:10px;color:var(--text-secondary);white-space:pre-wrap">${this.escapeHtml(String(item.details).slice(0, 500))}</div>`;
        }
        const labelEsc = this.escapeHtml(String(label ?? ''));
        const statusLabelEsc = this.escapeHtml(String(statusLabel ?? ''));
        const argsStrEsc = this.escapeHtml(String(argsStr ?? ''));
        entry.innerHTML = `
            <div class="ipc-cmd ${isIPC ? 'rpc' : 'action'}" style="overflow:hidden;">
                ${icon}
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" data-tooltip="${labelEsc}">${labelEsc}</span>
            </div>
            <div class="ipc-status ${statusCls}" data-tooltip="${statusLabelEsc}" style="overflow:hidden;text-overflow:ellipsis;">${statusLabelEsc}</div>
            <div class="ipc-time" style="display:flex;align-items:center;gap:4px;">
                ${argsStr ? `<span style="font-size:9px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;flex:1;white-space:nowrap;" data-tooltip="${argsStrEsc}">${argsStrEsc}</span>` : ''}
                <span>${timeLabel}</span>
                ${detailBlock || argsStr ? `<span class="timeline-expand-btn" data-target="${expandId}" data-tooltip="Détails" style="cursor:pointer;opacity:0.5;padding:0 2px;flex-shrink:0">▾</span>` : ''}
            </div>
            ${detailBlock}
        `;
        // Toggle expand on click
        entry.querySelector(`.timeline-expand-btn[data-target="${expandId}"]`)?.addEventListener('click', (e) => {
            e.stopPropagation();
            const detail = document.getElementById(expandId);
            if (!detail)
                return;
            const isHidden = detail.style.display === 'none';
            detail.style.display = isHidden ? 'block' : 'none';
            e.target.textContent = isHidden ? '▴' : '▾';
        });
    }
    clearSelection() {
        this.selectedEl = null;
        this._get('inspect-header').style.display = 'none';
        this._get('inspect-content').innerHTML = '<div class="debug-label">Select an element to inspect...</div>';
        if (this.highlightEl)
            this.highlightEl.style.display = 'none';
        if (this.tooltipEl)
            this.tooltipEl.style.display = 'none';
    }
    selectElement(target) {
        if (!target)
            return;
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
            <div style="background:var(--bmm-s03); padding:12px; border-radius:8px; margin-bottom:16px; border:1px solid var(--bmm-s05)">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px">
                    <div>
                        <div style="font-weight:700; color:var(--debug-accent); font-size:14px; font-family:'JetBrains Mono'">&lt;${target.tagName.toLowerCase()}&gt;</div>
                        <div class="debug-hint">${target.id ? '#' + target.id : ''} ${Array.from(target.classList).map(c => '.' + c).join(' ')}</div>
                    </div>
                    <div style="display:flex; gap:4px">
                        <button class="debug-btn" id="inspect-copy-node" data-tooltip="Copy HTML" style="padding:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                        <button class="debug-btn" id="inspect-send-playground" data-tooltip="Send to Playground" style="padding:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l2.233 2.233L21 2z"/></svg></button>
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
                                   style="background:rgba(0,0,0,0.2); border:1px solid var(--border); border-radius:4px; color:var(--debug-text-primary); font-size:10px; padding:4px 8px; font-family:'JetBrains Mono'; outline:none">
                            ${isColorOrBackground ? `<input type="color" class="style-color-helper" data-prop="${prop}" data-helper-prop="${helperProp}" style="width:16px; height:20px; padding:0; border:none; background:none; cursor:pointer" value="${colorValue.startsWith('rgb') ? this.rgbToHex(colorValue) : colorValue}">` : ''}
                        </div>
                    `;
        }).join('')}

                <div style="margin-top:12px; border-top:1px solid var(--bmm-s05); padding-top:12px">
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
        if (!rgb || !rgb.startsWith('rgb'))
            return rgb;
        const [r, g, b] = rgb.match(/\d+/g).map(Number);
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }
    /** A value the way a state inspector should show it: what it IS, not all of it.
     *
     *  This used to be `JSON.stringify(value)`, which meant `allMods`, `displayedMods` and
     *  `conflictCache` — the entire mod library, twice, plus every conflict list — were
     *  serialised in full and then truncated to one ellipsised line. Every second, because
     *  the state pane is on a 1s timer. On a real library that is megabytes of string built
     *  and thrown away per tick, which is the DevTools "lag on open".
     *
     *  A summary is also simply better: `Array(482)` answers the question a state inspector is
     *  for, and the first forty characters of a serialised mod list never did.
     */
    _describe(value) {
        if (value === null)
            return 'null';
        if (value === undefined)
            return 'undefined';
        if (Array.isArray(value))
            return `Array(${value.length})`;
        if (value instanceof Set)
            return `Set(${value.size})`;
        if (value instanceof Map)
            return `Map(${value.size})`;
        if (typeof value === 'object') {
            const keys = Object.keys(value);
            // Small plain objects are worth showing whole — they are usually the settings
            // somebody opened this pane to read.
            if (keys.length <= 4) {
                const body = JSON.stringify(value);
                if (body.length <= 120)
                    return body;
            }
            return `{${keys.length} key${keys.length === 1 ? '' : 's'}}`;
        }
        const str = String(value);
        return str.length > 120 ? `${str.slice(0, 119)}…` : str;
    }
    updateStateView() {
        const pane = this._get('pane-state');
        const state = appState.state;
        // Nothing changed → nothing to rebuild. The pane repaints on a 1s timer whether or
        // not the state moved, and rebuilding identical markup still costs a full parse, a
        // layout and a paint. The signature is built from the SUMMARIES, which is cheap
        // precisely because they are summaries.
        const rows = Object.entries(state).map(([k, v]) => [k, this._describe(v)]);
        const signature = rows.map(([k, v]) => `${k}=${v}`).join('|');
        if (signature === this._stateSignature)
            return;
        this._stateSignature = signature;
        let html = '<div style="padding:16px; font-family:inherit">';
        for (const [key, shown] of rows) {
            html += `
                <div class="state-row" style="margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; padding:4px 8px; border-radius:4px; transition:background 0.2s" data-key="${key}">
                    <span style="color:var(--text-muted)">${this.escapeHtml(key)}:</span>
                    <span style="color:var(--debug-accent); font-weight:600; text-align:right; max-width:60%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${this.escapeHtml(shown)}</span>
                </div>
            `;
        }
        html += '</div>';
        pane.innerHTML = html;
    }
    clearUI() {
        this._get('pane-console').innerHTML = '';
        this._get('pane-network').innerHTML = '';
        this.updateStateView();
    }
    escapeHtml(str) {
        if (!str)
            return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    // --- ADVANCED A11Y & DEBUG TOOLS ---
    toggleA11yWarnings(enabled) {
        this.a11yWarnings = enabled;
        if (enabled) {
            this.auditA11y();
            this.a11yInterval = setInterval(() => this.auditA11y(), 2000);
            console.info('[BMM-Debug] Live A11y Warnings enabled.');
        }
        else {
            if (this.a11yInterval)
                clearInterval(this.a11yInterval);
            document.querySelectorAll('.bmm-a11y-error-outline').forEach(el => {
                el.classList.remove('bmm-a11y-error-outline');
                el.removeAttribute('title');
            });
        }
    }
    auditA11y() {
        if (!this.a11yWarnings)
            return;
        // 1. Missing ALT on images
        document.querySelectorAll('img').forEach(img => {
            if (!img.hasAttribute('alt') || img.alt.trim() === '') {
                img.classList.add('bmm-a11y-error-outline');
                img.title = "A11y Warning: Image missing alt attribute";
            }
            else {
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
            }
            else {
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
                }
                else {
                    input.classList.remove('bmm-a11y-error-outline');
                }
            }
            else if (!input.hasAttribute('aria-label') && !input.hasAttribute('placeholder')) {
                input.classList.add('bmm-a11y-error-outline');
                input.title = "A11y Warning: Form field has no associated label or aria-label";
            }
            else {
                input.classList.remove('bmm-a11y-error-outline');
            }
        });
    }
    toggleA11yReader(enabled) {
        this.a11yReader = enabled;
        if (enabled) {
            this._a11yMouseOver = (e) => {
                const target = e.target;
                if (target.closest('#bmm-debug-overlay'))
                    return;
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
                if (overlay)
                    overlay.style.display = 'none';
            };
            document.addEventListener('mouseover', this._a11yMouseOver);
            document.addEventListener('mouseout', this._a11yMouseOut);
            console.info('[BMM-Debug] A11y Reader Simulation enabled.');
        }
        else {
            document.removeEventListener('mouseover', this._a11yMouseOver);
            document.removeEventListener('mouseout', this._a11yMouseOut);
            const overlay = document.getElementById('bmm-a11y-reader-overlay');
            if (overlay)
                overlay.remove();
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
        }
        else {
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
        }
        else {
            if (this.hardcodedInterval)
                clearInterval(this.hardcodedInterval);
            document.querySelectorAll('.bmm-hardcoded-error').forEach(el => {
                el.classList.remove('bmm-hardcoded-error');
                el.removeAttribute('title');
            });
        }
    }
    auditHardcoded() {
        if (!this.hardcodedDetector)
            return;
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                // Skip if inside debug overlay
                if (node.parentElement?.closest('#bmm-debug-overlay'))
                    return NodeFilter.FILTER_REJECT;
                // Skip script/style
                if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(node.parentElement?.tagName))
                    return NodeFilter.FILTER_REJECT;
                // Skip icons, symbols, or very short strings (usually UI decor)
                if (!node.textContent.trim())
                    return NodeFilter.FILTER_REJECT;
                // Skip if already has i18n
                if (node.parentElement?.closest('[data-i18n], [data-i18n-placeholder], [data-i18n-title], [data-i18n-tooltip]'))
                    return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        const nodes = [];
        let curr;
        while (curr = walk.nextNode())
            nodes.push(curr);
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
                    // Clamp a restored position back into view (window may have
                    // shrunk, or it was saved while partly off-screen).
                    const w = data.width || this.container.offsetWidth || 320;
                    const KEEP = 160, HDR = 44;
                    const left = Math.max(KEEP - w, Math.min(data.left, window.innerWidth - KEEP));
                    const top = Math.max(0, Math.min(data.top, window.innerHeight - HDR));
                    this.container.style.top = top + 'px';
                    this.container.style.left = left + 'px';
                }
                if (data.width)
                    this.container.style.width = data.width + 'px';
                if (data.height)
                    this.container.style.height = data.height + 'px';
                if (data.activeTab)
                    this.activeTab = data.activeTab;
            }
        }
        catch (e) { }
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
    // ─────────────────────────────────────────────────────────────
    // The Sources tab + companion methods (loadSources, _fileTypeIcon,
    // renderFileTree, openSourceFile, highlightCode) were removed in
    // 2026-05.  They scanned the project tree on every devtools open
    // and rendered massive file contents into the DOM — the main
    // cause of devtools lag.  Use an external editor instead.
    // ─────────────────────────────────────────────────────────────
    async updateMetrics(metrics) {
        try {
            const fps = this._get('dbg-fps');
            const mem = this._get('dbg-mem');
            const pid = this._get('dbg-pid');
            const uptime = this._get('dbg-uptime');
            const stats = await invoke('get_debug_stats');
            if (fps)
                fps.textContent = Math.round(metrics?.fps || 0);
            if (mem)
                mem.textContent = (stats.memory_mb || 0) + 'MB';
            if (pid)
                pid.textContent = stats.pid || '-';
            if (uptime) {
                const s = stats.uptime_secs || 0;
                const hrs = Math.floor(s / 3600);
                const mins = Math.floor((s % 3600) / 60);
                const secs = s % 60;
                uptime.textContent = `${hrs > 0 ? hrs + 'h ' : ''}${mins > 0 ? mins + 'm ' : ''}${secs}s`;
            }
        }
        catch (e) {
            console.error('[BMM-Debug] Metrics Update Failed:', e);
        }
    }
    createContextMenu() {
        const menu = document.createElement('div');
        menu.id = 'debug-context-menu';
        menu.style = 'position:fixed; display:none; background:rgba(30,30,30,0.95); backdrop-filter:blur(10px); border:1px solid var(--bmm-s10); border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.5); z-index:200000; padding:4px; min-width:140px; transform: scale(0.9); opacity: 0; transition: transform 0.1s, opacity 0.1s';
        document.body.appendChild(menu);
        this.contextMenu = menu;
        document.addEventListener('click', () => this.hideContextMenu());
    }
    showContextMenu(x, y, items) {
        this.contextMenu.innerHTML = items.map(item => `
            <div class="ctx-item">
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
        if (!this.contextMenu)
            return;
        this.contextMenu.style.transform = 'scale(0.9)';
        this.contextMenu.style.opacity = '0';
        setTimeout(() => this.contextMenu.style.display = 'none', 100);
    }
    copyToClipboard(text) {
        if (text.startsWith('data:')) {
            // It's a base64 image, skip copy or copy base64
            navigator.clipboard.writeText(text);
            this.showAlert('Copied', 'Base64 image data copied to clipboard.');
        }
        else {
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
        }
        else {
            blob = new Blob([content], { type: 'text/plain' });
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
    }
    buildDomTree() {
        const tree = this._get('html-dom-tree');
        if (!tree)
            return;
        tree.innerHTML = '';
        const root = document.documentElement;
        tree.appendChild(this._renderDomNode(root));
    }
    _renderDomNode(node) {
        if (node.nodeType !== Node.ELEMENT_NODE)
            return null;
        if (node.id === 'bmm-debug-overlay' || node.closest('#bmm-debug-overlay'))
            return null;
        const container = document.createElement('div');
        container.className = 'dom-node';
        container.style.marginLeft = '12px';
        container.style.padding = '2px 0';
        const header = document.createElement('div');
        header.style.cursor = 'pointer';
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.gap = '6px';
        header.className = 'dom-tree-node'; // Use style from debug.css
        const hasChildren = node.children.length > 0;
        const toggle = document.createElement('span');
        toggle.className = 'dom-toggle';
        toggle.style.fontSize = '8px';
        toggle.style.width = '10px';
        toggle.style.color = 'var(--text-muted)';
        toggle.textContent = hasChildren ? '▶' : ' ';
        header.appendChild(toggle);
        const tag = document.createElement('span');
        tag.style.color = 'var(--debug-accent)';
        tag.style.fontWeight = 'bold';
        tag.textContent = `<${node.tagName.toLowerCase()}${node.id ? '#' + node.id : ''}>`;
        header.appendChild(tag);
        container.appendChild(header);
        if (hasChildren) {
            const children = document.createElement('div');
            children.className = 'dom-children';
            children.style.display = 'none';
            children.style.borderLeft = '1px solid var(--bmm-s05)';
            children.style.marginLeft = '4px';
            header.onclick = (e) => {
                e.stopPropagation();
                const isHidden = children.style.display === 'none';
                children.style.display = isHidden ? 'block' : 'none';
                toggle.textContent = isHidden ? '▼' : '▶';
                // Lazy load children if needed
                if (isHidden && children.innerHTML === '') {
                    for (const child of node.children) {
                        const childNode = this._renderDomNode(child);
                        if (childNode)
                            children.appendChild(childNode);
                    }
                }
            };
            container.appendChild(children);
        }
        tag.onclick = (e) => {
            e.stopPropagation();
            this.selectElement(node);
        };
        return container;
    }
    async refreshRustLogs() {
        const container = this._get('rust-logs-container');
        if (!container)
            return;
        container.innerHTML = `<div class="debug-empty">Chargement...</div>`;
        try {
            const { invoke } = window.__TAURI__.core;
            const logs = await invoke('get_rust_logs');
            container.innerHTML = logs.map(line => {
                // simple parsing for highlighting strings like "[HH:MM:SS.mmm] [LEVEL] message"
                let color = 'var(--text-primary)';
                const lowerLine = line.toLowerCase();
                if (lowerLine.includes('error') || lowerLine.includes('panic'))
                    color = 'var(--debug-error)';
                else if (lowerLine.includes('warn'))
                    color = 'var(--debug-warn)';
                else if (lowerLine.includes('info'))
                    color = 'var(--debug-accent)';
                else if (lowerLine.includes('success') || lowerLine.includes('done'))
                    color = 'var(--debug-success)';
                return `<div class="debug-rustline" style="color:${color}">${this.escapeHtml(line)}</div>`;
            }).join('') || '<div class="debug-empty">None log Rust trouvé.</div>';
            container.scrollTop = container.scrollHeight;
        }
        catch (e) {
            container.innerHTML = `<div style="padding:10px; color:var(--debug-error)">Error: ${e}</div>`;
        }
    }
    _getLogColor(level) {
        if (!level)
            return 'var(--text-primary)';
        const l = level.toUpperCase();
        if (l.includes('ERROR'))
            return 'var(--debug-error)';
        if (l.includes('WARN'))
            return 'var(--debug-warn)';
        if (l.includes('INFO'))
            return 'var(--debug-accent)';
        return 'var(--debug-success)';
    }
    /** The hover highlight the removed listeners used to do. Two listeners per row, re-added
     *  on every repaint, for something one CSS rule does — and CSS cannot leak them. */
    _ensureStateStyles() {
        if (document.getElementById('bmm-debug-state-style'))
            return;
        const st = document.createElement('style');
        st.id = 'bmm-debug-state-style';
        st.textContent = '#bmm-debug-overlay .state-row:hover { background: var(--bmm-s05); }';
        document.head.appendChild(st);
    }
    startUpdateLoop() {
        // Refresh state view periodically when open if we aren't using deep Proxies for everything
        if (this._updateInterval)
            clearInterval(this._updateInterval);
        this._updateInterval = setInterval(() => {
            if (this.isOpen && this.activeTab === 'state')
                this.updateStateView();
        }, 1000);
    }
    /** Fully unload the DevTools: remove all DOM + stop all timers/observers so
     *  it returns to ~0 resource usage when closed. Rebuilt on next open. */
    destroy() {
        this.isOpen = false;
        try {
            this.toggleInspector(false);
        }
        catch { /* ignore */ }
        // Free the heavy native WebView2 DevTools process when we close.
        try {
            invoke('close_devtools');
        }
        catch { /* ignore */ }
        if (this._updateInterval) {
            clearInterval(this._updateInterval);
            this._updateInterval = null;
        }
        if (this.a11yInterval) {
            clearInterval(this.a11yInterval);
            this.a11yInterval = null;
        }
        // Was missing from this list: close DevTools with the hardcoded-text audit on and
        // its 3s interval kept scanning a dead UI forever — one of the "ça mange" leaks.
        if (this.hardcodedInterval) {
            clearInterval(this.hardcodedInterval);
            this.hardcodedInterval = null;
        }
        if (this.mutationObserver) {
            try {
                this.mutationObserver.disconnect();
            }
            catch { }
            this.mutationObserver = null;
        }
        // The hub keeps subscribers in a Set that nothing else prunes, so a subscriber left
        // behind here is permanent: every later log/ipc/action emit would fan out into this
        // dead UI forever, and the closure would pin its DOM. This is the actual leak.
        if (this._hubSub) {
            debugHub.unsubscribe(this._hubSub);
            this._hubSub = null;
        }
        for (const el of [this.container, this.modalOverlay, this.crashOverlay, this.highlightEl, this.tooltipEl]) {
            try {
                el?.remove();
            }
            catch { /* ignore */ }
        }
        this.container = null;
        this.modalOverlay = null;
        this.crashOverlay = null;
        this.highlightEl = null;
        this.tooltipEl = null;
    }
}
export const debugUI = new DebugUI();
//# sourceMappingURL=debug-ui.js.map