// BMM Telemetry — multi-page dashboard (ECharts), live via SSE.
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n);
const flag = cc => (!cc || cc.length !== 2) ? '🌐' : cc.toUpperCase().replace(/./g, c => String.fromCodePoint(127397 + c.charCodeAt(0)));
const AX = '#8a94a6', GRID = '#1d232e';
const TIP = { backgroundColor: '#12161e', borderColor: '#2a323f', textStyle: { color: '#e8edf4', fontSize: 12 } };
const COL = ['#5b8cff', '#34d399', '#fbbf24', '#a78bfa', '#22d3ee', '#f87171', '#8a94a6'];
let S = null, ROUTE = 'overview', BUILT = null, METRIC = 'users', ACT = 'min', mapGeo = false, glLoaded = false, MAPMODE = 'flat';
const TITLES = { overview: 'Overview', events: 'Events', sessions: 'Sessions', pages: 'Pages & performance', map: 'Map', funnels: 'Funnels', retention: 'Retention', goals: 'Goals', users: 'Users & journeys', bmm: 'BMM insights', admin: 'Privacy / admin' };

// ── ECharts pool ──────────────────────────────────────────────────────────────
const charts = {};
function ec(id) { const el = document.getElementById(id); if (!el) return null; if (charts[id] && (!charts[id]._dom || charts[id]._dom !== el || charts[id].isDisposed())) { try { charts[id].dispose(); } catch {} delete charts[id]; } const c = charts[id] || (charts[id] = echarts.init(el)); c._dom = el; return c; }
window.addEventListener('resize', () => Object.values(charts).forEach(c => { try { c.resize(); } catch {} }));
fetch('https://cdn.jsdelivr.net/gh/apache/echarts-website@asf-site/examples/data/asset/geo/world.json').then(r => r.json()).then(g => { echarts.registerMap('world', g); mapGeo = true; if (S && (ROUTE === 'overview' || ROUTE === 'map')) renderMaps(); }).catch(() => {});

// ── chart helpers ────────────────────────────────────────────────────────────
function hbar(id, rows, opt = {}) { const c = ec(id); if (!c) return; rows = rows.slice(0, opt.limit || 14).reverse();
  c.setOption({ grid: { left: 4, right: 38, top: 8, bottom: 8, containLabel: true }, tooltip: { trigger: 'item', ...TIP },
    xAxis: { type: 'value', splitLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX } },
    yAxis: { type: 'category', data: rows.map(r => r.k), axisLine: { lineStyle: { color: GRID } }, axisLabel: { color: '#e8edf4', fontSize: 11 } },
    series: [{ type: 'bar', data: rows.map(r => r.v), barWidth: '62%', cursor: opt.click ? 'pointer' : 'default',
      label: { show: true, position: 'right', color: AX, fontSize: 11, formatter: p => opt.unit === 'ms' ? p.value + 'ms' : fmt(p.value) },
      itemStyle: { color: opt.color || '#5b8cff', borderRadius: [0, 4, 4, 0] } }] }, true);
  c.off('click'); if (opt.click) c.on('click', p => opt.click(rows[rows.length - 1 - p.dataIndex].k)); }
function pie(id, rows) { const c = ec(id); if (!c) return;
  c.setOption({ tooltip: { trigger: 'item', ...TIP }, series: [{ type: 'pie', radius: ['45%', '72%'], label: { color: '#e8edf4', fontSize: 11, formatter: '{b}: {c}' },
    data: rows.map(r => ({ name: r.k, value: r.v })), itemStyle: { borderColor: '#0e1117', borderWidth: 2 }, color: COL }] }, true); }
function lineChart(id, data, color = '#5b8cff') { const c = ec(id); if (!c) return;
  c.setOption({ grid: { left: 42, right: 16, top: 14, bottom: 26 }, tooltip: { trigger: 'axis', ...TIP },
    xAxis: { type: 'category', data: data.map(d => d[0]), axisLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX, hideOverlap: true } },
    yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX } },
    series: [{ type: 'line', smooth: true, symbol: 'circle', symbolSize: 5, data: data.map(d => d[1]), lineStyle: { color, width: 2.4 }, itemStyle: { color },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: color + '55' }, { offset: 1, color: color + '00' }]) } }] }, true); }
function funnelChart(id, rows) { const c = ec(id); if (!c) return; rows = rows.slice(0, 9);
  c.setOption({ tooltip: { trigger: 'item', ...TIP }, series: [{ type: 'funnel', left: 6, right: 6, top: 8, bottom: 8, minSize: '16%', gap: 3, sort: 'descending',
    label: { color: '#e8edf4', fontSize: 11, formatter: '{b} · {c}' }, data: rows.map(r => ({ name: r.path || r.step, value: r.count })),
    itemStyle: { borderColor: '#0e1117', borderWidth: 1 }, color: COL }] }, true);
  if (!rows.length) c.setOption({ graphic: { type: 'text', left: 'center', top: 'center', style: { text: 'No data', fill: '#5e6675' } } }); }

