const CFG = window.RELIEF_CONFIG;
const $ = s => document.querySelector(s);
const fmt = n => "RM" + Number(n || 0).toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
let receipts = [];
let currentImg = null;
let editingId = null, imgChanged = false;
let who = "me"; // dashboard: me | sp | all
const byOf = r => r.by || "me";
const isPdf = b => b && (b.type === "application/pdf" || (b.name || "").toLowerCase().endsWith(".pdf"));
let year = new Date().getFullYear();

function taxOn(ci) {
  let tax = 0, prev = 0;
  for (const [top, r] of CFG.bands) { if (ci <= prev) break; tax += (Math.min(ci, top) - prev) * r; prev = top; }
  return tax;
}
function marginal(ci) { for (const [top, r] of CFG.bands) { if (ci <= top) return r; } return .3; }

function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2200); }

// ---------- NAV ----------
document.querySelectorAll("nav button").forEach(b => b.onclick = () => show(b.dataset.v));
function show(v) {
  document.querySelectorAll(".view").forEach(x => x.classList.toggle("active", x.id === "view-" + v));
  document.querySelectorAll("nav button").forEach(x => x.classList.toggle("on", x.dataset.v === v));
  if (v === "list") renderList();
  if (v === "dash") renderDash();
  window.scrollTo(0, 0);
}

