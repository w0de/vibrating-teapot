// Teapot — one click: find the newest archive.today snapshot of the current
// page and open it in reader mode. No snapshot? Pour a 418.
//
// Mirrors are tried in order; the first one that *answers* wins, even if its
// answer is "nothing archived" — that still counts as the archive working.
//
// Click the icon while already on an archived page and we skip the lookup and
// open that page's archive search results instead.

const MIRRORS = ["archive.ph", "archive.today", "archive.li", "archive.md"];

// True when url lives on one of the archive mirrors (i.e. it's a snapshot or an
// archive listing page) rather than an ordinary page we'd want to snapshot.
function isArchiveUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return MIRRORS.includes(host);
  } catch (_) {
    return false;
  }
}

// Archive snapshot URLs embed the original page after the mirror host, e.g.
//   https://archive.ph/20230101000000/https://example.com/article
//   https://archive.ph/o/CODE/https://example.com/article
// Pull that original URL back out; null for bare short-code links (archive.ph/ab12).
function originalFromArchive(url) {
  const m = url.match(/^https?:\/\/[^/]+\/(?:.*?\/)?(https?:\/\/.+)$/i);
  return m ? m[1] : null;
}

// The archive.today "all snapshots of this page" results page.
function archiveSearchUrl(url) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  return `https://${host}/${originalFromArchive(url) || url}`;
}

// The FT serves paywalled articles as a stub titled "Subscribe to read"; archive
// snapshots of those are worthless, so we skip them and keep looking.
function isFt(target) {
  try {
    return /(^|\.)ft\.com$/i.test(new URL(target).hostname);
  } catch (_) {
    return false;
  }
}

async function isPaywallStub(snapshotUrl) {
  try {
    const res = await fetch(snapshotUrl, { credentials: "omit" });
    if (!res.ok) return false; // can't tell → don't discard a maybe-good snapshot
    const html = await res.text();
    const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [, ""])[1].trim();
    return /^subscribe to read$/i.test(title);
  } catch (_) {
    return false;
  }
}

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

// All memento URLs from a Memento TimeMap (RFC 7089 link format), newest first.
function mementos(text) {
  const re = /<([^>]+)>\s*;\s*rel="([^"]*memento[^"]*)"(?:\s*;\s*datetime="([^"]+)")?/gi;
  const out = [];
  let m, order = 0;
  while ((m = re.exec(text))) {
    const [, url, rel, dt] = m;
    const t = dt ? Date.parse(dt) : NaN;
    out.push({ url, last: /\blast\b/i.test(rel), time: Number.isNaN(t) ? -Infinity : t, order: order++ });
  }
  // Explicitly "last"-tagged wins; then newest datetime; then document order.
  out.sort((a, b) => (b.last - a.last) || (b.time - a.time) || (a.order - b.order));
  return out.map((x) => x.url);
}

// Returns a snapshot URL, or null if the (working) archive simply has none.
async function findSnapshot(target) {
  const rejectStubs = isFt(target);
  for (const host of MIRRORS) {
    try {
      const res = await fetch(`https://${host}/timemap/${target}`, { credentials: "omit" });
      // ok = has data; 404 = working but empty. Anything else (403/429/5xx,
      // e.g. a bot wall) isn't a trustworthy answer — try the next mirror.
      if (res.ok || res.status === 404) {
        const text = res.ok ? await res.text().catch(() => "") : "";
        const candidates = mementos(text);
        if (!candidates.length) return null;
        if (!rejectStubs) return candidates[0];
        // Walk newest→older, skipping paywall stubs. Cap the probing so a page
        // with nothing but stubs doesn't turn into a fetch storm.
        for (const url of candidates.slice(0, 6)) {
          if (!(await isPaywallStub(url))) return url;
        }
        return null; // every recent snapshot is just the paywall → teapot
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

  // Already looking at an archived page? Show every snapshot of it instead.
  if (isArchiveUrl(target)) {
    browser.tabs.create({ url: archiveSearchUrl(target), active: true });
    return;
  }

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

// Firefox flags a tab reader-able (isArticle) a moment after it finishes
// detecting the article, and toggleReaderMode rejects if called a hair too
// early. Keep nudging until it takes — but only while the job is still pending,
// so the safety-net timeout (or tab close) can call it off.
function enterReader(tabId, attempt = 0) {
  browser.tabs.toggleReaderMode(tabId).then(
    () => pending.delete(tabId),
    () => {
      if (attempt < 6 && pending.has(tabId)) {
        setTimeout(() => enterReader(tabId, attempt + 1), 400);
      }
    }
  );
}

browser.tabs.onUpdated.addListener(
  (tabId, changeInfo, tab) => {
    const job = pending.get(tabId);
    if (!job) return;

    if (job.reader) {
      const readerable = changeInfo.isArticle === true ||
        (changeInfo.status === "complete" && tab.isArticle);
      if (readerable && !job.entering) {
        job.entering = true; // don't start a second retry loop on later events
        enterReader(tabId);
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