function renderMaps() { if (ROUTE === 'overview') geoFlat('map', S.map); if (ROUTE === 'map') MAPMODE === 'globe' ? geoGlobe('map', S.map) : geoFlat('map', S.map); }
function geoFlat(id, map) { const c = ec(id); if (!c || !mapGeo) return;
  const pts = (arr, color) => (arr || []).map(p => ({ name: `${p.kind}: ${p.count} · ${p.country || ''} (approx)`, value: [p.lon, p.lat, p.count], itemStyle: { color } }));
  c.setOption({ backgroundColor: 'transparent', tooltip: { trigger: 'item', ...TIP, formatter: p => p.name },
    geo: { map: 'world', roam: true, itemStyle: { areaColor: '#0f1a2a', borderColor: '#22324a' }, emphasis: { itemStyle: { areaColor: '#16273d' }, label: { show: false } } },
    series: [{ type: 'effectScatter', coordinateSystem: 'geo', symbolSize: v => 6 + Math.min(16, (v[2] || 1) * 3), rippleEffect: { scale: 2.2, brushType: 'stroke' }, data: pts(map.users, '#5b8cff') },
      { type: 'scatter', coordinateSystem: 'geo', symbolSize: v => 7 + Math.min(14, (v[2] || 1) * 2), data: pts(map.repos, '#34d399') }] }, true); }
async function geoGlobe(id, map) {
  if (!glLoaded) { try { await import('https://cdn.jsdelivr.net/npm/echarts-gl@2/dist/echarts-gl.min.js'); glLoaded = true; } catch { MAPMODE = 'flat'; return geoFlat(id, map); } }
  const c = ec(id); if (!c) return;
  const pts = (arr, color) => (arr || []).map(p => ({ name: `${p.kind}: ${p.count} · ${p.country || ''}`, value: [p.lon, p.lat, p.count], itemStyle: { color } }));
  c.setOption({ backgroundColor: 'transparent',
    globe: { baseColor: '#0e1d30', environment: 'none', shading: 'color', atmosphere: { show: true, color: '#3a6ea5' }, light: { ambient: { intensity: .9 }, main: { intensity: 1.1 } }, viewControl: { autoRotate: true, autoRotateAfterStill: 3 } },
    series: [{ type: 'scatter3D', coordinateSystem: 'globe', symbolSize: v => 4 + Math.min(12, (v[2] || 1) * 2), itemStyle: { color: '#5b8cff' }, data: pts(map.users) },
      { type: 'scatter3D', coordinateSystem: 'globe', symbolSize: v => 5 + Math.min(12, (v[2] || 1) * 2), itemStyle: { color: '#34d399' }, data: pts(map.repos) }] }, true); }

// ── html helpers ──────────────────────────────────────────────────────────────
const table = (head, rows) => `<div class="scroll"><table><tr>${head.map(h => `<th class="${h.n ? 'num' : ''}">${h.t}</th>`).join('')}</tr>${rows}</table></div>`;
const kpiRow = items => `<div class="kpis">${items.map(([l, v, cls]) => `<div class="kpi"><div class="l">${l}</div><div class="v ${cls || ''}">${v}</div></div>`).join('')}</div>`;
const panel = (cls, title, body, extra = '') => `<div class="panel ${cls}"><div class="ph"><h2>${title}</h2>${extra}</div>${body}</div>`;
window._copy = (t, b) => navigator.clipboard.writeText(t).then(() => { const o = b.textContent; b.textContent = '✓'; setTimeout(() => b.textContent = o, 1200); });
function liveHtml(s) { return (s.live || []).length ? s.live.slice(0, 16).map(l => `<div class="live-card"><span class="gdot"></span><div style="flex:1;min-width:0"><div class="mono" style="font-size:11px">${flag(l.cc)} ${esc((l.creator_id || '').slice(0, 12))}…</div><div class="mut" style="font-size:10.5px">${esc((l.gpu || '').slice(0, 24))} · ${l.ram_gb ? l.ram_gb + 'GB' : ''} ${l.is_vm ? '· VM' : ''}</div></div><div style="text-align:right"><div class="${l.fps >= 50 ? 'ok' : l.fps >= 30 ? 'warn' : 'bad'}" style="font-weight:800">${l.fps ?? '–'} fps</div><div class="mut" style="font-size:10px">${esc(l.view || '')} · ${l.ago_s}s</div></div></div>`).join('') : '<div class="empty">No instance online</div>'; }
const userRow = (s, u) => { const c = u.config || {}; return `<tr class="clk" onclick="window._openUser('${esc(u.creator_id)}')"><td class="mono">${esc(u.creator_id)}</td><td>${(u.names || []).map(n => `<span class="chip">${esc(n)}</span>`).join('') || '<span class="mut">—</span>'}</td><td>${(u.versions || []).map(v => `<span class="chip acc">${esc(v)}</span>`).join('')}</td><td>${u.country ? `<span class="flag">${flag(u.cc)}</span> ${esc((u.city ? u.city + ', ' : '') + u.country)}` : '<span class="mut">—</span>'}</td><td class="mut" style="white-space:normal;max-width:280px">${esc((c.gpu || '').slice(0, 26))} · ${esc((c.cpu || '').slice(0, 22))}${c.is_vm ? ' <span class="chip vm">VM</span>' : ''}</td><td class="num">${u.sessions || 0}</td><td class="mut mono">${esc((u.last_seen || '').slice(0, 16).replace('T', ' '))}</td></tr>`; };

