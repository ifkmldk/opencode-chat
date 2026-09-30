# Maps di OpenCode — gratis, dijamin Rp0

OpenCode memakai dua sumber data peta:

- **Google Maps lewat Gemini API free tier (sumber utama).** Memberi rating, jumlah ulasan, kategori, harga,
  status buka dan jam hari ini, alamat, serta link Google Maps. Petunjuk KRL/TransJakarta/MRT didapat lewat
  `maps_ask`.
- **OpenStreetMap (cadangan, selalu gratis).** Dipakai untuk pencarian tempat, rute mobil/motor/sepeda/jalan
  kaki (OSRM), matriks waktu tempuh, POI di sekitar (Overpass), dan tile peta.

Tidak ada Google Maps Platform key dan tidak ada billing account yang dipakai.

## Status sekarang

- **Maps sudah bisa dipakai tanpa key.** Datanya lewat OpenStreetMap.
  - Dicek live pada 2026-09-30: pencarian (Nominatim), geocoding (Photon), rute (OSRM), dan POI (Overpass)
    semuanya jalan.
  - Rating dan jam buka baru muncul setelah key Gemini dipasang.
- **Kotak "Custom research endpoints" di Settings → Preferences tidak perlu diisi.** Itu hanya untuk server
  riset buatan sendiri (fitur Cline). Riset hotel, tempat, dan event sekarang otomatis memakai Maps. Key Google
  Maps dimasukkan di **Settings → Maps**, bukan di situ.

## Hasil Test key (2026-09-30)

Key kamu ditolak untuk 2.5 Flash **dan** 2.5 Flash-Lite ("no longer available to new users"). Artinya, untuk akun
baru tidak ada lagi jalur data Google Maps yang gratis. OpenCode memakai sumber yang **selalu gratis**:

- Tempat: OpenStreetMap, dengan POI didahulukan daripada nama jalan.
- Foto: Wikimedia Commons, Wikipedia, atau Wikidata, hanya kalau judul fotonya menyebut nama tempat itu. Kalau
  tidak ada, kartu memakai ikon kategori.
- Info: bintang hotel, jam buka dan status buka sekarang, telepon, dan website dari tag OSM.
- Tidak ada rating bintang Google, karena itu butuh Places API berbayar dengan billing.

## Catatan model (dicek 2026-09-30 di ai.google.dev/gemini-api/docs/pricing)

- Grounding Google Maps **gratis** hanya ada di **Gemini 2.5 Flash** dan **2.5 Flash-Lite** (500 request/hari).
- Gemini 2.5 Flash sudah "no longer available to new users" untuk key baru, jadi OpenCode otomatis memakai
  **2.5 Flash-Lite**.
- Gemini 3.x (3.5/3.6/3.7/3.8 Flash) menandai Maps grounding sebagai **"Not available" di free tier**. Di paid
  tier harganya 5.000 prompt/bulan gratis, lalu $14 per 1.000. OpenCode **tidak pernah** memakai Gemini 3 untuk
  Maps, karena itu butuh billing.
- Kalau suatu saat Google juga mematikan 2.5 Flash-Lite untuk key baru, tidak ada lagi jalur Google Maps yang
  gratis. OpenCode akan bilang begitu dan tetap memakai OpenStreetMap.

## Kenapa pasti Rp0

- Project Google AI Studio **tanpa billing account** tidak punya cara pembayaran, jadi Google tidak bisa menagih
  apa pun.
- Kalau jatah gratis habis (500 request/hari untuk grounding Google Maps di Gemini 2.5 Flash/Flash-Lite), Google
  hanya menjawab **429**. Tidak ada tagihan.
- Kalau Google menolak (429) di kedua model gratis, OpenCode berhenti mencoba Google **sampai reset hari itu**,
  walau hitungannya belum 450. Ini berjaga-jaga kalau Google menurunkan batas gratisnya. Di Settings → Maps akan
  tertulis bahwa batas gratis hari ini tercapai.
- OpenCode berhenti sendiri di **450/hari** (bisa diturunkan di Settings), lalu otomatis pindah ke
  OpenStreetMap.
