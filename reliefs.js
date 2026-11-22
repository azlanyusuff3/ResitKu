// Had relief LHDN — individu pemastautin.
// YA2026 (pendapatan 2026, isi borang 2027) — termasuk perubahan Belanjawan 2026.
// SEMAK SEMULA setiap Belanjawan baru & kemas kini file ni je. (Belanjawan 2027 berkuat kuasa YA2027.)
// keywords = untuk auto-cadang kategori dari teks OCR resit.
const YA2026 = {
  ya: 2026,
  personal: 9000,
  note: "Had YA2026 (termasuk perubahan Belanjawan 2026). Relief individu RM9,000 auto. Sahkan dengan jadual LHDN sebelum e-Filing 2027.",
  categories: [
    { id: "lifestyle", name: "Gaya Hidup", limit: 2500, icon: "📱",
      desc: "Buku, majalah, smartphone, tablet, komputer, internet, kursus upskilling",
      keywords: ["popular", "mph", "kinokuniya", "bookxcess", "harris", "borders", "times bookstore", "bookstore", "kedai buku", "isbn", "novel", "majalah", "magazine", "ebook", "kindle", "dbp", "dewan bahasa", "apple", "samsung", "huawei", "xiaomi", "laptop", "books", "buku", "unifi", "maxis", "celcom", "digi", "umobile", "time fibre", "harvey norman", "senheng", "machines"] },
    { id: "sports", name: "Sukan", limit: 1000, icon: "🏸",
      desc: "Peralatan sukan, yuran gym, sewa gelanggang, yuran pertandingan (diri, pasangan, anak, ibu bapa)",
      keywords: ["decathlon", "sports", "gym", "fitness", "badminton", "futsal", "anytime fitness", "celebrity fitness", "al-ikhsan", "running", "court"] },
    { id: "medical", name: "Perubatan (diri/pasangan/anak)", limit: 10000, icon: "🏥",
      desc: "Penyakit serius, fertiliti, semua vaksin berdaftar NPRA & gigi & pemeriksaan penuh/mental health (RM1,000 setiap satu), anak kurang upaya pembelajaran (sub-had RM10,000)",
      subs: [{ id: "dental", name: "Rawatan gigi", limit: 1000 }, { id: "vaccine", name: "Vaksin", limit: 1000 }, { id: "checkup", name: "Pemeriksaan penuh / mental health / kit ujian", limit: 1000 }, { id: "learning", name: "Anak kurang upaya pembelajaran", limit: 10000 }],
      keywords: ["hospital", "klinik", "clinic", "dental", "pergigian", "medical", "pharmacy", "farmasi", "vaksin", "vaccine", "kpj", "pantai", "columbia", "sunway medical", "guardian", "watsons", "caring"] },
    { id: "parents_medical", name: "Perubatan Ibu Bapa/Datuk Nenek", limit: 8000, icon: "👵",
      desc: "Rawatan, penjagaan, pemeriksaan & vaksin ibu bapa / datuk nenek",
      subs: [{ id: "checkup", name: "Pemeriksaan penuh & vaksin", limit: 1000 }],
      keywords: [] },
    { id: "education_self", name: "Pendidikan Diri", limit: 7000, icon: "🎓",
      desc: "Yuran diploma/ijazah/sarjana/PhD, kursus upskilling (sub-had RM2,000)",
      subs: [{ id: "upskill", name: "Kursus upskilling / kemahiran", limit: 2000 }],
      keywords: ["university", "universiti", "college", "kolej", "yuran", "tuition fee", "uitm", "oum", "unitar"] },
    { id: "epf_life", name: "KWSP + Insurans Hayat", limit: 7000, icon: "🛡️",
      desc: "KWSP/pencen (RM4,000) + insurans hayat/takaful diri, pasangan & anak (RM3,000)",
      subs: [{ id: "epf", name: "KWSP / pencen", limit: 4000 }, { id: "life", name: "Insurans hayat / takaful", limit: 3000 }], subsOnly: true,
      keywords: ["life insurance", "takaful", "great eastern", "prudential", "aia", "allianz life", "etiqa", "kwsp", "epf"] },
    { id: "edu_med_insurance", name: "Insurans Pendidikan & Perubatan", limit: 4000, icon: "📋",
      desc: "Premium insurans pendidikan / perubatan (diri, pasangan, anak)",
      keywords: ["medical card", "medical insurance", "education insurance"] },
    { id: "prs", name: "PRS / Anuiti Tertangguh", limit: 3000, icon: "🏦",
      desc: "Caruman Private Retirement Scheme",
      keywords: ["prs", "private retirement", "ppa"] },
    { id: "sspn", name: "SSPN (simpanan bersih)", limit: 8000, icon: "🐷",
      desc: "Simpanan bersih SSPN untuk anak (deposit tolak pengeluaran)",
      keywords: ["sspn", "ptptn"] },
    { id: "socso", name: "PERKESO / SIP", limit: 350, icon: "👷",
      desc: "Caruman SOCSO & EIS (biasanya dalam EA form)",
      keywords: ["perkeso", "socso"] },
    { id: "childcare", name: "Taska / Tadika / Transit", limit: 3000, icon: "🧸",
      desc: "Yuran taska/tadika, pusat jagaan harian & pusat transit selepas sekolah berdaftar (anak ≤ 12 tahun)",
      keywords: ["taska", "tadika", "kindergarten", "nursery", "childcare", "transit", "daycare", "day care"] },
    { id: "breastfeeding", name: "Peralatan Penyusuan", limit: 1000, icon: "🍼",
      desc: "Pam susu, beg sejuk, dll (anak ≤ 2 tahun) — sekali setiap 2 tahun",
      keywords: ["breast pump", "medela", "spectra", "pigeon"] },
    { id: "ev", name: "Hijau: EV / Kompos / CCTV", limit: 2500, icon: "🔌",
      desc: "Pengecas EV, mesin kompos / pengisar sisa makanan, CCTV rumah (baru YA2026)",
      keywords: ["ev charger", "chargev", "gentari", "jomcharge", "compost", "food waste", "cctv", "ezviz", "tapo", "imou", "hikvision"] },
    { id: "tourism", name: "Pelancongan Domestik", limit: 1000, icon: "🎡", onlyYA: 2026,
      desc: "Tiket masuk tarikan pelancongan & program seni/budaya dalam negara — YA2026 SAHAJA",
      keywords: ["zoo negara", "aquaria", "sunway lagoon", "legoland", "genting skytropolis", "skytropolis", "petrosains", "kl tower", "menara kl", "theme park", "museum", "muzium", "istana budaya", "dewan filharmonik", "escape", "farm in the city", "skyworlds"] },
    { id: "disabled_equip", name: "Peralatan OKU", limit: 6000, icon: "♿",
      desc: "Peralatan sokongan untuk diri/pasangan/anak/ibu bapa OKU",
      keywords: ["wheelchair", "kerusi roda", "hearing aid"] },
  ],
};

