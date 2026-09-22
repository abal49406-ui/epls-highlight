// scripts/fetch-feeds.js  (versi 3 -- YouTube Data API v3 + filter Shorts berdasarkan durasi)
//
// Alur:
// 1. Ambil daftar video terbaru tiap channel lewat "uploads playlist" (playlistItems.list,
//    1 unit kuota per channel).
// 2. Kumpulkan semua video ID kandidat, cek durasinya sekaligus lewat videos.list
//    (1 unit per batch, maks 50 ID per panggilan -- sangat hemat kuota).
// 3. Buang video yang durasinya < MIN_DURATION_SECONDS (dianggap Shorts).
// 4. Ambil MAX_PER_CHANNEL video "panjang" teratas per channel, gabung, urutkan, simpan.
//
// WAJIB: API key HARUS diisi lewat GitHub Actions secret bernama YOUTUBE_API_KEY,
// JANGAN ditulis langsung di file ini atau di channels.json (repo ini public).

const fs = require("fs");
const path = require("path");

const CHANNELS_PATH = path.join(__dirname, "..", "channels.json");
const OUTPUT_PATH = path.join(__dirname, "..", "data", "videos.json");

const API_KEY = process.env.YOUTUBE_API_KEY;

const MAX_PER_CHANNEL = 4;        // video "panjang" final yang ditampilkan per channel
const RAW_FETCH_PER_CHANNEL = 12; // ambil lebih banyak dulu dari playlist, karena sebagian akan gugur (Shorts)
const MAX_TOTAL = 80;

// Video dengan durasi KURANG DARI ini (dalam detik) dianggap Shorts dan disingkirkan.
// 120 = 2 menit. Tepat 120 detik masih dianggap video panjang (lolos, tidak dibuang).
const MIN_DURATION_SECONDS = 120;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Trik standar: playlist "semua upload" suatu channel ID-nya sama persis dengan
// channel ID tsb, HANYA dua huruf pertama "UC" diganti jadi "UU".
function uploadsPlaylistId(channelId) {
  return "UU" + channelId.slice(2);
}

function decodeEntities(str) {
  if (!str) return str;
  return str
    .replace(/&#(\d+);/g, function(_, dec) { return String.fromCharCode(parseInt(dec, 10)); })
    .replace(/&#x([0-9a-fA-F]+);/g, function(_, hex) { return String.fromCharCode(parseInt(hex, 16)); })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function bestThumbnail(thumbnails, videoId) {
  if (thumbnails) {
    var t = thumbnails.high || thumbnails.medium || thumbnails.default;
    if (t && t.url) return t.url;
  }
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

// Parse durasi format ISO 8601 dari YouTube (contoh: "PT4M13S", "PT45S", "PT1H2M3S")
// jadi total detik.
function parseIsoDuration(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || "");
  if (!m) return null;
  const h = parseInt(m[1] || 0, 10);
  const mm = parseInt(m[2] || 0, 10);
  const s = parseInt(m[3] || 0, 10);
  return h * 3600 + mm * 60 + s;
}

// Ambil video "mentah" (belum difilter Shorts) dari uploads playlist satu channel.
async function fetchChannelRaw(channel) {
  const playlistId = uploadsPlaylistId(channel.id);
  const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=${RAW_FETCH_PER_CHANNEL}&key=${API_KEY}`;

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
        videoId,
        team: channel.name,
        title: decodeEntities(s.title),
        link: `https://www.youtube.com/watch?v=${videoId}`,
        pubDate: s.publishedAt,
        thumb: bestThumbnail(s.thumbnails, videoId)
      };
    }).filter(v => v.videoId);
  } catch (err) {
    console.warn(`[WARN] ${channel.name}: ${err.message}`);
    return [];
  }
}

// Ambil durasi banyak video sekaligus (maks 50 ID per panggilan = 1 unit kuota).
async function fetchDurations(videoIds) {
  const map = {};
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${chunk.join(",")}&key=${API_KEY}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        console.warn(`[WARN] Gagal ambil durasi batch: ${(data.error && data.error.message) || res.status}`);
        continue;
      }
      (data.items || []).forEach(item => {
        map[item.id] = parseIsoDuration(item.contentDetails && item.contentDetails.duration);
      });
    } catch (err) {
      console.warn(`[WARN] Gagal ambil durasi batch: ${err.message}`);
    }
  }
  return map;
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

  console.log(`Mengambil upload playlist untuk ${channels.length} channel...`);
  const rawResults = [];
  for (const channel of channels) {
    rawResults.push(await fetchChannelRaw(channel));
    await sleep(150);
  }
  const candidates = [].concat(...rawResults);

  console.log(`Mengecek durasi ${candidates.length} video kandidat (untuk menyaring Shorts)...`);
  const durationMap = await fetchDurations(candidates.map(v => v.videoId));

  const longFormOnly = candidates.filter(v => {
    const dur = durationMap[v.videoId];
    if (dur == null) return true; // gagal ambil durasi -> tetap ditampilkan (fail-open), drpd video hilang
    return dur >= MIN_DURATION_SECONDS;
  });

  const shortsExcluded = candidates.length - longFormOnly.length;
  console.log(`${shortsExcluded} video Shorts (< ${MIN_DURATION_SECONDS} detik) disingkirkan.`);

  // Ambil maksimal MAX_PER_CHANNEL video terbaru (yang sudah lolos filter) per channel.
  // Playlist "uploads" YouTube sudah terurut dari yang terbaru, jadi urutan asli tetap dijaga.
  const perTeamCount = {};
  const finalPicks = longFormOnly.filter(v => {
    perTeamCount[v.team] = (perTeamCount[v.team] || 0) + 1;
    return perTeamCount[v.team] <= MAX_PER_CHANNEL;
  });

  let merged = finalPicks.map(({ videoId, ...rest }) => rest); // videoId cuma dipakai internal, tidak perlu ikut ke output
  merged.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  merged = merged.slice(0, MAX_TOTAL);

  const successCount = rawResults.filter(r => r.length > 0).length;
  console.log(`Ringkasan: ${successCount}/${channels.length} channel berhasil, total ${merged.length} video (setelah filter Shorts).`);

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
