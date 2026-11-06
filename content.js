// eFS Bulk Downloader — content script.
// Runs on eFS pages. On an inbox page ("Sedia untuk Diekstrak" or "Peti Masuk"),
// it adds a panel that scans the inbox messages, lists every document in them,
// and downloads the selected ones into a folder per case.

(() => {
  if (window.__efsBulkDl) return;
  window.__efsBulkDl = true;

  // ---------- page selectors (eFS uses Telerik RadGrid + RadAjax) ----------
  const gridTable = () => document.querySelector('table[id$="radGridMyInbox_ctl00"]');
  // Outer message container holds From / Date / Subject plus the body with the document table.
  const msgBox = () =>
    document.getElementById('Body_MyFilingBody_InboxMessageDiv') ||
    document.getElementById('Body_MyFilingBody_LabelMessage');
  const dataRows = () => [...(gridTable()?.querySelectorAll('tr.rgRow, tr.rgAltRow') || [])];

  if (!gridTable()) return; // not an inbox page

  // ---------- helpers ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const clean = (s) =>
    String(s || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/, '')
      .slice(0, 120);

  const store = {
    async get(key, fallback) {
      const v = await chrome.storage.local.get(key);
      return v[key] ?? fallback;
    },
    async set(key, value) {
      await chrome.storage.local.set({ [key]: value });
    },
  };

  function rowInfo(tr) {
    const c = [...tr.cells].map((td) => td.innerText.trim());
    const stamp = c[0] || '';
    const title = c[2] || '';
    // "Document ready for extraction (B-02(NCvC)(A)-1675-08/2026)" -> outer brackets
    const i = title.indexOf('(');
    const j = title.lastIndexOf(')');
    const caseNo = i >= 0 && j > i ? title.slice(i + 1, j).trim() : '';
    const date = new Date(stamp);
    return {
      key: `${stamp}|${title}`,
      stamp,
      type: c[1] || '',
      title,
      caseNo,
      iso: isNaN(date) ? '' : date.toISOString(),
    };
  }

  async function openMessage(index, info) {
    const shown = msgBox();
    if (shown && shown.innerText.includes(info.stamp)) return shown;
    const tr = dataRows()[index];
    tr.cells[2].click();
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      await sleep(250);
      const box = msgBox();
      if (box && box.innerText.includes(info.stamp)) return box;
    }
    throw new Error(`Timed out opening: ${info.title}`);
  }

  function parseDocs(box) {
    return [...box.querySelectorAll('a[href*="DocDownloader.aspx"]')].map((a) => {
      const cells = [...(a.closest('tr')?.cells || [])].map((td) => td.innerText.trim());
      const url = new URL(a.getAttribute('href'), location.href);
      return {
        url: url.href,
        docId: url.searchParams.get('DocumentID') || url.href,
        name: cells[1] || a.textContent.trim(),
        serial: cells[2] || '',
        code: cells[3] || '',
      };
    });
  }

  function pagerState() {
    const g = gridTable();
    const cur = g?.querySelector('.rgCurrentPage');
    const m = (g?.innerText || '').match(/(\d+)\s+items?\s+in\s+(\d+)\s+pages?/i);
    return {
      page: cur ? parseInt(cur.innerText, 10) : 1,
      pages: m ? parseInt(m[2], 10) : 1,
      items: m ? parseInt(m[1], 10) : null,
    };
  }

  async function goToPage(target) {
    const before = pagerState().page;
    if (before === target) return;
    const g = gridTable();
    const link = [...g.querySelectorAll('.rgNumPart a')].find((a) => a.innerText.trim() === String(target));
    const btn = link || g.querySelector('input.rgPageNext');
    if (!btn) throw new Error('Could not find the page control');
    btn.click();
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      await sleep(300);
      if (gridTable() && pagerState().page !== before) {
        await sleep(400);
        return;
      }
    }
    throw new Error('Timed out loading the next page');
  }

  function fileName(doc, perCase) {
    const d = doc.iso ? new Date(doc.iso) : new Date();
    const caseNo = clean(doc.caseNo) || 'Lain-lain';
    const base = `${ymd(d)} ${clean(doc.name) || 'Dokumen'}.pdf`;
    return perCase ? `eFS/${caseNo}/${base}` : `eFS/${caseNo} - ${base}`;
  }

  // ---------- state ----------
  let results = []; // one entry per document
  let busy = false;
  let stopRequested = false;

  // ---------- core actions ----------
  async function scan(opts) {
    busy = true;
    stopRequested = false;
    results = [];
    const cache = await store.get('msgCache', {});
    const downloaded = await store.get('downloaded', {});
    let messages = 0;
    let opened = 0;

    try {
      if (opts.fromFirstPage && pagerState().page !== 1) {
        setStatus('Going to page 1…');
        await goToPage(1);
      }

      outer: while (true) {
        const { page, pages } = pagerState();
        const count = dataRows().length;
        for (let i = 0; i < count; i++) {
          if (stopRequested) break outer;
          const tr = dataRows()[i];
          if (!tr) continue;
          const info = rowInfo(tr);
          const when = info.iso ? new Date(info.iso) : null;

          if (opts.to && when && when > opts.to) continue;
          if (opts.from && when && when < opts.from) break outer; // inbox is newest-first
          if (opts.caseFilter && !info.caseNo.toLowerCase().includes(opts.caseFilter)) continue;

          let docs = cache[info.key];
          if (!docs) {
            const box = await openMessage(i, info);
            docs = parseDocs(box);
            cache[info.key] = docs;
            await store.set('msgCache', cache);
            opened++;
            await sleep(opts.delay);
          }
          messages++;
          for (const d of docs) {
            results.push({ ...d, caseNo: info.caseNo, iso: info.iso, stamp: info.stamp, title: info.title, done: !!downloaded[d.docId] });
          }
          setStatus(`Page ${page}/${pages} · ${messages} messages · ${results.length} documents found`);
        }
        if (stopRequested || page >= pages) break;
        await goToPage(page + 1);
      }
      setStatus(
        `${stopRequested ? 'Stopped. ' : 'Scan done. '}${messages} messages (${opened} opened, ${messages - opened} from cache), ${results.length} documents.`
      );
    } catch (e) {
      setStatus(`Scan stopped: ${e.message}. ${results.length} documents found so far.`, true);
    } finally {
      busy = false;
      renderResults();
    }
  }

  async function downloadSelected(opts) {
    const picked = results.filter((r) => r.selected);
    if (!picked.length) return setStatus('Nothing selected.', true);
    busy = true;
    stopRequested = false;
    const downloaded = await store.get('downloaded', {});
    let ok = 0, skipped = 0, failed = 0;
    const errors = [];

    for (const [n, doc] of picked.entries()) {
      if (stopRequested) break;
      if (opts.skipDone && downloaded[doc.docId]) {
        skipped++;
        continue;
      }
      setStatus(`Downloading ${n + 1}/${picked.length}: ${doc.caseNo} — ${doc.name}`);
      const filename = fileName(doc, opts.perCase);
      let res;
      try {
        res = await chrome.runtime.sendMessage({ type: 'download', url: doc.url, filename });
      } catch (e) {
        res = { ok: false, error: e.message };
      }
      if (res && res.ok) {
        ok++;
        doc.done = true;
        downloaded[doc.docId] = { at: Date.now(), filename };
        await store.set('downloaded', downloaded);
      } else {
        failed++;
        errors.push(`${doc.caseNo} — ${doc.name}: ${res?.error || 'unknown error'}`);
        if (/session may have expired/i.test(res?.error || '')) break;
      }
      await sleep(opts.delay);
    }

    busy = false;
    renderResults();
    setStatus(
      `${stopRequested ? 'Stopped. ' : 'Done. '}${ok} downloaded, ${skipped} skipped (already downloaded), ${failed} failed.` +
        (errors.length ? `\n${errors.slice(0, 5).join('\n')}` : ''),
      failed > 0
    );
  }

  function exportCsv() {
    if (!results.length) return setStatus('Scan first, then export.', true);
    const head = ['Date', 'Case No', 'Document', 'Serial No', 'Extraction Code', 'Message'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [head.map(q).join(',')].concat(
      results.map((r) => [r.stamp, r.caseNo, r.name, r.serial, r.code, r.title].map(q).join(','))
    );
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `eFS index ${ymd(new Date())}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 2000);
  }

  // ---------- UI (shadow DOM so eFS styles don't leak in) ----------
  const host = document.createElement('div');
  host.id = 'efs-bulk-downloader';
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });

  root.innerHTML = `
  <style>
    :host { all: initial; }
    * { box-sizing: border-box; font-family: "Segoe UI", system-ui, sans-serif; }
    .fab { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; background: #002b3d; color: #fff;
           border: 0; border-radius: 22px; padding: 10px 16px; font-size: 13px; font-weight: 600; cursor: pointer;
           box-shadow: 0 4px 14px rgba(0,0,0,.25); }
    .panel { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; width: 420px; max-height: 80vh;
             display: none; flex-direction: column; background: #fff; color: #1d2b33; border-radius: 10px;
             box-shadow: 0 10px 30px rgba(0,0,0,.3); font-size: 13px; overflow: hidden; }
    .panel.open { display: flex; }
    header { background: #002b3d; color: #fff; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; }
    header b { font-size: 14px; }
    header button { background: none; border: 0; color: #fff; font-size: 18px; cursor: pointer; line-height: 1; }
    .body { padding: 12px 14px; overflow: auto; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 10px; }
    label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: #4a5a63; }
    label.check { flex-direction: row; align-items: center; gap: 6px; color: #1d2b33; }
    input[type=date], input[type=text], input[type=number] { padding: 6px 8px; border: 1px solid #c9d3d8; border-radius: 6px; font-size: 13px; }
    .full { grid-column: 1 / -1; }
    .btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .btns button { flex: 1 1 auto; padding: 8px 10px; border-radius: 6px; border: 1px solid #002b3d; background: #fff; color: #002b3d; font-weight: 600; cursor: pointer; font-size: 12px; }
    .btns button.primary { background: #002b3d; color: #fff; }
    .btns button.stop { border-color: #b3261e; color: #b3261e; }
    .btns button:disabled { opacity: .45; cursor: default; }
    .status { margin-top: 10px; padding: 8px 10px; background: #eef4f7; border-radius: 6px; white-space: pre-wrap; font-size: 12px; }
    .status.err { background: #fdecea; color: #8a1c15; }
    .list { margin-top: 10px; border-top: 1px solid #e3e9ec; }
    .case { border-bottom: 1px solid #e3e9ec; padding: 6px 0; }
    .case > label { font-weight: 600; }
    .doc { padding-left: 22px; }
    .doc small { color: #6b7b84; }
    .tag { font-size: 10px; background: #e1f3e6; color: #1b6b34; border-radius: 4px; padding: 1px 5px; margin-left: 4px; }
    .toolbar { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; font-size: 12px; }
    .toolbar a { color: #00617f; cursor: pointer; text-decoration: underline; margin-left: 8px; }
  </style>
  <button class="fab" id="fab">⬇ eFS Bulk Download</button>
  <div class="panel" id="panel">
    <header><b>eFS Bulk Downloader</b><button id="close" title="Minimise">–</button></header>
    <div class="body">
      <div class="grid">
        <label>From date<input type="date" id="from"></label>
        <label>To date<input type="date" id="to"></label>
        <label class="full">Case no. contains (optional)<input type="text" id="caseFilter" placeholder="e.g. BA-22NCvC-24-01/2024"></label>
        <label>Delay between requests (ms)<input type="number" id="delay" min="500" step="250" value="1500"></label>
        <label class="check" style="align-self:end"><input type="checkbox" id="fromFirst" checked>Start from page 1</label>
        <label class="check"><input type="checkbox" id="perCase" checked>Folder per case</label>
        <label class="check"><input type="checkbox" id="skipDone" checked>Skip already downloaded</label>
      </div>
      <div class="btns">
        <button class="primary" id="scan">1. Scan inbox</button>
        <button class="primary" id="dl" disabled>2. Download selected</button>
        <button id="csv" disabled>Export CSV</button>
        <button class="stop" id="stop" disabled>Stop</button>
      </div>
      <div class="status" id="status">Set a date range, then Scan. Leave dates blank to scan the whole inbox (slow: each message is opened once, then cached).</div>
      <div class="toolbar" id="toolbar" style="display:none">
        <span id="count"></span>
        <span><a id="all">Select all</a><a id="new">Only new</a><a id="none">None</a></span>
      </div>
      <div class="list" id="list"></div>
      <div class="toolbar"><span></span><span><a id="reset" title="Forget which files were downloaded and which messages were scanned">Reset history</a></span></div>
    </div>
  </div>`;

  const $ = (id) => root.getElementById(id);
  const panel = $('panel');

  // Default: last 30 days
  const today = new Date();
  $('to').value = ymd(today);
  $('from').value = ymd(new Date(today.getTime() - 30 * 86400000));

  $('fab').onclick = () => { panel.classList.add('open'); $('fab').style.display = 'none'; };
  $('close').onclick = () => { panel.classList.remove('open'); $('fab').style.display = ''; };

  function setStatus(text, isErr = false) {
    const s = $('status');
    s.textContent = text;
    s.classList.toggle('err', !!isErr);
  }

  function syncButtons() {
    $('scan').disabled = busy;
    $('dl').disabled = busy || !results.some((r) => r.selected);
    $('csv').disabled = busy || !results.length;
    $('stop').disabled = !busy;
  }
  setInterval(syncButtons, 400);

  function readOpts() {
    const f = $('from').value, t = $('to').value;
    return {
      from: f ? new Date(`${f}T00:00:00`) : null,
      to: t ? new Date(`${t}T23:59:59`) : null,
      caseFilter: $('caseFilter').value.trim().toLowerCase(),
      delay: Math.max(500, parseInt($('delay').value, 10) || 1500),
      fromFirstPage: $('fromFirst').checked,
      perCase: $('perCase').checked,
      skipDone: $('skipDone').checked,
    };
  }

  function renderResults() {
    const list = $('list');
    list.innerHTML = '';
    $('toolbar').style.display = results.length ? 'flex' : 'none';
    // default selection: anything not yet downloaded
    results.forEach((r) => { if (r.selected === undefined) r.selected = !r.done; });

    const byCase = new Map();
    results.forEach((r, i) => {
      const k = r.caseNo || 'Lain-lain';
      if (!byCase.has(k)) byCase.set(k, []);
      byCase.get(k).push(i);
    });

    for (const [caseNo, idxs] of byCase) {
      const wrap = document.createElement('div');
      wrap.className = 'case';
      const head = document.createElement('label');
      head.className = 'check';
      const hcb = document.createElement('input');
      hcb.type = 'checkbox';
      hcb.checked = idxs.every((i) => results[i].selected);
      head.append(hcb, document.createTextNode(`${caseNo} (${idxs.length})`));
      wrap.appendChild(head);

      const boxes = [];
      for (const i of idxs) {
        const r = results[i];
        const row = document.createElement('label');
        row.className = 'check doc';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!r.selected;
        cb.onchange = () => { r.selected = cb.checked; hcb.checked = idxs.every((j) => results[j].selected); updateCount(); };
        boxes.push(cb);
        const txt = document.createElement('span');
        txt.textContent = `${r.name} `;
        const sm = document.createElement('small');
        sm.textContent = r.stamp.split(' ').slice(0, 3).join(' ');
        txt.appendChild(sm);
        if (r.done) {
          const tag = document.createElement('span');
          tag.className = 'tag';
          tag.textContent = 'downloaded';
          txt.appendChild(tag);
        }
        row.append(cb, txt);
        wrap.appendChild(row);
      }
      hcb.onchange = () => {
        idxs.forEach((i) => (results[i].selected = hcb.checked));
        boxes.forEach((b) => (b.checked = hcb.checked));
        updateCount();
      };
      list.appendChild(wrap);
    }
    updateCount();
  }

  function updateCount() {
    const n = results.filter((r) => r.selected).length;
    $('count').textContent = `${n} of ${results.length} selected`;
  }

  function selectWhere(fn) {
    results.forEach((r) => (r.selected = fn(r)));
    renderResults();
  }

  $('all').onclick = () => selectWhere(() => true);
  $('none').onclick = () => selectWhere(() => false);
  $('new').onclick = () => selectWhere((r) => !r.done);
  $('scan').onclick = () => { if (!busy) scan(readOpts()); };
  $('dl').onclick = () => { if (!busy) downloadSelected(readOpts()); };
  $('csv').onclick = exportCsv;
  $('stop').onclick = () => { stopRequested = true; setStatus('Stopping after the current item…'); };
  $('reset').onclick = async () => {
    if (busy) return;
    await chrome.storage.local.remove(['downloaded', 'msgCache']);
    results.forEach((r) => (r.done = false));
    renderResults();
    setStatus('History cleared.');
  };
})();
