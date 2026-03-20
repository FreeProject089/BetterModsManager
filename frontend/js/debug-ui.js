import { debugHub } from './debug.js';
import { appState } from './state.js';
import { invoke } from './api.js';

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
    }

    init() {
        this.createContainer();
        this.createContextMenu();
        this.attachListeners();
        this.loadSources();
        this.startUpdateLoop();
        console.info('[BMM-Debug] UI Initialized. Toggle with Ctrl+Alt+D');
    }

    createContainer() {
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
                <div class="debug-tab active" data-tab="console">Console</div>
                <div class="debug-tab" data-tab="timeline">Timeline</div>
                <div class="debug-tab" data-tab="inspect-view">Inspect</div>
                <div class="debug-tab" data-tab="sources">Sources</div>
                <div class="debug-tab" data-tab="state">State</div>
                <div class="debug-tab" data-tab="playground">Playground</div>
            </div>
            <div class="debug-content">
                <div class="debug-pane active" id="pane-console">
                    <div class="console-tools" style="padding:8px; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; gap:8px">
                    <input type="text" id="console-search" placeholder="Search logs..." style="flex:1; background:rgba(0,0,0,0.2); border:1px solid var(--debug-border); border-radius:4px; color:white; font-size:10px; padding:4px 8px; outline:none">
                        <button class="debug-btn" id="console-clear-manual" title="Clear Console">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
                        </button>
                    </div>
                    <div id="console-logs" style="flex:1; overflow-y:auto"></div>
                </div>
                <div class="debug-pane" id="pane-timeline">
                    <div class="timeline-filters" style="padding:8px; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; gap:6px; align-items:center">
                        <button class="filter-btn active" data-filter="all">ALL</button>
                        <button class="filter-btn" data-filter="rpc">RPC</button>
                        <button class="filter-btn" data-filter="action">ACT</button>
                        <button class="filter-btn" data-filter="error">ERR</button>
                        <div style="flex:1"></div>
                        <button class="debug-btn" id="timeline-clear-manual" title="Clear Timeline">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/></svg>
                        </button>
                    </div>
                    <div id="timeline-list" style="flex:1; overflow-y:auto"></div>
                </div>
                <div class="debug-pane" id="pane-inspect-view">
                    <div id="inspect-header" style="padding:8px 16px; border-bottom:1px solid var(--debug-border); display:none; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.02)">
                        <span style="font-size:10px; font-weight:700; color:var(--text-muted)">INSPECTOR</span>
                        <button class="tb-btn" id="inspect-btn-clear" style="font-size:10px; padding:2px 8px; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.1); border-radius:4px; color:white; cursor:pointer">CLEAR SELECTION</button>
                    </div>
                    <div id="inspect-content" style="padding:16px; border-bottom:1px solid var(--debug-border); overflow-y:auto; height:100%">
                        <div style="color:var(--text-muted); font-size:11px">Select an element to inspect...</div>
                    </div>
                </div>
                <div class="debug-pane" id="pane-sources">
                    <div class="sources-layout">
                        <div class="sources-tree-container" style="display:flex; flex-direction:column; border-right:1px solid var(--debug-border); background:rgba(0,0,0,0.1)">
                            <div style="padding:8px; border-bottom:1px solid var(--debug-border); display:flex; justify-content:space-between; align-items:center">
                                <span style="font-size:10px; font-weight:700; color:var(--text-muted)">PROJECT</span>
                                <button class="debug-btn" id="sources-refresh" title="Refresh Files">
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                                </button>
                            </div>
                            <div class="sources-tree" style="flex:1; overflow-y:auto; padding:8px 0"></div>
                        </div>
                        <div class="sources-editor">
                            <div id="sources-code-container" style="height:100%; position:relative">
                                <pre id="sources-code" style="margin:0; padding:16px; font-family:'JetBrains Mono'; font-size:11px; color:var(--text-muted)">Select a file to view source...</pre>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="debug-pane" id="pane-state"></div>
                <div class="debug-pane" id="pane-playground">
                    <div style="padding:16px">
                        <div style="margin-bottom:12px; font-size:10px; color:var(--text-muted); display:flex; justify-content:space-between">
                            <span>HOT-PATCH: CSS / JS</span>
                            <div style="display:flex; gap:8px">
                                <button id="playground-reset" class="tb-btn" style="background:none; border:none; color:var(--debug-accent); font-size:10px; padding:0; cursor:pointer">RESET</button>
                                <button id="playground-export" class="tb-btn" style="background:none; border:none; color:var(--debug-success); font-size:10px; padding:0; cursor:pointer">EXPORT PATCH</button>
                            </div>
                        </div>
                        <textarea id="playground-code" style="width:100%; height:120px; background:rgba(0,0,0,0.3); border:1px solid var(--debug-border); border-radius:8px; color:var(--debug-accent); font-family:inherit; padding:12px; font-size:11px; outline:none" placeholder="/* Enter CSS or JS here... */"></textarea>
                        <div style="margin-top:12px; display:flex; gap:8px">
                            <button class="tb-btn" style="background:var(--debug-accent); color:white; padding:6px 16px; border-radius:6px; font-size:11px" id="playground-apply-css">Apply CSS</button>
                            <button class="tb-btn" style="background:var(--debug-success); color:white; padding:6px 16px; border-radius:6px; font-size:11px" id="playground-run-js">Run JS</button>
                        </div>
                        <div style="margin-top:20px; font-size:10px; color:var(--text-muted)">ACTIVE PATCHES</div>
                        <div id="patch-tree" style="margin-top:8px; display:flex; flex-direction:column; gap:6px"></div>
                    </div>
                </div>
            </div>
            <div class="debug-footer">
                <div class="metric-item">FPS: <b id="dbg-fps">0</b></div>
                <div class="metric-item">Heap: <b id="dbg-mem">0MB</b></div>
                <div class="metric-item">PID: <b id="dbg-pid">-</b></div>
                <div class="metric-item">Uptime: <b id="dbg-uptime">0s</b></div>
            </div>
            <div class="debug-resizer"></div>
        `;
        document.body.appendChild(div);
        this.container = div;

        // Modal components
        const modalOverlay = document.createElement('div');
        modalOverlay.id = 'debug-modal-overlay';
        modalOverlay.style = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); backdrop-filter:blur(4px); display:none; align-items:center; justify-content:center; z-index:20002';
        modalOverlay.innerHTML = `
            <div id="debug-modal-content" style="background:var(--bg-panel); border:1px solid var(--border); border-radius:12px; padding:24px; min-width:320px; box-shadow:0 20px 40px rgba(0,0,0,0.4); transform:translateY(20px); transition:transform 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28)">
                <h3 id="debug-modal-title" style="margin:0 0 12px 0; font-size:16px; color:var(--text-primary)">Confirm Action</h3>
                <p id="debug-modal-text" style="margin:0 0 24px 0; font-size:13px; color:var(--text-secondary); line-height:1.5">Are you sure?</p>
                <div id="debug-modal-input-container" style="display:none; margin-bottom:24px">
                    <input type="text" id="debug-modal-input" style="width:100%; padding:10px; background:rgba(0,0,0,0.3); border:1px solid var(--border); border-radius:6px; color:white; outline:none">
                </div>
                <div style="display:flex; justify-content:flex-end; gap:12px">
                    <button id="debug-modal-cancel" class="tb-btn" style="padding:8px 16px">Cancel</button>
                    <button id="debug-modal-confirm" class="tb-btn" style="padding:8px 24px; background:var(--debug-accent); color:white">OK</button>
                </div>
            </div>
        `;
        document.body.appendChild(modalOverlay);

        // Load persisted position/size
        this.loadPosition();

        // Create Crash Overlay
        const crashDiv = document.createElement('div');
        crashDiv.className = 'debug-crash-overlay';
        crashDiv.innerHTML = `
            <img src="assets/Tasky.png" style="width:100px; height:auto; filter: grayscale(1) contrast(2) brightness(0.5) sepia(1) hue-rotate(-50deg); margin-bottom:24px; opacity:0.6;">
            <div class="crash-title">System Halt</div>
            <div class="crash-subtitle">CRITICAL_LEVEL_EXCEPTION // KERNEL_PANIC_PREVENTED</div>
            <div class="crash-details" id="crash-details">An unhandled exception has occurred. A debug dump has been saved to your local storage.</div>
            <div style="display:flex; gap:16px; flex-wrap:wrap; justify-content:center">
                <button class="tb-btn" style="background:var(--debug-error); color:white; padding:12px 32px; border-radius:12px; font-weight:800; border:none; cursor:pointer; box-shadow:0 8px 20px rgba(239, 68, 68, 0.3)" onclick="location.reload()">RELOAD APPLICATION</button>
                <button class="tb-btn" style="background:rgba(255,255,255,0.05); color:white; padding:12px 24px; border-radius:12px; border:1px solid rgba(255,255,255,0.1); cursor:pointer" id="crash-copy-dump">COPY ERROR DUMP</button>
                <button class="tb-btn" style="background:none; color:var(--text-muted); padding:12px 24px; font-size:11px; text-decoration:underline; border:none; cursor:pointer" id="crash-dismiss">Dismiss & Continue (Unstable)</button>
            </div>
            <div style="margin-top:48px; font-size:10px; opacity:0.3; font-family:'JetBrains Mono'">BMM_OS_DEBUG_v0.9.7 // ${new Date().toISOString()}</div>
        `;
        document.body.appendChild(crashDiv);
        this.crashOverlay = crashDiv;

        document.getElementById('crash-copy-dump').onclick = () => {
            const dump = localStorage.getItem('bmm_last_crash_dump');
            navigator.clipboard.writeText(dump);
            const btn = document.getElementById('crash-copy-dump');
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

        document.getElementById('crash-dismiss').onclick = () => {
            if (confirm("DANGER: Continuing after a System Halt may cause data corruption or unpredictable behavior. Proceed?")) {
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
    }

    showConfirm(title, text, onConfirm) {
        const overlay = document.getElementById('debug-modal-overlay');
        const modal = document.getElementById('debug-modal-content');
        const inputContainer = document.getElementById('debug-modal-input-container');
        
        document.getElementById('debug-modal-title').textContent = title;
        document.getElementById('debug-modal-text').textContent = text;
        inputContainer.style.display = 'none';
        overlay.style.display = 'flex';
        setTimeout(() => modal.style.transform = 'translateY(0)', 10);

        const close = () => {
            modal.style.transform = 'translateY(20px)';
            setTimeout(() => overlay.style.display = 'none', 300);
        };

        document.getElementById('debug-modal-cancel').onclick = close;
        document.getElementById('debug-modal-confirm').onclick = () => {
            onConfirm();
            close();
        };
    }

    showPrompt(title, text, defaultValue, onConfirm) {
        const overlay = document.getElementById('debug-modal-overlay');
        const modal = document.getElementById('debug-modal-content');
        const inputContainer = document.getElementById('debug-modal-input-container');
        const input = document.getElementById('debug-modal-input');
        
        document.getElementById('debug-modal-title').textContent = title;
        document.getElementById('debug-modal-text').textContent = text;
        inputContainer.style.display = 'block';
        input.value = defaultValue || '';
        overlay.style.display = 'flex';
        input.focus();
        setTimeout(() => modal.style.transform = 'translateY(0)', 10);

        const close = () => {
            modal.style.transform = 'translateY(20px)';
            setTimeout(() => overlay.style.display = 'none', 300);
        };

        document.getElementById('debug-modal-cancel').onclick = close;
        document.getElementById('debug-modal-confirm').onclick = () => {
            onConfirm(input.value);
            close();
        };
    }

    showAlert(title, text) {
        const overlay = document.getElementById('debug-modal-overlay');
        const modal = document.getElementById('debug-modal-content');
        const inputContainer = document.getElementById('debug-modal-input-container');
        const cancelBtn = document.getElementById('debug-modal-cancel');
        
        document.getElementById('debug-modal-title').textContent = title;
        document.getElementById('debug-modal-text').textContent = text;
        inputContainer.style.display = 'none';
        cancelBtn.style.display = 'none'; // Only OK for alert
        overlay.style.display = 'flex';
        setTimeout(() => modal.style.transform = 'translateY(0)', 10);

        const close = () => {
            modal.style.transform = 'translateY(20px)';
            setTimeout(() => {
                overlay.style.display = 'none';
                cancelBtn.style.display = 'block'; // Restore for next calls
            }, 300);
        };

        document.getElementById('debug-modal-confirm').onclick = close;
    }

    attachListeners() {
        // Keyboard toggle
        document.addEventListener('keydown', e => {
            if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'd') {
                this.toggle();
            }
        });

        // Tab switching
        this.container.querySelectorAll('.debug-tab').forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
        });

        // Controls
        document.getElementById('debug-btn-close').addEventListener('click', () => this.toggle(false));
        document.getElementById('dbg-clear-all').addEventListener('click', () => {
            this.showConfirm('Clear Everything', 'This will wipe all console logs and the activity timeline. Proceed?', () => {
                debugHub.recordLog('info', ['[System] History cleared by user']);
                debugHub.logs = [];
                debugHub.ipcCalls = [];
                debugHub.actions = [];
                document.getElementById('console-logs').innerHTML = '';
                document.getElementById('timeline-list').innerHTML = '';
            });
        });
        document.getElementById('debug-btn-inspect').addEventListener('click', () => this.toggleInspector());
        document.getElementById('debug-btn-export').addEventListener('click', () => this.exportSession());

        document.getElementById('console-clear-manual').addEventListener('click', () => {
             document.getElementById('console-logs').innerHTML = '';
             debugHub.logs = [];
        });

        document.getElementById('timeline-clear-manual').addEventListener('click', () => {
             document.getElementById('timeline-list').innerHTML = '';
             debugHub.ipcCalls = [];
             debugHub.actions = [];
        });

        document.getElementById('sources-refresh').addEventListener('click', () => this.loadSources());

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
        document.getElementById('console-search').addEventListener('input', e => {
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

        document.getElementById('inspect-btn-clear').addEventListener('click', () => this.clearSelection());

        document.getElementById('playground-apply-css').addEventListener('click', () => {
            try {
                const code = document.getElementById('playground-code').value;
                debugHub.applyPatch('CSS', code);
            } catch (err) {
                this.showAlert('CSS Error', err.message || 'Invalid CSS syntax.');
            }
        });

        document.getElementById('playground-run-js').addEventListener('click', () => {
            try {
                const code = document.getElementById('playground-code').value;
                debugHub.applyPatch('JS', code);
            } catch (err) {
                this.showAlert('JS Error', err.message || 'Execution failed.');
            }
        });

        document.getElementById('playground-reset').addEventListener('click', () => {
            document.getElementById('playground-code').value = '';
            // Remove all CSS patches
            debugHub.patches.filter(p => p.type === 'CSS').forEach(p => debugHub.removePatch(p.id));
        });

        document.getElementById('playground-export').addEventListener('click', () => {
            const content = debugHub.patches.map(p => `/* Patch ${p.id} (${p.type}) */\n${p.content}`).join('\n\n');
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `bmm-patches-${Date.now()}.txt`;
            a.click();
        });

        // Patch tree interaction
        document.getElementById('patch-tree').addEventListener('click', e => {
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
                document.getElementById('console-logs').innerHTML = '';
                document.getElementById('timeline-list').innerHTML = '';
                debugHub.logs = [];
                debugHub.ipcCalls = [];
                debugHub.actions = [];
            }
            if (event.type === 'state') this.updateStateView();
            if (event.type === 'metrics') this.updateMetrics(event.data);
            if (event.type === 'patches') this.updatePatchTree();
            if (event.type === 'crash') {
                this.crashOverlay.classList.add('active');
                document.getElementById('crash-details').textContent = event.data.msg || 'Unknown internal error';
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
            this.selectElement(target);
            
            console.debug('[Inspector] Selected:', target);

            // Auto-fill playground with current styles for quick editing
            const computed = window.getComputedStyle(target);
            const styleSnippet = `/* Edit styles for ${target.tagName.toLowerCase()} */\n` + 
                `selector {\n  background: ${computed.backgroundColor};\n  color: ${computed.color};\n  border: ${computed.border};\n}`;
            document.getElementById('playground-code').value = styleSnippet;
        }, true);
    }

    toggle(force) {
        this.isOpen = force !== undefined ? force : !this.isOpen;
        this.container.classList.toggle('open', this.isOpen);
        if (this.isOpen) {
            this.switchTab(this.activeTab);
            this.updateStateView();
        }
    }

    toggleInspector(force) {
        this.isInspecting = force !== undefined ? force : !this.isInspecting;
        const btn = document.getElementById('debug-btn-inspect');
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
        const logs = document.getElementById('console-logs');
        if (!logs) return;

        const entry = document.createElement('div');
        entry.className = `log-entry ${item.level}`;
        
        const timestamp = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        entry.innerHTML = `
            <span style="color:var(--text-muted); min-width:60px; font-size:9px">[${timestamp}]</span>
            <span class="log-msg">${this.escapeHtml(item.message)}</span>
        `;
        
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
        this.tooltipEl.textContent = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className ? '.' + el.className.split(' ').join('.') : ''}`;
    }

    updatePatchTree() {
        const list = document.getElementById('patch-tree');
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
        const pane = document.getElementById('timeline-list');
        let entry = document.getElementById(`timeline-${item.id}`);
        
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
        document.getElementById('inspect-header').style.display = 'none';
        document.getElementById('inspect-content').innerHTML = '<div style="color:var(--text-muted); font-size:11px">Select an element to inspect...</div>';
        if (this.highlightEl) this.highlightEl.style.display = 'none';
        if (this.tooltipEl) this.tooltipEl.style.display = 'none';
    }

    selectElement(target) {
        if (!target) return;
        this.selectedEl = target;
        this.toggleInspector(false);
        this.switchTab('inspect-view');

        document.getElementById('inspect-header').style.display = 'flex';
        const pane = document.getElementById('inspect-content');
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
                        <button class="tb-btn" id="inspect-copy-node" title="Copy HTML" style="padding:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                        <button class="tb-btn" id="inspect-send-playground" title="Send to Playground" style="padding:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l2.233 2.233L21 2z"/></svg></button>
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
                    <button class="tb-btn" id="inspect-add-prop" style="width:100%; border-style:dashed; opacity:0.6; font-size:10px">+ ADD CUSTOM PROPERTY</button>
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

        document.getElementById('inspect-add-prop').onclick = () => {
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

        document.getElementById('inspect-copy-node').onclick = () => {
            navigator.clipboard.writeText(target.outerHTML);
            console.info('[Inspector] Copied HTML to clipboard');
        };
        
        document.getElementById('inspect-send-playground').onclick = () => {
            this.switchTab('playground');
            const styleSnippet = `/* Edit styles for ${target.tagName.toLowerCase()} */\n` + 
                `selector {\n  background: ${computed.backgroundColor};\n  color: ${computed.color};\n  border: ${computed.border};\n}`;
            document.getElementById('playground-code').value = styleSnippet;
        };
    }

    rgbToHex(rgb) {
        if (!rgb || !rgb.startsWith('rgb')) return rgb;
        const [r, g, b] = rgb.match(/\d+/g).map(Number);
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    updateStateView() {
        const pane = document.getElementById('pane-state');
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
        document.getElementById('pane-console').innerHTML = '';
        document.getElementById('pane-network').innerHTML = '';
        this.updateStateView();
    }

    escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

        editorArea.innerHTML = '<div style="padding:20px; color:var(--text-muted)">Loading...</div>';

        try {
            const data = await invoke('read_project_file', { path });
            this.currentSource.data = data;
            
            const ext = path.split('.').pop().toLowerCase();
            const isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext);

            if (isImage) {
                editorArea.innerHTML = `
                    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; padding:20px; background:rgba(0,0,0,0.3)">
                        <img src="${data}" style="max-width:90%; max-height:80%; box-shadow:0 10px 30px rgba(0,0,0,0.5); border:1px solid rgba(255,255,255,0.1); border-radius:4px; margin-bottom:12px">
                        <div style="color:var(--text-muted); font-size:10px; font-family:'JetBrains Mono'">${path}<br>Click image to download</div>
                    </div>
                `;
            } else {
                const highlighted = this.highlightCode(data, ext);
                editorArea.innerHTML = `<pre id="sources-code" style="margin:0; padding:16px; font-family:'JetBrains Mono'; font-size:11px; color:var(--text-primary); white-space:pre-wrap; line-height:1.5">${highlighted}</pre>`;
            }
        } catch (e) {
            console.error('[BMM-Debug] Failed to read source file:', e);
            editorArea.innerHTML = `<div style="padding:20px; color:var(--debug-error)">Error: ${e}</div>`;
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
                 .replace(/([^{}\n;]+)\s*\{/g, (m, p1) => pushToken('#d7ba7d', p1) + ' {')
                 .replace(/([\w-]+)\s*:/g, (m, p1) => pushToken('#9cdcfe', p1) + ':')
                 .replace(/:\s*([^;\}]+)/g, (m, p1) => ': ' + pushToken('#ce9178', p1));
        } 
        else if (ext === 'js' || ext === 'ts' || ext === 'rust' || ext === 'rs') {
            const keywords = ext.startsWith('r') 
                ? /\b(fn|let|mut|match|if|else|loop|while|for|return|pub|use|mod|struct|enum|impl|trait|type|where|async|await|dyn|static|crate)\b/g
                : /\b(const|let|var|function|return|if|else|for|while|import|export|from|class|extends|new|async|await|try|catch|finally|this|super|case|switch|break|continue|default|typeof|instanceof)\b/g;

            h = h.replace(/(\/\/.*$)/gm, m => pushToken('#6a9955', m))
                 .replace(/(\/\*[\s\S]*?\*\/)/g, m => pushToken('#6a9955', m))
                 .replace(/('.*?'|".*?"|`[\s\S]*?`)/g, m => pushToken('#ce9178', m))
                 .replace(keywords, m => pushToken('#569cd6', m))
                 .replace(/\b(true|false|null|undefined|None|Some|Ok|Err|Self|self)\b/g, m => pushToken('#569cd6', m))
                 .replace(/\b(\d+)\b/g, m => pushToken('#b5cea8', m));
        }
        else if (ext === 'html' || ext === 'svg' || ext === 'xml') {
            h = h.replace(/(&lt;[\w-]+)/g, m => pushToken('#569cd6', m))
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

        // Final replacement of tokens
        tokens.forEach(t => {
            h = h.replace(t.id, t.html);
        });

        return h;
    }

    async updateMetrics(metrics) {
        try {
            const fps = document.getElementById('dbg-fps');
            const mem = document.getElementById('dbg-mem');
            const pid = document.getElementById('dbg-pid');
            const uptime = document.getElementById('dbg-uptime');

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
}

export const debugUI = new DebugUI();
