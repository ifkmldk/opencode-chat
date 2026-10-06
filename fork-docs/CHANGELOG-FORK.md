# Fork changelog

## 2.0.22-fork.14 (2026-10-07)

- Data stasiun dari OSM untuk semua jalur KRL (Bogor+Nambo, Cikarang, Rangkasbitung+Jatake, Tangerang, Tanjung Priok), MRT, LRT (`maps/stations.ts`).
- Tool baru `maps_near_transit`: semua fitur (kantor, hotel, wisata, RS, …) dalam N m dari stasiun, dengan jarak lurus dan jalan kaki (OSRM foot).
- Lokasi kantor perusahaan: OSM nama/kantor, Photon, alamat di lowongan, lalu halaman Google Maps di Chromium headless (berhenti bila consent/captcha). Website perusahaan dicari dari OSM, profil papan, lalu web search; cek halaman karir semua perusahaan dalam radius (dengan NetGuard).
- research_deep lowongan: semua frasa role × semua kota yang dilalui jalur, batas gaji hanya membuang gaji tercantum di bawah batas, tabel utama dengan kantor/stasiun/jarak + tabel di luar radius + lokasi belum ketemu + perusahaan dalam radius; tidak ada pemotongan diam-diam; "BELUM SELESAI, panggil lagi" dengan cache.
- Pencarian kategori (hotel, wisata, RS, klinik, kantor, mal, …) memakai tag OSM di sekitar titik; Nominatim dibatasi Indonesia; "Stasiun X" lewat indeks stasiun. geo_compute `distance` memakai origin; operasi `near_any`.
- Instruksi agen dan kontrak jawaban: tabel lengkap, gaji tidak dicantumkan tetap tampil, lokasi wajib, tidak ada jarak karangan.


## 2.0.22-fork.13 (2026-10-06)

- Tool yang gagal tidak lagi tampil sebagai baris merah di jawaban. Di semua mode (Chat, Code, Classifier, semua preset detail) panggilan gagal masuk ke grup tool yang terlipat ("Used N …"); klik untuk melihat panggilan dan errornya.
- Argumen tool dari model diperbaiki otomatis sebelum ditolak: angka/boolean yang dikirim sebagai teks (`"limit": "5"`, `"exact": "true"`), kunci opsional berisi `null`/`"null"`/`""`, objek/array berupa teks JSON, dan angka di atas batas maksimum (dipotong ke batas). Dari riwayat: 19 dari 19 panggilan `maps_search`/`maps_poi`/`jobs_search`/`geo_compute` yang dulu gagal sekarang lolos.
- Plugin lokal `opencode-websearch` (di `~/.config/opencode/plugins`, di luar repo): hasil tanpa tanggal mengirim `published: undefined` yang ditolak skema server, jadi setiap web search berakhir "Unable to search the web". Kolom kosong kini dibuang.
- QA: cek secrets di pentest bekerja di PowerShell maupun Git Bash.


## 2.0.22-fork.12 (2026-10-06)

- Aplikasi desktop (Electron, `packages/desktop`) dengan **browser asli di panel**: Google, login aplikasi (H5) dan cookie bekerja seperti browser biasa. Desktop memakai server launcher (`OPENCODE_DESKTOP_SERVER_URL` + password `service.json`) dan tidak menyalakan server kedua. Browser native aktif secara default. Launcher membuka desktop secara default; `-Web` untuk Brave.
- UI web (cadangan): Google dimuat langsung (mode embed `igu=1`), tidak lagi dialihkan ke Bing; link yang biasanya membuka jendela baru tetap di panel.
- ScrapeGraphAI otomatis sebagai tier terakhir di mode auto/stealth.
- Portal tambahan: Loker.id (data route situs), Karir.com (kartu; link ke hasil pencarian karena kartu tidak punya alamat sendiri). Jobs.id (sertifikat HTTPS situs rusak), TopKarir (timeout) dan Glassdoor (cek "Humans only") dilaporkan dengan alasan.
- `web_browser` aksi `login`: membuka profil agen di jendela terlihat supaya pengguna login sendiri; agen tidak pernah mengetik password.
- Satu konteks besar: sesi Claude Code (+ sub-agent), memory Claude, dan sesi OpenCode (5 database, v1 dan v2) disalin ke vault Obsidian (`sessions/` ringkasan untuk recall, `transcripts/` transkrip penuh untuk `memory_search`), rahasia disensor. Dua arah: hook Claude Code `UserPromptSubmit` (recall dari vault) dan `SessionEnd` (sinkron); launcher menyinkron saat dibuka.
- QA: pen test `secrets` memakai `cmd /c set` (shell uji bisa PowerShell).


## 2.0.22-fork.11 (2026-10-05)

