const CFG = window.RELIEF_CONFIG;
const $ = s => document.querySelector(s);
const fmt = n => "RM" + Number(n || 0).toLocaleString("en-MY", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
let receipts = [];
let currentImg = null;
let year = new Date().getFullYear();

// Kadar cukai pemastautin (YA2023 ke atas) — [had atas band, kadar]
const BANDS = [[5000, 0], [20000, .01], [35000, .03], [50000, .06], [70000, .11], [100000, .19],
  [400000, .25], [600000, .26], [2000000, .28], [Infinity, .30]];
function taxOn(ci) {
  let tax = 0, prev = 0;
  for (const [top, r] of BANDS) { if (ci <= prev) break; tax += (Math.min(ci, top) - prev) * r; prev = top; }
  return tax;
}
function marginal(ci) { let prev = 0; for (const [top, r] of BANDS) { if (ci <= top) return r; prev = top; } return .3; }

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
  const ys = new Set([new Date().getFullYear(), ...receipts.map(r => +r.date.slice(0, 4))]);
  $("#yearSel").innerHTML = [...ys].sort((a, b) => b - a).map(y => `<option value="${y}">YA ${y}</option>`).join("");
  $("#yearSel").value = year;
  $("#yearSel").onchange = e => { year = +e.target.value; renderDash(); renderList(); };
  $("#fCat").innerHTML = CFG.categories.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join("");
  $("#fDate").valueAsDate = new Date();
  $("#income").value = (await DB.getMeta("income")) || "";
  $("#income").onchange = async e => { await DB.setMeta("income", +e.target.value || 0); renderDash(); };
  $("#cfgNote").textContent = CFG.note;
  const draft = await DB.getMeta("draftImg");
  if (draft && !currentImg) { currentImg = draft; showPreview(); $("#ocrStatus").textContent = "📎 Gambar resit tadi masih ada — isi butiran & simpan."; show("add"); }
  renderDash();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

// ---------- DASHBOARD ----------
async function renderDash() {
  const yr = receipts.filter(r => r.date.startsWith(String(year)));
  const income = +(await DB.getMeta("income")) || 0;
  let claimed = 0, totalLimit = 0;
  const rows = CFG.categories.map(c => {
    const spent = yr.filter(r => r.cat === c.id).reduce((s, r) => s + r.amount, 0);
    const eff = Math.min(spent, c.limit);
    claimed += eff; totalLimit += c.limit;
    return { c, spent, eff, left: Math.max(c.limit - spent, 0), pct: Math.min(spent / c.limit * 100, 100) };
  });
  // Susun: yang ada baki & dah mula guna dulu (peluang paling dekat), kemudian yang belum sentuh
  rows.sort((a, b) => (b.spent > 0) - (a.spent > 0) || (a.pct === 100) - (b.pct === 100) || b.left - a.left);

  $("#totClaimed").textContent = fmt(claimed);
  $("#totLeft").textContent = `daripada ${fmt(totalLimit)} had kategori yang dijejak`;
  if (income > 0) {
    const base = Math.max(income - 9000, 0); // relief individu RM9,000 auto
    const saved = taxOn(base) - taxOn(Math.max(base - claimed, 0));
    $("#taxSaved").textContent = fmt(Math.round(saved));
    $("#rateInfo").textContent = `Setiap RM100 lagi ≈ jimat RM${Math.round(marginal(Math.max(base - claimed, 0)) * 100)}`;
  } else {
    $("#taxSaved").textContent = "—";
    $("#rateInfo").textContent = "Isi pendapatan di Tetapan";
  }

  const rate = income > 0 ? marginal(Math.max(income - 9000 - claimed, 0)) : 0;
  $("#cats").innerHTML = rows.map(({ c, spent, left, pct }) => `
    <div class="cat ${pct >= 100 ? "full" : spent > 0 ? "part" : ""}">
      <div class="cathead"><span>${c.icon} <b>${c.name}</b></span><span>${fmt(spent)} / ${fmt(c.limit)}</span></div>
      <div class="bar"><div style="width:${pct}%"></div></div>
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
  currentImg = await compress(f, 1400, 0.7);
  await DB.setMeta("draftImg", currentImg); // simpan terus — kalau iOS reload page, gambar tak hilang
  showPreview();
  runOCR(f);
};
function showPreview() { const p = $("#preview"); p.src = URL.createObjectURL(currentImg); p.classList.remove("hidden"); }

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
  const hit = CFG.categories.find(c => c.keywords.some(k => low.includes(k)));
  if (hit) $("#fCat").value = hit.id;
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

// ---------- SAVE ----------
$("#addForm").onsubmit = async e => {
  e.preventDefault();
  const rec = {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    merchant: $("#fMerchant").value.trim(),
    amount: +$("#fAmount").value,
    date: $("#fDate").value,
    cat: $("#fCat").value,
    for: $("#fFor").value,
    note: $("#fNote").value.trim(),
    img: currentImg || null,
    created: Date.now(),
  };
  await DB.put(rec);
  receipts.push(rec);
  e.target.reset(); $("#fDate").valueAsDate = new Date();
  currentImg = null; DB.setMeta("draftImg", null); $("#preview").classList.add("hidden"); $("#ocrStatus").textContent = ""; $("#fileIn").value = ""; $("#galleryIn").value = "";
  toast("Resit disimpan ✅");
  show("dash");
  window.afterSave && window.afterSave();
};

// ---------- LIST ----------
$("#search").oninput = renderList;
function renderList() {
  const q = $("#search").value.toLowerCase();
  const cat = id => CFG.categories.find(c => c.id === id) || { icon: "❓", name: id };
  const yr = receipts.filter(r => r.date.startsWith(String(year)))
    .filter(r => !q || (r.merchant + r.note + cat(r.cat).name).toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date));
  $("#list").innerHTML = yr.length ? yr.map(r => `
    <div class="item">
      ${r.img ? `<img data-id="${r.id}" class="thumb">` : `<label class="thumb none" title="Tambah gambar">📎<input type="file" accept="image/*" data-attach="${r.id}" hidden></label>`}
      <div class="info"><b>${esc(r.merchant)}</b><small>${cat(r.cat).icon} ${cat(r.cat).name} · ${r.for} · ${r.date}</small>${r.note ? `<small>${esc(r.note)}</small>` : ""}</div>
      <div class="amt">${fmt(r.amount)}<button class="del" data-id="${r.id}">🗑</button></div>
    </div>`).join("") : `<p class="note">Takde resit lagi untuk YA ${year}.</p>`;
  document.querySelectorAll(".thumb[data-id]").forEach(im => {
    const r = receipts.find(x => x.id === im.dataset.id);
    im.src = URL.createObjectURL(r.img);
    im.onclick = () => window.open(im.src);
  });
  document.querySelectorAll("[data-attach]").forEach(inp => inp.onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const r = receipts.find(x => x.id === inp.dataset.attach);
    r.img = await compress(f, 1400, 0.7); delete r.driveId;
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
  const data = receipts.map(({ img, ...r }) => ({ ...r, imgFile: img ? `resit/${r.date.slice(0, 4)}/${r.cat}/${r.date}_${slug(r.merchant)}_${r.id.slice(0, 6)}.jpg` : null }));
  receipts.forEach((r, i) => r.img && zip.file(data[i].imgFile, r.img));
  zip.file("data.json", JSON.stringify({ app: "resitku", v: 1, exported: new Date().toISOString(), income: await DB.getMeta("income"), receipts: data }, null, 2));
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
      const img = r.imgFile && zip.file(r.imgFile) ? new Blob([await zip.file(r.imgFile).async("arraybuffer")], { type: "image/jpeg" }) : null;
      const { imgFile, ...rest } = r;
      await DB.put({ ...rest, img });
    }
    if (meta.income) await DB.setMeta("income", meta.income);
    receipts = await DB.all(); toast("Restore berjaya ✅"); init();
  } catch { toast("Fail ZIP tak sah"); }
  e.target.value = "";
};

function csv() {
  const head = "tarikh,kedai,kategori,untuk,amaun,nota";
  const cat = id => (CFG.categories.find(c => c.id === id) || {}).name || id;
  const q = s => `"${String(s || "").replace(/"/g, '""')}"`;
  return [head, ...receipts.sort((a, b) => a.date.localeCompare(b.date)).map(r => [r.date, q(r.merchant), q(cat(r.cat)), r.for, r.amount.toFixed(2), q(r.note)].join(","))].join("\n");
}
$("#btnCsv").onclick = () => download(new Blob([csv()], { type: "text/csv" }), `ResitKu_${year}.csv`);

init();
