// provider.js
// Converted from the Kotlin CloudStream provider you provided.
// Dependencies: node-fetch, cheerio
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { URL } = require('url');

let MAIN_URL = 'https://cinemalux.zip'; // default, overwritten if remote config provides
const URLS_JSON = 'https://raw.githubusercontent.com/SaurabhKaperwan/Utils/refs/heads/main/urls.json';

async function fetchText(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return await res.text();
}

async function fetchDocument(url, opts = {}) {
  const txt = await fetchText(url, opts);
  return cheerio.load(txt);
}

async function initMainUrl() {
  try {
    const text = await fetchText(URLS_JSON);
    const json = JSON.parse(text || '{}');
    const u = json.cinemaluxe;
    if (u && u.length) MAIN_URL = u;
  } catch (e) {
    // keep default MAIN_URL
  }
}
// initialize once (non-blocking)
initMainUrl();

/* --------------------------
   Helper: makePostRequest (mimics Kotlin makePostRequest)
   Expects jsonString representing Item { token, id, time, post, redirect, cacha, new, link }
   Posts to url and returns Location header (or empty string)
--------------------------- */
async function makePostRequest(jsonString, url, action) {
  let item;
  try {
    item = JSON.parse(jsonString);
  } catch (e) {
    // If the jsonString has trailing semicolon or var, try to sanitize
    const cleaned = jsonString.replace(/^\s*var\s+\w+\s*=\s*/, '').replace(/;$/, '');
    item = JSON.parse(cleaned);
  }
  const params = new URLSearchParams();
  params.append('token', item.token || '');
  params.append('id', item.id != null ? String(item.id) : '');
  params.append('time', item.time != null ? String(item.time) : '');
  params.append('post', item.post || '');
  params.append('redirect', item.redirect || '');
  params.append('cacha', item.cacha || '');
  params.append('new', item.new ? 'true' : 'false');
  params.append('link', item.link || '');
  params.append('action', action || '');

  // POST form-encoded, but want to capture Location header (the Kotlin code used allowRedirects=false)
  const res = await fetch(url, {
    method: 'POST',
    body: params.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    redirect: 'manual'
  });
  const loc = res.headers.get('location') || '';
  return loc;
}

/* --------------------------
   bypass(url)
   Attempts to follow the same bypass logic as Kotlin:
   - try extract base64 link from link":"(...)
   - else find soralink_ajaxurl and var item = {...} and soralink_z action token -> POST
   - else return original url
--------------------------- */
async function bypass(url) {
  try {
    const text = await fetchText(url);
    // 1) link":"([^"]+)
    const m = /link":"([^"]+)"/.exec(text);
    if (m && m[1]) {
      const enc = m[1].replace(/\\\//g, '/');
      try {
        const decoded = Buffer.from(enc, 'base64').toString('utf8');
        if (decoded) return decoded;
      } catch (e) {
        // fallback
      }
    }

    // 2) Check for soralink_ajaxurl, var item = ({...}), and soralink_z
    const postUrlMatch = /"soralink_ajaxurl":"([^"]+)"/.exec(text);
    const jsonDataMatch = /var\s+item\s*=\s*(\{.*?\});/s.exec(text);
    const soraLinkMatch = /"soralink_z"\s*:\s*"([^"]+)"/.exec(text);

    if (postUrlMatch && jsonDataMatch && soraLinkMatch) {
      const postUrl = postUrlMatch[1].replace(/\\\//g, '/');
      const jsonData = jsonDataMatch[1];
      const action = soraLinkMatch[1];
      // The Kotlin code passed jsonData (object) to makePostRequest which posted token,id,... and received Location header
      try {
        const location = await makePostRequest(jsonData, postUrl, action);
        return location || url;
      } catch (e) {
        return url;
      }
    }

    return url;
  } catch (e) {
    return url;
  }
}

/* --------------------------
   toSearchResult: map a result element to search response
   Kotlin used: title <- img.alt, href <- a.href, poster <- img.data-src
--------------------------- */
function elementToSearchResult(el, $) {
  const img = $(el).find('img');
  const title = img.attr('alt') || $(el).find('.title').text().trim();
  const href = $(el).find('a').attr('href') || '';
  const poster = img.attr('data-src') || img.attr('src') || null;
  if (!title || !href) return null;
  return {
    id: new URL(href, MAIN_URL).toString(),
    title: title.trim(),
    poster,
    type: 'movie' // Kotlin used newMovieSearchResponse with TvType.Movie; search may include series too - adjust if needed
  };
}