- Riset lowongan membaca 7 papan sekaligus: Jobstreet, LinkedIn, Glints (data halaman + id lokasi), Kalibrr dan Dealls (API publik yang dipakai situsnya), Indeed (data kartu), KitaLulus (data server halaman). Kota disaring dari kartu, duplikat digabung, ejaan "analis/analyst" disamakan, sampai 50 baris. Glassdoor menolak akses otomatis ("Humans only"): tidak dibobol, pengguna diberi link pencariannya.
- Tool baru `web_browser`: agen memakai browser seperti orang (buka, isi, klik, gulir, sorot, screenshot), profil tetap, tidak pernah mengetik password, berhenti di login/cek manusia (`needsUser`), alamat privat ditolak. (Nama `browser_*` dipakai plugin desktop upstream.)
- ScrapeGraphAI terpasang dan jalan lewat 9router (kunci dibaca dari opencode.json, dikirim via stdin); diberi HTML hasil render browser; dipakai untuk halaman karir perusahaan yang tidak terbaca parser. Perbaikan: `OPENAI_API_KEY` tidak lagi dipasangkan dengan alamat 9router; `model_tokens` diisi.
- User guide dari web → PPTX: skill `userguide`, tipe slide `step` (screenshot utuh, nomor, langkah, tip). Sorotan lama dibersihkan tiap panggilan.
- Batas gambar per permintaan: hanya hasil tool bergambar terakhir yang dikirim ulang; `office_render` 4 halaman per panggilan; screenshot ke model dalam JPEG. Sebelumnya user guide gagal dengan 413 (payload 9router ~4,5 MB).
- Panel Browser: pencarian Google dialihkan ke Bing dengan kata yang sama (Google menampilkan cek bot untuk proxy server).


## 2.0.22-fork.10 (2026-10-05)

- Panel Browser bisa dipakai lagi untuk mencari: CSP milik situs (nonce `script-src`, `base-uri`) memblokir skrip jembatan dan `<base>` proxy, jadi Google dan Bing kosong atau rusak. CSP situs (header dan meta) sekarang dibuang; sandbox proxy tetap membuat halaman beropini origin buram. Mesin pencari bawaan alamat bar: Bing (DuckDuckGo html memblokir fetch server). Google sendiri tetap menampilkan halaman cek bot untuk fetch server-side.
- LinkedIn (halaman publik) ditambahkan ke riset lowongan di samping Jobstreet; duplikat antar papan digabung.
- Halaman karir resmi perusahaan dibuka oleh program (`careerTable`), bukan oleh model.
- Tidak dimasukkan: Glints dan Kalibrr (parameter kata kunci dan kota diabaikan, hasilnya acak), Indeed (hanya 3 kartu terbaca, satu id terlihat seperti umpan).


## 2.0.22-fork.9 (2026-10-05)

Dari sesi "Loker Bandung" milik pemilik (jawaban berulang, lokasi dan link salah, hasil sedikit, banyak sampah di tampilan).

- Riset lowongan membaca daftar Jobstreet dan LinkedIn langsung (kartu: judul, perusahaan, kota, gaji, link listing), disaring dengan kota di kartu, bukan cuplikan web search. Batas hasil 30 (maks 50), tabel siap tempel (`table`).
- Halaman karir resmi perusahaan dari hasil dibuka oleh program (`careerTable`), bukan tergantung model; halaman kosong atau gagal dilaporkan apa adanya.
- `jobs_search` dan `research_deep`: kata "lowongan" tidak ganda, kueri cadangan, error penyedia ditampilkan (sebelumnya disembunyikan).
- Pembuka kalimat yang sama tiga kali dalam satu giliran memicu arahan sementara agar model berhenti menarasi.
- Chat dan Classifier hanya menampilkan jawaban: narasi di samping tool call dan kartu proses (maps, scrape, search, fetch) disembunyikan; checklist, `office_render`, aksi tetap.
- Belum: Glints/Kalibrr (daftar tidak menghormati kata kunci), interaksi "muat lebih banyak", sesi lama tidak diperbaiki isinya.


## 2.0.22-fork.8 (2026-10-05)

Perbaikan dari UAT dengan model asli (laporan: `fork-docs/qa/REPORT.md`).

- **Jawaban sederhana tidak lagi "ngalor ngidul".** Penanda selesai (`[[OPENCODE_TASK_COMPLETE]]`) kini hanya dituntut setelah ada kerja dengan tool pada giliran itu; teks kontrak dan dorongan dilunakkan.
  Sebelumnya agen dengan `requireCompletionMarker: true` didorong memeriksa ulang folder kerja setelah jawaban biasa (78 dtk, 8 tool, isi proyek bocor ke jawaban); kini 3 dtk, 0 tool.
