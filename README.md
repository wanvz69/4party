# Pengelola Party The Forge

Bot Discord pencari party The Forge yang tersimpan secara permanen. Anggota membuat, mencari, bergabung, dan mengelola party melalui panel, menu, serta formulir interaktif. `/setup` adalah satu-satunya perintah slash.

## Fitur

- `/setup` membuat atau memperbaiki kategori, kanal, dan panel party tanpa menggandakan struktur yang sudah ada.
- Party umum dan pribadi, kode lima karakter yang dibuat secara kriptografis, dan kanal lobi untuk setiap party.
- Keanggotaan SQLite transaksional dengan batas sepuluh anggota serta batasan satu party aktif per pengguna.
- Daftar party dengan halaman, undang anggota, keluarkan anggota, pindahkan pemimpin, keluar, dan tutup party.
- Pemulihan saat bot dimulai ulang untuk panel atau lobi yang hilang serta penghapusan lobi yang tertunda.
- Party ditutup otomatis setelah 30 menit tanpa pesan anggota di kanal lobi; waktu aktivitas disimpan di SQLite dan tetap berlaku setelah bot dimulai ulang.
- Pengujian bawaan Node.js untuk aturan party, pemindahan pemimpin, penyimpanan, dan percobaan bergabung bersamaan.

## Persyaratan

- Node.js versi 22 atau lebih baru dan npm.
- Aplikasi serta bot Discord yang sudah ditambahkan ke satu server.
- Windows PowerShell atau CMD untuk perintah di bawah.

## Pengaturan di Discord Developer Portal

1. Buat aplikasi dan tambahkan bot melalui menu **Bot**.
2. Salin token bot dan simpan secara rahasia. Jangan masukkan token ke dalam repositori.
3. Di **Bot → Privileged Gateway Intents**, aktifkan **Server Members Intent**. Bot menggunakan fitur ini untuk memilih dan memeriksa anggota server. Bot juga memerlukan intent **Guild Messages** untuk mendeteksi obrolan di kanal lobi; intent **Message Content** tidak diperlukan.
4. Di **OAuth2 → URL Generator**, pilih cakupan `bot` dan `applications.commands`.
5. Berikan izin berikut kepada bot:
   - Kelola Kanal
   - Kelola Peran (diperlukan untuk mengatur izin kanal lobi)
   - Lihat Kanal
   - Kirim Pesan
   - Sematkan Tautan
   - Baca Riwayat Pesan
6. Tambahkan bot ke server yang akan digunakan. Jangan berikan izin Administrator kecuali memang diwajibkan oleh kebijakan server.

## Instalasi dan konfigurasi (Windows)

Buka CMD di folder proyek:

```cmd
npm install
copy .env.example .env
notepad .env
```

Isi nilai berikut di `.env`:

```dotenv
DISCORD_TOKEN=token-bot-anda
CLIENT_ID=id-aplikasi-discord-anda
GUILD_ID=id-server-anda
LOBBY_VIEW_ROLE_IDS=id-peran-opsional,id-peran-lain
DATABASE_PATH=./data/party.sqlite
LOG_LEVEL=info
```

`LOBBY_VIEW_ROLE_IDS` bersifat opsional. Peran yang dicantumkan dapat melihat semua lobi party. Jika dikosongkan, hanya bot dan anggota party terkait yang dapat melihat lobi. ID peran akan diperiksa saat pengaturan server dijalankan.

Daftarkan perintah `/setup` ke server, lalu jalankan bot:

```cmd
npm run deploy
npm start
```

Setelah itu, jalankan `/setup` sebagai administrator server. Bot akan membuat:

- Kategori `SISTEM PARTY` dengan kanal `#buat-party` dan `#daftar-party`
- Kategori `LOBI PARTY` untuk kanal tiap party

Panel akan dibuat atau diperbarui di pesan yang sama, bukan dikirim ulang setiap bot dimulai. Jalankan `/setup` lagi kapan saja untuk memperbaiki kanal atau pesan yang hilang tanpa menggandakan struktur.

