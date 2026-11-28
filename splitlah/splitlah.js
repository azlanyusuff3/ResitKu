// SplitLah — split bil satu resit. Takde login, data simpan dalam phone (localStorage).
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const toC = v => Math.round((parseFloat(v) || 0) * 100);           // RM -> sen
const rm = c => "RM" + (c / 100).toFixed(2);
const COLORS = ["#e8b84a", "#3ddc97", "#6aa8ff", "#ff7a9c", "#b18cff", "#ff9f43", "#2ed3d3", "#c4d64a", "#ff6b6b", "#9aa0b4"];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "" + Math.random());

const store = {
  get(k, d) { try { const v = localStorage.getItem("sl:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("sl:" + k, JSON.stringify(v)); return true; } catch { toast("⚠️ Storage penuh"); return false; } }
};
let owner = store.get("owner", { name: "", qrText: "", qrImg: "" });
let bills = store.get("bills", []);
let bill = null;       // bil yang sedang diedit
let previewUrl = null;

function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2200); }

// ---------- NAV ----------
function show(v) {
  $$(".view").forEach(x => x.classList.toggle("active", x.id === "v-" + v));
  $$("nav button").forEach(x => x.classList.toggle("on", x.dataset.v === v || (v !== "set" && x.dataset.v === "home")));
  if (v === "home") renderHome();
  if (v === "set") renderSet();
  window.scrollTo(0, 0);
}
$$("nav button").forEach(b => b.onclick = () => show(b.dataset.v));
document.addEventListener("click", e => { const g = e.target.closest("[data-go]"); if (g) { e.preventDefault(); show(g.dataset.go); } });

// ---------- HOME ----------
function renderHome() {
  $("#ownerWarn").classList.toggle("hidden", !!(owner.qrText || owner.qrImg));
  const h = $("#history");
  if (!bills.length) { h.innerHTML = `<p class="note">Belum ada bil. Snap resit pertama kau 📸</p>`; return; }
  h.innerHTML = bills.slice().sort((a, b) => (b.created || 0) - (a.created || 0)).map(b => {
    const r = calc(b);
    return `<div class="hist" data-id="${b.id}"><div><b>${esc(b.shop || "Bil tanpa nama")}</b><small>${esc(b.date || "")} · ${b.people.length} orang</small></div><b>${rm(r.total)}</b></div>`;
  }).join("");
  $$(".hist").forEach(el => el.onclick = () => { bill = structuredClone(bills.find(x => x.id === el.dataset.id)); renderResult(); show("res"); });
}

function newBill() {
  const people = [];
  if (owner.name) people.push({ id: uid(), name: owner.name, owner: true });
  return { id: uid(), created: Date.now(), shop: "", date: new Date().toISOString().slice(0, 10), people, items: [], svc: 0, sst: 0, rnd: 0, disc: 0, prop: false };
}

$("#btnManual").onclick = () => { bill = newBill(); bill.items.push({ id: uid(), name: "", price: 0, who: null }); clearPreview(); $("#ocrStatus").textContent = ""; openEdit(); };
$("#camIn").onchange = e => startScan(e.target.files[0], e.target);
$("#galIn").onchange = e => startScan(e.target.files[0], e.target);

function clearPreview() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; $("#preview").classList.add("hidden"); }

async function startScan(file, input) {
  input.value = "";
  if (!file) return;
  bill = newBill();
  clearPreview();
  previewUrl = URL.createObjectURL(file);
  $("#preview").src = previewUrl; $("#preview").classList.remove("hidden");
  openEdit();
  const key = store.get("gkey", "");
  let res = null;
  if (key) {
    try { $("#ocrStatus").textContent = "🤖 Gemini tengah baca resit..."; res = await geminiRead(file, key); }
    catch (err) { $("#ocrStatus").textContent = "Gemini gagal (" + (err.message || err) + ") — cuba OCR biasa..."; }
  }
  if (!res) {
    try { res = await tessRead(file); } catch (err) { $("#ocrStatus").textContent = "OCR gagal — key in manual."; }
  }
  if (res) applyScan(res);
  if (!bill.items.length) bill.items.push({ id: uid(), name: "", price: 0, who: null });
  renderEdit();
}