- **`websearch` tidak lagi selalu "cancelled".** Pemilihan penyedia gratis otomatis pada pemakaian pertama (form izin tak pernah dijawab pada sesi latar); `OPENCODE_WEBSEARCH_ASK=1` mengembalikan pertanyaan.
- `research_classify`/`classifier_classify` menerima bentuk argumen yang dikirim model; mirror Overpass saat server utama 504; aturan: `research_deep` dulu untuk riset, tanpa narasi per langkah; dukungan jawaban: tidak menyebut hal tak bersumber.
- Harness QA: `fork-docs/qa/{harness,smoke,uat,modes,pentest}.mjs`, `REPORT.md`, `pentest.md`.

## 2.0.22-fork.7 (2026-10-05)

Memory, Obsidian dan konteks yang benar-benar terhubung.

- **Recall mengikuti pertanyaan.** Hook `context` (`plugin/memory-recall.ts`) menimbang pesan terakhir pengguna terhadap catatan tersimpan (database + vault Obsidian) dan menyisipkan paling banyak 5 catatan yang jelas cocok tepat sebelum pesan itu
  (tidak disimpan di percakapan, prefiks cache utuh). Tidak ada yang cocok = tidak ada yang disisipkan. Sebelumnya recall otomatis tidak pernah jalan (dipanggil dengan query kosong).
- **Ranking kata, bukan LIKE kalimat penuh** (`memory/rank.ts`): minimal dua kata berbeda cocok, preferensi/koreksi berbobot lebih, catatan sampah (hanya path) dibuang, duplikat digabung. Diuji pada vault asli: pertanyaan loker/hotel menemukan sesi terkait, resep nasi goreng tidak menarik apa pun.
- **Obsidian terhubung:** vault dibaca (`entries/`) lewat `memory/vault.ts`; `memory_save` menulis catatan ke vault juga (matikan dengan `<config>/memory.json` `{ "write": false }`); `memory_forget` menghapus dari database dan vault dan jujur melaporkan bila tidak ada.
  Folder: `OPENCODE_MEMORY_VAULT`, `memory.json` `vaultDir`, atau `~/Documents/Obsidian/opencode-memory` bila ada. (Kolom path di Settings → Memory masih hanya tersimpan di browser; belum dibaca core.)
- **Filter "sudah dilamar/ditolak":** catatan berjudul "Sudah dilamar: ..." / "Ditolak: ..." (disimpan model saat Anda bilang sudah melamar) otomatis menyaring lowongan dengan tautan atau judul yang sama dari hasil `research_deep`; setiap lowongan wajib punya tautan lamar.
- **Kompaksi menjaga batasan keras** (lokasi, gaji, tanggal, jumlah, bahasa, hal yang sudah dilakukan) dengan kata-kata pengguna dan tidak menjatuhkannya.
- Pengukuran: pesan "Code Mode catalog changed" ada 25 kali di 9 sesi (1-6 per sesi), bukan tiap giliran; dibiarkan.

## 2.0.22-fork.6 (2026-10-05)

Hardening setelah audit keamanan dan pen test lokal (`fork-docs/qa/pentest.md`, skrip `pentest.mjs`; sebelum/sesudah: 6/9 -> 9/9 lulus).

- Env anak proses (shell agen, PTY) disaring: kunci provider/gateway, token, password tidak diwariskan (`OPENCODE_CHILD_ENV_PASSTHROUGH` untuk mengizinkan nama tertentu).
- `fs.write` hanya di dalam proyek, root repo, dan folder tmp server; `office.preview` hanya docx/pptx/xlsx dengan tanda tangan zip, makro dimatikan di otomasi Word/PowerPoint/Excel, folder sementara selalu dihapus, antrean dibatasi.
- `webfetch` dan `scrape_fetch` menolak alamat privat/loopback/metadata (izinkan lewat `OPENCODE_FETCH_ALLOW_HOSTS` atau `OPENCODE_FETCH_ALLOW_PRIVATE=1`).
- Gambar eksternal di markdown model diblokir (jalur eksfiltrasi); instruksi: teks dari web/berkas/tool adalah data, bukan perintah.
- Hook pengguna: path berbahaya melewati hook, agen tidak boleh mengubah `hooks.json`, pagar menangkap PowerShell terenkode, `rm` dengan flag terpisah, `--no-preserve-root`.
- Perbandingan password konstan-waktu; total memori preview dibatasi 48 MB.
- Harness uji baru: `fork-docs/qa/{harness,smoke,pentest}.mjs`.

## 2.0.22-fork.5 (2026-10-05)

Hasil audit sesi nyata (hotel BSD, loker Tangerang/Bandung): scraper dan jawaban riset diperbaiki. Rencana lengkap di `fork-docs/` (ringkasan di bawah).

