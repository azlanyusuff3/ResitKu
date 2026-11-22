// UI untuk Google Drive sync
(() => {
  const el = s => document.querySelector(s);
  let busy = false;

  async function refresh() {
    const connected = await DB.getMeta("driveOn");
    const last = await DB.getMeta("lastSync");
    const pend = receipts.filter(r => r.img && !r.driveId).length;
    el("#btnDriveConnect").classList.toggle("hidden", !!connected);
    ["#btnDriveSync", "#btnDriveRestore", "#btnDriveOff"].forEach(s => el(s).classList.toggle("hidden", !connected));
    if (!Drive.hasClientId()) {
      el("#driveStatus").innerHTML = "⚙️ Belum setup Google Client ID (lihat README).";
      el("#btnDriveConnect").disabled = true;
    } else if (connected) {
      el("#driveStatus").innerHTML = `✅ Disambung${last ? " · sync terakhir " + new Date(last).toLocaleString("ms-MY") : ""}${pend ? ` · <b>${pend} resit belum sync</b>` : " · semua dah sync"}`;
    } else el("#driveStatus").textContent = "Belum sambung.";
    renderSyncBanner();
  }

  window.renderSyncBanner = async () => {
    const b = el("#syncBanner"); if (!b) return;
    const connected = await DB.getMeta("driveOn");
    const pend = receipts.filter(r => r.img && !r.driveId).length;
    b.classList.toggle("hidden", !(connected && pend));
    if (connected && pend) b.innerHTML = `☁️ ${pend} resit belum masuk Drive. <a href="#" id="syncNow">Sync sekarang</a>`;
    const a = el("#syncNow"); if (a) a.onclick = e => { e.preventDefault(); doSync(true); };
    // Kalau Drive aktif, amaran "belum backup ZIP" tak perlu
    if (connected) el("#backupWarn").classList.add("hidden");
  };

  async function ensureToken(interactive) {
    if (Drive.valid()) return true;
    if (!interactive) return false;
    return Drive.connect(false);
  }

  async function doSync(interactive) {
    if (busy) return; busy = true;
    try {
      if (!(await ensureToken(interactive))) { refresh(); return; }
      el("#driveStatus").textContent = "🔄 Sync...";
      const n = await Drive.sync(receipts, (i, t) => el("#driveStatus").textContent = `🔄 Upload ${i}/${t}...`);
      if (interactive || n) toast(n ? `☁️ ${n} resit masuk Drive` : "☁️ Semua dah sync");
    } catch (e) {
      toast(e.message === "auth" ? "Sesi Google tamat — tekan Sync sekarang" : "Sync gagal, cuba lagi");
    } finally { busy = false; refresh(); renderDash(); }
  }

  // Dipanggil oleh app.js lepas simpan resit — auto-sync kalau token masih sah (tak perlu popup)
  window.afterSave = async () => { if (await DB.getMeta("driveOn")) doSync(false).then(refresh); else refresh(); };

  el("#btnDriveConnect").onclick = async () => {
    if (!Drive.ready()) return toast("Google belum load — semak internet");
    const ok = await Drive.connect(true);
    if (!ok) return toast("Sambungan dibatalkan");
    await DB.setMeta("driveOn", true);
    toast("✅ Google Drive disambung");
    doSync(false);
  };
  el("#btnDriveSync").onclick = () => doSync(true);
  el("#btnDriveRestore").onclick = async () => {
    if (!confirm("Ambil semua resit dari Drive ke phone ni? Resit dengan ID sama akan ditimpa.")) return;
    if (!(await ensureToken(true))) return;
    try {
      el("#driveStatus").textContent = "⬇️ Restore...";
      const n = await Drive.restore((i, t) => el("#driveStatus").textContent = `⬇️ Restore ${i}/${t}...`);
      if (n === null) toast("Takde data ResitKu dalam Drive ni");
      else { receipts = await DB.all(); toast(`✅ ${n} resit dipulihkan`); init(); }
    } catch { toast("Restore gagal"); }
    refresh();
  };
  el("#btnDriveOff").onclick = async () => {
    if (!confirm("Putuskan sambungan Drive? Fail dalam Drive tak dipadam.")) return;
    Drive.disconnect(); await DB.setMeta("driveOn", false); refresh();
  };

  // Tunggu receipts load dulu
  setTimeout(refresh, 500);
})();