function applyScan(r) {
  if (r.shop) bill.shop = String(r.shop).slice(0, 60);
  if (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) bill.date = r.date;
  bill.items = (r.items || []).filter(i => i && i.name && +i.price).map(i => ({ id: uid(), name: String(i.name).slice(0, 50), price: toC(i.price), who: null }));
  bill.svc = toC(r.service); bill.sst = toC(r.sst); bill.rnd = toC(r.rounding); bill.disc = Math.abs(toC(r.discount));
  const n = bill.items.length;
  let msg = n ? `✅ Jumpa ${n} item — semak harga & tap siapa makan.` : "😕 Tak jumpa item — key in manual.";
  if (r.total && n) {
    const tot = bill.items.reduce((s, i) => s + i.price, 0) + bill.svc + bill.sst + bill.rnd - bill.disc;
    const diff = tot - toC(r.total);
    if (Math.abs(diff) > 1) msg += ` ⚠️ Jumlah kira ${rm(tot)} tak sama dengan resit ${rm(toC(r.total))} — ada yang tersilap baca.`;
  }
  $("#ocrStatus").textContent = msg;
}

// ---------- OCR: Tesseract (free, dalam phone) ----------
let worker = null;
async function tessRead(file) {
  if (!window.Tesseract) throw new Error("offline");
  $("#ocrStatus").textContent = "🔍 Sediakan OCR (kali pertama lambat sikit)...";
  const img = await shrink(file, 1600, true);
  if (!worker) worker = await Tesseract.createWorker("eng", 1, {
    logger: m => m.status === "recognizing text" && ($("#ocrStatus").textContent = `🔍 Membaca resit... ${Math.round(m.progress * 100)}%`)
  });
  const { data } = await worker.recognize(img);
  return parseText(data.text);
}

function parseText(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const out = { shop: "", items: [], service: 0, sst: 0, rounding: 0, discount: 0, total: 0 };
  const priceRe = /(-?\d{1,5}[.,]\s?\d{2})\s*\)?\s*[A-Z*]{0,2}\s*$/;
  const skip = /sub\s*-?total|grand|total|jumlah|cash|tunai|change|baki|balance|visa|master|card|kad|debit|credit|duitnow|tng|ewallet|paid|bayar|tender|qty|item\(s\)|no\.|no:|tel|invoice|table|tbl|meja|pax|receipt|resit|gst\s*reg|sst\s*(reg|no|id|:)|tin|date|time|cashier|ord#/i;
  const payRe = /credit|debit|visa|master|card|kad|duitnow|tng|e-?wallet|grab\s*pay|boost|shopee\s*pay/i;
  // jenis caj ikut label (tax dulu, sebab "Service Tax" pun ada perkataan "service")
  const kind = l => /incl|termasuk|prices/i.test(l) ? null
    : /sst|gst|tax|cukai/i.test(l) ? "sst"
    : /serv|svc|s\/c|s\.c\.|caj\s*perkhid/i.test(l) ? "service"
    : /round|bundar/i.test(l) ? "rounding"
    : /disc|diskaun|promo|voucher|less/i.test(l) ? "discount"
    : /grand\s*total|^total|net\s*total|jumlah\s*(besar|bersih)?$|amount\s*due/i.test(l) ? "total" : null;
  let pending = null; // label caj yang amaunnya turun ke baris bawah
  for (const l of lines) {
    const m = l.match(priceRe);
    if (!m) {
      pending = kind(l);
      if (!pending && !out.shop && /[a-z]{3}/i.test(l) && out.items.length === 0 && l.length < 40 && !skip.test(l)) out.shop = l.replace(/[^\w\s&'.-]/g, "").trim();
      continue;
    }
    const v = Math.abs(parseFloat(m[1].replace(/\s/g, "").replace(",", ".")));
    let head = l.slice(0, m.index).trim();
    const k = kind(l) || (pending && !/[a-z]{2}/i.test(head) ? pending : null);
    pending = null;
    if (k === "service") { out.service = v; continue; }
    if (k === "sst") { out.sst = v; continue; }
    if (k === "rounding") { out.rounding = /-/.test(m[1]) ? -v : v; continue; }
    if (k === "discount") { out.discount = v; continue; }
    if (k === "total") { out.total = Math.max(out.total, v); continue; }
    if (payRe.test(l)) { if (!out.total) out.total = v; continue; }
    if (skip.test(l)) continue;
    // buang qty: "2 x 2.80 Teh" di depan, atau lajur qty "C Rice 1   2" di belakang
    let qty = 1;
    head = head.replace(/^(\d{1,2})\s*[xX@]\s*(\d+[.,]\d{2}\s+)?/, (_, q) => { qty = +q; return ""; });
    head = head.replace(/\s+(\d{1,2}|[lI|])\s*$/, (_, q) => { if (/\d/.test(q)) qty = +q; return ""; });
    head = head.replace(/\s+\d+\s*[xX@]\s*[\d.,]+\s*$/, "").replace(/[|_~=]+/g, " ").replace(/\s{2,}/g, " ").trim();
    if (head.length < 2 || !/[a-z]{2}/i.test(head) || v <= 0 || v > 5000) continue;
    out.items.push({ name: qty > 1 ? `${head} x${qty}` : head, price: v });
  }
  return out;
}

// ---------- OCR: Gemini (pilihan, key user sendiri) ----------
async function geminiRead(file, key) {
  const blob = await shrink(file, 1600, false);
  const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(",")[1]); fr.readAsDataURL(blob); });
  const prompt = `Baca resit restoran ni. Pulangkan JSON sahaja:
{"shop":string,"date":"YYYY-MM-DD" atau "","items":[{"name":string,"price":number}],"service":number,"sst":number,"rounding":number,"discount":number,"total":number}
- price = harga baris (qty x harga seunit) sebelum tax. Satu baris = satu item; kalau qty > 1 masukkan qty dalam nama, cth "Teh Tarik x2".
- service = service charge. sst = SST/GST/service tax. rounding boleh negatif. discount nombor positif.
- Jangan masukkan subtotal/total/bayaran/baki sebagai item. Guna 0 kalau tiada.`;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: b64 } }] }], generationConfig: { responseMimeType: "application/json", temperature: 0 } })
  });
  const j = await res.json();
  if (!res.ok) throw new Error((j.error && j.error.message || res.status).toString().slice(0, 80));
  const txt = j.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
  return JSON.parse(txt.replace(/^```json|```$/g, "").trim());
}