/* --------------------------
   search(query, page)
   GET ${MAIN_URL}/page/${page}/?s=${query}
   select 'div.result-item'.mapNotNull { toSearchResult() }
--------------------------- */
async function search(query, page = 1) {
  const url = `${MAIN_URL}/page/${page}/?s=${encodeURIComponent(query)}`;
  const $ = await fetchDocument(url);
  const results = [];
  $('div.result-item').each((i, el) => {
    const r = elementToSearchResult(el, $);
    if (r) results.push(r);
  });
  const hasNext = results.length > 0;
  return { results, hasNext };
}

/* --------------------------
   getMainPage: mimic the Kotlin mainPageOf mapping for categories
   We'll provide a small helper to fetch a category page and return items (article.item -> toSearchResult)
--------------------------- */
async function getMainPage(categoryPath, page = 1) {
  const url = `${MAIN_URL}/${categoryPath}${page}`;
  const $ = await fetchDocument(url);
  const home = [];
  $('article.item').each((i, el) => {
    const title = $(el).find('img').attr('alt') || $(el).find('.title').text().trim();
    const href = $(el).find('a').attr('href') || '';
    const poster = $(el).find('img').attr('data-src') || $(el).find('img').attr('src') || null;
    if (title && href) {
      home.push({
        id: new URL(href, MAIN_URL).toString(),
        title: title.trim(),
        poster
      });
    }
  });
  return { name: categoryPath, items: home };
}

/* --------------------------
   load(url) - loads details and returns metadata and list of EpisodeLink-like objects
   Mirrors Kotlin load() behavior
--------------------------- */
async function load(url) {
  const $ = await fetchDocument(url);
  const title = $('div.data > h1').text().trim() || $('title').text().trim();
  const poster = $('div.poster > img').attr('data-src') || $('div.poster > img').attr('src') || null;
  const description = $('div.wp-content > p').text().trim() || '';

  const isSeries = url.includes('series');

  if (isSeries) {
    // collect episodes per season
    const aTags = $('div.wp-content div.ep-button-container > a').toArray();
    const episodesMap = new Map(); // key: "season|episode" => [sourceUrls]

    // For each season link (aTag), bypass it and fetch inner episode links
    await Promise.all(
      aTags.map(async (aTag) => {
        try {
          const seasonText = $(aTag).text();
          const realSeasonMatch = /(?:Season |S)(\d+)/i.exec(seasonText);
          const realSeason = realSeasonMatch ? parseInt(realSeasonMatch[1], 10) : 0;
          const seasonHref = $(aTag).attr('href') || '';
          const seasonLink = await bypass(seasonHref);
          const $$ = await fetchDocument(seasonLink);
          // innerATags = doc.select("div.ep-button-container > a:matches((?i)(Episode))")
          const innerATags = $$('#div.ep-button-container > a, div.ep-button-container > a').toArray()
            .filter(el => {
              const t = $$(el).text();
              return /episode/i.test(t);
            });

          for (const innerATag of innerATags) {
            const epText = $$(innerATag).text();
            const epNumMatch = /(?:episode\s*[-]?\s*)(\d{1,3})/i.exec(epText);
            const epNumber = epNumMatch ? parseInt(epNumMatch[1], 10) : 0;
            const epUrl = $$(innerATag).attr('href') || '';
            const key = `${realSeason}|${epNumber}`;
            const arr = episodesMap.get(key) || [];
            arr.push(epUrl);
            episodesMap.set(key, arr);
          }
        } catch (e) {
          // ignore individual season errors
        }
      })
    );

    // Build episode objects (mirrors newEpisode(newEpisodeLink...))
    const episodes = [];
    for (const [key, sources] of episodesMap.entries()) {
      const [seasonStr, episodeStr] = key.split('|');
      const season = parseInt(seasonStr, 10) || 0;
      const episode = parseInt(episodeStr, 10) || 0;
      // map sources to an array of objects { source: url }
      const data = sources.map(s => ({ source: s }));
      episodes.push({
        season,
        episode,
        sources: data
      });
    }

    return {
      id: url,
      title,
      poster,
      description,
      type: 'series',
      episodes
    };
  } else {
    // movie: collect buttons and bypass each to get final link
    const buttons = $('div.wp-content div.ep-button-container > a').toArray();
    const data = await Promise.all(
      buttons.map(async (btn) => {
        const href = $(btn).attr('href') || '';
        const link = await bypass(href);
        return { source: link };
      })
    );

    return {
      id: url,
      title,
      poster,
      description,
      type: 'movie',
      sources: data
    };
  }
}