// ---------- INIT ----------
async function init() {
  if (navigator.storage && navigator.storage.persist) {
    const ok = await navigator.storage.persist().catch(() => false);
    $("#storageInfo").textContent = ok ? "✅ Storage kekal diaktifkan." : "⚠️ Browser tak jamin storage kekal — Add to Home Screen & buat backup selalu.";
  }
  receipts = await DB.all();
  const ys = new Set([new Date().getFullYear(), ...(new Date().getMonth() >= 10 ? [new Date().getFullYear() + 1] : []), ...receipts.map(r => +r.date.slice(0, 4))]);
  $("#yearSel").innerHTML = [...ys].sort((a, b) => b - a).map(y => `<option value="${y}">YA ${y}</option>`).join("");
  $("#yearSel").value = year;
  $("#yearSel").onchange = e => { year = +e.target.value; setReliefYA(year); $("#cfgNote").textContent = CFG.note; renderDash(); renderList(); };
  fillCats();
  $("#fDate").onchange = fillCats;
  $("#fCat").onchange = () => fillSubs();
  $("#fDate").valueAsDate = new Date(); fillCats();
  $("#income").value = (await DB.getMeta("income")) || "";
  $("#income").onchange = async e => { await DB.setMeta("income", +e.target.value || 0); renderDash(); };
  $("#income2").value = (await DB.getMeta("income2")) || "";
  $("#income2").onchange = async e => { await DB.setMeta("income2", +e.target.value || 0); renderDash(); };
  $("#cfgNote").textContent = CFG.note;
  const draft = await DB.getMeta("draftImg");
  if (draft && !currentImg) { currentImg = draft; showPreview(); $("#ocrStatus").textContent = "📎 Gambar resit tadi masih ada — isi butiran & simpan."; show("add"); }
  renderDash();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

// ---------- DASHBOARD ----------
document.querySelectorAll("#whoTabs button").forEach(b => b.onclick = () => {
  who = b.dataset.who;
  document.querySelectorAll("#whoTabs button").forEach(x => x.classList.toggle("on", x === b));
  renderDash();
});

const eaKey = (y, w) => `ea:${y}:${w}`;
async function getEA(y, w) { return (await DB.getMeta(eaKey(y, w))) || {}; }

// Kira relief untuk seorang pembayar cukai (resit + EA)
async function computeFor(w) {
  const ea = await getEA(year, w);
  const rs = receipts.filter(r => r.date.startsWith(String(year)) && byOf(r) === w);
  if (ea.epf) rs.push({ cat: "epf_life", sub: "epf", amount: +ea.epf, virtual: true });
  if (ea.socso) rs.push({ cat: "socso", amount: +ea.socso, virtual: true });
  let claimed = 0, totalLimit = 0;
  const rows = CFG.categories.map(c => {
    const cr = rs.filter(r => r.cat === c.id);
    const spent = cr.reduce((s, r) => s + r.amount, 0);
    const subs = (c.subs || []).map(sb => {
      const sp = cr.filter(r => r.sub === sb.id).reduce((s, r) => s + r.amount, 0);
      return { ...sb, spent: sp, eff: Math.min(sp, sb.limit) };
    });
    const other = cr.filter(r => !r.sub || !subs.some(sb => sb.id === r.sub)).reduce((s, r) => s + r.amount, 0);
    const eff = Math.min(subs.reduce((s, sb) => s + sb.eff, 0) + other, c.limit);
    claimed += eff; totalLimit += c.limit;
    return { c, spent, eff, subs, left: Math.max(c.limit - eff, 0), pct: Math.min(eff / c.limit * 100, 100) };
  });
  const income = +(await DB.getMeta(w === "me" ? "income" : "income2")) || 0;
  let tax = null;
  if (income > 0) {
    const base = Math.max(income - CFG.personal, 0);
    const ci = Math.max(base - claimed, 0);
    let payable = taxOn(ci);
    const rebate = ci <= 35000 ? Math.min(400, payable) : 0;
    payable = Math.max(payable - rebate - (+ea.zakat || 0), 0);
    tax = { income, ci, saved: taxOn(base) - taxOn(ci), rate: marginal(ci), payable, pcb: ea.pcb != null && ea.pcb !== "" ? +ea.pcb : null, zakat: +ea.zakat || 0, rebate };
  }
  return { rows, claimed, totalLimit, tax, ea };
}

async function renderDash() {
  const parts = who === "all" ? [await computeFor("me"), await computeFor("sp")] : [await computeFor(who)];
  // Gabung (untuk "Semua": had digandakan sebab setiap orang ada had sendiri)
  const rows = parts[0].rows.map((r, i) => {
    if (parts.length === 1) return r;
    const o = parts[1].rows[i];
    return { c: { ...r.c, limit: r.c.limit * 2 }, spent: r.spent + o.spent, eff: r.eff + o.eff,
      subs: r.subs.map((sb, j) => ({ ...sb, limit: sb.limit * 2, spent: sb.spent + o.subs[j].spent, eff: sb.eff + o.subs[j].eff })),
      left: r.left + o.left, pct: Math.min((r.eff + o.eff) / (r.c.limit * 2) * 100, 100), split: [r.eff, o.eff] };
  });
  const claimed = parts.reduce((s, p) => s + p.claimed, 0);
  const totalLimit = parts.reduce((s, p) => s + p.totalLimit, 0);
  rows.sort((a, b) => (b.spent > 0) - (a.spent > 0) || (a.pct === 100) - (b.pct === 100) || b.left - a.left);

  $("#totClaimed").textContent = fmt(claimed);
  $("#totLeft").textContent = `daripada ${fmt(totalLimit)} had kategori yang dijejak`;
  const taxes = parts.map(p => p.tax).filter(Boolean);
  if (taxes.length) {
    $("#taxSaved").textContent = fmt(Math.round(taxes.reduce((s, t) => s + t.saved, 0)));
    $("#rateInfo").textContent = parts.length === 1 ? `Setiap RM100 lagi ≈ jimat RM${Math.round(taxes[0].rate * 100)}` : "Gabungan aku + pasangan";
  } else {
    $("#taxSaved").textContent = "—";
    $("#rateInfo").textContent = "Isi pendapatan di Tetapan";
  }

  // Kotak anggaran cukai / bayaran balik
  const tb = $("#taxBox");
  const names = parts.length === 1 ? [who === "me" ? "Aku" : "Pasangan"] : ["Aku", "Pasangan"];
  const boxes = parts.map((p, i) => {
    const t = p.tax; if (!t) return "";
    let line = `Cukai anggaran: <b>${fmt(Math.round(t.payable))}</b>` + (t.zakat ? ` <small>(lepas zakat ${fmt(t.zakat)})</small>` : "") + (t.rebate ? ` <small>(rebat RM400)</small>` : "");
    if (t.pcb !== null) {
      const diff = t.pcb - t.payable;
      line += diff >= 0 ? `<br>💰 Anggaran <b>refund ${fmt(Math.round(diff))}</b> (PCB ${fmt(t.pcb)})` : `<br>⚠️ Anggaran <b>kena bayar lagi ${fmt(Math.round(-diff))}</b> (PCB ${fmt(t.pcb)})`;
    } else line += `<br><small>Isi PCB dalam "EA form" untuk anggar refund</small>`;
    return `<div><small>${names[i]} · pendapatan bercukai ${fmt(Math.round(t.ci))}</small><div>${line}</div></div>`;
  }).join("");
  tb.innerHTML = boxes; tb.classList.toggle("hidden", !boxes);
  $("#btnEA").classList.toggle("hidden", who === "all");

  // Cadangan siapa patut claim (bila kedua-dua pendapatan ada)
  let tip = "";
  if (who === "all" && parts[0].tax && parts[1].tax && parts[0].tax.rate !== parts[1].tax.rate) {
    const hi = parts[0].tax.rate > parts[1].tax.rate ? "Aku" : "Pasangan";
    tip = `<div class="banner">💡 Untuk perbelanjaan keluarga yang boleh di-claim oleh sesiapa (cth: perubatan anak, SSPN, taska), claim bawah <b>${hi}</b> dulu — bracket ${Math.round(Math.max(parts[0].tax.rate, parts[1].tax.rate) * 100)}% vs ${Math.round(Math.min(parts[0].tax.rate, parts[1].tax.rate) * 100)}%, jimat lebih untuk setiap RM.</div>`;
  }

  const rate = parts.length === 1 && parts[0].tax ? parts[0].tax.rate : 0;
  $("#cats").innerHTML = tip + rows.map(({ c, spent, eff, subs, left, pct, split }) => `
    <div class="cat ${pct >= 100 ? "full" : spent > 0 ? "part" : ""}">
      <div class="cathead"><span>${c.icon} <b>${c.name}</b></span><span>${fmt(eff)} / ${fmt(c.limit)}</span></div>
      <div class="bar"><div style="width:${pct}%"></div></div>
      ${split ? `<small class="split">👤 ${fmt(split[0])} · 💑 ${fmt(split[1])}</small>` : ""}
      ${spent > eff + 0.005 ? `<small class="over">⚠️ Belanja ${fmt(spent)}, tapi hanya ${fmt(eff)} boleh dikira (had/sub-had penuh)</small>` : ""}
      ${subs.length ? `<div class="subs">${subs.map(sb => `<div class="sub ${sb.spent >= sb.limit ? "full" : ""}"><span>↳ ${sb.name}</span><span>${fmt(sb.eff)} / ${fmt(sb.limit)}${sb.spent >= sb.limit ? " ✅" : ""}</span></div>`).join("")}</div>` : ""}
      <div class="catfoot"><small>${c.desc}</small>
      <small class="left">${pct >= 100 ? "✅ Penuh" : `Baki ${fmt(left)}${rate ? ` · jimat ~${fmt(Math.round(left * rate))}` : ""}`}</small></div>
    </div>`).join("");

  // Countdown hujung tahun
  const now = new Date();
  if (year === now.getFullYear()) {
    const days = Math.ceil((new Date(year, 11, 31, 23, 59) - now) / 864e5);
    const top = rows.filter(r => r.left > 0 && r.spent > 0).slice(0, 2).map(r => `${r.c.icon} ${r.c.name} (${fmt(r.left)})`).join(", ");
    $("#countdown").innerHTML = `⏳ <b>${days} hari</b> lagi sebelum 31 Dis.` + (top ? ` Baki terdekat: ${top}` : "");
  } else $("#countdown").innerHTML = `📁 Paparan YA ${year}`;

  const last = await DB.getMeta("lastBackup");
  const w = $("#backupWarn");
  const stale = receipts.length && (!last || Date.now() - last > 14 * 864e5);
  w.classList.toggle("hidden", !stale);
  window.renderSyncBanner && window.renderSyncBanner();
  if (stale) w.innerHTML = `⚠️ ${last ? "Backup terakhir " + Math.floor((Date.now() - last) / 864e5) + " hari lepas" : "Belum pernah backup"}. <a href="#" onclick="show('set');return false">Backup sekarang</a>`;
}

// ---------- OCR ----------
$("#fileIn").onchange = $("#galleryIn").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  if (isPdf(f)) {
    if (f.size > 8e6) return toast("PDF terlalu besar (max 8MB)");
    currentImg = new Blob([await f.arrayBuffer()], { type: "application/pdf" });
  } else currentImg = await compress(f, 1400, 0.7);
  imgChanged = true;
  await DB.setMeta("draftImg", currentImg); // simpan terus — kalau iOS reload page, gambar tak hilang
  showPreview();
  isPdf(currentImg) ? readPDF(currentImg) : runOCR(f);
};
// Kategori dalam borang ikut tahun tarikh resit
function fillCats() {
  const y = +($("#fDate").value || "").slice(0, 4) || new Date().getFullYear();
  const keep = $("#fCat").value;
  $("#fCat").innerHTML = reliefFor(y).categories.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join("");
  if ([...$("#fCat").options].some(o => o.value === keep)) $("#fCat").value = keep;
  fillSubs();
}
function fillSubs(keep) {
  const y = +($("#fDate").value || "").slice(0, 4) || new Date().getFullYear();
  const c = reliefFor(y).categories.find(x => x.id === $("#fCat").value);
  const subs = (c && c.subs) || [];
  $("#subWrap").classList.toggle("hidden", !subs.length);
  $("#fSub").innerHTML = (c && c.subsOnly ? "" : `<option value="">Umum / lain-lain</option>`) + subs.map(sb => `<option value="${sb.id}">${sb.name} (had ${fmt(sb.limit)})</option>`).join("");
  if (keep !== undefined && [...$("#fSub").options].some(o => o.value === keep)) $("#fSub").value = keep;
}
function showPreview() {
  const p = $("#preview"), d = $("#pdfPreview");
  if (!currentImg) { p.classList.add("hidden"); d.classList.add("hidden"); return; }
  if (isPdf(currentImg)) {
    p.classList.add("hidden"); d.classList.remove("hidden");
    d.innerHTML = `📄 Resit PDF (${Math.round(currentImg.size / 1024)} KB) — <a href="${URL.createObjectURL(currentImg)}" target="_blank">buka</a>`;
  } else { d.classList.add("hidden"); p.src = URL.createObjectURL(currentImg); p.classList.remove("hidden"); }
}