- **Scraper sungguhan jalan di situs perusahaan.** Tier baru `chromium` memakai Chrome/Brave/Playwright Chromium yang sudah ada, dikendalikan lewat DevTools
  (muat halaman, tunggu teks berhenti bertambah, scroll sekali, ambil DOM; batas waktu tetap mengembalikan DOM sebagian). Mode `auto` naik dari fetch biasa ke
  browser saat hasil kosong, menu saja, tembok bot, error TLS/transport. Uji nyata: Jobstreet (403 -> 989 lowongan terbaca), Telkom, bank bjb terbaca; efishery
  jujur dilaporkan sertifikatnya bermasalah.
- **Skrip jembatan Python ter-embed** (`*.py.txt`) dan ditulis ke `~/.local/share/opencode/scrape-bridges`; sebelumnya exe mencari `B:~BUNootridges...` (tidak ada)
  sehingga camofox/scrapling selalu gagal. Skrip kini membaca stdin atau argv.
- **Ekstraksi konten utama** (`scrape/extract.ts`): buang menu/footer/banner, ambil `<main>`/`<article>`, tambahkan data JSON-LD `JobPosting` (judul, perusahaan, lokasi, gaji, tanggal).
- **Gagal = error, bukan halaman kosong.** `scrape_fetch` tanpa isi menolak dengan alasan dan perintah jangan menebak; `scrape_status` tidak lagi berbohong "ready"
  (memeriksa Chromium sungguhan; tier Python ditandai sekadar cek paket). `webfetch` juga naik ke browser pada transport error. Klaim "respects robots/SSRF" dihapus dari deskripsi.
- **Instruksi lebih pendek dan tidak bertabrakan:** geo 3,3k -> ~1,7k karakter, office/todo diringkas; kontrak jawaban diselaraskan (jawab pertanyaan di baris pertama, satu tabel dengan kolom
  sumber + tanggal cek); instruksi baru `core/answer-plan` (konstrain keras tetap dipakai di tiap pencarian, jawaban berurutan: jawaban, hasil bersumber, yang tidak ditemukan, langkah berikut, tidak mengarang saat tool gagal).
- **research_deep untuk pekerjaan:** tidak lagi memakai logika hotel (regex carport/furnished, geocode judul lalu buang). Semua lowongan dipertahankan, lokasi diverifikasi dari halamannya
  (JSON-LD/teks), yang halamannya menunjukkan kota lain dibuang, yang terverifikasi di depan. Pencarian gagal = status `error`, nol hasil = `unavailable`, dengan perintah jangan menyusun daftar dari ingatan.
  Mode koridor KRL tetap bila `transitLine` diberikan eksplisit.
- **Classifier:** menerima `question`, dan peringatan fallback kini jujur (bukan model, pilihan = petunjuk, jangan sebut "terjamin").

Belum (rencana Tahap 2-3): pin konstrain saat kompaksi, daftar "sudah dilamar", recall memory/Obsidian otomatis, katalog Code Mode yang membuat cache prompt tidak terpakai, sumber ATS khusus.

## 2.0.22-fork.4 (2026-10-05)

- **Kartu halaman untuk `office_render`:** timeline menampilkan strip thumbnail halaman yang dirender (judul, jumlah halaman, mesin),
  dibaca lewat pembaca gambar yang sama dengan kartu file. Data kartu ada di `metadata` hasil tool.
- **Hook pengguna + pagar pengaman shell** (`core/src/plugin/user-hooks.ts`): `hooks.json` di folder config (sebelah `opencode.json`)
  menolak panggilan tool yang cocok (`before`) atau menjalankan perintah sesudah tool selesai (`after`, mis. `prettier --write {path}`).
  Pagar bawaan (bisa dimatikan dengan `"guard": false`) menolak perintah shell yang merusak: hapus rekursif root/home/drive, format,
  tulis ke disk, shutdown, hapus registri HKLM, dan unduhan yang dipipa ke shell. Ini sabuk pengaman, bukan sandbox; prompt izin tetap kendali utama.
  Dokumentasi: `fork-docs/hooks.md`.

## 2.0.22-fork.3 (2026-10-05)

Polesan mesin dokumen setelah QA visual 6 jenis dokumen (`fork-docs/qa/`: pitch deck, proposal, laporan, workbook, CV, brosur).

- **Workbook:** render Excel tidak lagi memuat strip tab sheet abu-abu di bawah halaman (halaman sheet Excel mengalihkan dirinya ke
  frameset; skrip itu dibuang pada salinan yang dicetak).
