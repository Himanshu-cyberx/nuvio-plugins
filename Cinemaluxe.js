const cheerio = require("cheerio-without-node-native");

function getStreams(tmdbId, type, season, episode) {
  const url = "https://cinemalux.zip";

  return fetch(url)
    .then(res => res.text())
    .then(html => {
      const $ = cheerio.load(html);
      const firstLink = $("article.item a").first().attr("href");

      if (!firstLink) return [];

      return fetch(firstLink)
        .then(res2 => res2.text())
        .then(html2 => {
          const match = html2.match(/"link":"([^"]+)"/);
          if (!match) return [];

          const encoded = match[1].replace(/\\\//g, "/");
          const decoded = atob(encoded);

          return [
            {
              name: "Cinemaluxe",
              title: "Cinemaluxe Stream",
              url: decoded,
              quality: "HD",
              type: "mp4",
              behaviorHints: {
                bingeGroup: "cinemaluxe"
              }
            }
          ];
        });
    })
    .catch(() => []);
}

module.exports = { getStreams };
