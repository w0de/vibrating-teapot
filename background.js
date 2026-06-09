// Teapot — one click: find the newest archive.today snapshot of the current
// page and open it in reader mode. No snapshot? Pour a 418.
//
// Mirrors are tried in order; the first one that *answers* wins, even if its
// answer is "nothing archived" — that still counts as the archive working.

const MIRRORS = ["archive.ph", "archive.today", "archive.li", "archive.md"];

// Universal, tasteful dark mode for the archived page when reader mode is off.
// (When reader mode is on, Firefox's own reader theme handles dark.)
const DARK_CSS = `
  :root { background: #0e0e0e !important; }
  html { filter: invert(0.92) hue-rotate(180deg) !important; background: #0e0e0e !important; }
  img, picture, video, canvas, svg, iframe, embed, object,
  [style*="url("] { filter: invert(1) hue-rotate(180deg) !important; }
`;

// tabId -> { reader, dark } for snapshot tabs awaiting post-load treatment.
const pending = new Map();

async function getPrefs() {
  const p = await browser.storage.local.get(["readerMode", "darkMode"]);
  return { reader: p.readerMode !== false, dark: p.darkMode !== false };
}

// Pull the newest memento URL out of a Memento TimeMap (RFC 7089 link format).
function newestMemento(text) {
  const re = /<([^>]+)>\s*;\s*rel="([^"]*memento[^"]*)"(?:\s*;\s*datetime="([^"]+)")?/gi;
  let best = null, bestTime = -Infinity, m;
  while ((m = re.exec(text))) {
    const [, url, rel, dt] = m;
    if (/\blast\b/i.test(rel)) return url; // explicitly tagged newest
    const t = dt ? Date.parse(dt) : NaN;
    if (!Number.isNaN(t) && t > bestTime) { bestTime = t; best = url; }
    else if (best === null) best = url;
  }
  return best;
}

// Returns a snapshot URL, or null if the (working) archive simply has none.
async function findSnapshot(target) {
  for (const host of MIRRORS) {
    try {
      const res = await fetch(`https://${host}/timemap/${target}`, { credentials: "omit" });
      // ok = has data; 404 = working but empty. Anything else (403/429/5xx,
      // e.g. a bot wall) isn't a trustworthy answer — try the next mirror.
      if (res.ok || res.status === 404) {
        const text = res.ok ? await res.text().catch(() => "") : "";
        return newestMemento(text) || null;
      }
    } catch (_) {
      // Network failure — this mirror is down, fall through to the next.
    }
  }
  return null; // nobody answered → teapot
}

function openTeapot(target) {
  const q = target ? "?u=" + encodeURIComponent(target) : "";
  return browser.tabs.create({ url: browser.runtime.getURL("teapot.html") + q });
}

browser.action.onClicked.addListener(async (tab) => {
  const prefs = await getPrefs();
  const target = tab.url || "";

  const snapshot = /^https?:\/\//i.test(target) ? await findSnapshot(target) : null;
  if (!snapshot) { openTeapot(target); return; }

  const opened = await browser.tabs.create({ url: snapshot, active: true });
  pending.set(opened.id, prefs);

  // Safety net: if the page never becomes reader-able, still honour dark mode.
  setTimeout(() => {
    const job = pending.get(opened.id);
    if (!job) return;
    pending.delete(opened.id);
    if (job.dark) {
      browser.scripting.insertCSS({ target: { tabId: opened.id }, css: DARK_CSS }).catch(() => {});
    }
  }, 6000);
});

browser.tabs.onUpdated.addListener(
  (tabId, changeInfo, tab) => {
    const job = pending.get(tabId);
    if (!job) return;

    if (job.reader) {
      const readerable = changeInfo.isArticle === true ||
        (changeInfo.status === "complete" && tab.isArticle);
      if (readerable) {
        pending.delete(tabId);
        browser.tabs.toggleReaderMode(tabId).catch(() => {});
      }
    } else if (changeInfo.status === "complete") {
      pending.delete(tabId);
      if (job.dark) {
        browser.scripting.insertCSS({ target: { tabId }, css: DARK_CSS }).catch(() => {});
      }
    }
  },
  { properties: ["isArticle", "status"] }
);

browser.tabs.onRemoved.addListener((tabId) => pending.delete(tabId));