- **Deck:** slide `twoColumn` memakai teks 18pt, judul kolom serif, dan pemisah vertikal; `content` memakai catatan samping bergaya kutipan.
- **Laporan Word:** `table({ totalRow: true })` menebalkan baris total dengan garis di atasnya.
- **CV:** helper baru `createCV` (`cv.mjs`): satu halaman, satu kolom, tanggal rata kanan pada tab stop, tanpa tabel/foto/bar skill.
- **Skill `pdf`:** menyertakan starter HTML/CSS untuk brosur dan satu-lembar (token desain, @page, bagian per halaman).

## 2.0.22-fork.2 (2026-10-05)

- **Membuka .pptx tidak lagi mengosongkan panel samping.** zip.js membuat web worker dari blob, yang diblokir CSP aplikasi;
  penolakannya membuat `createResource` error, dan membaca resource yang error melempar ke ErrorBoundary sehingga seluruh panel
  kosong. Sekarang zip.js jalan tanpa worker (`artifact.ts`) dan error parse jatuh ke status "tidak bisa dipratinjau"
  (`ArtifactOfficeQuick`). Bug ini sudah ada sebelum fork.8.

## 2.0.22-fork.1 (2026-10-05)

Sinkron upstream "hibrida": backend naik ke upstream v2.0.22, UI tetap UI fork (v2.0.15).

- **Naik ke v2.0.22:** `ai`, `core`, `schema`, `plugin`, `util`, `codemode`, `protocol`, `server`, `tui`, `cli`, `sdk`, `client` (digenerate ulang)
  dan paket non-UI lain. Membawa ~110 perbaikan core/ai: stream putus di tengah jalan, timeout provider 5 menit,
  urutan instruksi untuk prompt-cache, error MCP yang jelas, batas output vs konteks, banyak perbaikan provider.
- **Tetap UI fork:** `app`, `ui`, `session-ui`, `desktop` (upstream memindahkan browser/file/review/side chat ke
  `packages/gui-extensions`; migrasi UI ke SDK itu ditunda, lihat UPSTREAM-SYNC.md).
- **Hook fork dipasang ulang:** `core/instructions/builtins.ts` (signature `load()` baru tanpa session ID; instruksi
  output-files, response, geo, office, todo), `server/middleware/authorization.ts` + `server/process.ts` (tiket browser-proxy
  berdampingan dengan `isPairingConnectURL` upstream), `plugin-browser/src/connection.ts` (pesan web UI), `tui/context/storage.tsx`.
- **Skema DB bisa maju** (migrasi upstream): cadangkan DB sebelum deploy; exe lama tidak bisa membaca skema baru.
## 2.0.15-fork.10 (2026-10-05)

Fase 3 dari audit paritas agen (bagian yang aman dikerjakan tanpa LLM nyata).

- **Tool `todo_write`:** checklist multi-langkah yang terlihat (setara TodoWrite Claude Code / rencana Codex). Model
  mengirim seluruh daftar tiap pembaruan (pending / in_progress / completed); panggilannya sendiri adalah state, jadi
  tidak ada penyimpanan baru dan aman terhadap compaction. Kartu timeline "Checklist" menampilkan "2 of 5 done · item
  aktif" dan daftar lengkap bila dibuka; tampil juga di mode Chat dan Classifier. Instruksi `core/todo` memberi tahu
  kapan memakainya.
- **Pesan error yang membimbing:** kegagalan `scrape_fetch`, provider jobs dan provider research kini menyuruh model
  tidak mengarang data dan menyebut langkah berikutnya (mode lain, `websearch`, atau katakan terus terang).
- **Hasil audit Fase 3:** mode izin (agen `plan` + setelan "auto-approve"), panel pekerjaan latar belakang untuk
  subagen (`session/summary/background.tsx`) dan Undo (`command.session.undo`) ternyata sudah ada di upstream, jadi
  tidak dibangun ulang. Ditunda dengan alasan: gerbang tool `browser.*` per sesi (registri tool di-scope per
  Location, butuh desain inti), hook shell pengguna dan sandbox (permukaan keamanan, perlu keputusan pemilik).
## 2.0.15-fork.9 (2026-10-05)

Fase 2 dari audit paritas agen: mesin dokumen "ala Claude" (kode + skill + render lalu periksa).

- **Tool `office_render`:** mengubah docx/pptx/xlsx/pdf/html menjadi PDF dan PNG per halaman, lalu menampilkan gambarnya
  ke model (maks 8 per panggilan, argumen `pages`/`scale`). Mesin, berurutan: Microsoft Word/PowerPoint/Excel yang
  terpasang (COM, tanpa jendela, proses sisa dibersihkan), LibreOffice bila ada, Chromium untuk HTML. Windows tanpa
  printer memblokir ekspor PDF Excel; fallback-nya Excel→HTML per sheet→Chromium→gabung PDF.
