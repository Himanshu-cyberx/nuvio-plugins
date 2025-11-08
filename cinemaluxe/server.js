const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const manifest = require('./manifest.json');
const provider = require('./provider');

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  let results = [];

  if (extra.search) {
    let searchQuery = extra.search;
    if (searchQuery.startsWith('tt')) {
        searchQuery = await provider.getTitleFromImdbId(searchQuery);
    }
    const searchResults = await provider.search(searchQuery);
    results = searchResults.results;
  } else {
    if (type === 'movie' && id === 'cinemaluxe-movies') {
      const mainPage = await provider.getMainPage('movies/');
      results = mainPage.items;
    }
    if (type === 'series' && id === 'cinemaluxe-series') {
      const mainPage = await provider.getMainPage('series/');
      results = mainPage.items;
    }
  }

  return { metas: results };
});

builder.defineMetaHandler(async ({ type, id }) => {
  const meta = await provider.meta(id);
  return { meta };
});

builder.defineStreamHandler(async ({ type, id }) => {
  const streams = await provider.stream(id);
  return { streams };
});

const PORT = process.env.PORT || 7000;

serveHTTP(builder.getInterface(), { port: PORT });

console.log(`Addon listening on http://localhost:${PORT}`);
