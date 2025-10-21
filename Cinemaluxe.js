module.exports = {
  name: "Cinemaluxe",
  site: "https://cinemalux.zip",

  getList: async function () {
    const res = await fetch("https://cinemalux.zip/page/1");
    const html = await res.text();
    const $ = require("cheerio-without-node-native").load(html);

    const items = [];
    $("article.item").each((i, el) => {
      const title = $(el).find("img").attr("alt");
      const link = $(el).find("a").attr("href");
      const poster = $(el).find("img").attr("data-src");
      items.push({ title, link, poster });
    });

    return items;
  },

  search: async function (query) {
    const res = await fetch(`https://cinemalux.zip/?s=${encodeURIComponent(query)}`);
    const html = await res.text();
    const $ = require("cheerio-without-node-native").load(html);

    const results = [];
    $("div.result-item").each((i, el) => {
      const title = $(el).find(".title").text();
      const link = $(el).find("a").attr("href");
      const poster = $(el).find("img").attr("src");
      results.push({ title, link, poster });
    });

    return results;
  },

  getStreams: async function (url) {
    const res = await fetch(url);
    const html = await res.text();

    const match = html.match(/"link":"([^"]+)"/);
    if (!match) return [];

    const encoded = match[1].replace(/\\\//g, "/");
    const decoded = atob(encoded);

    return [
      {
        url: decoded,
        name: "Cinemaluxe Stream",
        type: "mp4",
      },
    ];
  },
};