Mode pengembangan opsional:

```cmd
npm run dev
```

## Basis data dan pemulihan

SQLite disimpan di lokasi `DATABASE_PATH`; folder induknya dibuat otomatis. Skema menggunakan foreign key dan mode WAL. Satu pengguna hanya dapat menjadi anggota satu party aktif, setiap pemimpin harus tercatat sebagai anggota, dan perubahan keanggotaan dilakukan dalam transaksi SQLite.

Saat mulai, bot memperbaiki kanal dan panel yang dikonfigurasi, mencoba ulang penghapusan lobi yang tertunda, memeriksa lobi party aktif, menyelaraskan izin kanal lobi, lalu memperbarui daftar party umum. Jika lobi dihapus secara manual, bot membuat ulang lobi untuk party yang sama. Penutupan yang gagal akan tetap tersembunyi dan dicoba lagi saat bot dimulai berikutnya.

Waktu aktivitas diperbarui setiap kali anggota mengirim pesan di kanal lobi party. Pesan bot dan webhook tidak dihitung sebagai aktivitas. Party tanpa obrolan anggota selama 30 menit akan ditutup otomatis, kanal lobi dihapus, data party dibersihkan, dan para anggota akan diberi tahu melalui pesan pribadi jika memungkinkan. Pemeriksaan dilakukan setiap 30 detik, jadi penutupan dapat terjadi paling lambat sekitar 30 detik setelah batas waktu. Aktivitas terakhir disimpan dalam basis data dan dipulihkan saat bot dimulai ulang.

## Pengujian dan pemeriksaan

```cmd
npm test
npm run check
```

## Pemecahan masalah

- **Variabel lingkungan belum diisi:** periksa `.env`; jangan gunakan tanda kutip untuk token atau ID biasa.
- **Perintah `/setup` tidak muncul:** jalankan `npm run deploy` lagi dan pastikan `CLIENT_ID` serta `GUILD_ID` benar.
- **Pengaturan gagal karena izin:** berikan izin Kelola Kanal, Kelola Peran, Lihat Kanal, Kirim Pesan, Sematkan Tautan, dan Baca Riwayat Pesan.
- **Menu undang anggota tidak bekerja:** aktifkan Server Members Intent di Developer Portal, mulai ulang bot, dan pastikan bot ada di server.
- **Akses lobi tidak sesuai:** periksa ID peran yang dikonfigurasi lalu jalankan `/setup` lagi. Bot juga menyelaraskan izin saat mulai.
- **Basis data terkunci atau tidak tersedia:** hentikan proses bot yang ganda dan pastikan folder basis data dapat ditulis.

## Struktur proyek

```text
src/
  commands/          perintah pengaturan administrator dan pemulihan struktur server
  config/            konfigurasi lingkungan
  database/          skema dan inisialisasi SQLite
  embeds/            panel permanen, daftar party, dan lobi
  interactions/      pengelola interaksi komponen permanen
  services/          layanan party, lobi, izin, daftar, dan pemulihan
  utils/              validasi, kode aman, pencatatan, dan utilitas Discord
tests/                pengujian logika bisnis dengan Node.js
data/                 basis data SQLite yang dibuat saat dijalankan
```

## Batasan yang diketahui

- Discord dapat menolak pesan pribadi jika anggota menonaktifkan pesan pribadi dari anggota server. Perubahan party tetap diproses dan kegagalan notifikasi dicatat.
- Daftar party umum menggunakan satu panel berpaginasi bersama, sehingga perubahan halaman terlihat oleh semua orang.
- Discord dan SQLite tidak dapat digabungkan dalam satu transaksi. Keanggotaan basis data dibatalkan jika sinkronisasi lobi atau daftar gagal; penutupan yang gagal menghapus kanal akan masuk antrean untuk dicoba kembali.
"# 4party" 
