// Teapot — one click: find the newest archive.today snapshot of the current
// page and open it in reader mode. No snapshot? Pour a 418.
//
// Mirrors are tried in order; the first one that *answers* wins, even if its
// answer is "nothing archived" — that still counts as the archive working.
//
// Click the icon while already on an archived page and we skip the lookup and
// open that page's archive search results instead.

const MIRRORS = ["archive.ph", "archive.today", "archive.li", "archive.md"];

// Archive mirrors routinely sit behind a bot wall and just hang. Cap every
// request so one stalled mirror can't freeze the whole lookup.
const FETCH_TIMEOUT = 7000;
const HEDGE_DELAY = 1200;      // ms to wait on the top-ranked mirror before fanning out
const STATS_EWMA = 0.5;        // weight of the newest latency sample in the ranking
const FAIL_PENALTY = 20000;    // a failed/walled mirror ranks as if it took this long
const CACHE_TTL_HIT = 30 * 60 * 1000;  // remember a found snapshot for 30 min
const CACHE_TTL_MISS = 5 * 60 * 1000;  // re-check an unarchived page after 5 min

function fetchWithTimeout(url, opts = {}, ms = FETCH_TIMEOUT) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

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
    const res = await fetchWithTimeout(snapshotUrl, { credentials: "omit" });
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

// ── Mirror ranking ───────────────────────────────────────────────────────────
// We learn which mirrors answer fastest and try the best one first, fanning out
// to the rest only if it stalls. The common case is a single request — which
// also keeps us under archive.today's rate wall, the very thing that makes it
// slow once you start spraying it with parallel lookups.

async function loadStats() {
  const { mirrorStats } = await browser.storage.local.get("mirrorStats");
  return mirrorStats || {};
}

// Fold each lookup's latency (ms; failures counted as FAIL_PENALTY) into a
// per-mirror EWMA, so the ranking tracks current conditions, not ancient ones.
async function recordStats(samples) {
  const entries = Object.entries(samples);
  if (!entries.length) return;
  const stats = await loadStats();
  for (const [host, sample] of entries) {
    const prev = stats[host];
    stats[host] = prev == null ? sample : Math.round(STATS_EWMA * sample + (1 - STATS_EWMA) * prev);
  }
  await browser.storage.local.set({ mirrorStats: stats });
}

async function rankedMirrors() {
  const stats = await loadStats();
  // Untried mirrors get a neutral score (plus their config index as a tiebreak),
  // so a fresh install still tries archive.ph first but a known-slow mirror sinks.
  const score = (h) => stats[h] ?? 3000 + MIRRORS.indexOf(h);
  return [...MIRRORS].sort((a, b) => score(a) - score(b));
}

// ── Snapshot cache (memoize) ─────────────────────────────────────────────────
// Repeat clicks on the same page should be instant. Hits live longer than
// misses, since a found snapshot rarely changes but an unarchived page might
// get archived any minute.

async function cacheGet(target) {
  const { snapCache } = await browser.storage.local.get("snapCache");
  const hit = snapCache && snapCache[target];
  if (!hit) return undefined; // never looked up (or evicted) → not cached
  const ttl = hit.url ? CACHE_TTL_HIT : CACHE_TTL_MISS;
  return Date.now() - hit.at > ttl ? undefined : hit.url; // string | null
}

async function cachePut(target, url) {
  const { snapCache } = await browser.storage.local.get("snapCache");
  const cache = snapCache || {};
  cache[target] = { url, at: Date.now() };
  const keys = Object.keys(cache);
  if (keys.length > 200) { // evict oldest so the cache stays bounded
    keys.sort((a, b) => cache[a].at - cache[b].at)
        .slice(0, keys.length - 200)
        .forEach((k) => delete cache[k]);
  }
  await browser.storage.local.set({ snapCache: cache });
}

// ── Lookup ───────────────────────────────────────────────────────────────────