// PDF: ambil teks terus (e-invoice); kalau PDF scan (takde teks), render page 1 & OCR
function loadScript(src) { return new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = src; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); }); }
async function readPDF(blob) {
  $("#ocrStatus").textContent = "📄 Membaca PDF...";
  try {
    if (!window.pdfjsLib) {
      await loadScript("https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js");
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
    }
    const pdf = await pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
    let text = "";
    for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
      const pg = await pdf.getPage(i);
      const tc = await pg.getTextContent();
      // susun ikut baris (y)
      const lines = {};
      tc.items.forEach(it => { const y = Math.round(it.transform[5]); (lines[y] = lines[y] || []).push(it.str); });
      text += Object.keys(lines).sort((a, b) => b - a).map(y => lines[y].join(" ")).join("\n") + "\n";
    }
    if (text.replace(/\s/g, "").length > 20) {
      const got = parseReceipt(text);
      $("#ocrStatus").textContent = got ? "✅ PDF dibaca — semak & betulkan kalau salah." : "😕 Tak jumpa amaun dalam PDF — isi manual.";
      return;
    }
    // PDF scan → render & OCR
    const pg = await pdf.getPage(1);
    const vp = pg.getViewport({ scale: 2 });
    const cv = document.createElement("canvas"); cv.width = vp.width; cv.height = vp.height;
    await pg.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
    const png = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.9));
    runOCR(png);
  } catch (err) {
    $("#ocrStatus").textContent = "PDF tak dapat dibaca (" + (err && err.message || err) + ") — isi manual.";
  }
}

