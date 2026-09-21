// scripts/fetch-feeds.js  (versi 2 -- pakai YouTube Data API v3 resmi)
//
// Tidak lagi memakai RSS feeds/videos.xml (yang sedang bermasalah di sisi YouTube).
// Sebagai gantinya, script ini memanggil endpoint resmi playlistItems.list untuk
// membaca "uploads playlist" tiap channel -- ini cuma makan 1 unit kuota per channel
// (dibanding search.list yang makan 100 unit), jadi sangat hemat kuota gratis harian.
//
// WAJIB: API key HARUS diisi lewat GitHub Actions secret bernama YOUTUBE_API_KEY,
// JANGAN ditulis langsung di file ini atau di channels.json (supaya tidak bocor ke
// publik, karena repo ini public).

const fs = require("fs");
const path = require("path");

const CHANNELS_PATH = path.join(__dirname, "..", "channels.json");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "videos.json");

const API_KEY = process.env.YOUTUBE_API_KEY;
const MAX_PER_CHANNEL = 4;
const MAX_TOTAL = 80;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Trik standar: playlist "semua upload" suatu channel ID-nya sama persis dengan
// channel ID tsb, HANYA dua huruf pertama "UC" diganti jadi "UU".
function uploadsPlaylistId(channelId) {
  return "UU" + channelId.slice(2);
}

function bestThumbnail(thumbnails, videoId) {
  if (thumbnails) {
    var t = thumbnails.high || thumbnails.medium || thumbnails.default;
    if (t && t.url) return t.url;
  }
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

async function fetchChannel(channel) {
  const playlistId = uploadsPlaylistId(channel.id);
  const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=${MAX_PER_CHANNEL}&key=${API_KEY}`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
      console.warn(`[WARN] ${channel.name}: ${msg}`);
      return [];
    }
    if (!data.items || !data.items.length) {
      console.warn(`[WARN] ${channel.name}: 0 video, cek channel ID / playlist uploads-nya.`);
      return [];
    }

    return data.items.map(item => {
      const s = item.snippet;
      const videoId = s.resourceId && s.resourceId.videoId;
      return {
        team: channel.name,
        title: s.title,
        link: `https://www.youtube.com/watch?v=${videoId}`,
        pubDate: s.publishedAt,
        thumb: bestThumbnail(s.thumbnails, videoId)
      };
    });
  } catch (err) {
    console.warn(`[WARN] ${channel.name}: ${err.message}`);
    return [];
  }
}

async function main() {
  if (!API_KEY) {
    console.error("YOUTUBE_API_KEY tidak ditemukan. Set sebagai GitHub Actions secret bernama persis itu.");
    process.exit(1);
  }

  const allChannels = JSON.parse(fs.readFileSync(CHANNELS_PATH, "utf8"));
  const channels = allChannels.filter(c => c.id && c.id.trim());

  if (!channels.length) {
    console.error("channels.json: belum ada channel ID yang diisi.");
    process.exit(1);
  }

  console.log(`Mengambil upload playlist untuk ${channels.length} channel (via YouTube Data API resmi)...`);

  const results = [];
  for (const channel of channels) {
    results.push(await fetchChannel(channel));
    await sleep(150); // jeda kecil, sopan-sopan saja terhadap API
  }

  let merged = [].concat(...results);
  merged.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  merged = merged.slice(0, MAX_TOTAL);

  const successCount = results.filter(r => r.length > 0).length;
  console.log(`Ringkasan: ${successCount}/${channels.length} channel berhasil, total ${merged.length} video.`);

  if (merged.length === 0) {
    console.error("Semua channel gagal / 0 video. data/videos.json TIDAK ditimpa, data lama tetap dipakai.");
    process.exit(1);
  }

  const output = {
    updatedAt: new Date().toISOString(),
    videos: merged
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`Selesai: ${merged.length} video ditulis ke ${OUTPUT_PATH}`);
}

main();