// Kadar cukai pemastautin — [had atas band, kadar]
const BANDS_2026 = [[5000, 0], [20000, .01], [35000, .03], [50000, .06], [70000, .11], [100000, .19],
  [400000, .25], [600000, .26], [2000000, .28], [Infinity, .30]];
YA2026.bands = BANDS_2026;

// ---------- YA2027 (Belanjawan 2027, dibentang 9 Okt 2026 — CADANGAN, tunggu Akta Kewangan & senarai LHDN) ----------
const clone = o => JSON.parse(JSON.stringify(o));
const YA2027 = clone(YA2026);
YA2027.ya = 2027;
YA2027.personal = 12000; // naik dari RM9,000
YA2027.note = "Had YA2027 ikut cadangan Belanjawan 2027 (relief individu RM12,000 auto). Masih cadangan — sahkan dengan senarai LHDN YA2027.";
YA2027.bands = BANDS_2026.map(([t, r]) => [t, t === 100000 ? .18 : r]); // RM70k–100k turun 1 mata peratus
YA2027.categories = YA2027.categories.filter(c => c.id !== "tourism"); // YA2026 sahaja
const life = YA2027.categories.find(c => c.id === "lifestyle");
life.desc = "Buku, smartphone, tablet, komputer, internet, upskilling + BARU: langganan AI (ChatGPT, Gemini, Claude...), ambil haiwan peliharaan dari pusat berdaftar, vaksin & mandul haiwan di vet berdaftar";
life.keywords.push("openai", "chatgpt", "gemini", "claude", "anthropic", "copilot", "midjourney", "perplexity", "cursor", "grammarly", "veterinar", "vet ", "klinik haiwan", "animal clinic", "spca", "pet adoption");
const sport = YA2027.categories.find(c => c.id === "sports");
sport.desc += " + BARU: kasut sukan (sub-had RM300)";
sport.subs = [{ id: "shoes", name: "Kasut sukan", limit: 300 }];
sport.keywords.push("nike", "adidas", "asics", "skechers", "puma", "new balance", "hoka");

window.RELIEF_YEARS = { 2026: YA2026, 2027: YA2027 };
// Pilih set relief ikut YA (tahun belum ada → guna yang paling dekat)
window.reliefFor = y => {
  const ys = Object.keys(window.RELIEF_YEARS).map(Number).sort((a, b) => a - b);
  const pick = ys.filter(x => x <= y).pop() || ys[0];
  return window.RELIEF_YEARS[pick];
};
window.RELIEF_CONFIG = {};
window.setReliefYA = y => Object.assign(window.RELIEF_CONFIG, window.reliefFor(y));
window.findCat = id => { for (const k in window.RELIEF_YEARS) { const c = window.RELIEF_YEARS[k].categories.find(x => x.id === id); if (c) return c; } return null; };
window.setReliefYA(new Date().getFullYear());
