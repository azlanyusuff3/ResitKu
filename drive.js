// Google Drive sync — setiap user guna Drive DIA SENDIRI.
// Scope drive.file: app cuma nampak fail yang app ni sendiri cipta.
// Struktur: ResitKu/<tahun>/<kategori>/<tarikh>_<kedai>_<id>.jpg + ResitKu/resitku-data.json
const Drive = (() => {
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  const API = "https://www.googleapis.com/drive/v3/files";
  const UP = "https://www.googleapis.com/upload/drive/v3/files";
  let token = null, expiry = 0;
  const folderCache = {};

  const clientId = () => (window.GOOGLE_CLIENT_ID || "").trim();
  const ready = () => !!clientId();
  const valid = () => token && Date.now() < expiry - 60000;

  const REDIRECT = location.origin + location.pathname.replace(/index\.html$/, "");
  function save() { try { localStorage.setItem("gtok", JSON.stringify({ token, expiry })); } catch {} }
  try { const s = JSON.parse(localStorage.getItem("gtok")); if (s && s.expiry > Date.now()) ({ token, expiry } = s); } catch {}

  // Balik dari Google: #access_token=...&expires_in=...&state=...
  let justConnected = false, authError = null;
  if (location.hash.includes("access_token") || location.hash.includes("error=")) {
    const h = new URLSearchParams(location.hash.slice(1));
    let st = null; try { st = localStorage.getItem("gstate"); localStorage.removeItem("gstate"); } catch {}
    if (h.get("access_token") && h.get("state") === st) {
      token = h.get("access_token"); expiry = Date.now() + (+h.get("expires_in") || 3600) * 1000;
      save(); justConnected = true;
    } else authError = h.get("error") || "state";
    history.replaceState(null, "", REDIRECT);
  }

  // Redirect penuh ke Google (jalan dalam PWA home screen Android & iOS — takde popup)
  function connect(firstTime) {
    if (!clientId()) return Promise.resolve(false);
    const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem("gstate", state); } catch {}
    const p = new URLSearchParams({ client_id: clientId(), redirect_uri: REDIRECT, response_type: "token",
      scope: SCOPE, state, include_granted_scopes: "true", prompt: firstTime ? "consent" : "select_account" });
    location.href = "https://accounts.google.com/o/oauth2/v2/auth?" + p;
    return new Promise(() => {}); // page akan pergi
  }

  async function api(url, opts = {}) {
    const r = await fetch(url, { ...opts, headers: { Authorization: "Bearer " + token, ...(opts.headers || {}) } });
    if (r.status === 401) { token = null; throw new Error("auth"); }
    if (!r.ok) throw new Error("drive " + r.status);
    return r.status === 204 ? null : r.json();
  }
  const q = s => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  async function folder(name, parent) {
    const key = (parent || "root") + "/" + name;
    if (folderCache[key]) return folderCache[key];
    const stored = await DB.getMeta("df:" + key);
    if (stored) return (folderCache[key] = stored);
    const query = `name='${q(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false and '${parent || "root"}' in parents`;
    const found = await api(`${API}?q=${encodeURIComponent(query)}&fields=files(id)&spaces=drive`);
    let id = found.files[0] && found.files[0].id;
    if (!id) {
      const made = await api(API + "?fields=id", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: parent ? [parent] : [] }) });
      id = made.id;
    }
    await DB.setMeta("df:" + key, id);
    return (folderCache[key] = id);
  }
  async function path(parts) { let p = null; for (const n of parts) p = await folder(n, p); return p; }

  async function upload(name, parent, blob, mime, existingId) {
    const meta = existingId ? { name } : { name, parents: [parent] };
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
    form.append("file", blob, name);
    const url = existingId ? `${UP}/${existingId}?uploadType=multipart&fields=id` : `${UP}?uploadType=multipart&fields=id`;
    return (await api(url, { method: existingId ? "PATCH" : "POST", body: form })).id;
  }

  const catName = id => ((window.findCat(id) || {}).name || id).replace(/[\/\\]/g, "-");
  const fileName = r => `${r.date}_${r.merchant.replace(/[^\w\- ]+/g, "").trim().slice(0, 30) || "resit"}_RM${r.amount.toFixed(2)}_${r.id.slice(0, 6)}.jpg`;

  // Upload resit yang belum sync + kemas kini resitku-data.json
  async function sync(receipts, onProgress) {
    if (!valid()) throw new Error("auth");
    const root = await path(["ResitKu"]);
    const pend = receipts.filter(r => r.img && !r.driveId);
    let n = 0;
    for (const r of pend) {
      const dir = await path(["ResitKu", r.date.slice(0, 4), catName(r.cat)]);
      r.driveId = await upload(fileName(r), dir, r.img, "image/jpeg");
      await DB.put(r);
      onProgress && onProgress(++n, pend.length);
    }
    // Trash fail Drive untuk resit yang dipadam
    const trash = (await DB.getMeta("driveTrash")) || [];
    for (const id of trash) { try { await api(`${API}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) }); } catch {} }
    await DB.setMeta("driveTrash", []);
    // Data JSON (tanpa gambar)
    const data = JSON.stringify({ app: "resitku", v: 1, synced: new Date().toISOString(), income: await DB.getMeta("income"),
      receipts: receipts.map(({ img, ...r }) => r) }, null, 2);
    const dataId = await DB.getMeta("driveDataId");
    let newId;
    try { newId = await upload("resitku-data.json", root, new Blob([data], { type: "application/json" }), "application/json", dataId); }
    catch (e) { if (e.message === "auth") throw e; newId = await upload("resitku-data.json", root, new Blob([data], { type: "application/json" }), "application/json"); }
    await DB.setMeta("driveDataId", newId);
    await DB.setMeta("lastBackup", Date.now());
    await DB.setMeta("lastSync", Date.now());
    return pend.length;
  }

  // Restore dari Drive (phone baru)
  async function restore(onProgress) {
    if (!valid()) throw new Error("auth");
    const query = `name='resitku-data.json' and trashed=false`;
    const found = await api(`${API}?q=${encodeURIComponent(query)}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`);
    if (!found.files.length) return null;
    const id = found.files[0].id;
    await DB.setMeta("driveDataId", id);
    const r = await fetch(`${API}/${id}?alt=media`, { headers: { Authorization: "Bearer " + token } });
    const meta = await r.json();
    let n = 0;
    for (const rec of meta.receipts) {
      let img = null;
      if (rec.driveId) {
        const ir = await fetch(`${API}/${rec.driveId}?alt=media`, { headers: { Authorization: "Bearer " + token } });
        if (ir.ok) img = await ir.blob();
      }
      await DB.put({ ...rec, img });
      onProgress && onProgress(++n, meta.receipts.length);
    }
    if (meta.income) await DB.setMeta("income", meta.income);
    return meta.receipts.length;
  }

  async function markDeleted(rec) {
    if (!rec.driveId) return;
    const t = (await DB.getMeta("driveTrash")) || [];
    t.push(rec.driveId); await DB.setMeta("driveTrash", t);
  }

  function disconnect() {
    if (token) fetch("https://oauth2.googleapis.com/revoke?token=" + token, { method: "POST" }).catch(() => {});
    token = null; expiry = 0; try { localStorage.removeItem("gtok"); } catch {}
  }

  return { justConnected: () => justConnected, authError: () => authError, redirectUri: REDIRECT, ready, valid, connect, sync, restore, markDeleted, disconnect, hasClientId: () => !!clientId() };
})();
