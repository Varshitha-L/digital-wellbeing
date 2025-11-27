/* script.js
   Screen-time graphing helper for WellTrack dashboard.
   - Requires Chart.js already loaded on the page.
   - Reads from backend /api/sessions (Authorization: Bearer <token> in localStorage.wt_token),
     otherwise falls back to localStorage keys `wt_local_sessions` and `wt_local_buffer`.
*/

(() => {
  // CONFIG
  const API_BASE = localStorage.getItem('wt_api_base') || 'http://localhost:8080';
  const POLL_MS = 30_000; // refresh every 30 seconds
  const TOP_N_APPS = 8;   // top N apps to show in bar chart

  // DOM
  const canvas = document.getElementById('usageChart');
  if (!canvas) {
    console.warn('usageChart canvas not found');
    return;
  }
  const ctx = canvas.getContext('2d');

  // Chart instance (created on first render)
  let usageChart = null;

  // helpers: read token
  function authToken() { return localStorage.getItem('wt_token') || null; }

  // helpers: local storage fallback keys used by previous files
  function loadLocalSessions() {
    try { return JSON.parse(localStorage.getItem('wt_local_sessions') || '[]'); }
    catch (e) { return []; }
  }
  function loadLocalBuffer() {
    try { return JSON.parse(localStorage.getItem('wt_local_buffer') || '[]'); }
    catch (e) { return []; }
  }

  // fetch sessions from backend (returns array of unified sessions)
  async function fetchServerSessions() {
    const token = authToken();
    if (!token) throw new Error('no token');
    const url = (localStorage.getItem('wt_api_base') || API_BASE) + '/api/sessions';
    const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } , cache:'no-store' });
    if (!res.ok) throw new Error('server error');
    const data = await res.json();
    // server returns rows: {id, source, name, seconds, label, created_at}
    return (data.rows || []).map(r => ({
      id: 's' + r.id,
      title: r.name || 'unknown',
      seconds: Number(r.seconds || 0),
      durationMin: Math.round((r.seconds || 0) / 60),
      label: r.label || 'other',
      createdAt: (r.created_at ? new Date(r.created_at).getTime() : Date.now()),
      source: r.source || 'server'
    }));
  }

  // unify local sessions format to same shape
  function unifyLocalSessions() {
    const local = loadLocalSessions().map(s => ({
      id: s.id || ('l' + Math.random().toString(36).slice(2,8)),
      title: s.title || s.name || 'local',
      seconds: (s.durationMin ? s.durationMin * 60 : (s.seconds || 0)),
      durationMin: s.durationMin || Math.round((s.seconds || 0) / 60),
      label: s.label || 'other',
      createdAt: s.createdAt ? new Date(s.createdAt).getTime() : Date.now(),
      source: s.source || 'local'
    }));
    const buf = loadLocalBuffer().map(s => ({
      id: s.id || ('b' + Math.random().toString(36).slice(2,8)),
      title: s.name || s.title || s.app || 'buffer',
      seconds: Number(s.seconds || (s.durationMin ? s.durationMin * 60 : 0)),
      durationMin: s.durationMin || Math.round((s.seconds || 0) / 60),
      label: s.label || 'other',
      createdAt: s.createdAt ? new Date(s.createdAt).getTime() : Date.now(),
      source: s.source || 'buffer'
    }));
    return local.concat(buf);
  }

  // Aggregate sessions by app name (sum seconds)
  function aggregateByApp(sessions) {
    const map = new Map();
    for (const s of sessions) {
      const key = (s.title || 'unknown').trim();
      const prev = map.get(key) || 0;
      map.set(key, prev + Number(s.seconds || 0));
    }
    // convert to sorted array (descending)
    const arr = Array.from(map.entries()).map(([name, seconds]) => ({ name, seconds, minutes: Math.round(seconds / 60) }));
    arr.sort((a,b) => b.seconds - a.seconds);
    return arr;
  }

  // Build timeseries for last 7 days (daily totals in minutes)
  function aggregateLast7Days(sessions) {
    const now = new Date();
    const days = [];
    for (let i = 6; i >= 0; --i) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      days.push({ label: d.toLocaleDateString(undefined, { weekday: 'short', month:'short', day:'numeric' }), stamp: d.toISOString().slice(0,10), minutes: 0 });
    }
    const lookup = new Map(days.map(d => [d.stamp, d]));
    for (const s of sessions) {
      const dt = new Date(s.createdAt);
      const key = dt.toISOString().slice(0,10);
      if (lookup.has(key)) {
        lookup.get(key).minutes += Math.round((s.seconds || 0) / 60);
      }
    }
    return days;
  }

  // Create gradient for chart bars
  function createBarGradient(ctx, baseColor1 = '#60a5fa', baseColor2 = '#7c3aed') {
    const g = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
    g.addColorStop(0, baseColor1);
    g.addColorStop(1, baseColor2);
    return g;
  }

  // Render or update Chart.js chart
  function renderUsageChart(agg, daysSeries) {
    // top N apps
    const top = agg.slice(0, TOP_N_APPS);
    const labels = top.map(x => x.name);
    const values = top.map(x => Math.round(x.seconds / 60)); // minutes

    // If chart exists, update dataset
    if (usageChart) {
      usageChart.data.labels = labels;
      usageChart.data.datasets[0].data = values;
      // optional timeseries dataset
      if (usageChart.data.datasets.length > 1) {
        usageChart.data.datasets[1].data = daysSeries.map(d => d.minutes);
        usageChart.data.labels = labels; // keep labels same for bar; timeseries is in dataset2.xAxis? We'll show in tooltip only.
      }
      usageChart.update();
      return;
    }

    // create chart
    usageChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Minutes (top apps)',
          data: values,
          backgroundColor: createBarGradient(ctx),
          borderRadius: 8,
          barPercentage: 0.72,
          categoryPercentage: 0.7,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 700, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function(context) {
                const mins = context.raw;
                const name = context.label;
                // find seconds
                const entry = agg.find(e => e.name === name);
                const s = entry ? entry.seconds : mins * 60;
                // also compute weekly total for that app if sessions detail available
                return `${name}: ${mins} min (${s} s)`;
              },
              afterBody: function() {
                // Show last7days totals summary
                const ds = daysSeries.map(d => `${d.label}: ${d.minutes}m`).join('\n');
                return ['---', 'Last 7 days:', ds];
              }
            },
            bodyFont: { weight: '600' }
          }
        },
        scales: {
          x: {
            ticks: {
              maxRotation: 45,
              minRotation: 20,
              color: '#dbeafe'
            },
            grid: { display: false }
          },
          y: {
            beginAtZero: true,
            ticks: {
              callback: v => v + 'm',
              color: '#dbeafe'
            },
            grid: {
              color: 'rgba(255,255,255,0.04)'
            }
          }
        }
      }
    });
  }

  // Main: gather sessions (try server then fallback) and render graph
  async function updateUsageGraph({ forceLocal = false } = {}) {
    // try to fetch server sessions if token and not forcing local
    let sessions = [];
    if (!forceLocal) {
      try {
        sessions = await fetchServerSessions();
      } catch (e) {
        // fallback to local
        sessions = unifyLocalSessions();
      }
    } else {
      sessions = unifyLocalSessions();
    }

    // aggregate by app and days
    const agg = aggregateByApp(sessions);
    const days = aggregateLast7Days(sessions);

    // render chart
    renderUsageChart(agg, days);

    // update small UI summary (if you have elements)
    // e.g. show top app in appsList container if exists
    const appsListEl = document.getElementById('appsList') || document.getElementById('appContainer');
    if (appsListEl) {
      // create small top apps view
      const top = agg.slice(0, TOP_N_APPS);
      const html = ['<div style="display:flex;flex-direction:column;gap:8px">'];
      for (const a of top) {
        const pct = Math.round((a.seconds / Math.max(1, sessions.reduce((s, x) => s + (x.seconds || 0), 0))) * 100);
        html.push(`
          <div class="app-item">
            <div style="display:flex;gap:12px;align-items:center">
              <div style="width:44px;height:44px;border-radius:10px;background:linear-gradient(135deg,#6eaaff,#7c3aed);display:grid;place-items:center;font-weight:700">${(a.name[0]||'A').toUpperCase()}</div>
              <div>
                <div style="font-weight:700">${a.name}</div>
                <div class="small muted">${a.minutes} min • ${pct}%</div>
              </div>
            </div>
            <div style="width:120px">
              <div class="app-progress"><div class="app-progress-inner" style="width:${Math.min(100,pct)}%"></div></div>
            </div>
          </div>
        `);
      }
      html.push('</div>');
      appsListEl.innerHTML = html.join('');
    }
  }

  // Auto-refresh + focus listener
  window.addEventListener('focus', () => updateUsageGraph());
  setInterval(() => updateUsageGraph(), POLL_MS);

  // Expose for manual use
  window.updateUsageGraph = updateUsageGraph;

  // initial render (try server first)
  updateUsageGraph().catch(err => {
    console.warn('Initial usage graph load failed, trying local', err);
    updateUsageGraph({ forceLocal: true });
  });

})();