function shrink(file, max, gray) {
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
      cv.toBlob(b => res(b || file), "image/jpeg", 0.85);
    };
    img.onerror = () => res(file);
    img.src = URL.createObjectURL(file);
  });
}

// ---------- EDIT ----------
function openEdit() { renderEdit(); show("edit"); }
const color = i => COLORS[i % COLORS.length];

function renderEdit() {
  const b = bill;
  $("#bShop").value = b.shop; $("#bDate").value = b.date;
  ["svc", "sst", "rnd", "disc"].forEach(k => { const el = $("#c" + k[0].toUpperCase() + k.slice(1)); el.value = b[k] ? (b[k] / 100).toFixed(2) : ""; });
  $("#propTax").checked = !!b.prop;
  $("#btnDelBill").classList.toggle("hidden", !bills.some(x => x.id === b.id));
  renderPeople(); renderItems(); renderSum();
}

function renderPeople() {
  $("#pplCnt").textContent = bill.people.length ? `(${bill.people.length})` : "";
  $("#people").innerHTML = bill.people.map((p, i) => `<button class="chip" data-pid="${p.id}"><span class="dot" style="background:${color(i)}"></span>${esc(p.name)}${p.owner ? " (kau)" : ""}<span class="x">✕</span></button>`).join("") || `<p class="note">Tambah nama orang yang makan.</p>`;
  $$("#people .chip").forEach(c => c.onclick = () => {
    const p = bill.people.find(x => x.id === c.dataset.pid);
    if (!confirmTap(c, `Buang ${p.name}?`)) return;
    bill.people = bill.people.filter(x => x !== p);
    bill.items.forEach(it => { if (it.who === p.id) it.who = null; });
    renderPeople(); renderItems(); renderSum();
  });
}
// Tap pertama tukar label, tap kedua sahkan (elak dialog browser)
function confirmTap(el, label) {
  if (el.dataset.arm) return true;
  el.dataset.arm = 1; const old = el.innerHTML; el.innerHTML = esc(label);
  setTimeout(() => { if (el.isConnected) { delete el.dataset.arm; el.innerHTML = old; } }, 2000);
  return false;
}

