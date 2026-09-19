// scripts/fetch-feeds.js
// Dijalankan oleh GitHub Actions (Node 18+, sudah ada global fetch, tanpa dependency npm).
// Mengambil feed Atom YouTube LANGSUNG dari youtube.com (server-to-server, tidak kena
// batasan CORS seperti kalau dipanggil dari browser), lalu menggabung & mengurutkannya,
// dan menyimpan hasilnya ke data/videos.json.

const fs = require("fs");
const path = require("path");

const CHANNELS_PATH = path.join(__dirname, "..", "channels.json");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "videos.json");

const MAX_PER_CHANNEL = 4;   // samakan dengan yang dulu kamu pakai di widget
const MAX_TOTAL = 80;

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseAtomFeed(xml, channelName) {
  const entries = [];
  const blocks = xml.split("<entry>").slice(1);
  for (const block of blocks) {
    const videoIdMatch = /<yt:videoId>(.*?)<\/yt:videoId>/.exec(block);
    const titleMatch = /<title>(.*?)<\/title>/.exec(block);
    const publishedMatch = /<published>(.*?)<\/published>/.exec(block);
    if (!videoIdMatch || !titleMatch || !publishedMatch) continue;

    const videoId = videoIdMatch[1].trim();
    entries.push({
      team: channelName,
      title: decodeEntities(titleMatch[1].trim()),
      link: `https://www.youtube.com/watch?v=${videoId}`,
      pubDate: publishedMatch[1].trim(),
      thumb: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    });
  }
  return entries.slice(0, MAX_PER_CHANNEL);
}

async function fetchChannel(channel) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channel.id)}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; EPLFeedBot/1.0)" } });
    if (!res.ok) {
      console.warn(`[WARN] ${channel.name} (${channel.id}): HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const parsed = parseAtomFeed(xml, channel.name);
    if (!parsed.length) console.warn(`[WARN] ${channel.name}: 0 video terparsing, cek channel ID.`);
    return parsed;
  } catch (err) {
    console.warn(`[WARN] ${channel.name}: ${err.message}`);
    return [];
  }
}

async function main() {
  const allChannels = JSON.parse(fs.readFileSync(CHANNELS_PATH, "utf8"));
  const channels = allChannels.filter(c => c.id && c.id.trim());

  if (!channels.length) {
    console.error("channels.json: belum ada channel ID yang diisi. Isi dulu field \"id\" tiap klub.");
    process.exit(1);
  }

  console.log(`Mengambil feed untuk ${channels.length} channel...`);
  const results = await Promise.all(channels.map(fetchChannel));

  let merged = [].concat(...results);
  merged.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  merged = merged.slice(0, MAX_TOTAL);

  const output = {
    updatedAt: new Date().toISOString(),
    videos: merged
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Selesai: ${merged.length} video ditulis ke ${OUTPUT_PATH}`);
}

main();