- **Tool `office_kit`:** memasang sekali (npm) dan menemukan "office kit": pustaka tata letak untuk deck
  (`pptxgenjs`), laporan Word (`docx`), workbook (`exceljs`), plus `mupdf` (WASM) untuk merender PDF ke PNG. Folder
  default `~/.local/share/opencode/office-kit` (`OPENCODE_OFFICE_KIT`; `OPENCODE_OFFICE_NO_INSTALL=1` mematikan
  pemasangan otomatis). Kit: 6 palet, 5 pasangan font, 13 tipe slide, laporan dengan style heading/daftar asli.
- **Skill bawaan:** `office-design` (proses, pilihan tampilan, aturan anti-AI-slop, daftar periksa render),
  `pptx`, `docx`, `xlsx`, `pdf`. Instruksi `core/office` menyuruh model memuatnya, membangun dengan kit, lalu
  render dan melihat tiap halaman sebelum menyerahkan.
- **Preview dokumen akurat:** docx/pptx/xlsx di panel file dirender server menjadi PDF (endpoint
  `office.preview`, di-cache per hash) dan ditampilkan pdf.js, dengan toggle Exact/Quick; tampilan Quick lama
  (mammoth, pptx-preview, tabel) tetap sebagai cadangan saat mesin tidak ada.
- Catatan: pemindai artefak rilis menolak string pustaka canvas native, jadi rasterizer memakai `mupdf` (WASM).
  Preview pptx di panel file kosong pada harness QA (juga di build fork.8): belum diselidiki.

## 2.0.15-fork.8 (2026-10-05)

Fase 1 dari audit paritas agen: perbaikan cepat atas kegagalan nyata di sesi pemilik.

- **Angka berbentuk string diperbaiki untuk semua tool.** `maps_poi` menolak `radius_m:"1000"` karena cabang enum
  `"NaN"` dari `Schema.Number` dianggap menerima string apa pun. `repair()` di `core/src/plugin/tool-input-repair.ts`
  sekarang mengabaikan cabang enum/const yang tidak memuat nilainya (berlaku juga untuk tool MCP dan plugin).
- **Shell Windows:** deskripsi tool `shell` memuat aturan sintaks per shell (PowerShell 5.1 tanpa `&&`, jangan membungkus
  `powershell -Command`, jangan sintaks bash).
- **`webfetch` yang diblokir (403/429/5xx) atau halaman kosong berbasis JS** otomatis jatuh ke scraper stealth
  (izin `scrape.fetch`), dengan pesan error yang menunjuk `scrape_fetch`. Scraper: kegagalan Camofox sekarang
  gagal biasa, bukan defect yang menghentikan tier berikutnya.
- **Tool `browser.*` di UI web** gagal dengan pesan yang mengarahkan ke `webfetch`/`scrape_fetch`/`preview_file`.
- **Thinking disembunyikan di semua mode** (Chat, Code, Classifier) kecuali setting baru "Show thinking" dinyalakan.
  Kata "Thinking" diganti indikator titik-titik.
- **Composer:** Shift+Enter melanjutkan daftar bernomor/bullet, Tab / Shift+Tab mengatur indentasi, Backspace di
  belakang marker menurunkan level lalu menghapus marker. Enter tetap mengirim.
- **Preview HTML:** halaman disajikan dari server (rute `browser-proxy/preview` bertiket, header `sandbox`), jadi
  JavaScript inline dan CDN jalan (CSP aplikasi sebelumnya memblokirnya di frame blob). Teks di preview bisa dikutip
  atau diberi catatan, dengan nomor baris sumber (`source lines 12-14`) ikut ke model.

## 2.0.15-fork.7 (2026-10-04)

`research_deep` selesai + kartu jujur + job koridor geocode (jawaban Sudirman/carport/KRL presisi):

- Branch job `orchestrate.ts` tidak lagi return awal: station-name match cepat + geocode fallback
  via `searchPlaces` → `nearestStation()` (≤ transitWalkKm) + `station`/`distanceM` + must-verify
  via scrape + sort terdekat (filter keras, gagal geocode = dibuang dalam mode koridor).
- `research-honesty.test.ts`: kasus baru job koridor (Serpong keep + station, Medan dibuang).
- Kartu `ResearchToolOutput`: badge verified (✓/✗/?), jarak/stasiun, `limitations` jujur;
  `maps-output.tsx` `PlaceCard` rating berattribusi (tanpa sumber = `(?)`).
- OSM-only penuh: `google.ts` shim, `settings/usage` no-op, Settings → Maps tanpa key,
  `links.ts` keyless tetap.

## 2.0.15-fork.6 (2026-10-04)

`research_deep` terintegrasi + OSM-only penuh (jawaban ngaco Sudirman/carport/KRL diperbaiki di lapisan data):

