# EPL YouTube Static Feed

Repo kecil ini menjalankan GitHub Actions terjadwal yang mengambil feed YouTube
20 channel klub EPL langsung dari YouTube (server-to-server, bukan lewat proxy
pihak ketiga), menggabungnya, lalu menyimpan hasilnya sebagai `data/videos.json`.

Widget di Blogger cukup membaca file JSON statis ini — tidak ada lagi rate limit
proxy, tidak ada lagi API key yang bisa habis.

## Setup

1. Buat repository baru di GitHub (harus **public**, supaya bisa diakses gratis
   lewat jsDelivr CDN).
2. Upload semua isi folder ini ke repo tsb (lewat web UI "Add file > Upload files",
   atau `git push` kalau familiar dengan git).
3. Buka `channels.json`, isi field `"id"` tiap klub dengan Channel ID YouTube
   resmi (cara mencarinya sama seperti sebelumnya — lihat instruksi di widget
   Blogger kamu, atau pakai commentpicker.com/youtube-channel-id.php).
4. Buka tab **Actions** di repo, aktifkan workflow kalau diminta.
5. Jalankan sekali secara manual: tab Actions > "Update EPL YouTube Feeds" >
   "Run workflow" — supaya `data/videos.json` langsung terisi tanpa menunggu
   jadwal cron.
6. Setelah berhasil, `data/videos.json` akan otomatis ter-update tiap 20 menit
   selama ada aktivitas di repo dalam 60 hari terakhir (GitHub otomatis
   menonaktifkan scheduled workflow di repo yang benar-benar tidak disentuh
   lebih dari 60 hari — cukup buka tab Actions & "Run workflow" manual sesekali
   kalau itu terjadi).

## URL JSON untuk widget Blogger

Setelah repo online, URL yang dipakai di widget adalah (lewat jsDelivr CDN,
lebih cepat & CORS-friendly daripada raw.githubusercontent.com):

```
https://cdn.jsdelivr.net/gh/USERNAME/REPO@main/data/videos.json
```

Ganti `USERNAME` dan `REPO` sesuai punya kamu. Masukkan URL ini ke
`CONFIG.dataUrl` di file widget Blogger (`epl-youtube-widget-v2.html`).

Catatan: jsDelivr melakukan caching sendiri di CDN-nya (biasanya ter-update
dalam beberapa menit setelah commit baru), jadi ini juga membantu meredam
lonjakan trafik dari banyak pengunjung sekaligus.
