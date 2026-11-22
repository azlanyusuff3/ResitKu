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
const psKey = (y, w) => `ps:${y}:${w}`;
const profKey = (y, w) => `prof:${y}:${w}`;
async function getPS(y, w) { return (await DB.getMeta(psKey(y, w))) || []; }
async function getProf(y, w) {
  return (await DB.getMeta(profKey(y, w))) || (await DB.getMeta(profKey(y - 1, w))) || { married: 0, spouseWorks: 1, claimKids: w === "me", kids: {} };
}
// Unjuran setahun dari payslip, ikut majikan:
// - bulan yang ada payslip → nombor sebenar
// - bulan dalam tempoh kerja majikan tu yang takde payslip → sama macam payslip BIASA terkini majikan tu
// - semua majikan dijumlahkan (KWSP, PCB, gaji kasar semua sekali)
const empKey = (y, w) => `emp:${y}:${w}`;
function projectPS(list, emps = {}) {
  if (!list.length) return null;
  const groups = {};
  for (const x of list) (groups[x.emp || "Majikan"] = groups[x.emp || "Majikan"] || []).push(x);
  const out = { months: list.length, missing: 0, extras: 0, noBase: false, employers: [] };
  const F = ["gross", "epf", "socso", "pcb", "zakat"];
  F.forEach(f => out[f] = 0);
  for (const name in groups) {
    const g = groups[name].sort((a, b) => a.month.localeCompare(b.month));
    const rng = emps[name] || { from: 1, to: 12 };
    const span = Math.max(+rng.to - +rng.from + 1, 0);
    const inRange = g.filter(x => { const m = +x.month.slice(5, 7); return m >= rng.from && m <= rng.to; });
    const normals = g.filter(x => !x.extra);
    const base = normals[normals.length - 1] || null;
    const missing = Math.max(span - new Set(inRange.map(x => x.month)).size, 0);
    const e = { name, from: +rng.from, to: +rng.to, months: g.length, missing, extras: g.length - normals.length, noBase: !base && missing > 0 };
    for (const f of F) e[f] = g.reduce((s, x) => s + (+x[f] || 0), 0) + (base ? (+base[f] || 0) * missing : 0);
    out.employers.push(e);
    F.forEach(f => out[f] += e[f]);
    out.missing += missing; out.extras += e.extras; out.noBase = out.noBase || e.noBase;
  }
  return out;
}

function autoReliefs(prof) {
  const F = CFG.family, k = prof.kids || {}, list = [{ name: "Individu", amt: CFG.personal }];
  if (+prof.married && !+prof.spouseWorks) list.push({ name: "Pasangan tiada pendapatan", amt: F.spouse });
  if (+prof.married && prof.spouseOku) list.push({ name: "Pasangan OKU (tambahan)", amt: F.spouseOku });
  if (prof.oku) list.push({ name: "Individu OKU", amt: F.selfOku });
  if (prof.claimKids) {
    const add = (n, rate, label) => { n = +n || 0; if (n) list.push({ name: `${label} × ${n}`, amt: n * rate }); };
    add(k.u18, F.kidU18, "Anak bawah 18"); add(k.pre, F.kidPre, "Anak 18+ pra-U"); add(k.higher, F.kidHigher, "Anak 18+ IPT");
    add(k.oku, F.kidOku, "Anak OKU"); add(k.okuHigher, F.kidOkuHigher, "Anak OKU 18+ IPT (tambahan)");
  }
  return list;
}