// Hedged TimeMap lookup. Start the best-ranked mirror; if it hasn't returned a
// snapshot within HEDGE_DELAY (or answers empty / fails), fan out to the rest.
// Resolves with the first mirror's mementos (newest first) that actually has a
// snapshot, or null if every mirror that answered came up empty / unreachable.
function hedgedTimemap(hosts, target) {
  const samples = {};
  let launched = 0, settled = 0, fannedOut = false, done = false;
  let resolveOuter, timer;
  const out = new Promise((r) => (resolveOuter = r));

  const finish = (value) => {
    if (done) return;
    done = true;
    fannedOut = true;          // block any pending fan-out
    clearTimeout(timer);
    resolveOuter(value);
  };

  // A mirror reported without a usable hit: make sure we've fanned out, then —
  // once every launched probe has reported — give up with a teapot.
  const settle = () => {
    fanOut();
    if (++settled === launched && fannedOut) finish(null);
  };

  const fanOut = () => {
    if (fannedOut) return;
    fannedOut = true;
    clearTimeout(timer);
    for (let i = 1; i < hosts.length; i++) launch(hosts[i]);
  };

  const launch = (host) => {
    launched++;
    const t0 = Date.now();
    fetchWithTimeout(`https://${host}/timemap/${target}`, { credentials: "omit" })
      .then(async (res) => {
        // ok = has data; 404 = working but empty. Anything else (403/429/5xx,
        // e.g. a bot wall) isn't a trustworthy answer — treat it as a failure.
        if (!(res.ok || res.status === 404)) throw new Error(String(res.status));
        samples[host] = Date.now() - t0;
        return res.ok ? mementos(await res.text().catch(() => "")) : [];
      })
      .then(
        (candidates) => (candidates.length ? finish(candidates) : settle()),
        () => { samples[host] = FAIL_PENALTY; settle(); }
      );
  };

  launch(hosts[0]);
  timer = setTimeout(fanOut, HEDGE_DELAY);

  return out.finally(() => recordStats(samples));
}

// Returns a snapshot URL, or null if the (working) archive simply has none.
async function findSnapshot(target) {
  const cached = await cacheGet(target);
  if (cached !== undefined) return cached; // memoized hit or known teapot

  const candidates = await hedgedTimemap(await rankedMirrors(), target);

  let result = null;
  if (candidates && candidates.length) {
    if (!isFt(target)) {
      result = candidates[0];
    } else {
      // FT serves paywall stubs; walk newest→older, skipping them. Cap the
      // probing so a page with nothing but stubs doesn't become a fetch storm.
      for (const url of candidates.slice(0, 6)) {
        if (!(await isPaywallStub(url))) { result = url; break; }
      }
    }
  }

  await cachePut(target, result);
  return result;
}

function openTeapot(target) {
  const q = target ? "?u=" + encodeURIComponent(target) : "";
  return browser.tabs.create({ url: browser.runtime.getURL("teapot.html") + q });
}

// Steep a URL: open its newest snapshot in reader mode, or pour a 418. Shared by
// the toolbar button (current tab) and the right-click menu (a link's target).
async function steep(target) {
  const prefs = await getPrefs();

  // Already an archived page? Show every snapshot of it instead.
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
}

browser.action.onClicked.addListener((tab) => steep(tab.url || ""));

// Right-click a link → steep its target, not the page you're on. Restricted to
// web links so the item never clutters the menu on mailto:/javascript: anchors.
async function registerMenus() {
  await browser.menus.removeAll(); // idempotent: never collide on a duplicate id
  browser.menus.create({
    id: "steep-link",
    title: "Steep this link  ·  archive + reader",
    contexts: ["link"],
    targetUrlPatterns: ["*://*/*"],
  });
}
browser.runtime.onInstalled.addListener(registerMenus);
browser.runtime.onStartup.addListener(registerMenus);

browser.menus.onClicked.addListener((info) => {
  if (info.menuItemId === "steep-link" && info.linkUrl) steep(info.linkUrl);
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