function addPerson(name) {
  name = (name || "").trim();
  if (/^\d{1,2}$/.test(name)) { // taip nombor → tambah sekian ramai "Orang N"
    const want = Math.min(30, +name);
    while (bill.people.length < want) addPerson("");
    return;
  }
  if (!name) { let n = bill.people.length + 1; while (bill.people.some(p => p.name === "Orang " + n)) n++; name = "Orang " + n; }
  bill.people.push({ id: uid(), name: name.slice(0, 20) });
}
$("#btnAddPerson").onclick = () => { const v = $("#newPerson").value; if (!v.trim()) return $("#newPerson").focus(); addPerson(v); $("#newPerson").value = ""; renderPeople(); renderItems(); renderSum(); };
$("#newPerson").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); $("#btnAddPerson").click(); } };
$("#btnQuick").onclick = () => { addPerson(""); renderPeople(); renderItems(); renderSum(); };
$("#btnQuick").textContent = "＋ Orang tanpa nama";

function renderItems() {
  const box = $("#items");
  box.innerHTML = bill.items.map(it => `
    <div class="item2 ${it.who ? "" : "none"}" data-iid="${it.id}">
      <div class="irow">
        <input class="iname" value="${esc(it.name)}" placeholder="Nama item">
        <input class="iprice" type="number" step="0.01" inputmode="decimal" value="${it.price ? (it.price / 100).toFixed(2) : ""}" placeholder="0.00">
        <button class="idel" title="Buang">🗑</button>
      </div>
      <div class="who">${bill.people.length ? bill.people.map((p, i) => `<button data-pid="${p.id}" class="${it.who === p.id ? "on" : ""}" style="${it.who === p.id ? `background:${color(i)}` : ""}">${esc(p.name)}</button>`).join("") : `<span class="hint">Tambah orang dulu kat atas ☝️</span>`}</div>
    </div>`).join("");
  $$(".item2").forEach(row => {
    const it = bill.items.find(x => x.id === row.dataset.iid);
    row.querySelector(".iname").oninput = e => { it.name = e.target.value; };
    row.querySelector(".iprice").oninput = e => { it.price = toC(e.target.value); renderSum(); };
    row.querySelector(".idel").onclick = () => { bill.items = bill.items.filter(x => x !== it); renderItems(); renderSum(); };
    row.querySelectorAll(".who button").forEach(btn => btn.onclick = () => {
      it.who = it.who === btn.dataset.pid ? null : btn.dataset.pid;
      const i = bill.people.findIndex(p => p.id === btn.dataset.pid);
      row.querySelectorAll(".who button").forEach(x => { const on = x.dataset.pid === it.who; x.classList.toggle("on", on); x.style.background = on ? color(i) : ""; });
      row.classList.toggle("none", !it.who);
      renderSum();
    });
  });
}
$("#btnAddItem").onclick = () => { bill.items.push({ id: uid(), name: "", price: 0, who: null }); renderItems(); renderSum(); const ins = $$(".iname"); ins[ins.length - 1].focus(); };

$("#bShop").oninput = e => bill.shop = e.target.value;
$("#bDate").oninput = e => bill.date = e.target.value;
[["#cSvc", "svc"], ["#cSst", "sst"], ["#cRnd", "rnd"], ["#cDisc", "disc"]].forEach(([s, k]) => $(s).oninput = e => { bill[k] = k === "disc" ? Math.abs(toC(e.target.value)) : toC(e.target.value); renderSum(); });
$("#propTax").onchange = e => { bill.prop = e.target.checked; renderSum(); };
$$("[data-pct]").forEach(b => b.onclick = () => {
  const [sc, st] = b.dataset.pct.split(",").map(Number);
  const sub = bill.items.reduce((s, i) => s + i.price, 0) - bill.disc;
  bill.svc = Math.round(sub * sc / 100);
  bill.sst = Math.round((sub + bill.svc) * st / 100) ;
  // SST restoran biasanya dikenakan atas subtotal + service charge
  $("#cSvc").value = bill.svc ? (bill.svc / 100).toFixed(2) : ""; $("#cSst").value = (bill.sst / 100).toFixed(2);
  renderSum(); toast(`Service ${sc}% + SST ${st}% dikira`);
});

