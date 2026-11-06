// eFS Bulk Downloader — runs in the eFS page's own JavaScript world (manifest "world": "MAIN").
//
// eFS's pager links are "javascript:__doPostBack(...)" URLs. Chrome blocks extension content
// scripts from triggering javascript: URLs, so the content script asks this bridge to make the
// same __doPostBack call the link would have made. Nothing else is exposed.
(() => {
  if (window.__efsBdBridge) return;
  window.__efsBdBridge = true;
  document.addEventListener('efs-bd-postback', (e) => {
    try {
      const { target, arg } = JSON.parse(e.detail);
      if (typeof target !== 'string' || !/^ctl00\$[\w$]+$/.test(target)) return;
      if (typeof window.__doPostBack === 'function') window.__doPostBack(target, typeof arg === 'string' ? arg : '');
    } catch {
      /* ignore malformed requests */
    }
  });
})();
