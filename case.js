// eFS Bulk Downloader — case page ("CaseDetails.aspx").
// Downloads every document in the green side-panel list and names each file
// "<3-digit enclosure no>_<document category>.pdf", e.g. "001_Writ Saman.pdf".
//
// eFS only unlocks a document after a genuine click on its row (a full page
// postback), so this script clicks the rows one at a time. Progress is kept in
// sessionStorage, and the script picks up again after each page reload.

(() => {
  if (window.__efsCaseDl) return;
  window.__efsCaseDl = true;

  const GRID = '#ctl00_Body_radGridDocumentList_ctl00';
  const grid = () => document.querySelector(GRID);
  if (!/CaseDetails\.aspx/i.test(location.pathname) || !grid()) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) =>
    String(s || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/, '')
      .slice(0, 120);

  const caseRowId = new URLSearchParams(location.search).get('CaseRowID') || location.search;
  const JOB_KEY = `efsbd_job_${caseRowId}`;

  const rows = () => [...(grid()?.querySelectorAll('tr.rgRow, tr.rgAltRow') || [])];
  function rowList() {
    return rows().map((tr, idx) => ({
      idx,
      no: (tr.querySelector('[id$="lblEncloNo"]')?.innerText || String(idx + 1)).trim(),
      type: (tr.querySelector('[id$="lblDocTypeName"]')?.innerText || 'Dokumen').trim(),
    }));
  }

  function partyName(gridId) {
    const td = document.querySelector(`#${gridId} tr.rgRow td:nth-child(2)`);
    return td ? td.innerText.split('\n')[0].replace(/\s*\[.*$/, '').trim() : '';
  }
  function caseFolder() {
    const p1 = partyName('ctl00_Body_RadGridParty1');
    const p2 = partyName('ctl00_Body_RadGridParty2');
    const name = p1 && p2 ? `${p1} v ${p2}` : p1 || p2 || `Case ${caseRowId.slice(0, 8)}`;
    return clean(name);
  }

  const fileName = (item, folder, perCase) => {
    const n = String(parseInt(item.no, 10) || item.idx + 1).padStart(3, '0');
    const base = `${n}_${clean(item.type) || 'Dokumen'}.pdf`;
    return perCase ? `eFS/${folder}/${base}` : `eFS/${base}`;
  };

  // The viewer the page opens after a row postback.
  function viewerUrl() {
    const ifr = document.querySelector('iframe[name="radWindowViewDocument"][src*="DocDownloader"]');
    if (ifr) return ifr.src;
    const m = document.documentElement.innerHTML.match(/DocDownloader\.aspx\?DocumentID=[^"'\s<>]*/i);
    return m ? new URL(m[0].split('\\u0026').join('&').replace(/&amp;/g, '&'), location.href).href : null;
  }
  const docIdOf = (u) => { try { return new URL(u).searchParams.get('DocumentID'); } catch { return null; } };

  const loadJob = () => { try { return JSON.parse(sessionStorage.getItem(JOB_KEY) || 'null'); } catch { return null; } };
  const saveJob = (job) => sessionStorage.setItem(JOB_KEY, JSON.stringify(job));
  const clearJob = () => sessionStorage.removeItem(JOB_KEY);

  async function getDone() { return (await chrome.storage.local.get('caseDone')).caseDone || {}; }
  async function markDone(key, filename) {
    const done = await getDone();
    done[key] = { at: Date.now(), filename };
    await chrome.storage.local.set({ caseDone: done });
  }

  // ---------- UI ----------
  const host = document.createElement('div');
  host.id = 'efs-case-downloader';
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
  <style>
    :host { all: initial; }
    * { box-sizing: border-box; font-family: "Segoe UI", system-ui, sans-serif; }
    .fab { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; background: #2e7d32; color: #fff; border: 0;
           border-radius: 22px; padding: 10px 16px; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.25); }
    .panel { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; width: 400px; max-height: 80vh; display: none;
             flex-direction: column; background: #fff; color: #1d2b33; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.3);
             font-size: 13px; overflow: hidden; }
    .panel.open { display: flex; }
    header { background: #2e7d32; color: #fff; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; }
    header button { background: none; border: 0; color: #fff; font-size: 18px; cursor: pointer; }
    .body { padding: 12px 14px; overflow: auto; }
    label.check { display: flex; align-items: center; gap: 6px; font-size: 12px; margin: 3px 0; }
    .opts { display: flex; flex-wrap: wrap; gap: 4px 14px; }
    .btns { display: flex; gap: 6px; margin-top: 10px; }
    .btns button { flex: 1; padding: 8px 10px; border-radius: 6px; border: 1px solid #2e7d32; background: #2e7d32; color: #fff; font-weight: 600; cursor: pointer; font-size: 12px; }
    .btns button.stop { background: #fff; color: #b3261e; border-color: #b3261e; }
    .btns button:disabled { opacity: .45; cursor: default; }
    .status { margin-top: 10px; padding: 8px 10px; background: #eef7ee; border-radius: 6px; white-space: pre-wrap; font-size: 12px; }
    .status.err { background: #fdecea; color: #8a1c15; }
    .list { margin-top: 10px; border-top: 1px solid #e3e9ec; padding-top: 6px; }
    .list small { color: #6b7b84; }
    .tag { font-size: 10px; background: #e1f3e6; color: #1b6b34; border-radius: 4px; padding: 1px 5px; margin-left: 4px; }
    .toolbar { font-size: 12px; margin-top: 8px; }
    .toolbar a { color: #00617f; cursor: pointer; text-decoration: underline; margin-right: 10px; }
    .preview { font-size: 11px; color: #4a5a63; margin-top: 6px; word-break: break-all; }
    .support { margin-top: 12px; padding-top: 8px; border-top: 1px solid #e3e9ec; font-size: 11px; color: #7a8790; text-align: center; }
    .support a { color: #2e7d32; font-weight: 600; text-decoration: none; }
    .support a:hover { text-decoration: underline; }
  </style>
  <button class="fab" id="fab">⬇ Download all case files</button>
  <div class="panel" id="panel">
    <header><b>Case files</b><button id="close" title="Minimise">–</button></header>
    <div class="body">
      <div class="opts">
        <label class="check"><input type="checkbox" id="perCase" checked>Folder per case</label>
        <label class="check"><input type="checkbox" id="skipDone" checked>Skip already downloaded</label>
      </div>
      <div class="preview" id="preview"></div>
      <div class="btns">
        <button id="go">Download selected</button>
        <button class="stop" id="stop" disabled>Stop</button>
      </div>
      <div class="status" id="status">The page reloads once per file while downloading — that's normal. Leave this tab open until it says Done.</div>
      <div class="toolbar"><a id="all">Select all</a><a id="none">None</a><a id="reset">Reset history</a></div>
      <div class="list" id="list"></div>
      <div class="support">Free &amp; open source. Saved you time? <a href="https://buymeacoffee.com/rachelcjw" target="_blank" rel="noopener">☕ Buy me a coffee</a></div>
    </div>
  </div>`;

  const $ = (id) => root.getElementById(id);
  const panel = $('panel');
  const open = () => { panel.classList.add('open'); $('fab').style.display = 'none'; };
  $('fab').onclick = open;
  $('close').onclick = () => { panel.classList.remove('open'); $('fab').style.display = ''; };

  function setStatus(text, err = false) {
    $('status').textContent = text;
    $('status').classList.toggle('err', !!err);
  }

  const items = rowList();
  const folder = caseFolder();
  let selected = new Set(items.map((i) => i.idx));

  async function render() {
    const done = await getDone();
    const list = $('list');
    list.innerHTML = '';
    for (const it of items) {
      const row = document.createElement('label');
      row.className = 'check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selected.has(it.idx);
      cb.onchange = () => { cb.checked ? selected.add(it.idx) : selected.delete(it.idx); };
      const span = document.createElement('span');
      span.textContent = fileName(it, folder, false).replace(/^eFS\//, '') + ' ';
      if (done[`${caseRowId}|${it.no}`]) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = 'downloaded';
        span.appendChild(tag);
      }
      row.append(cb, span);
      list.appendChild(row);
    }
    $('preview').textContent = `Saves to: Downloads/eFS/${$('perCase').checked ? folder + '/' : ''}001_${items[0] ? clean(items[0].type) : 'Writ'}.pdf …`;
  }
  $('perCase').onchange = render;
  $('all').onclick = () => { selected = new Set(items.map((i) => i.idx)); render(); };
  $('none').onclick = () => { selected = new Set(); render(); };
  $('reset').onclick = async () => {
    const done = await getDone();
    for (const k of Object.keys(done)) if (k.startsWith(`${caseRowId}|`)) delete done[k];
    await chrome.storage.local.set({ caseDone: done });
    render();
    setStatus('History for this case cleared.');
  };

  function setBusy(b) {
    $('go').disabled = b;
    $('stop').disabled = !b;
  }

  $('go').onclick = async () => {
    const done = await getDone();
    const skip = $('skipDone').checked;
    const queue = items.filter((i) => selected.has(i.idx) && !(skip && done[`${caseRowId}|${i.no}`]));
    if (!queue.length) return setStatus('Nothing to download (all selected files already downloaded).');
    const job = {
      queue, pos: 0, pending: null, lastDocId: docIdOf(viewerUrl() || ''),
      folder, perCase: $('perCase').checked, ok: 0, failed: [], skipped: selected.size - queue.length,
    };
    saveJob(job);
    step();
  };

  $('stop').onclick = () => {
    const job = loadJob();
    if (job) { job.stop = true; saveJob(job); }
    setStatus('Stopping…');
  };

  // ---------- job runner (resumes after each postback reload) ----------
  async function step() {
    let job = loadJob();
    if (!job) return;
    open();
    setBusy(true);

    if (job.stop) return finish(job, 'Stopped.');

    // Just came back from clicking a row: grab its document.
    if (job.pending !== null) {
      const item = job.queue[job.pos];
      let url = null;
      // After the postback the page renders the viewer for the clicked row.
      // Prefer a document different from the last one; after ~3s accept what's shown
      // (the same document can legitimately repeat if the user clicked that row before).
      for (let t = 0; t < 40 && !url; t++) {
        const u = viewerUrl();
        if (u && (docIdOf(u) !== job.lastDocId || t >= 12)) url = u;
        else await sleep(250);
      }
      if (!url) {
        job.failed.push(`${item.no} ${item.type}: viewer did not open`);
      } else {
        const filename = fileName(item, job.folder, job.perCase);
        setStatus(`Saving ${job.pos + 1}/${job.queue.length}: ${filename.split('/').pop()}`);
        let res;
        try { res = await chrome.runtime.sendMessage({ type: 'download', url, filename }); }
        catch (e) { res = { ok: false, error: e.message }; }
        if (res && res.ok) {
          job.ok++;
          await markDone(`${caseRowId}|${item.no}`, filename);
        } else {
          job.failed.push(`${item.no} ${item.type}: ${res?.error || 'failed'}`);
          if (/session may have expired/i.test(res?.error || '')) { saveJob(job); return finish(job, 'Stopped — eFS session expired. Log in again and rerun.'); }
        }
        job.lastDocId = docIdOf(url);
      }
      job.pending = null;
      job.pos++;
      saveJob(job);
    }

    if (job.pos >= job.queue.length) return finish(job, 'Done.');

    // Click the next row (full page postback; this script resumes on reload).
    const next = job.queue[job.pos];
    setStatus(`Opening ${job.pos + 1}/${job.queue.length}: ${next.no} – ${next.type}`);
    await sleep(job.pos === 0 ? 300 : 1200); // be gentle on the court server
    const tr = rows()[next.idx];
    const target = tr && (tr.querySelector('[id$="lblDocTypeName"]') || tr.cells[0]);
    if (!target) {
      job.failed.push(`${next.no} ${next.type}: row not found`);
      job.pos++;
      saveJob(job);
      return step();
    }
    job.pending = next.idx;
    job.lastDocId = docIdOf(viewerUrl() || '') || job.lastDocId;
    saveJob(job);
    target.click();
  }

  function finish(job, prefix) {
    clearJob();
    setBusy(false);
    render();
    const msg = `${prefix} ${job.ok} downloaded` +
      (job.skipped ? `, ${job.skipped} skipped (already downloaded)` : '') +
      (job.failed.length ? `, ${job.failed.length} failed:\n${job.failed.slice(0, 6).join('\n')}` : '.');
    setStatus(msg, job.failed.length > 0);
  }

  render();
  if (loadJob()) step();
})();