// OCR ringan: English sahaja, gambar kecil & grayscale (jimat memory iPhone)
let ocrWorker = null;
async function runOCR(file) {
  if (!window.Tesseract) { $("#ocrStatus").textContent = "OCR tak dapat load (offline?) — isi manual."; return; }
  $("#ocrStatus").textContent = "🔍 Sediakan OCR (kali pertama ambil masa sikit)...";
  try {
    const img = await compress(file, 1200, 0.85, true);
    if (!ocrWorker) ocrWorker = await Tesseract.createWorker("eng", 1, {
      logger: m => m.status === "recognizing text" && ($("#ocrStatus").textContent = `🔍 Membaca resit... ${Math.round(m.progress * 100)}%`)
    });
    const { data } = await ocrWorker.recognize(img);
    const got = parseReceipt(data.text);
    $("#ocrStatus").textContent = got ? "✅ Siap — semak & betulkan kalau salah." : "😕 OCR tak jumpa amaun — isi manual. (Cuba gambar lebih terang & lurus)";
  } catch (err) {
    $("#ocrStatus").textContent = "OCR gagal (" + (err && err.message || err) + ") — isi manual.";
  }
}

function parseReceipt(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const low = text.toLowerCase();
  // Amaun: cari baris TOTAL dulu, kalau tak jumpa ambil nombor RM terbesar
  const num = s => { const m = s.replace(/(\d),(\d{3})/g, "$1$2").replace(/(\d)\s*[,]\s*(\d{2})\b/g, "$1.$2").match(/(\d+\.\s?\d{2})/g); return m ? m.map(x => Number(x.replace(/\s/g, ""))).filter(n => n < 100000) : []; };
  let amt = 0;
  const totLine = lines.filter(l => /(grand\s*total|total|jumlah|amount due|net)/i.test(l) && !/sub\s*total|tax|sst|rounding/i.test(l));
  for (const l of totLine) { const n = num(l); if (n.length) amt = Math.max(amt, ...n); }
  if (!amt) { const all = lines.flatMap(num); if (all.length) amt = Math.max(...all); }
  if (amt) $("#fAmount").value = amt.toFixed(2);
  const found = !!amt;
  // Tarikh
  const dm = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (dm) {
    let [, d, m, y] = dm; if (y.length === 2) y = "20" + y;
    if (+m <= 12 && +d <= 31) $("#fDate").value = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Kedai = baris pertama yang ada huruf
  const merch = lines.find(l => /[a-z]{3,}/i.test(l));
  if (merch) $("#fMerchant").value = merch.slice(0, 60);
  // Kategori dari keyword
  fillCats();
  const yy = +($("#fDate").value || "").slice(0, 4) || year;
  const hit = reliefFor(yy).categories.find(c => c.keywords.some(k => low.includes(k)));
  if (hit) { $("#fCat").value = hit.id; fillSubs(); }
  // Teka sub-had dari teks
  const subHints = { dental: /dental|gigi|pergigian/, vaccine: /vaksin|vaccin|immuni/, checkup: /check.?up|pemeriksaan|screening|health screen|psych|kaunsel/, upskill: /course|kursus|workshop|certificat|bootcamp|udemy|coursera/, life: /life|takaful|hayat/, epf: /kwsp|epf/, shoes: /shoe|kasut|sneaker|footwear/ };
  for (const o of $("#fSub").options) if (o.value && subHints[o.value] && subHints[o.value].test(low)) { $("#fSub").value = o.value; break; }
  return found;
}

// Kecilkan gambar (jimat storage). gray=true untuk OCR.
function compress(file, max = 1400, q = 0.7, gray = false) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const sc = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
      const cx = cv.getContext("2d");
      if (gray) cx.filter = "grayscale(1) contrast(1.4)";
      cx.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(img.src);
      cv.toBlob(b => res(b || file), "image/jpeg", q);
    };
    img.onerror = () => res(file);
    img.src = URL.createObjectURL(file);
  });
}