/* --------------------------
   resolveStreams(id)
   When given an id which is either:
     - a movie page (from load) or
     - a direct source URL (mp4/m3u8) or an episode-source page
   We'll:
     - if id looks like a direct stream (contains .m3u8 or .mp4) -> return it
     - else fetch page, look for video sources, iframes, or try bypass on links and return resolved list
--------------------------- */
async function resolveStreams(id) {
  // quick direct link
  if (/\.m3u8($|\?)/i.test(id) || /\.mp4($|\?)/i.test(id)) {
    return [{ url: id, quality: 'auto', isM3U8: /\.m3u8/i.test(id) }];
  }
  try {
    const $ = await fetchDocument(id);
    const streams = [];

    // 1) <video><source>
    $('video source').each((i, s) => {
      const src = $(s).attr('src');
      const label = $(s).attr('label') || $(s).attr('data-res') || '';
      if (src) {
        streams.push({ url: new URL(src, MAIN_URL).toString(), quality: label || 'auto', isM3U8: /\.m3u8/i.test(src) });
      }
    });

    // 2) iframes
    $('iframe').each((i, f) => {
      const src = $(f).attr('src');
      if (!src) return;
      const full = new URL(src, MAIN_URL).toString();
      if (/\.m3u8/i.test(full)) {
        streams.push({ url: full, quality: 'auto', isM3U8: true });
      } else {
        // attempt bypass (some iframe hosts redirect)
        streams.push({ url: full, quality: 'auto', isM3U8: /\.m3u8/i.test(full) });
      }
    });

    // 3) data-src in .player (base64 encoded content)
    const dataSrc = $('.player').attr('data-src') || '';
    if (dataSrc) {
      try {
        const decoded = Buffer.from(dataSrc, 'base64').toString('utf8');
        const matches = decoded.match(/https?:\/\/[^'"\s]+(?:m3u8|mp4)/g) || [];
        for (const u of matches) streams.push({ url: u, quality: 'auto', isM3U8: /\.m3u8/i.test(u) });
      } catch (e) {
        // ignore
      }
    }

    // 4) fallback: search anchor links in page that look like hosters and try bypassing them
    $('a').each((i, a) => {
      const href = $(a).attr('href') || '';
      if (/player|watch|embed|link/i.test(href) || /\.php\?id=/.test(href)) {
        streams.push({ url: new URL(href, MAIN_URL).toString(), quality: 'auto', isM3U8: /\.m3u8/i.test(href) });
      }
    });

    // dedupe and normalize
    const seen = new Set();
    const out = [];
    for (const s of streams) {
      if (!s.url) continue;
      const urlStr = s.url.toString();
      if (seen.has(urlStr)) continue;
      seen.add(urlStr);
      out.push(s);
    }

    return out;
  } catch (e) {
    // fallback: return provided id as-is
    return [{ url: id, quality: 'auto', isM3U8: /\.m3u8/i.test(id) }];
  }
}

/* --------------------------
   Exported handlers (shape: search, meta/load, stream)
   Nuvio loader may expect slightly different names; adjust as required.
--------------------------- */
module.exports = {
  manifest: {
    id: 'cinemaluxe',
    name: 'CinemaLuxe (converted)',
    version: '1.0.0'
  },

  // returns { results: [...], hasNext: true/false }
  search: async (args) => {
    const q = args.query || args.q || '';
    const p = args.page || args.p || 1;
    if (!q) return { results: [], hasNext: false };
    return await search(q, p);
  },

  // load metadata and sources/episodes. Returns the same shape as load()
  meta: async (args) => {
    const id = args.id || args.url;
    if (!id) throw new Error('meta requires id/url');
    return await load(id);
  },

  // resolve playable streams for an id/source
  stream: async (args) => {
    const id = args.id || args.url;
    if (!id) throw new Error('stream requires id/url');
    return await resolveStreams(id);
  },

  // helpers for Nuvio UI if needed
  getMainPage: async (args) => {
    const category = args.categoryPath || 'page/';
    const page = args.page || 1;
    return await getMainPage(category, page);
  },

  // expose bypass for testing/debug
  _bypass: bypass
};