- `research_deep`: `constraints.ts` (carport = filter keras, KRL Rangkasbitung = koridor jalan 1 km, anchor-from-query),
  `transit.ts` (19 stasiun Tanah Abang→Rangkasbitung + `nearestStation`), `orchestrate.ts`
  (extract→anchor-resolve→search→koridor/radius→scrape-verify→SearchOut + limitations), tool `research_deep`
  (permission `research.deep`), honesty schema/test.
- `maps/search.ts`: `anchor`/`radiusKm` + filter radius Karney + sort + `distanceM` (yang jauh dibuang beneran).
- `jobs.ts`: tanpa `OPENCODE_JOBS_API_URL` fallback web-search ber-lokasi (tidak `ToolFailure` buta).
- OSM-only: `google.ts` jadi shim (throw jujur), `settings.ts`/`usage.ts` no-op OSM, Settings → Maps tanpa
  section key/limit/test, i18n `settings.maps.google*` dihapus, `links.ts` keyless tetap (tombol + transit directions).
- Rich-info keyless: `enrich.ts` (`ogImage`, `contactFrom`, `ratingFromScrape`) — rating/review/foto hanya
  bila OSM/Wikimedia/scrape berattribusi, else `unknown` (tidak pernah ngarang).
- Kontrak jawaban: `core/geo` + `response/contract` (pipeline wajib, tabel Nama|Jarak/Waktu|Harga|Verifikasi|Sumber,
  badge ✓/✗/?, `map_show` di akhir); kartu UI (`ResearchToolOutput`, `maps-output`) tampilkan jarak/stasiun/badge/tanggal cek.

## 2.0.15-fork.5 (2026-10-03, foundation — OSM-only + cards follow)

Fondasi `research_deep` + scraper-first yang terintegrasi (jawaban ngaco Sudirman/carport/KRL diperbaiki di lapisan data):

- `research_deep`: `constraints.ts` (carport = filter keras, KRL Rangkasbitung = koridor jalan 1 km),
  `transit.ts` (19 stasiun Tanah Abang→Rangkasbitung + `nearestStation`), `orchestrate.ts`
  (extract→anchor→search→koridor→scrape-verify→SearchOut), tool `research_deep` + honesty schema/test.
- `maps/search.ts`: `anchor`/`radiusKm` + filter radius Karney + sort + `distanceM` (yang jauh dibuang beneran).
- `jobs.ts`: tanpa `OPENCODE_JOBS_API_URL` fallback web-search ber-lokasi (tidak `ToolFailure` buta).
- Explicit BELUM di rilis ini: OSM-only removal, rich-info workaround, kontrak prompt, kartu UI,
  live 3 kasus — menyusul sebelum closeout fork.5.

## 2.0.15-fork.4 (2026-10-02)

Repair `memory` yang hilang di DB: jurnal migrasi `m48` completed tapi tabel
fisik tidak ada (snapshot drizzle basi) → migrasi repair idempotent
`20261002082455_icy_meggan` + regenerasi `schema.json`/`schema.gen.ts`
(`--check` hijau). Backfill 576 vault entries → DB. `memory_save/search/forget`
bisa dipakai di prod.

Hook-by-hook details: [`../FORK-HOOKS.md`](../FORK-HOOKS.md). Deploy history and rollback: [`handoff.md`](../../opencode-app/handoff.md).

## 2.0.15-fork.3-backfill (2026-10-02, staged — belum rilis)

Penutup 5% sisa fork.3: tidak ada perubahan runtime, hanya backfill + docs.

- Vault `C:/Users/fadhi/Documents/Obsidian/opencode-memory` terisi penuh:
  142 session notes + 576 entries + 56 project notes (opencode 43, cline 8,
  claude transcripts 25, claude-code 55, claude-desktop 11; deterministik tanpa
  LLM; full transcript tidak dicopy). Lihat `docs/MEMORY_OBSIDIAN.md` § Backfill.
- Baru (staged): `packages/core/src/memory/import.ts`
  (`summarizeDeterministic`, `readClaudeCodeFile`, `readClineFile`,
  `readInboxFile`, `fingerprint`) + `packages/core/test/memory-import.test.ts`.
- Betulkan link `handoff.md` → `../../opencode-app/handoff.md` (2 baris).
- Belum: tabel `memory` di DB prod (butuh restart `4096` sekali agar migrasi
  `20261001000000` jalan, lalu verifikasi `memory_search` live).

Hook-by-hook details: [`../FORK-HOOKS.md`](../FORK-HOOKS.md). Deploy history and rollback: [`handoff.md`](../../opencode-app/handoff.md).

## 2.0.15-fork.3 (2026-10-02)