// ---------- SAVE / EDIT ----------
$("#addForm").onsubmit = async e => {
  e.preventDefault();
  const old = editingId && receipts.find(r => r.id === editingId);
  const rec = {
    ...(old || {}),
    id: old ? old.id : (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    merchant: $("#fMerchant").value.trim(),
    amount: +$("#fAmount").value,
    date: $("#fDate").value,
    cat: $("#fCat").value,
    sub: $("#subWrap").classList.contains("hidden") ? "" : $("#fSub").value,
    by: $("#fBy").value,
    for: $("#fFor").value,
    note: $("#fNote").value.trim(),
    img: currentImg || null,
    created: old ? old.created : Date.now(),
    updated: Date.now(),
  };
  // Kesan duplicate: amaun sama + tarikh dekat (±3 hari) + nama kedai mirip
  const norm = x => (x || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  const dup = receipts.find(r => r.id !== rec.id && Math.abs(r.amount - rec.amount) < 0.01 &&
    Math.abs(new Date(r.date) - new Date(rec.date)) <= 3 * 864e5 && (norm(r.merchant) === norm(rec.merchant) || r.date === rec.date));
  if (dup && !confirm(`⚠️ Macam dah ada resit sama:\n${dup.merchant} · ${fmt(dup.amount)} · ${dup.date}\n\nSimpan juga?`)) return;
  // Gambar ditukar → fail lama dalam Drive ke Trash, upload yang baru
  if (old && imgChanged) { if (typeof Drive !== "undefined") await Drive.markDeleted(old); delete rec.driveId; }
  await DB.put(rec);
  if (old) receipts[receipts.indexOf(old)] = rec; else receipts.push(rec);
  toast(old ? "Resit dikemas kini ✏️" : "Resit disimpan ✅");
  resetForm();
  show(old ? "list" : "dash");
  window.afterSave && window.afterSave();
};

function resetForm() {
  const lastBy = $("#fBy").value;
  $("#addForm").reset(); $("#fBy").value = lastBy || "me"; $("#fDate").valueAsDate = new Date(); fillCats();
  currentImg = null; editingId = null; imgChanged = false; DB.setMeta("draftImg", null);
  showPreview(); $("#ocrStatus").textContent = ""; $("#fileIn").value = ""; $("#galleryIn").value = "";
  $("#addTitle").textContent = "Tambah resit"; $("#btnSave").textContent = "💾 Simpan"; $("#btnCancelEdit").classList.add("hidden");
}
$("#btnCancelEdit").onclick = () => { resetForm(); show("list"); };

function editReceipt(id) {
  const r = receipts.find(x => x.id === id); if (!r) return;
  resetForm();
  editingId = id; imgChanged = false;
  $("#fMerchant").value = r.merchant; $("#fAmount").value = r.amount; $("#fDate").value = r.date;
  fillCats(); $("#fCat").value = r.cat; fillSubs(r.sub || "");
  $("#fFor").value = r.for; $("#fBy").value = byOf(r); $("#fNote").value = r.note || "";
  currentImg = r.img || null; showPreview();
  $("#addTitle").textContent = "✏️ Edit resit"; $("#btnSave").textContent = "💾 Simpan perubahan"; $("#btnCancelEdit").classList.remove("hidden");
  $("#ocrStatus").textContent = r.img ? "Nak tukar gambar? Pilih yang baru kat atas." : "Boleh tambah gambar/PDF kat atas.";
  show("add");
}

// ---------- LIST ----------
$("#search").oninput = renderList;
function renderList() {
  const q = $("#search").value.toLowerCase();
  const cat = id => findCat(id) || { icon: "❓", name: id };
  const yr = receipts.filter(r => r.date.startsWith(String(year)))
    .filter(r => !q || (r.merchant + r.note + cat(r.cat).name).toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date));
  $("#list").innerHTML = yr.length ? yr.map(r => `
    <div class="item">
      ${r.img ? (isPdf(r.img) ? `<div data-pdf="${r.id}" class="thumb none">📄</div>` : `<img data-id="${r.id}" class="thumb">`) : `<label class="thumb none" title="Tambah gambar">📎<input type="file" accept="image/*,application/pdf" data-attach="${r.id}" hidden></label>`}
      <div class="info" data-edit="${r.id}"><b>${esc(r.merchant)} <span class="pen">✏️</span></b><small>${cat(r.cat).icon} ${cat(r.cat).name}${byOf(r) === "sp" ? "💑 · " : ""}${r.sub ? " › " + esc(((cat(r.cat).subs || []).find(x => x.id === r.sub) || {}).name || r.sub) : ""} · ${r.for} · ${r.date}</small>${r.note ? `<small>${esc(r.note)}</small>` : ""}</div>
      <div class="amt">${fmt(r.amount)}<button class="del" data-id="${r.id}">🗑</button></div>
    </div>`).join("") : `<p class="note">Takde resit lagi untuk YA ${year}.</p>`;
  document.querySelectorAll(".thumb[data-id]").forEach(im => {
    const r = receipts.find(x => x.id === im.dataset.id);
    im.src = URL.createObjectURL(r.img);
    im.onclick = () => window.open(im.src);
  });
  document.querySelectorAll("[data-pdf]").forEach(d => d.onclick = () => window.open(URL.createObjectURL(receipts.find(x => x.id === d.dataset.pdf).img)));
  document.querySelectorAll("[data-edit]").forEach(d => d.onclick = () => editReceipt(d.dataset.edit));
  document.querySelectorAll("[data-attach]").forEach(inp => inp.onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const r = receipts.find(x => x.id === inp.dataset.attach);
    r.img = isPdf(f) ? new Blob([await f.arrayBuffer()], { type: "application/pdf" }) : await compress(f, 1400, 0.7); delete r.driveId;
    await DB.put(r); toast("Gambar ditambah 📎"); renderList();
    window.afterSave && window.afterSave();
  });
  document.querySelectorAll(".del").forEach(b => b.onclick = async () => {
    if (!confirm("Padam resit ni?")) return;
    const gone = receipts.find(r => r.id === b.dataset.id); if (typeof Drive !== "undefined") await Drive.markDeleted(gone);
    await DB.del(b.dataset.id); receipts = receipts.filter(r => r.id !== b.dataset.id); renderList(); toast("Dipadam");
  });
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- BACKUP / RESTORE ----------
$("#btnExport").onclick = async () => {
  if (!window.JSZip) return toast("JSZip tak load — perlukan internet sekali");
  const zip = new JSZip();
  const data = receipts.map(({ img, ...r }) => ({ ...r, imgFile: img ? `resit/${r.date.slice(0, 4)}/${r.cat}/${r.date}_${slug(r.merchant)}_${r.id.slice(0, 6)}.${isPdf(img) ? "pdf" : "jpg"}` : null }));
  receipts.forEach((r, i) => r.img && zip.file(data[i].imgFile, r.img));
  zip.file("data.json", JSON.stringify({ app: "resitku", v: 1, exported: new Date().toISOString(), income: await DB.getMeta("income"), income2: await DB.getMeta("income2"), ea: await allEA(), receipts: data }, null, 2));
  zip.file("ringkasan.csv", csv());
  const blob = await zip.generateAsync({ type: "blob" });
  const name = `ResitKu_backup_${new Date().toISOString().slice(0, 10)}.zip`;
  const file = new File([blob], name, { type: "application/zip" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); } catch (e) { if (e.name === "AbortError") return; download(blob, name); }
  } else download(blob, name);
  await DB.setMeta("lastBackup", Date.now());
  toast("Backup siap 📦"); renderDash();
};
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 25);
function download(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); }

