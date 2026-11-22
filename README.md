# 🧾 ResitKu

PWA local-first untuk jejak resit relief cukai LHDN.

- **Takde server.** Semua data & gambar resit simpan dalam phone (IndexedDB).
- **Scan resit** (OCR Tesseract.js, BM + EN), auto-isi amaun, tarikh, kedai & cadang kategori.
- **Dashboard** baki setiap kategori relief + anggaran cukai dijimat ikut bracket.
- **Countdown 31 Dis** + amaran kalau lama tak backup.
- **Backup ZIP** (data.json + gambar ikut folder tahun/kategori + CSV), simpan di mana-mana (Drive, OneDrive, WhatsApp...). Restore bila tukar phone.

## Update had relief
Edit `reliefs.js` je setiap Belanjawan baru.

## Deploy
GitHub Pages: Settings → Pages → Branch `main` / root.

## Roadmap
- [ ] Fasa 2: auto-backup ke Google Drive user sendiri (scope `drive.file`)
- [ ] Import data pasangan (read-only) + cadangan siapa patut claim
- [ ] Export ikut susunan borang BE

⚠️ Rujukan sahaja, bukan nasihat cukai.