async function computeFor(w) {
  const eaRaw = await getEA(year, w);
  const ps = projectPS(await getPS(year, w), (await DB.getMeta(empKey(year, w))) || {});
  const prof = await getProf(year, w);
  const auto = autoReliefs(prof);
  const autoTotal = auto.reduce((s, a) => s + a.amt, 0);
  // EA manual mengatasi unjuran payslip
  const pick = f => (eaRaw[f] !== undefined && eaRaw[f] !== null && eaRaw[f] !== "" && +eaRaw[f] > 0) ? +eaRaw[f] : (ps ? ps[f] : 0);
  const ea = { epf: pick("epf"), socso: pick("socso"), zakat: pick("zakat"), pcb: (eaRaw.pcb != null && eaRaw.pcb !== "") ? +eaRaw.pcb : (ps ? ps.pcb : null), gross: pick("gross") };
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
  const manualIncome = +(await DB.getMeta(w === "me" ? "income" : "income2")) || 0;
  const income = ea.gross || manualIncome;
  const incomeSrc = eaRaw.gross > 0 ? "EA" : ps && ps.gross ? `unjuran ${ps.months} payslip` : "anggaran Tetapan";
  let tax = null;
  if (income > 0) {
    const base = Math.max(income - autoTotal, 0);
    const ci = Math.max(base - claimed, 0);
    let payable = taxOn(ci);
    const rebate = ci <= 35000 ? Math.min(400, payable) : 0;
    payable = Math.max(payable - rebate - (+ea.zakat || 0), 0);
    tax = { income, incomeSrc, ci, saved: taxOn(base) - taxOn(ci), rate: marginal(ci), payable, pcb: ea.pcb != null && ea.pcb !== "" ? +ea.pcb : null, zakat: +ea.zakat || 0, rebate };
  }
  return { rows, claimed, totalLimit, tax, ea, auto, autoTotal, ps };
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
    } else line += `<br><small>Upload payslip untuk anggar refund</small>`;
    return `<div><small>${names[i]} · pendapatan ${fmt(Math.round(t.income))} (${t.incomeSrc}) · relief auto ${fmt(p.autoTotal)} · bercukai ${fmt(Math.round(t.ci))}</small><div>${line}</div></div>`;
  }).join("");
  tb.innerHTML = boxes; tb.classList.toggle("hidden", !boxes);
  $("#btnEA").classList.toggle("hidden", who === "all");
  $("#btnProf").classList.toggle("hidden", who === "all");

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
  const hit = guessCat(low, reliefFor(yy).categories);
  if (hit) { $("#fCat").value = hit.id; fillSubs(); }
  // Teka sub-had dari teks
  const subHints = { dental: /dental|gigi|pergigian/, vaccine: /vaksin|vaccin|immuni/, checkup: /check.?up|pemeriksaan|screening|health screen|psych|kaunsel/, upskill: /course|kursus|workshop|certificat|bootcamp|udemy|coursera/, life: /life|takaful|hayat/, epf: /kwsp|epf/, shoes: /shoe|kasut|sneaker|footwear/ };
  for (const o of $("#fSub").options) if (o.value && subHints[o.value] && subHints[o.value].test(low)) { $("#fSub").value = o.value; break; }
  return found;
}