$("#importIn").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const zip = await JSZip.loadAsync(f);
    const meta = JSON.parse(await zip.file("data.json").async("string"));
    if (meta.app !== "resitku") throw 0;
    if (!confirm(`Restore ${meta.receipts.length} resit? Resit sedia ada dengan ID sama akan ditimpa.`)) return;
    for (const r of meta.receipts) {
      const img = r.imgFile && zip.file(r.imgFile) ? new Blob([await zip.file(r.imgFile).async("arraybuffer")], { type: r.imgFile.endsWith(".pdf") ? "application/pdf" : "image/jpeg" }) : null;
      const { imgFile, ...rest } = r;
      await DB.put({ ...rest, img });
    }
    if (meta.income) await DB.setMeta("income", meta.income);
    if (meta.income2) await DB.setMeta("income2", meta.income2);
    for (const k in (meta.ea || {})) await DB.setMeta(k, meta.ea[k]);
    receipts = await DB.all(); toast("Restore berjaya ✅"); init();
  } catch { toast("Fail ZIP tak sah"); }
  e.target.value = "";
};

function csv() {
  const head = "tarikh,kedai,kategori,untuk,amaun,nota";
  const cat = id => (findCat(id) || {}).name || id;
  const q = s => `"${String(s || "").replace(/"/g, '""')}"`;
  return [head, ...receipts.sort((a, b) => a.date.localeCompare(b.date)).map(r => [r.date, q(r.merchant), q(cat(r.cat)), r.for, r.amount.toFixed(2), q(r.note)].join(","))].join("\n");
}
$("#btnCsv").onclick = () => download(new Blob([csv()], { type: "text/csv" }), `ResitKu_${year}.csv`);