// ---------- KIRA ----------
function calc(b) {
  const n = b.people.length;
  const sub = {}; b.people.forEach(p => sub[p.id] = 0);
  let subtotal = 0, unassigned = 0;
  b.items.forEach(it => { subtotal += it.price; if (it.who && it.who in sub) sub[it.who] += it.price; else unassigned += it.price; });
  const charges = b.svc + b.sst + b.rnd - b.disc;
  const assigned = subtotal - unassigned;
  // bahagi caj dalam sen, baki sen diagih supaya jumlah tepat
  const raw = b.people.map(p => n ? (b.prop && assigned > 0 ? charges * sub[p.id] / assigned : charges / n) : 0);
  const share = raw.map(Math.trunc);
  let left = charges - share.reduce((s, x) => s + x, 0);
  const order = raw.map((v, i) => [Math.abs(v - share[i]), i]).sort((a, c) => c[0] - a[0]);
  for (let k = 0; left !== 0 && order.length; k = (k + 1) % order.length) { const i = order[k][1]; const st = Math.sign(left); share[i] += st; left -= st; }
  const per = b.people.map((p, i) => ({ p, idx: i, items: b.items.filter(it => it.who === p.id), sub: sub[p.id], share: share[i], total: sub[p.id] + share[i] }));
  return { n, subtotal, charges, unassigned, total: subtotal + charges, per };
}

function renderSum() {
  const r = calc(bill);
  $("#sSub").textContent = rm(r.subtotal); $("#sChg").textContent = rm(r.charges); $("#sTot").textContent = rm(r.total);
  $("#taxNote").textContent = r.n ? (bill.prop ? "Caj dibahagi ikut nilai makanan setiap orang." : `Caj ${rm(r.charges)} ÷ ${r.n} orang = ~${rm(Math.round(r.charges / r.n))} seorang.`) : "";
  const cnt = bill.items.filter(i => !i.who).length;
  $("#unassigned").classList.toggle("hidden", !cnt);
  $("#unassigned").textContent = `⚠️ ${cnt} item belum ada nama (${rm(r.unassigned)}). Tap nama siapa yang makan.`;
}