// Teka kategori ikut skor: keyword pendek (≤4 huruf) mesti perkataan penuh,
// keyword panjang dapat skor lebih tinggi, nama kedai (baris atas) dapat bonus.
function guessCat(low, cats) {
  const head = low.split("\n").slice(0, 4).join(" ");
  const esc = k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let best = null, bestScore = 0;
  for (const c of cats) {
    let score = 0;
    for (const k of c.keywords) {
      const kk = k.trim();
      const re = kk.length <= 4 ? new RegExp(`(^|[^a-z0-9])${esc(kk)}([^a-z0-9]|$)`) : new RegExp(esc(kk));
      if (re.test(low)) score += Math.min(kk.length, 10) + (re.test(head) ? 5 : 0);
    }
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= 4 ? best : null; // terlalu lemah → biar user pilih
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
  for (let y = 2025; y <= new Date().getFullYear() + 1; y++) for (const w of ["me", "sp"]) for (const k of [eaKey(y, w), psKey(y, w), profKey(y, w), empKey(y, w)]) { const v = await DB.getMeta(k); if (v) out[k] = v; }
  return out;
}
window.allEA = allEA;
$("#btnEA").onclick = async () => {
  const ea = await getEA(year, who);
  $("#eaWho").textContent = `${who === "me" ? "👤 Aku" : "💑 Pasangan"} · YA ${year}`;
  $("#eaEpf").value = ea.epf || ""; $("#eaSocso").value = ea.socso || ""; $("#eaZakat").value = ea.zakat || ""; $("#eaPcb").value = ea.pcb ?? ""; $("#eaGross").value = ea.gross || "";
  $("#psForm").classList.add("hidden"); $("#psStatus").textContent = "";
  await renderPS();
  $("#eaModal").classList.remove("hidden");
};
$("#eaSave").onclick = async () => {
  await DB.setMeta(eaKey(year, who), { epf: +$("#eaEpf").value || 0, socso: +$("#eaSocso").value || 0, zakat: +$("#eaZakat").value || 0, pcb: $("#eaPcb").value === "" ? null : +$("#eaPcb").value, gross: +$("#eaGross").value || 0 });
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
    html += `<h4>${nm} — YA ${year}</h4><table class="be">`;
    txt += `${nm.replace(/^\S+ /, "")} — YA ${year}\n`;
    if (p.tax) { html += `<tr><td>Pendapatan kasar (${p.tax.incomeSrc})</td><td>${fmt(Math.round(p.tax.income))}</td></tr>`; txt += `Pendapatan kasar: ${fmt(Math.round(p.tax.income))}\n`; }
    for (const a of p.auto) { html += `<tr><td>${a.name}</td><td>${fmt(a.amt)}</td></tr>`; txt += `${a.name}: ${fmt(a.amt)}\n`; }
    for (const r of list) {
      html += `<tr><td>${r.c.icon} ${r.c.name}</td><td>${fmt(r.eff)}</td></tr>`;
      txt += `${r.c.name}: ${fmt(r.eff)}\n`;
      for (const sb of r.subs.filter(x => x.eff > 0)) { html += `<tr class="besub"><td>↳ ${sb.name}</td><td>${fmt(sb.eff)}</td></tr>`; txt += `  - ${sb.name}: ${fmt(sb.eff)}\n`; }
    }
    html += `<tr class="betot"><td>Jumlah relief</td><td>${fmt(p.claimed + p.autoTotal)}</td></tr>`;
    txt += `Jumlah relief: ${fmt(p.claimed + p.autoTotal)}\n`;
    if (p.ea.pcb != null) { html += `<tr><td>PCB dipotong</td><td>${fmt(Math.round(p.ea.pcb))}</td></tr>`; txt += `PCB dipotong: ${fmt(Math.round(p.ea.pcb))}\n`; }
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

// ---------- PAYSLIP ----------
const MONTHS = { jan: 1, januari: 1, january: 1, feb: 2, februari: 2, february: 2, mac: 3, mar: 3, march: 3, apr: 4, april: 4, mei: 5, may: 5, jun: 6, june: 6, jul: 7, julai: 7, july: 7, ogos: 8, aug: 8, august: 8, sep: 9, sept: 9, september: 9, okt: 10, oct: 10, oktober: 10, october: 10, nov: 11, november: 11, dis: 12, dec: 12, disember: 12, december: 12 };
function parsePayslip(text) {
  const out = {};
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const firstNum = l => { const m = l.replace(/(\d),(\d{3})/g, "$1$2").match(/\d+\.\d{2}/); return m ? +m[0] : null; };
  const rules = [
    ["gross", /(gaji kasar|gross\s*(pay|salary|earning|income|wages?)|jumlah\s*(pendapatan|gaji|perolehan|emolumen)|total\s*(earnings?|gross|income|emolument))/],
    ["epf", /(kwsp|\bepf\b|caruman pekerja)/],
    ["socso", /(perkeso|socso)/],
    ["eis", /(\bsip\b|\beis\b|insurans pekerjaan|employment insurance)/],
    ["pcb", /(\bpcb\b|\bmtd\b|potongan cukai|cukai pendapatan|income tax|\btax\b)/],
    ["zakat", /zakat/],
  ];
  for (const l of lines) {
    const low = l.toLowerCase();
    if (/(majikan|employer|\bco\b|company|\ber\b|syarikat)/.test(low)) continue; // abaikan caruman majikan
    for (const [k, re] of rules) if (out[k] == null && re.test(low)) { const v = firstNum(l); if (v != null) out[k] = v; }
  }
  if (/(bonus|insentif|incentive|tunggakan|arrears|ganjaran|bayaran khas|\bot\b|overtime|lebih masa)/.test(text.toLowerCase())) out.extra = true;
  // Bulan: "Oktober 2026", "OCT-2026", "10/2026"
  const low = text.toLowerCase();
  let m = low.match(/\b(januari|january|februari|february|mac|march|april|mei|may|jun|june|julai|july|ogos|august|september|sept|oktober|october|november|disember|december|jan|feb|mar|apr|jul|aug|sep|okt|oct|nov|dis|dec)[\s\-\/.,]*(20\d{2})\b/);
  if (m) out.month = `${m[2]}-${String(MONTHS[m[1]]).padStart(2, "0")}`;
  else if ((m = low.match(/\b(0?[1-9]|1[0-2])\s*[\/\-]\s*(20\d{2})\b/))) out.month = `${m[2]}-${m[1].padStart(2, "0")}`;
  return out;
}

async function extractText(blob) {
  if (isPdf(blob)) {
    if (!window.pdfjsLib) {
      await loadScript("https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js");
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
    }
    const pdf = await pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
    const pg = await pdf.getPage(1);
    const tc = await pg.getTextContent();
    const lines = {};
    tc.items.forEach(it => { const y = Math.round(it.transform[5] / 3); (lines[y] = lines[y] || []).push(it); });
    const text = Object.keys(lines).sort((a, b) => b - a).map(y => lines[y].sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join(" ")).join("\n");
    if (text.replace(/\s/g, "").length > 20) return text;
    const vp = pg.getViewport({ scale: 2 });
    const cv = document.createElement("canvas"); cv.width = vp.width; cv.height = vp.height;
    await pg.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
    blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.9));
  } else blob = await compress(blob, 1600, 0.9, true);
  if (!window.Tesseract) throw new Error("OCR tak load");
  if (!ocrWorker) ocrWorker = await Tesseract.createWorker("eng", 1);
  return (await ocrWorker.recognize(blob)).data.text;
}