- Google baru dipakai setelah kamu mencentang **"I checked: this project's Billing Tier is Free"**.
- Satu-satunya risiko tagihan: kamu sendiri menautkan billing ke project itu. Jangan pernah klik
  **Set up billing** atau **Upgrade** di project tersebut.

## Langkah

1. **Buat key di project baru.**
   - Buka https://aistudio.google.com/apikey dan login.
   - Klik **Create API key**, lalu pilih **Create API key in new project**.
   - Jangan pilih project lama.
2. **Cek status gratis.**
   - Buka https://aistudio.google.com/projects.
   - Kolom **Billing Tier** untuk project baru itu harus **Free**.
3. **Cek ganda di Google Cloud.**
   - Buka https://console.cloud.google.com/billing/projects.
   - Project itu harus **Billing is disabled** (tidak tertaut ke billing account).
   - Kalau ternyata tertaut: klik ⋮, lalu **Disable billing**, untuk project itu saja.
4. **Pasang di OpenCode.**
   - Buka Settings (Ctrl+,), lalu tab **Maps**.
   - Tempel key, klik **Save**.
   - Nyalakan **I checked: this project's Billing Tier is Free**.
   - Klik **Test**. Hasilnya harus *Connected*.
5. **Pantau pemakaian (opsional):**
   - di Settings → Maps (*Usage today*, reset jam 14:00/15:00 WIB)
   - atau di https://aistudio.google.com/rate-limit

Jangan pakai `GEMINI_API_KEY` lama yang sudah ada di komputer, kecuali project-nya juga berstatus Free.

## Privasi

Di free tier, Google boleh memakai prompt untuk meningkatkan produknya. OpenCode hanya mengirim kueri tempat
(misalnya "hotel dekat Monas") dan perkiraan lokasi, bukan isi chat lainnya.

## Yang bisa dilakukan (semua mode: Chat, Code, Laya)

- **Kartu tempat di chat:**
  - foto peta mini, ★ rating (jumlah ulasan), kategori, harga, status Buka/Tutup
  - tombol **View on map**, **Directions** (Google Maps), dan **Google Maps**
- **Link tempat di jawaban:** tautan `[Nama](place:<id>)` tampil sebagai chip 📍. Klik chip untuk membuka tab
  **Map** di panel kanan dan fokus ke tempat itu.
- **Tab Map (panel kanan):**
  - pin bernomor, garis rute, area, hot/cold spot, dan daftar tempat
  - **Route in Google Maps** membuka rute terbaik di aplikasi/web Google Maps, lengkap dengan traffic dan
    transit live
  - Tab ini terbuka sendiri saat model memanggil `map_show`.
- **Analisis spasial (`geo_compute`, lokal dan gratis):**
  - jarak geodesik WGS84 (Karney)
  - buffer, luas/keliling di UTM (Jabodetabek: zona 48S, EPSG:32748)
  - convex hull, DBSCAN, ranking multi-kriteria
  - **klasifikasi tematik terbaik otomatis**: membandingkan Jenks, quantile, equal interval, std-dev, dan
    head/tail, lalu merekomendasikan yang GVF-nya tertinggi
  - Moran's I (uji klaster)
  - Getis-Ord Gi* (hot/cold spot)
  - Clark–Evans nearest-neighbour index
  - pusat rata-rata berbobot dan standard distance
- **Laya:**
  - Keputusan tempat memakai skor spasial: waktu tempuh dari `maps_matrix`, fasilitas sekitar dari `maps_poi`,
    rating, dan harga, yang diberi bobot lewat `geo_compute rank`.
  - Di Windows, Laya-MLX tidak bisa jalan native (butuh Mac Apple Silicon). Fallback-nya kini memilih kandidat
    dengan skor tertinggi dari ranking tersebut, bukan sekadar mencocokkan kata.

## Batasan

- Tidak ada foto Google (tidak ada API foto yang gratis). Kartu memakai tile OpenStreetMap sebagai gambar.
- Waktu tempuh di dalam app berasal dari OSRM, tanpa traffic live. Untuk traffic dan transit live, pakai tombol
  Google Maps.
- Kalau Google mati atau jatah habis, hasil dari OpenStreetMap tidak punya rating dan jam buka.