### Smarter answers, no more loops
- Replies follow a short structure (summary, details, files, verify, next) and never invent ratings, prices, or hours the tools did not return.
- The runner stops nagging after 2 unconfirmed-completion retries instead of looping.

### Memory (Obsidian vault)
- New tools: `memory_save`, `memory_search`, `memory_forget` (all ask-first, permission `memory.*`).
- Vault-backed recall (max 4KB) in the system prompt; an empty vault changes nothing. Compaction proposes Memory Candidates.
- Settings → Memory: vault directory + auto-save preference. The vault is plain markdown so other agents can share it.

### Ultimate scraper (`scrape_fetch` / `scrape_status`)
- One tool for chat, code, and classifier: fast (webfetch) → stealth (camofox → scrapling) → AI (scrapegraph) → channels (agent-reach); first success wins with a warning trail.
- Camofox works without VS Build Tools via the python `camoufox` backend (verified live); the node REST server stays optional.
- Scrapegraph uses `scrapegraphai` + the 9router key; it skips honestly without a key. Auto-setup via uv, kill-switch `OPENCODE_SCRAPER_NO_AUTOSETUP=1`.
- Settings → Scraper: default mode, auto-setup, per-engine status.

### Classifier (renamed from Laya)
- Chat/Code/Classifier view modes; `classifier_classify` plus a deprecated `laya_classify` alias for one release.
- Removed the in-composer guide note; clearer deterministic-mode messages (no raw `noul`/platform text to the user).

Hook-by-hook details: [`../FORK-HOOKS.md`](../FORK-HOOKS.md). Deploy history and rollback: [`handoff.md`](../../opencode-app/handoff.md).

## 2.0.15-fork.2 (2026-10-01)

- Chat quotes and notes capture the whole selection, even with a slow drag. Before, a pause during the drag kept
  only the first word.
- The quoted text stays highlighted while you write the note. The note box shows exactly what will be quoted
  and sits below the selection.
- The composer chip shows the quoted text, with the full quote and note on hover.
- The canvas plugin (outside the repo, `~/.config/opencode/plugins/opencode-preview`) no longer hangs a turn when
  two projects start the canvas at once. See `../../opencode-app/handoff.md`.

## 2.0.15-fork.1 (2026-09-30)

This is the first versioned release. It is based on upstream opencode v2.0.15 plus Cline's chat stack.

### v1 UX restored on v2
- v1 look and layout, Chat, Code and Laya view modes, topics and side chat.
- A web Browser pane with a loopback direct frame and the annotator.
- Generated-file cards with download and preview, and pdf.js PDF preview.
- Timeline freeze fix for 75% zoom (the virtualizer settle tolerance).
- The file-card black screen fix: no `createResource` in the timeline.

### Launcher and Windows
- The launcher signs in without a Basic-auth prompt.
- Plugins no longer open console windows, and Playwright runs headless.
- IDM no longer hijacks previews:
  - file reads go to `/api/fs/read/~b64~<base64url>` and return `application/octet-stream`
  - sounds are inlined
- An open window offers a "new version, Reload" toast after each deploy.

### Chat
- `[[OPENCODE_TASK_COMPLETE]]` is hidden. The runner still uses it.
- Canvas output from the opencode-preview and opencode-artifacts plugins opens in a side-panel tab, not a
  browser window.

### Maps and spatial analysis (free only)
- Tools:
  - `maps_search`, `maps_ask`, `maps_route`, `maps_matrix`, `maps_poi` and `map_show`.
  - `geo_compute`, which covers geodesics, UTM, buffers, hulls, DBSCAN, ranking, classification (best of Jenks,
    quantile, equal, std-dev and head/tail by GVF), Moran's I, Getis-Ord Gi*, Clark–Evans and centrography.
- Data sources:
  - OpenStreetMap: Nominatim (preferring POIs), Photon, OSRM and Overpass.
  - Free enrichment: OSM hours, stars and contacts, plus Wikimedia photos whose title names the place.
  - Google Maps via the Gemini free tier: disabled for new keys (2.5 models retired), falls back to OSM, never
    billed.
- Settings → Maps:
  - key, a free-tier confirmation and daily-limit guard
  - a "429 means stop for the day" rule
- The Research providers block is collapsed and points to Maps.
- UI:
  - A Map tab in the side panel with numbered pins, name chips and a card strip. It opens on the first result.
  - Gemini-style inline place cards in replies.
  - A photo carousel in tool cards.
- Research for place, hotel and event queries uses Maps. The Laya fallback follows a spatial ranking.

Hook-by-hook details: [`../FORK-HOOKS.md`](../FORK-HOOKS.md). Deploy history and rollback: [`handoff.md`](../../opencode-app/handoff.md).