// ── PAGES (skel builds DOM once; fill updates in place) ────────────────────────
const P = {};
P.overview = {
  skel: s => kpiRow([['Unique users', '…'], ['Sessions', '…'], ['Pageviews', '…'], ['Pages/session', '…'], ['Avg session', '…'], ['Events', '…'], ['Valid repos', '…'], ['Benchmarks', '…']].map(x => x)) +
    `<div class="grid">
      ${panel('s8', 'Activity', '<div id="chart" class="chart" style="height:280px"></div>', `<div class="seg" id="actSeg"><button data-a="min" class="${ACT === 'min' ? 'on' : ''}">60 min</button><button data-a="hour" class="${ACT === 'hour' ? 'on' : ''}">24h</button></div>`)}
      ${panel('s4', '<span class="gdot" style="display:inline-block"></span> Live instances', '<div id="live" style="max-height:280px;overflow:auto"></div>')}
      ${panel('s8', 'Map <span class="mut" style="font-weight:400;text-transform:none">(approximate)</span>', '<div id="map" class="chart" style="height:360px"></div>')}
      ${panel('s4', 'Countries', '<div id="geo" class="chart" style="height:360px"></div>')}
      ${panel('s6', '<span class="star">★</span> Custom events <span class="mut" style="font-weight:400;text-transform:none">(click)</span>', '<div id="events" class="chart" style="height:300px"></div>')}
      ${panel('s6', 'Top funnels', '<div id="funnels" class="chart" style="height:300px"></div>')}
    </div>`,
  wire: s => $('#actSeg')?.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; ACT = b.dataset.a; document.querySelectorAll('#actSeg button').forEach(x => x.classList.toggle('on', x === b)); P.overview.fill(S); }),
  fill: s => { const t = s.totals;
    $('#content').querySelector('.kpis').innerHTML = [['Unique users', fmt(t.users)], ['Sessions', fmt(t.sessions)], ['Pageviews', fmt(t.pageviews)], ['Pages/session', t.pages_per_session], ['Avg session', t.avg_session_min + 'm'], ['Events', fmt(t.events)], ['Valid repos', fmt(t.valid_repos)], ['Benchmarks', fmt(t.benchmarks)]].map(([l, v]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('');
    const data = ACT === 'min' ? (s.activity_min || []).map(x => [x.t, x[METRIC] || 0]) : s.series.map(x => [x.hour.slice(11) + 'h', x[METRIC] || 0]);
    lineChart('chart', data); $('#live').innerHTML = liveHtml(s); geoFlat('map', s.map);
    const g = ec('geo'); if (g) g.setOption({ grid: { left: 4, right: 30, top: 6, bottom: 6, containLabel: true }, tooltip: { ...TIP, trigger: 'item' }, xAxis: { type: 'value', splitLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX } }, yAxis: { type: 'category', data: s.geo.slice(0, 12).reverse().map(x => flag(s.country_cc?.[x.country]) + ' ' + x.country), axisLabel: { color: '#e8edf4', fontSize: 11 }, axisLine: { lineStyle: { color: GRID } } }, series: [{ type: 'bar', data: s.geo.slice(0, 12).reverse().map(x => x.count), barWidth: '60%', itemStyle: { color: '#fbbf24', borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', color: AX, fontSize: 11 } }] }, true);
    hbar('events', s.events.map(e => ({ k: e.event, v: e.count })), { click: openEvent }); funnelChart('funnels', s.funnels); }
};
P.events = {
  skel: s => `<div class="grid">${panel('s6', '<span class="star">★</span> Custom events <span class="mut" style="font-weight:400;text-transform:none">(click a bar)</span>', '<div id="events" class="chart" style="height:420px"></div>')}${panel('s6', 'Features used', '<div id="features" class="chart" style="height:420px"></div>')}${panel('s6', 'Modals opened', '<div id="modals" class="chart" style="height:300px"></div>')}${panel('s6', 'Tutorial steps', '<div id="tutorial" class="chart" style="height:300px"></div>')}${panel('s12', 'All events', '<div id="evtable"></div>')}</div>`,
  fill: s => { hbar('events', s.events.map(e => ({ k: e.event, v: e.count })), { click: openEvent, limit: 18 }); hbar('features', (s.features || []).map(f => ({ k: f.k, v: f.v })), { color: '#34d399', limit: 18 }); hbar('modals', (s.modals || []).map(m => ({ k: m.k, v: m.v })), { color: '#a78bfa' }); hbar('tutorial', (s.tutorial || []).map(m => ({ k: m.k, v: m.v })), { color: '#22d3ee' });
    $('#evtable').innerHTML = table([{ t: 'Event' }, { t: 'Count', n: 1 }, { t: '' }], s.events.map(e => `<tr class="clk" onclick="window._openEvent('${esc(e.event)}')"><td>${esc(e.event)}</td><td class="num">${e.count}</td><td><span class="mut">inspect →</span></td></tr>`).join('')); }
};
P.sessions = {
  skel: s => panel('s12', 'Recent sessions <span class="mut" style="font-weight:400;text-transform:none">(click a row → timeline)</span>', '<div id="sesslist"><div class="empty">Loading…</div></div>', '<button class="btnx" id="sessRefresh">↻ refresh</button>'),
  wire: s => { loadSessions(); $('#sessRefresh')?.addEventListener('click', loadSessions); },
  fill: s => { }
};
async function loadSessions() {
  let d; try { d = await (await fetch('/api/sessions')).json(); } catch { return; }
  const byId = Object.fromEntries((S.users || []).map(u => [u.creator_id, u]));
  $('#sesslist').innerHTML = (d.sessions || []).length ? table([{ t: 'User' }, { t: 'Where' }, { t: 'Ver' }, { t: 'Path' }, { t: 'PV', n: 1 }, { t: 'Events', n: 1 }, { t: 'Duration', n: 1 }, { t: 'When' }],
    d.sessions.map(ss => { const u = byId[ss.distinct_id] || {}; return `<tr class="clk" onclick="window._openUser('${esc(ss.distinct_id)}')"><td class="mono">${esc((ss.distinct_id || '').slice(0, 12))}…</td><td>${u.country ? flag(u.cc) + ' ' + esc(u.country) : '<span class="mut">—</span>'}</td><td>${(u.versions || [])[0] ? '<span class="chip acc">' + esc(u.versions[0]) + '</span>' : ''}</td><td class="mut">${esc(ss.entry || '?')} → ${esc(ss.exit || '?')}</td><td class="num">${ss.pageviews}</td><td class="num">${ss.events}</td><td class="num mut">${ss.duration_s < 60 ? ss.duration_s + 's' : Math.floor(ss.duration_s / 60) + 'm ' + (ss.duration_s % 60) + 's'}</td><td class="mut mono">${esc((ss.start || '').slice(5, 16).replace('T', ' '))}</td></tr>`; }).join('')) : '<div class="empty">No sessions yet</div>';
}
P.pages = {
  skel: s => `<div class="grid">${panel('s12', 'Web Vitals <span class="mut" style="font-weight:400;text-transform:none">(BMM WebView)</span>', '<div id="wv"></div>')}${panel('s12', 'Performance per BMM view', '<div id="perfStat" style="margin-bottom:12px"></div><div id="perfView" class="chart" style="height:180px"></div>')}${panel('s12', 'Pages — visits, dwell, FPS, frametime <span class="mut" style="font-weight:400;text-transform:none">(click a row)</span>', '<div id="pagetable"></div>')}</div>`,
  fill: s => { const w = s.webvitals || {}, pf = s.perf;
    const vital = (l, v, unit, g, p) => { const cls = v == null ? '' : v <= g ? 'ok' : v <= p ? 'warn' : 'bad'; return `<div class="stat"><span class="v ${cls}">${v != null ? v + unit : '–'}</span><span class="l">${l}</span></div>`; };
    $('#wv').innerHTML = w.n ? vital('LCP', w.lcp, 'ms', 2500, 4000) + vital('CLS', w.cls, '', .1, .25) + vital('INP', w.inp, 'ms', 200, 500) + vital('FCP', w.fcp, 'ms', 1800, 3000) + vital('TTFB', w.ttfb, 'ms', 800, 1800) + `<div class="stat"><span class="v">${w.n}</span><span class="l">Samples</span></div>` : '<div class="empty">No web-vitals yet (sent once per app launch).</div>';
    $('#perfStat').innerHTML = `<div class="stat"><span class="v ${pf.fps_avg >= 50 ? 'ok' : pf.fps_avg >= 30 ? 'warn' : 'bad'}">${pf.fps_avg}</span><span class="l">FPS avg</span></div><div class="stat"><span class="v">${pf.frametime_avg_ms}ms</span><span class="l">Frametime</span></div><div class="stat"><span class="v ${pf.frametime_worst_ms > 100 ? 'bad' : ''}">${pf.frametime_worst_ms}ms</span><span class="l">Worst</span></div><div class="stat"><span class="v">${pf.heap_avg_mb}MB</span><span class="l">Heap</span></div>`;
    const c = ec('perfView'); if (c) c.setOption({ grid: { left: 4, right: 30, top: 6, bottom: 6, containLabel: true }, tooltip: { ...TIP, trigger: 'axis' }, xAxis: { type: 'value', splitLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX } }, yAxis: { type: 'category', data: pf.byView.slice(0, 8).reverse().map(b => b.view), axisLabel: { color: '#e8edf4', fontSize: 11 }, axisLine: { lineStyle: { color: GRID } } }, series: [{ type: 'bar', data: pf.byView.slice(0, 8).reverse().map(b => b.fps), barWidth: '55%', label: { show: true, position: 'right', formatter: '{c} fps', color: AX, fontSize: 11 }, itemStyle: { color: p => p.value < 40 ? '#f87171' : '#34d399', borderRadius: [0, 4, 4, 0] } }] }, true);
    $('#pagetable').innerHTML = s.pages.length ? table([{ t: 'View' }, { t: 'Visits', n: 1 }, { t: 'Avg dwell', n: 1 }, { t: 'FPS', n: 1 }, { t: 'Frametime', n: 1 }], s.pages.map(p => { const v = pf.byView.find(b => b.view === p.view); return `<tr class="clk" onclick="window._openView('${esc(p.view)}')"><td>${esc(p.view)}</td><td class="num">${p.enters}</td><td class="num mut">${(p.avg_dwell_ms / 1000).toFixed(1)}s</td><td class="num ${v && v.fps < 40 ? 'bad' : 'ok'}">${v ? v.fps : '–'}</td><td class="num mut">${v ? v.ft + 'ms' : '–'}</td></tr>`; }).join('')) : '<div class="empty">No page data</div>'; }
};
P.map = {
  skel: s => panel('s12', 'User &amp; repo map <span class="mut" style="font-weight:400;text-transform:none">(approximate — never precise)</span>', '<div id="map" class="chart" style="height:64vh"></div>', `<div class="seg" id="mapSeg"><button data-m="flat" class="${MAPMODE === 'flat' ? 'on' : ''}">2D map</button><button data-m="globe" class="${MAPMODE === 'globe' ? 'on' : ''}">3D globe</button></div>`),
  wire: s => $('#mapSeg')?.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; MAPMODE = b.dataset.m; document.querySelectorAll('#mapSeg button').forEach(x => x.classList.toggle('on', x === b)); renderMaps(); }),
  fill: s => renderMaps()
};
P.funnels = {
  skel: s => panel('s12', 'Funnel builder', `<p class="mut" style="font-size:12px;margin:0 0 10px">Enter BMM view names in order (e.g. <span class="mono">profiles</span> → <span class="mono">library</span> → <span class="mono">repo</span>). Use <span class="mono">*</span> as a wildcard step.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${[1, 2, 3, 4].map(i => `<input class="k" style="width:150px" id="fstep${i}" placeholder="Step ${i}${i > 2 ? ' (optional)' : ''}">`).join('')}<button class="btnx" id="fgo" style="border-color:var(--acc);color:var(--acc2)">Compute funnel</button></div>
    <div id="funnel" class="chart" style="height:320px"></div><div id="funtable" style="margin-top:10px"></div>`),
  wire: s => { $('#fstep1').value = 'profiles'; $('#fstep2').value = 'library'; $('#fgo')?.addEventListener('click', computeFunnel); computeFunnel(); },
  fill: s => { }
};
async function computeFunnel() {
  const steps = [1, 2, 3, 4].map(i => $('#fstep' + i)?.value.trim()).filter(Boolean);
  if (steps.length < 2) return;
  let d; try { d = await (await fetch('/api/funnel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ steps }) })).json(); } catch { return; }
  funnelChart('funnel', d.steps || []);
  $('#funtable').innerHTML = table([{ t: 'Step' }, { t: 'Sessions', n: 1 }, { t: 'Conversion', n: 1 }, { t: 'Drop-off', n: 1 }], (d.steps || []).map(st => `<tr><td>${esc(st.step)}</td><td class="num">${st.count}</td><td class="num ${st.pct >= 50 ? 'ok' : st.pct >= 20 ? 'warn' : 'bad'}">${st.pct}%</td><td class="num mut">${st.drop || 0}</td></tr>`).join(''));
}
P.retention = {
  skel: s => `<div class="grid">${panel('s12', 'Weekly retention curves', '<div id="ret" class="chart" style="height:300px"></div>')}${panel('s12', 'Cohorts', '<div id="cohorts"></div>')}</div>`,
  fill: s => { const ret = s.retention || [];
    const c = ec('ret'); if (c) c.setOption({ grid: { left: 40, right: 16, top: 16, bottom: 26 }, tooltip: { trigger: 'axis', ...TIP }, legend: { textStyle: { color: AX }, type: 'scroll', top: 0 }, xAxis: { type: 'category', data: Array.from({ length: 8 }, (_, k) => 'W' + k), axisLine: { lineStyle: { color: GRID } }, axisLabel: { color: AX } }, yAxis: { type: 'value', max: 100, axisLabel: { color: AX, formatter: '{value}%' }, splitLine: { lineStyle: { color: GRID } } }, series: ret.map(co => ({ name: co.cohort_start, type: 'line', smooth: true, data: Array.from({ length: 8 }, (_, k) => { const x = co.cells.find(c => c.week === k); return x ? x.pct : null; }) })) }, true);
    $('#cohorts').innerHTML = ret.length ? `<div class="scroll"><table class="ret"><tr><th style="text-align:left">Cohort</th>${Array.from({ length: 8 }, (_, k) => `<th>Week ${k}</th>`).join('')}</tr>${ret.map(co => `<tr><td style="text-align:left;border:0"><b>${co.cohort_start}</b><br><span class="mut" style="font-weight:400">${co.size} users</span></td>${Array.from({ length: 8 }, (_, k) => { const cell = co.cells.find(x => x.week === k); if (!cell) return '<td style="background:transparent"></td>'; const a = Math.max(.06, cell.pct / 100); return `<td style="background:rgba(52,211,153,${a});color:${cell.pct > 40 ? '#04110b' : '#e8edf4'}">${cell.pct}%</td>`; }).join('')}</tr>`).join('')}</table></div>` : '<div class="empty">Not enough history yet</div>'; }
};
P.goals = {
  skel: s => panel('s12', 'Goals', `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"><input class="k" id="gname" placeholder="Goal name"><select class="k" id="gtype" style="width:auto"><option value="event">Event</option><option value="page">Page view</option></select><input class="k" id="gtarget" placeholder="event name / view"><button class="btnx" id="gadd" style="border-color:var(--acc);color:var(--acc2)">Add goal (admin)</button></div><div id="goallist"></div>`),
  wire: s => $('#gadd')?.addEventListener('click', addGoal),
  fill: s => { const g = s.goals || []; $('#goallist') && ($('#goallist').innerHTML = g.length ? g.map(x => `<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px"><div style="flex:1"><b>${esc(x.name)}</b> <span class="chip">${esc(x.type)}: ${esc(x.target)}</span></div><div style="text-align:right"><div style="font-weight:800;font-size:18px" class="${x.rate >= 20 ? 'ok' : 'warn'}">${x.rate}%</div><div class="mut" style="font-size:11px">${x.conversions} users</div></div><button class="btnx" onclick="window._delGoal(${x.id})" style="color:var(--red)">✕</button></div>`).join('') : '<div class="empty">No goals yet. Add one to track conversions (e.g. event=repo_connect).</div>'); }
};
async function addGoal() { const key = $('#adminKey').value.trim(); if (!key) return alert('Enter admin key in header'); await fetch('/api/goals', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key }, body: JSON.stringify({ name: $('#gname').value.trim(), type: $('#gtype').value, target: $('#gtarget').value.trim() }) }); }
window._delGoal = async id => { const key = $('#adminKey').value.trim(); if (!key) return; await fetch('/api/goals/' + id, { method: 'DELETE', headers: { 'X-Admin-Key': key } }); };
P.users = { skel: s => panel('s12', 'Users <span class="mut" style="font-weight:400;text-transform:none">(click a row → config + journey)</span>', '<div id="usertable"></div>'), fill: s => $('#usertable') && ($('#usertable').innerHTML = s.users.length ? table([{ t: 'Creator ID' }, { t: 'Names' }, { t: 'Ver' }, { t: 'Where' }, { t: 'GPU / CPU' }, { t: 'Sess.', n: 1 }, { t: 'Last seen' }], s.users.map(u => userRow(s, u)).join('')) : '<div class="empty">No users yet</div>') };
P.bmm = {
  skel: s => `<div class="grid">${panel('s4', 'Themes', '<div id="themes" class="chart" style="height:240px"></div>')}${panel('s4', 'Theme kind', '<div id="themekind" class="chart" style="height:240px"></div>')}${panel('s4', 'Languages', '<div id="langs" class="chart" style="height:240px"></div>')}${panel('s12', 'Tasky &amp; settings', '<div id="tasky"></div>')}${panel('s6', 'Benchmarks · avg / op', '<div id="benchops" class="chart" style="height:300px"></div>')}${panel('s6', 'Recent benchmark runs <span class="mut" style="font-weight:400;text-transform:none">(click → analyze)</span>', '<div id="benchruns"></div>')}${panel('s12', 'Server repos', '<div id="repos"></div>')}</div>`,
  fill: s => { pie('themes', s.themes || []); pie('themekind', s.theme_kind || []); pie('langs', s.languages || []); const tk = s.tasky || {};
    $('#tasky').innerHTML = `<div class="stat"><span class="v">${tk.visible || 0}</span><span class="l">Tasky visible</span></div><div class="stat"><span class="v">${tk.hidden || 0}</span><span class="l">Tasky hidden</span></div><div class="stat"><span class="v">${tk.animations || 0}</span><span class="l">Animations on</span></div><div class="stat"><span class="v">${tk.tooltips || 0}</span><span class="l">Tooltips on</span></div>`;
    hbar('benchops', (s.benchmarks_ops || []).map(o => ({ k: o.op, v: o.avg_ms })), { unit: 'ms', color: '#a78bfa' });
    $('#benchruns').innerHTML = (s.benchmarks_recent || []).length ? table([{ t: 'Creator ID' }, { t: 'Total', n: 1 }, { t: 'Source' }, { t: 'When' }], s.benchmarks_recent.map((b, i) => `<tr class="clk" onclick="window._openBench(${i})"><td class="mono">${esc(b.creator_id)}</td><td class="num">${b.total_ms ? Math.round(b.total_ms) + 'ms' : '–'}</td><td>${b.source === 'telemetry' ? '<span class="chip">auto</span>' : '<span class="chip acc">manual</span>'}</td><td class="mut mono">${esc((b.ts || '').slice(0, 16).replace('T', ' '))}</td></tr>`).join('')) : '<div class="empty">No benchmarks yet</div>';
    $('#repos').innerHTML = s.repos.length ? table([{ t: 'Host' }, { t: 'Repo' }, { t: 'Location' }, { t: 'Connects', n: 1 }, { t: 'Link' }], s.repos.map(r => `<tr><td class="mono">${esc(r.host)}</td><td>${esc(r.repo_name || '')}</td><td>${r.geo ? `<span class="flag">${flag(r.geo.cc)}</span> ${esc((r.geo.city ? r.geo.city + ', ' : '') + r.geo.country)}` : '<span class="mut">—</span>'}</td><td class="num">${r.count}</td><td>${r.sample_url ? `<a href="${esc(r.sample_url)}" target="_blank">open ↗</a>` : ''}</td></tr>`).join('')) : '<div class="empty">No public repos yet</div>'; }
};
P.admin = { skel: s => { const pv = s.privacy || {}; return kpiRow([['Retention', pv.retention_days + ' days'], ['Erase delay', pv.delete_delay_h + 'h'], ['Pending deletions', pv.pending_deletions || 0]]) + panel('s12', '🔑 Deletion requests', '<div id="deletions"><div class="empty">Enter the admin key in the header.</div></div>'); }, wire: s => loadAdmin(), fill: s => { } };

// ── drawers ──────────────────────────────────────────────────────────────────
function openDrawer(title, body) { $('#drawerTitle').innerHTML = title; $('#drawerBody').innerHTML = body; $('#drawer').classList.add('open'); $('#drawerBg').classList.add('open'); }
function closeDrawer() { $('#drawer').classList.remove('open'); $('#drawerBg').classList.remove('open'); }
$('#drawerX').onclick = closeDrawer; $('#drawerBg').onclick = closeDrawer; document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
const kv = (k, v) => `<div><div class="k">${k}</div><div class="vv">${v}</div></div>`;
async function openEvent(name) { openDrawer(`Event · <span class="mono">${esc(name)}</span>`, '<div class="empty">Loading…</div>'); let d; try { d = await (await fetch('/api/event?name=' + encodeURIComponent(name) + '&limit=80')).json(); } catch { return; }
  $('#drawerBody').innerHTML = (d.occurrences || []).length ? d.occurrences.map(o => `<div style="border:1px solid var(--border);border-radius:9px;padding:10px 12px;margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:11px"><span class="mono">${esc(o.distinct_id)}</span><span class="mut">${esc((o.ts || '').slice(0, 19).replace('T', ' '))}</span></div><div class="props" style="margin-top:6px">${esc(JSON.stringify(o.props, null, 2))}</div></div>`).join('') : '<div class="empty">No occurrences.</div>'; }
window._openEvent = openEvent;
window._openView = name => { const v = (S.perf?.byView || []).find(b => b.view === name); const p = (S.pages || []).find(x => x.view === name); openDrawer(`Page · <span class="mono">${esc(name)}</span>`, `<div class="udetail">${kv('Visits', p ? p.enters : '—')}${kv('Avg dwell', p ? (p.avg_dwell_ms / 1000).toFixed(1) + 's' : '—')}${kv('FPS avg', v ? v.fps : '—')}${kv('Frametime', v ? v.ft + 'ms' : '—')}${kv('Perf samples', v ? v.n : '—')}</div><p class="mut" style="font-size:12px">Per-view metrics are aggregated across all users who visited <b>${esc(name)}</b>.</p>`); };
async function openUser(id) {
  const u = (S.users || []).find(x => x.creator_id === id) || { creator_id: id, config: {} }; const c = u.config || {}, pf = c.profiles || {};
  openDrawer(`User <span class="mono" style="font-size:12px">${esc(id.slice(0, 16))}…</span>`, '<div class="empty">Loading journey…</div>');
  const cfg = `<div class="udetail">${kv('Creator ID', `<span class="mono" style="font-size:11px">${esc(id)}</span> <button class="btnx" onclick="window._copy('${esc(id)}',this)">copy</button>`)}${kv('Where', u.country ? `${flag(u.cc)} ${esc((u.city ? u.city + ', ' : '') + u.country)} · ${esc(u.region || '')}` : '—')}${kv('OS', esc(c.os || '—'))}${kv('CPU', esc(c.cpu || '—') + (c.cores ? ` (${c.cores}c)` : ''))}${kv('RAM', c.ram_gb ? c.ram_gb + ' GB' : '—')}${kv('GPU(s)', esc((c.gpus?.length ? c.gpus.join(', ') : c.gpu) || '—'))}${kv('Motherboard', esc(c.motherboard || '—'))}${kv('VM', c.is_vm ? 'Yes' : 'No')}${kv('Disks', `${c.disk_count || 0} · ${c.disk_total_gb || 0}GB ${(c.disks || []).map(d => `<span class="chip">${esc(d.type)} ${d.size_gb}G</span>`).join('')}`)}${kv('Profiles', pf.profile_count != null ? `${pf.profile_count} · ${pf.total_mods || 0} mods (avg ${pf.avg_mods_per_profile || 0})` : '—')}${kv('Theme / lang', `${esc(c.theme || '—')} ${c.theme_kind ? `<span class="chip">${esc(c.theme_kind)}</span>` : ''} · ${esc(c.locale || '')}`)}${kv('Versions', (u.versions || []).map(v => `<span class="chip acc">${esc(v)}</span>`).join('') || '—')}${kv('IPs', `<span class="mono" style="font-size:10px">${esc((u.ips || []).join(', ') || '—')}</span>`)}</div>`;
  let j; try { j = await (await fetch('/api/user?id=' + encodeURIComponent(id))).json(); } catch { j = { sessions: [] }; }
  const sess = (j.sessions || []).map(sn => `<div class="sess"><div class="sess-h"><span class="mono">session ${esc((sn.session_id || '').slice(0, 8))}</span><span class="mut">${esc((sn.start || '').slice(11, 19))} → ${esc((sn.end || '').slice(11, 19))} · ${sn.events.length} ev</span></div><div class="tl">${sn.events.map(e => `<div class="tl-item"><span class="tl-t">${esc((e.ts || '').slice(11, 19))}</span><span class="tl-ev">${esc(e.event)}</span> <span class="mut">${esc(e.detail || '')}</span></div>`).join('')}</div></div>`).join('');
  $('#drawerBody').innerHTML = cfg + `<h4 style="margin:6px 0 8px;font-size:12px;color:var(--mut);text-transform:uppercase">Session journeys (${(j.sessions || []).length})</h4>` + (sess || '<div class="empty">No session data.</div>');
}
window._openUser = openUser;
window._openBench = i => { const b = (S.benchmarks_recent || [])[i]; if (!b) return; openDrawer(`Benchmark · <span class="mono">${esc(b.creator_id.slice(0, 12))}…</span>`, `<div class="udetail">${kv('Creator ID', `<span class="mono" style="font-size:11px">${esc(b.creator_id)}</span> <button class="btnx" onclick="window._copy('${esc(b.creator_id)}',this)">copy</button>`)}${kv('When', esc((b.ts || '').replace('T', ' ').slice(0, 19)))}${kv('Total', b.total_ms ? Math.round(b.total_ms) + ' ms' : '—')}${kv('Source', b.source || '—')}</div><h4 style="font-size:12px;color:var(--mut);text-transform:uppercase;margin:8px 0">Per-operation (ms)</h4>${table([{ t: 'Operation' }, { t: 'ms', n: 1 }], Object.entries(b.ops || {}).sort((a, c) => c[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${Math.round(v * 100) / 100}</td></tr>`).join('') || '<tr><td class="mut">no ops</td></tr>')}`); };

// ── admin ────────────────────────────────────────────────────────────────────
async function loadAdmin() { const host = $('#deletions'); if (!host) return; const key = $('#adminKey').value.trim(); if (!key) { host.innerHTML = '<div class="empty">Enter the admin key in the header.</div>'; return; }
  let d; try { d = await (await fetch('/api/admin/deletions', { headers: { 'X-Admin-Key': key } })).json(); } catch { return; }
  if (d.error) { host.innerHTML = '<div class="empty">Invalid admin key.</div>'; return; }
  host.innerHTML = (d.deletions || []).length ? table([{ t: 'Packet ID' }, { t: 'Status' }, { t: 'Requested' }, { t: 'Auto-erase' }, { t: 'Actions' }], d.deletions.map(x => `<tr><td class="mono">${esc(x.packet_id)}</td><td class="${x.status === 'pending' ? 'warn' : x.status === 'done' ? 'ok' : 'mut'}">${esc(x.status)}${x.decided_at ? ' · ' + new Date(x.decided_at).toLocaleDateString() : ''}</td><td class="mut mono">${new Date(x.requested_at).toLocaleString()}</td><td class="mut mono">${x.status === 'pending' ? new Date(x.scheduled_at).toLocaleString() : '—'}</td><td>${x.status === 'pending' ? `<button class="btnx" style="color:#f87171" onclick="window._decide('${x.packet_id}','approve')">Approve now</button> <button class="btnx" onclick="window._decide('${x.packet_id}','reject')">Reject</button>` : '—'}</td></tr>`).join('')) : '<div class="empty">No deletion requests.</div>'; }
window._decide = async (packet_id, action) => { const key = $('#adminKey').value.trim(); if (!key) return; await fetch('/api/admin/decide', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key }, body: JSON.stringify({ packet_id, action }) }); loadAdmin(); };

// ── router + live ────────────────────────────────────────────────────────────
function render() { const p = P[ROUTE] || P.overview; $('#title').textContent = TITLES[ROUTE]; if (BUILT !== ROUTE) { $('#content').innerHTML = p.skel(S); BUILT = ROUTE; if (p.wire) p.wire(S); } p.fill(S); }
function go(route) { ROUTE = route; document.querySelectorAll('.nav').forEach(n => n.classList.toggle('on', n.dataset.route === route)); $('#side').classList.remove('open'); render(); }
document.querySelectorAll('.nav').forEach(n => n.addEventListener('click', () => go(n.dataset.route)));
$('#hamb').onclick = () => $('#side').classList.toggle('open');
$('#adminKey').addEventListener('change', () => { if (ROUTE === 'admin') loadAdmin(); });
function apply(s) { S = s; $('#onlineCount').textContent = s.live_count || 0; $('#updated').textContent = 'live · ' + new Date(s.updated).toLocaleTimeString(); const pv = s.privacy || {}; $('#sidefoot').innerHTML = `🔒 GDPR opt-in<br>retention ${pv.retention_days}d · erase ${pv.delete_delay_h}h<br>pending: ${pv.pending_deletions || 0}`; render(); }
// Live stream (SSE) — dynamic, no fixed polling. Falls back to polling on error.
let esrc;
function connect() { try { esrc = new EventSource('/api/stream'); esrc.onmessage = e => { try { apply(JSON.parse(e.data)); } catch {} }; esrc.onerror = () => { esrc.close(); $('#updated').textContent = 'reconnecting…'; setTimeout(poll, 2000); }; } catch { poll(); } }
async function poll() { try { apply(await (await fetch('/api/stats')).json()); } catch { $('#updated').textContent = 'offline'; } setTimeout(poll, 10000); }
connect();
