# 🧾 ResitKu

PWA local-first untuk jejak resit relief cukai LHDN.

- **Takde server.** Semua data & gambar resit simpan dalam phone (IndexedDB).
- **Scan resit** (OCR Tesseract.js, BM + EN), auto-isi amaun, tarikh, kedai & cadang kategori.
- **Dashboard** baki setiap kategori relief + anggaran cukai dijimat ikut bracket.
- **Countdown 31 Dis** + amaran kalau lama tak backup.
- **Backup ZIP** (data.json + gambar ikut folder tahun/kategori + CSV), simpan di mana-mana (Drive, OneDrive, WhatsApp...). Restore bila tukar phone.

## ➗ SplitLah (`/splitlah/`)
Split bil makan: snap resit → tap siapa makan setiap item → caj & tax bahagi sama rata (atau ikut proportion) → share gambar resit siap QR DuitNow owner.
- Takde login, data dalam phone. OCR Tesseract (free); letak Gemini API key dalam Tetapan untuk bacaan lebih tepat.
- Owner upload QR DuitNow sekali — app decode & lukis semula QR dengan kemas dalam resit.

## Update had relief
Edit `reliefs.js` je setiap Belanjawan baru.

## Deploy
GitHub Pages: Settings → Pages → Branch `main` / root.

## Setup Google Drive (sekali je, ~10 minit)
1. Buka https://console.cloud.google.com → **New Project** (nama: ResitKu)
2. **APIs & Services → Library** → cari **Google Drive API** → Enable
3. **OAuth consent screen** → External → isi nama app + email → Scopes: tambah `.../auth/drive.file` → **Test users**: tambah email kau & wife
4. **Credentials → Create Credentials → OAuth client ID** → jenis **Web application**
   - Authorized JavaScript origins: `https://azlanyusuff3.github.io`
   - Authorized redirect URIs: `https://azlanyusuff3.github.io/resitku/`
5. Copy **Client ID** → tampal dalam `config.js`
6. Push → buka app → Tetapan → **Sambung Google Drive**

> Mode Testing: max 100 test user (kena tambah email manual). Untuk 2–10 orang, cukup.

## Roadmap
- [x] Google Drive sync (scope `drive.file`, Drive user sendiri)
- [ ] Import data pasangan (read-only) + cadangan siapa patut claim
- [ ] Export ikut susunan borang BE

⚠️ Rujukan sahaja, bukan nasihat cukai.
