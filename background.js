// eFS Bulk Downloader — background service worker.
// Receives download requests from the content script, saves each file with
// chrome.downloads (which uses the browser's own eFS session cookies), and
// reports back once the file has finished, so downloads run one at a time.

const INBOX_URL = 'https://efs.kehakiman.gov.my/EFSWeb/Inbox/ReadyForExtractInbox.aspx';

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: INBOX_URL });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'download') return;

  chrome.downloads.download(
    { url: msg.url, filename: msg.filename, conflictAction: 'uniquify', saveAs: false },
    (id) => {
      if (chrome.runtime.lastError || id === undefined) {
        sendResponse({ ok: false, error: chrome.runtime.lastError?.message || 'Download did not start' });
        return;
      }
      waitForDownload(id).then(sendResponse);
    }
  );
  return true; // keep the message channel open for the async response
});

function waitForDownload(id, timeoutMs = 180000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve({ ok: true, id, note: 'still downloading after 3 minutes' });
    }, timeoutMs);

    function onChanged(delta) {
      if (delta.id !== id || !delta.state) return;
      if (delta.state.current === 'complete') {
        cleanup();
        chrome.downloads.search({ id }, ([item]) => {
          // If the session expired, eFS returns an HTML login page instead of a PDF.
          if (item && item.mime && !/pdf|octet-stream/i.test(item.mime)) {
            resolve({ ok: false, id, error: `Got ${item.mime} instead of a PDF — your eFS session may have expired` });
          } else {
            resolve({ ok: true, id });
          }
        });
      } else if (delta.state.current === 'interrupted') {
        cleanup();
        chrome.downloads.search({ id }, ([item]) => {
          resolve({ ok: false, id, error: item?.error || 'Download interrupted' });
        });
      }
    }

    function cleanup() {
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
    }

    chrome.downloads.onChanged.addListener(onChanged);
  });
}
