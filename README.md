# eFS Bulk Downloader

[![Buy me a coffee](https://img.shields.io/badge/☕-Buy%20me%20a%20coffee-ffdd00)](https://buymeacoffee.com/rachelcjw)

A free Chrome extension that bulk-downloads documents from the Malaysian Courts **e-Filing System (eFS)**, so you don't have to open and save each file one by one.

It works in two places:

- **Case page:** download every document in a case's file in one go, renamed by enclosure number (`001_Writ Saman.pdf`, `002_Pernyataan Tuntutan.pdf` …).
- **Inbox ("Sedia untuk Diekstrak" / "Peti Masuk"):** scan your extraction notices for a date range, then download the documents into a folder per case, with an optional CSV index of serial numbers and extraction codes.

> **Unofficial tool.** This extension is not made, endorsed or supported by the Federal Court of Malaysia, Pejabat Ketua Pendaftar Mahkamah Persekutuan (PKPMP) or the e-Kehakiman team. Use it at your own risk and in line with eFS's terms of use.

---

## Features

| | Case page | Inbox |
|---|---|---|
| Download all documents in one click | ✅ | ✅ |
| Pick which documents to download | ✅ | ✅ |
| Rename files consistently | `001_<Document type>.pdf` | `<YYYY-MM-DD> <Document name>.pdf` |
| Folder per case | ✅ (`<Plaintiff> v <Defendant>`) | ✅ (`<Case no.>`) |
| Skip files already downloaded | ✅ | ✅ |
| Filter by date range / case no. | — | ✅ |
| Export CSV index (incl. extraction codes) | — | ✅ |

Everything runs inside your own browser, through your own logged-in eFS session. The extension only sees what your account can already see, and **no data is sent anywhere else**: no servers, no analytics, no tracking.

---

## Install

The extension isn't on the Chrome Web Store, so you install it manually. It takes about a minute.

1. **Download** this repository: click the green **Code** button → **Download ZIP** (or grab the latest ZIP from [Releases](../../releases)).
2. **Unzip** it somewhere permanent, e.g. `Documents\efs-bulk-downloader`. Don't delete the folder afterwards, because Chrome loads the extension from it.
3. In Chrome, go to **`chrome://extensions`**.
4. Turn on **Developer mode** (toggle, top right).
5. Click **Load unpacked** and select the unzipped folder (the one containing `manifest.json`).
6. Optional: pin the extension from the puzzle-piece menu. Clicking its icon opens the eFS "Sedia untuk Diekstrak" inbox.

Also works in Microsoft Edge (`edge://extensions`) and other Chromium browsers.

**Updating:** download the new version, replace the folder's contents, then click the ↻ reload icon on the extension's card in `chrome://extensions`.

---

## How to use

### Download a whole case file

1. Log in to eFS and open a case.
2. Click the green **⬇ Download all case files** button (bottom right).
3. Untick anything you don't need, then click **Download selected**.

Files are saved to your Downloads folder:

```
Downloads/eFS/<Plaintiff> v <Defendant>/001_Writ Saman.pdf
Downloads/eFS/<Plaintiff> v <Defendant>/002_Pernyataan Tuntutan.pdf
Downloads/eFS/<Plaintiff> v <Defendant>/003_Notis Pengurusan Kes Secara e-Review.pdf
```

The number is the enclosure number padded to 3 digits, and the name is the document category, not the original upload file name.

⏱ **The page reloads once per document** while this runs (about 3–4 seconds each). eFS only releases a document after its row is clicked, so the extension clicks them for you one at a time. Leave the tab alone until the panel says **Done**. If it's interrupted, reopen the case and click Download again; files already saved are skipped.

### Download from the inbox

1. Open **Sedia untuk Diekstrak** (or **Peti Masuk**).
2. Click **⬇ eFS Bulk Download** (bottom right).
3. Set a date range (default: last 30 days) and, optionally, a case number.
4. Click **1. Scan inbox**. The extension opens each notice in range and lists its documents, grouped by case.
5. Tick what you want, then click **2. Download selected**.
6. Optional: click **Export CSV** for an index of date, case no., document, serial no. and extraction code.

```
Downloads/eFS/<Case no.>/<YYYY-MM-DD> <Document name>.pdf
```

Case numbers use `-` instead of `/`, because Windows doesn't allow `/` in folder names.

---

## Good to know

- **Scanning the inbox marks messages as read**, the same as clicking them yourself.
- **Scanned messages are cached**, so re-scanning the same range is near-instant.
- **"Skip already downloaded"** remembers what you've saved across sessions. **"Reset history"** clears it.
- **Be gentle on the court's server.** Keep the inbox delay at 1,000 ms or more. The case-page download has a built-in pause between files.
- **If eFS logs you out** mid-run, downloads stop with a "session may have expired" message. Log in again and rerun.
- The inbox scan assumes eFS's default newest-first order and stops at the first message older than your From date.
- **If eFS changes its page layout, the extension may stop working** until it's updated. Please [open an issue](../../issues) if that happens.

---

## Privacy

- Permissions used: `downloads` (to save files), `storage` (to remember what's been downloaded), and access to `efs.kehakiman.gov.my` only.
- Download history and the scan cache are stored locally in your browser (`chrome.storage.local`) and never leave your machine.
- The extension does not read, store or transmit your eFS username or password.

---

## Project structure

```
manifest.json   Extension manifest (Manifest V3)
background.js   Saves files via chrome.downloads, one at a time, and checks each is a PDF
content.js      Inbox page: scan notices, list documents, download, CSV export
case.js         Case page: click through the document list and download each file
icons/          Extension icons
```

## Contributing

Issues and pull requests are welcome, especially if eFS changes its layout or you find a page the extension should support.

## Disclaimer

This software is provided "as is", without warranty of any kind. It is an independent tool and is not affiliated with the Malaysian judiciary. You are responsible for how you use it and for complying with eFS's terms of use and your professional obligations, including client confidentiality.