init();

// ---------- EA FORM ----------
async function allEA() {
  const out = {};
  for (let y = 2025; y <= new Date().getFullYear() + 1; y++) for (const w of ["me", "sp"]) { const v = await DB.getMeta(eaKey(y, w)); if (v) out[eaKey(y, w)] = v; }
  return out;
}
window.allEA = allEA;
$("#btnEA").onclick = async () => {
  const ea = await getEA(year, who);
  $("#eaWho").textContent = `${who === "me" ? "👤 Aku" : "💑 Pasangan"} · YA ${year}`;
  $("#eaEpf").value = ea.epf || ""; $("#eaSocso").value = ea.socso || ""; $("#eaZakat").value = ea.zakat || ""; $("#eaPcb").value = ea.pcb ?? "";
  $("#eaModal").classList.remove("hidden");
};
$("#eaSave").onclick = async () => {
  await DB.setMeta(eaKey(year, who), { epf: +$("#eaEpf").value || 0, socso: +$("#eaSocso").value || 0, zakat: +$("#eaZakat").value || 0, pcb: $("#eaPcb").value === "" ? null : +$("#eaPcb").value });
  $("#eaModal").classList.add("hidden"); toast("EA disimpan ✅"); renderDash();
  window.afterSave && window.afterSave();
};
$("#eaClose").onclick = () => $("#eaModal").classList.add("hidden");