$("#psIn").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  $("#psStatus").textContent = "🔍 Membaca payslip...";
  try {
    const p = parsePayslip(await extractText(f));
    const now = new Date();
    $("#psMonth").value = p.month || `${year}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    $("#psExtra").checked = !!p.extra;
    await fillEmpFields();
    $("#psGross").value = p.gross ?? ""; $("#psEpf").value = p.epf ?? "";
    $("#psSocso").value = ((p.socso || 0) + (p.eis || 0)) || ""; $("#psPcb").value = p.pcb ?? ""; $("#psZakat").value = p.zakat ?? "";
    const n = ["gross", "epf", "socso", "pcb"].filter(k => p[k] != null).length;
    $("#psStatus").textContent = n >= 3 ? "✅ Dibaca — semak nombor & bulan, lepas tu simpan." : "😕 Sebahagian je dapat dibaca — lengkapkan manual.";
  } catch (err) { $("#psStatus").textContent = "Tak dapat baca (" + err.message + ") — isi manual."; }
  $("#psForm").classList.remove("hidden");
  e.target.value = "";
};
$("#psSave").onclick = async () => {
  const month = $("#psMonth").value;
  if (!month) return toast("Pilih bulan");
  if (+month.slice(0, 4) !== year) return toast(`Payslip ni untuk ${month.slice(0, 4)} — tukar YA kat atas dulu`);
  const emp = ($("#psEmp").value || "Majikan").trim();
  const emps = (await DB.getMeta(empKey(year, who))) || {};
  emps[emp] = { from: +$("#psFrom").value, to: +$("#psTo").value };
  if (emps[emp].from > emps[emp].to) return toast("Bulan mula mesti sebelum bulan akhir");
  await DB.setMeta(empKey(year, who), emps);
  const list = (await getPS(year, who)).filter(x => !(x.month === month && (x.emp || "Majikan") === emp));
  list.push({ month, emp, extra: $("#psExtra").checked, gross: +$("#psGross").value || 0, epf: +$("#psEpf").value || 0, socso: +$("#psSocso").value || 0, pcb: +$("#psPcb").value || 0, zakat: +$("#psZakat").value || 0 });
  await DB.setMeta(psKey(year, who), list);
  $("#psForm").classList.add("hidden"); $("#psStatus").textContent = "";
  toast("Payslip disimpan ✅"); await renderPS(); renderDash();
  window.afterSave && window.afterSave();
};
const BLN = ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"];
$("#psFrom").innerHTML = $("#psTo").innerHTML = BLN.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("");
async function fillEmpFields() {
  const emps = (await DB.getMeta(empKey(year, who))) || {};
  const names = Object.keys(emps);
  $("#empList").innerHTML = names.map(n => `<option value="${esc(n)}">`).join("");
  if (!$("#psEmp").value) $("#psEmp").value = names[names.length - 1] || "";
  const r = emps[$("#psEmp").value] || { from: 1, to: 12 };
  $("#psFrom").value = r.from; $("#psTo").value = r.to;
}
$("#psEmp").onchange = fillEmpFields;
async function renderPS() {
  const list = (await getPS(year, who)).sort((a, b) => a.month.localeCompare(b.month));
  const pj = projectPS(list, (await DB.getMeta(empKey(year, who))) || {});
  $("#psList").innerHTML = list.length ? `
    <table class="be"><tr><td><b>Bulan</b></td><td><b>Kasar</b></td><td><b>PCB</b></td><td></td></tr>
    ${list.map(x => `<tr><td>${x.month}${x.extra ? " 🎁" : ""}${pj.employers.length > 1 ? `<br><small>${esc(x.emp || "Majikan")}</small>` : ""}</td><td>${fmt(x.gross)}</td><td>${fmt(x.pcb)}</td><td><button class="del" data-psdel="${x.month}|${esc(x.emp || "Majikan")}">🗑</button></td></tr>`).join("")}</table>
    ${pj.employers.length > 1 ? `<div class="banner">🏢 ${pj.employers.map(e => `<b>${esc(e.name)}</b> (${BLN[e.from - 1]}–${BLN[e.to - 1]}): kasar ${fmt(Math.round(e.gross))}, KWSP ${fmt(Math.round(e.epf))}, PCB ${fmt(Math.round(e.pcb))}`).join("<br>🏢 ")}</div>` : ""}
    ${pj.noBase ? `<div class="banner warn">⚠️ Semua payslip ditanda luar biasa. Upload sekurang-kurangnya satu payslip <b>biasa</b> supaya app boleh unjur bulan lain.</div>` : ""}
    <div class="banner">📈 Unjuran setahun${pj.employers.length > 1 ? ` — ${pj.employers.length} majikan digabung` : ""} (${pj.months} payslip${pj.extras ? `, ${pj.extras} bulan luar biasa 🎁` : ""}${pj.missing ? ` + ${pj.missing} bulan lain = payslip biasa terkini` : ""}):<br>
    Kasar <b>${fmt(Math.round(pj.gross))}</b> · KWSP ${fmt(Math.round(pj.epf))} · PERKESO ${fmt(Math.round(pj.socso))} · PCB <b>${fmt(Math.round(pj.pcb))}</b>${pj.zakat ? ` · Zakat ${fmt(Math.round(pj.zakat))}` : ""}</div>`
    : `<p class="note">Belum ada payslip untuk YA ${year}. Upload satu je pun cukup — app anggap 12 bulan sama. Lebih banyak bulan = lebih tepat (bonus, OT, kenaikan gaji). Bulan bonus: upload payslip bulan tu juga.</p>`;
  document.querySelectorAll("[data-psdel]").forEach(b => b.onclick = async () => {
    const [m, e] = b.dataset.psdel.split("|");
    await DB.setMeta(psKey(year, who), (await getPS(year, who)).filter(x => !(x.month === m && (x.emp || "Majikan") === e)));
    renderPS(); renderDash();
  });
}

// ---------- PROFIL KELUARGA ----------
const pf = id => $("#" + id);
function profFromForm() {
  return { married: +pf("pMarried").value, spouseWorks: +pf("pSpouseWorks").value, spouseOku: pf("pSpouseOku").checked, oku: pf("pOku").checked,
    claimKids: pf("pClaimKids").checked,
    kids: { u18: +pf("kU18").value || 0, pre: +pf("kPre").value || 0, higher: +pf("kHigher").value || 0, oku: +pf("kOku").value || 0, okuHigher: +pf("kOkuHigher").value || 0 } };
}
function profSummary() {
  const p = profFromForm();
  pf("pSpouseBox").classList.toggle("hidden", !p.married);
  const list = autoReliefs(p);
  pf("profSum").innerHTML = "Relief automatik: " + list.map(a => `${a.name} ${fmt(a.amt)}`).join(" · ") + `<br><b>Jumlah ${fmt(list.reduce((s, a) => s + a.amt, 0))}</b>`;
}
$("#btnProf").onclick = async () => {
  const p = await getProf(year, who), k = p.kids || {};
  pf("profWho").textContent = `${who === "me" ? "👤 Aku" : "💑 Pasangan"} · YA ${year}`;
  pf("pMarried").value = +p.married || 0; pf("pSpouseWorks").value = p.spouseWorks === 0 || p.spouseWorks === "0" ? 0 : 1;
  pf("pSpouseOku").checked = !!p.spouseOku; pf("pOku").checked = !!p.oku; pf("pClaimKids").checked = !!p.claimKids;
  pf("kU18").value = k.u18 || ""; pf("kPre").value = k.pre || ""; pf("kHigher").value = k.higher || ""; pf("kOku").value = k.oku || ""; pf("kOkuHigher").value = k.okuHigher || "";
  profSummary();
  $("#profModal").classList.remove("hidden");
};
document.querySelectorAll("#profModal input, #profModal select").forEach(x => x.oninput = x.onchange = profSummary);
$("#profSave").onclick = async () => {
  await DB.setMeta(profKey(year, who), profFromForm());
  $("#profModal").classList.add("hidden"); toast("Profil disimpan ✅"); renderDash();
  window.afterSave && window.afterSave();
};
$("#profClose").onclick = () => $("#profModal").classList.add("hidden");
$("#profModal").onclick = e => { if (e.target.id === "profModal") e.target.classList.add("hidden"); };

// ---------- TEMA ----------
function applyTheme(t) {
  const dark = t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = dark ? "#0a0a0c" : "#ffffff";
  document.querySelectorAll("#themeTabs button").forEach(b => b.classList.toggle("on", b.dataset.theme === t));
}
let themePref = "auto"; try { themePref = localStorage.getItem("theme") || "auto"; } catch {}
applyTheme(themePref);
document.querySelectorAll("#themeTabs button").forEach(b => b.onclick = () => {
  themePref = b.dataset.theme; try { localStorage.setItem("theme", themePref); } catch {}
  applyTheme(themePref);
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => themePref === "auto" && applyTheme("auto"));