$("#btnCalc").onclick = () => {
  bill.items = bill.items.filter(i => i.name.trim() || i.price);
  if (!bill.people.length) { toast("Tambah sekurang-kurangnya seorang"); return; }
  if (!bill.items.length) { toast("Tambah item dulu"); renderItems(); return; }
  if (bill.items.some(i => !i.who)) { renderItems(); renderSum(); toast("Masih ada item tanpa nama"); $(".item2.none")?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  if (!bill.shop.trim()) bill.shop = "Makan-makan";
  saveBill(); renderResult(); show("res");
};
function saveBill() {
  const i = bills.findIndex(x => x.id === bill.id);
  const copy = structuredClone(bill);
  if (i >= 0) bills[i] = copy; else bills.push(copy);
  bills = bills.sort((a, b) => b.created - a.created).slice(0, 100);
  store.set("bills", bills);
}
$("#btnDelBill").onclick = e => {
  if (!confirmTap(e.target, "Tap lagi untuk padam")) return;
  bills = bills.filter(x => x.id !== bill.id); store.set("bills", bills); toast("Bil dipadam"); show("home");
};

// ---------- HASIL ----------
const fmtDate = d => { if (!d) return ""; const [y, m, dd] = d.split("-"); return `${dd}/${m}/${y}`; };
function payName() { return owner.name || (bill.people.find(p => p.owner) || {}).name || ""; }

function renderResult() {
  const r = calc(bill);
  $("#rShop").textContent = `${bill.shop} · ${fmtDate(bill.date)}`;
  $("#rTot").textContent = rm(r.total);
  $("#rMode").textContent = `${r.n} orang · caj ${rm(r.charges)} ${bill.prop ? "ikut proportion" : "bahagi sama rata"}`;
  $("#results").innerHTML = r.per.map(x => `
    <div class="pcard ${x.p.owner ? "owner" : ""}">
      <div class="phead"><div class="nm"><span class="dot" style="background:${color(x.idx)}"></span>${esc(x.p.name)}${x.p.owner ? " (kau)" : ""}</div><div class="amt">${rm(x.total)}</div></div>
      <div class="pdet">${x.items.map(i => `<div class="l"><span>${esc(i.name)}</span><span>${rm(i.price)}</span></div>`).join("")}
        <div class="l"><span>Bahagian caj &amp; tax</span><span>${rm(x.share)}</span></div></div>
      ${x.p.owner ? "" : `<button class="btn2" data-share="${x.p.id}">📤 Share resit ${esc(x.p.name)}</button>`}
    </div>`).join("");
  $$("[data-share]").forEach(b => b.onclick = () => openShare(b.dataset.share));
}
$("#btnBack").onclick = () => { clearPreview(); $("#ocrStatus").textContent = ""; openEdit(); };
$("#btnHome").onclick = () => show("home");
$("#btnShareAll").onclick = () => openShare(null);
$("#btnShareText").onclick = async () => {
  const r = calc(bill);
  let t = `🧾 *${bill.shop}* (${fmtDate(bill.date)})\n`;
  t += `Subtotal ${rm(r.subtotal)}`;
  if (bill.svc) t += ` · Service ${rm(bill.svc)}`;
  if (bill.sst) t += ` · SST ${rm(bill.sst)}`;
  if (bill.rnd) t += ` · Rounding ${rm(bill.rnd)}`;
  if (bill.disc) t += ` · Diskaun -${rm(bill.disc)}`;
  t += `\n*Jumlah: ${rm(r.total)}* · ${r.n} orang\n`;
  t += bill.prop ? `Caj ${rm(r.charges)} ikut proportion makanan\n` : `Caj ${rm(r.charges)} ÷ ${r.n} orang\n`;
  r.per.forEach(x => {
    t += `\n👤 *${x.p.name}: ${rm(x.total)}*${x.p.owner ? " (dah bayar)" : ""}\n`;
    x.items.forEach(i => { t += `   • ${i.name} ${rm(i.price)}\n`; });
    t += `   • Caj & tax ${rm(x.share)}\n`;
  });
  if (payName()) t += `\nBayar kepada ${payName()} 🙏`;
  t += `\n_SplitLah_`;
  // cuba hantar gambar resit penuh sekali dengan teks
  try {
    const cv = await drawReceipt(r, null);
    const blob = await new Promise(res => cv.toBlob(res, "image/png"));
    const f = new File([blob], "SplitLah-semua.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [f], text: t })) { await navigator.share({ files: [f], text: t }); return; }
  } catch (e) { if (e.name === "AbortError") return; }
  if (navigator.share) { try { await navigator.share({ text: t }); return; } catch (e) { if (e.name === "AbortError") return; } }
  location.href = "https://wa.me/?text=" + encodeURIComponent(t);
};

// ---------- GAMBAR RESIT ----------
let shareBlob = null, shareName = "";
async function openShare(pid) {
  const r = calc(bill);
  const who = pid ? r.per.find(x => x.p.id === pid) : null;
  const cv = await drawReceipt(r, who);
  shareBlob = await new Promise(res => cv.toBlob(res, "image/png"));
  shareName = `SplitLah-${(who ? who.p.name : "semua").replace(/\W+/g, "_")}.png`;
  $("#shImg").src = URL.createObjectURL(shareBlob);
  $("#shTitle").textContent = who ? `Resit untuk ${who.p.name}` : "Resit penuh";
  $("#shareModal").classList.remove("hidden");
}
$("#shShare").onclick = async () => {
  const f = new File([shareBlob], shareName, { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    try { await navigator.share({ files: [f] }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  saveImg(); toast("Phone tak support share terus — gambar disimpan");
};
$("#shSave").onclick = () => saveImg();
function saveImg() { const a = document.createElement("a"); a.href = URL.createObjectURL(shareBlob); a.download = shareName; a.click(); }
$("#shClose").onclick = () => $("#shareModal").classList.add("hidden");
$("#shareModal").onclick = e => { if (e.target.id === "shareModal") e.target.classList.add("hidden"); };

async function drawReceipt(r, who) {
  const W = 600, S = 2, pad = 36, F = '"Courier New", ui-monospace, monospace';
  const ops = []; let y = 0;
  const line = (h, fn) => { const yy = y; ops.push(cx => fn(cx, yy)); y += h; };
  const text = (t, opt = {}) => line(opt.h || 28, (cx, yy) => {
    cx.font = `${opt.bold ? "700 " : ""}${opt.size || 18}px ${F}`; cx.fillStyle = opt.color || "#222"; cx.textAlign = opt.align || "left";
    cx.fillText(t, opt.align === "center" ? W / 2 : opt.align === "right" ? W - pad : pad, yy + (opt.size || 18));
  });
  const fit = (cx, t, max) => { if (cx.measureText(t).width <= max) return t; while (t.length > 1 && cx.measureText(t + "…").width > max) t = t.slice(0, -1); return t + "…"; };
  const row = (l, rt, opt = {}) => line(opt.h || 28, (cx, yy) => {
    const sz = opt.size || 18; cx.font = `${opt.bold ? "700 " : ""}${sz}px ${F}`; cx.fillStyle = opt.color || "#222";
    cx.textAlign = "right"; cx.fillText(rt, W - pad, yy + sz); const rw = cx.measureText(rt).width;
    cx.textAlign = "left"; cx.fillText(fit(cx, l, W - pad * 2 - rw - 16), pad + (opt.indent || 0), yy + sz);
  });
  const dash = (dbl) => line(22, (cx, yy) => { cx.strokeStyle = "#999"; cx.lineWidth = 1.5; cx.setLineDash(dbl ? [] : [7, 6]); for (const o of dbl ? [8, 13] : [11]) { cx.beginPath(); cx.moveTo(pad, yy + o); cx.lineTo(W - pad, yy + o); cx.stroke(); } cx.setLineDash([]); });
  const gap = h => { y += h; };

  gap(34);
  text("S P L I T L A H", { align: "center", size: 14, color: "#888", h: 26 });
  text(bill.shop.toUpperCase(), { align: "center", size: 24, bold: true, h: 36 });
  text(fmtDate(bill.date) + `  ·  ${r.n} orang`, { align: "center", size: 15, color: "#666", h: 26 });
  dash();
  const people = who ? [who] : r.per;
  for (const x of people) {
    if (!who) row(x.p.name.toUpperCase() + (x.p.owner ? " (BAYAR BIL)" : ""), rm(x.total), { bold: true, h: 30 });
    else { text("UNTUK: " + x.p.name.toUpperCase(), { bold: true, size: 19, h: 34 }); }
    x.items.forEach(i => row(i.name, rm(i.price), { size: who ? 17 : 15, color: who ? "#222" : "#555", indent: who ? 0 : 14, h: who ? 27 : 23 }));
    row(`Caj & tax${bill.prop ? " (ikut %)" : ` (÷${r.n})`}`, rm(x.share), { size: who ? 17 : 15, color: "#555", indent: who ? 0 : 14, h: who ? 27 : 23 });
    if (!who) gap(8);
  }
  if (who) {
    dash();
    row("Subtotal makanan", rm(who.sub), { size: 16, color: "#555", h: 25 });
    row("Bahagian caj & tax", rm(who.share), { size: 16, color: "#555", h: 25 });
    if (!bill.prop) row(`  (caj ${rm(r.charges)} ÷ ${r.n} orang)`, "", { size: 14, color: "#888", h: 22 });
    dash(true);
    row("JUMLAH BAYAR", rm(who.total), { bold: true, size: 26, h: 42 });
  } else {
    dash();
    row("Subtotal", rm(r.subtotal), { size: 16, color: "#555", h: 25 });
    if (bill.svc) row("Service charge", rm(bill.svc), { size: 16, color: "#555", h: 25 });
    if (bill.sst) row("SST", rm(bill.sst), { size: 16, color: "#555", h: 25 });
    if (bill.rnd) row("Rounding", rm(bill.rnd), { size: 16, color: "#555", h: 25 });
    if (bill.disc) row("Diskaun", "-" + rm(bill.disc), { size: 16, color: "#555", h: 25 });
    dash(true);
    row("JUMLAH BIL", rm(r.total), { bold: true, size: 24, h: 40 });
  }
  // QR
  const qr = await qrCanvas(260);
  const pn = payName();
  if (qr || pn) {
    dash();
    if (pn) text("BAYAR KEPADA: " + pn.toUpperCase(), { align: "center", bold: true, size: 17, h: 32 });
    if (qr) {
      const qy = y; ops.push(cx => { cx.drawImage(qr, (W - 260) / 2, qy, 260, 260); }); y += 268;
      text("Scan DuitNow QR", { align: "center", size: 15, color: "#555", h: 24 });
      if (who) text(`& taip amaun ${rm(who.total)}`, { align: "center", size: 15, bold: true, color: "#222", h: 24 });
    }
  }
  gap(10);
  text("terima kasih belanja sekali 🍽", { align: "center", size: 13, color: "#999", h: 22 });
  gap(30);

  const H = y, cv = document.createElement("canvas");
  cv.width = W * S; cv.height = (H + 24) * S;
  const cx = cv.getContext("2d"); cx.scale(S, S);
  cx.fillStyle = "#e9e9ee"; cx.fillRect(0, 0, W, H + 24);
  // kertas dengan tepi zig-zag
  cx.save(); cx.translate(0, 12);
  cx.shadowColor = "rgba(0,0,0,.12)"; cx.shadowBlur = 14;
  cx.fillStyle = "#fffdf8"; cx.beginPath();
  const z = 12, zx = 10; cx.moveTo(zx, z);
  for (let x = zx; x < W - zx; x += z * 2) { cx.lineTo(x + z, 0); cx.lineTo(Math.min(x + z * 2, W - zx), z); }
  for (let x = W - zx; x > zx; x -= z * 2) { cx.lineTo(x - z, H); cx.lineTo(Math.max(x - z * 2, zx), H - z); }
  cx.closePath(); cx.fill(); cx.shadowBlur = 0;
  ops.forEach(fn => fn(cx));
  cx.restore();
  return cv;
}

async function qrCanvas(size) {
  if (owner.qrText && window.qrcode) {
    try {
      const q = qrcode(0, "M"); q.addData(owner.qrText); q.make();
      const n = q.getModuleCount(), quiet = 2, cell = Math.floor(size / (n + quiet * 2)) || 1;
      const cv = document.createElement("canvas"); cv.width = cv.height = size;
      const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, size, size);
      const off = Math.floor((size - cell * n) / 2); cx.fillStyle = "#000";
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) cx.fillRect(off + c * cell, off + r * cell, cell, cell);
      return cv;
    } catch (e) { /* jatuh ke gambar asal */ }
  }
  if (owner.qrImg) return await new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = owner.qrImg; });
  return null;
}

// ---------- TETAPAN ----------
async function renderSet() {
  $("#oName").value = owner.name || "";
  $("#gKey").value = store.get("gkey", "");
  const box = $("#qrBox"); box.innerHTML = "";
  if (owner.qrText) { const c = await qrCanvas(360); box.appendChild(c); }
  else if (owner.qrImg) box.innerHTML = `<img class="raw" src="${owner.qrImg}" alt="QR">`;
  else box.innerHTML = `<p class="note">Belum ada QR.</p>`;
  $("#btnQrDel").classList.toggle("hidden", !(owner.qrText || owner.qrImg));
}
$("#qrIn").onchange = async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  toast("🔍 Baca QR...");
  const txt = await decodeQR(f);
  if (txt) { owner.qrText = txt; owner.qrImg = ""; toast("✅ QR dibaca — akan dilukis semula dengan kemas"); }
  else { owner.qrText = ""; owner.qrImg = await toDataURL(await shrinkPng(f, 700)); toast("QR tak dapat dibaca — guna gambar asal"); }
  store.set("owner", owner); renderSet();
};
$("#btnQrDel").onclick = e => { if (!confirmTap(e.target, "Tap lagi untuk padam QR")) return; owner.qrText = ""; owner.qrImg = ""; store.set("owner", owner); renderSet(); };
$("#btnSaveSet").onclick = () => {
  const old = owner.name; owner.name = $("#oName").value.trim().slice(0, 20); store.set("owner", owner);
  store.set("gkey", $("#gKey").value.trim());
  // kemas kini nama owner dalam bil yang sedang dibuka
  if (bill) bill.people.forEach(p => { if (p.owner || (old && p.name === old)) p.name = owner.name || p.name; });
  toast("💾 Disimpan");
};

async function decodeQR(file) {
  if (!window.jsQR) return "";
  const img = await new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = URL.createObjectURL(file); });
  if (!img) return "";
  for (const max of [1000, 700, 1600, 450]) {
    const sc = Math.min(1, max / Math.max(img.width, img.height));
    const cv = document.createElement("canvas"); cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
    const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(img, 0, 0, cv.width, cv.height);
    const d = cx.getImageData(0, 0, cv.width, cv.height);
    const res = jsQR(d.data, d.width, d.height, { inversionAttempts: "attemptBoth" });
    if (res && res.data) return res.data;
  }
  return "";
}
function shrinkPng(file, max) {
  return new Promise(res => { const im = new Image(); im.onload = () => { const sc = Math.min(1, max / Math.max(im.width, im.height)); const cv = document.createElement("canvas"); cv.width = im.width * sc; cv.height = im.height * sc; cv.getContext("2d").drawImage(im, 0, 0, cv.width, cv.height); cv.toBlob(b => res(b || file), "image/jpeg", 0.85); }; im.onerror = () => res(file); im.src = URL.createObjectURL(file); });
}
function toDataURL(blob) { return new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); }); }

// ---------- INIT ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("../sw.js", { scope: "../" }).catch(() => {});
renderHome();