// ---------- RINGKASAN e-FILING ----------
let beText = "";
$("#btnBE").onclick = async () => {
  const ws = who === "all" ? ["me", "sp"] : [who];
  let html = "", txt = "";
  for (const w of ws) {
    const p = await computeFor(w);
    const nm = w === "me" ? "👤 Aku" : "💑 Pasangan";
    const list = p.rows.filter(r => r.eff > 0).sort((a, b) => CFG.categories.indexOf(a.c) - CFG.categories.indexOf(b.c));
    html += `<h4>${nm} — YA ${year}</h4><table class="be"><tr><td>Individu (auto)</td><td>${fmt(CFG.personal)}</td></tr>`;
    txt += `${nm.replace(/^\S+ /, "")} — YA ${year}\nIndividu (auto): ${fmt(CFG.personal)}\n`;
    for (const r of list) {
      html += `<tr><td>${r.c.icon} ${r.c.name}</td><td>${fmt(r.eff)}</td></tr>`;
      txt += `${r.c.name}: ${fmt(r.eff)}\n`;
      for (const sb of r.subs.filter(x => x.eff > 0)) { html += `<tr class="besub"><td>↳ ${sb.name}</td><td>${fmt(sb.eff)}</td></tr>`; txt += `  - ${sb.name}: ${fmt(sb.eff)}\n`; }
    }
    html += `<tr class="betot"><td>Jumlah relief</td><td>${fmt(p.claimed + CFG.personal)}</td></tr>`;
    txt += `Jumlah relief: ${fmt(p.claimed + CFG.personal)}\n`;
    if (p.ea.zakat) { html += `<tr><td>🕌 Zakat (rebat)</td><td>${fmt(p.ea.zakat)}</td></tr>`; txt += `Zakat (rebat): ${fmt(p.ea.zakat)}\n`; }
    if (p.tax) { html += `<tr><td>Cukai anggaran</td><td>${fmt(Math.round(p.tax.payable))}</td></tr>`; txt += `Cukai anggaran: ${fmt(Math.round(p.tax.payable))}\n`; }
    html += "</table>"; txt += "\n";
  }
  html += `<p class="note">Masukkan setiap baris dalam bahagian Pelepasan di MyTax (e-BE). Nama item dalam borang mungkin berbeza sikit. Simpan resit 7 tahun. ⚠️ Rujukan sahaja.</p>`;
  beText = txt;
  $("#beBody").innerHTML = html; $("#beModal").classList.remove("hidden");
};
$("#beCopy").onclick = async () => { try { await navigator.clipboard.writeText(beText); toast("Disalin 📋"); } catch { toast("Tak dapat copy"); } };
$("#beClose").onclick = () => $("#beModal").classList.add("hidden");
["#eaModal", "#beModal"].forEach(id => $(id).onclick = e => { if (e.target.id === id.slice(1)) e.target.classList.add("hidden"); });

// ---------- PERINGATAN KALENDAR (.ics) ----------
$("#btnIcs").onclick = () => {
  const y = new Date().getFullYear();
  const ev = (d, title, desc) => {
    const ds = d.replace(/-/g, "");
    return `BEGIN:VEVENT\r\nUID:resitku-${ds}@azlanyusuff3.github.io\r\nDTSTAMP:${ds}T010000Z\r\nDTSTART;VALUE=DATE:${ds}\r\nSUMMARY:${title}\r\nDESCRIPTION:${desc}\r\nURL:https://azlanyusuff3.github.io/resitku/\r\nBEGIN:VALARM\r\nTRIGGER:PT9H\r\nACTION:DISPLAY\r\nDESCRIPTION:${title}\r\nEND:VALARM\r\nEND:VEVENT`;
  };
  const evs = [
    ev(`${y}-12-01`, "ResitKu: semak baki relief cukai", "Sebulan lagi sebelum 31 Dis. Buka ResitKu & tengok kategori yang masih ada baki."),
    ev(`${y}-12-15`, "ResitKu: 2 minggu lagi untuk relief cukai", "Gaya hidup, sukan, PRS, SSPN, insurans — habiskan baki yang memang nak beli."),
    ev(`${y}-12-28`, "ResitKu: last call relief cukai!", "3 hari lagi. Pastikan semua resit dah masuk ResitKu & Drive."),
    ev(`${y + 1}-03-01`, "ResitKu: e-Filing cukai dibuka", "Isi EA form dalam ResitKu, buka Ringkasan e-Filing & isi MyTax."),
  ];
  const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//ResitKu//MS\r\nCALSCALE:GREGORIAN\r\n${evs.join("\r\n")}\r\nEND:VCALENDAR\r\n`;
  const blob = new Blob([ics], { type: "text/calendar" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "ResitKu-peringatan.ics"; a.click();
  toast("Buka fail tu & tekan Add All 📅");
};
