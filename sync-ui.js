// UI untuk Google Drive sync
(() => {
  const el = s => document.querySelector(s);
  let busy = false;

  async function refresh() {
    const connected = await DB.getMeta("driveOn");
    const last = await DB.getMeta("lastSync");
    const pend = receipts.filter(r => r.img && !r.driveId).length;
    const noImg = receipts.filter(r => !r.img).length;
    el("#btnDriveConnect").classList.toggle("hidden", !!connected);
    ["#btnDriveSync", "#btnDriveRestore", "#btnDriveOff"].forEach(s => el(s).classList.toggle("hidden", !connected));
    if (!Drive.hasClientId()) {
      el("#driveStatus").innerHTML = "⚙️ Belum setup Google Client ID (lihat README).";
      el("#btnDriveConnect").disabled = true;
    } else if (connected) {
      el("#driveStatus").innerHTML = `✅ Disambung${last ? " · sync terakhir " + new Date(last).toLocaleString("ms-MY") : ""}${pend ? ` · <b>${pend} resit belum sync</b>` : " · semua dah sync"}${noImg ? ` · ${noImg} resit takde gambar (tekan 📎 dalam senarai Resit)` : ""}`;
    } else el("#driveStatus").textContent = "Belum sambung.";
    const err = await DB.getMeta("lastSyncErr");
    if (connected && err) el("#driveStatus").innerHTML += `<br>⚠️ ${err}`;
    if (connected && !Drive.valid()) el("#driveStatus").innerHTML += "<br>🔑 Sesi Google tamat — tekan Sync sekarang untuk login semula.";
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
      if (!(await ensureToken(interactive))) { busy = false; refresh(); return; }
      await DB.setMeta("lastSyncErr", null);
      el("#driveStatus").textContent = "🔄 Sync...";
      const n = await Drive.sync(receipts, (i, t) => el("#driveStatus").textContent = `🔄 Upload ${i}/${t}...`);
      if (interactive || n) toast(n ? `☁️ ${n} resit masuk Drive` : "☁️ Semua dah sync");
    } catch (e) {
      const msg = e.message === "auth" ? "Sesi Google tamat — tekan Sync sekarang" : "Sync gagal: " + e.message;
      toast(msg); await DB.setMeta("lastSyncErr", msg);
    } finally { busy = false; await refresh(); renderDash(); }
  }

  // Dipanggil oleh app.js lepas simpan resit — auto-sync kalau token masih sah (tak perlu popup)
  window.afterSave = async () => { if (await DB.getMeta("driveOn")) doSync(false).then(refresh); else refresh(); };

  el("#btnDriveConnect").onclick = () => {
    if (!Drive.ready()) return toast("Client ID belum set");
    el("#driveStatus").textContent = "↗️ Membuka login Google...";
    Drive.connect(true);
  };
  el("#btnDriveSync").onclick = () => doSync(true);
  async function doRestore() {
    try {
      el("#driveStatus").textContent = "⬇️ Restore dari Drive...";
      const n = await Drive.restore((i, t) => el("#driveStatus").textContent = `⬇️ Restore ${i}/${t}...`);
      if (n === null) toast("Takde data ResitKu dalam Drive ni");
      else { receipts = await DB.all(); toast(`✅ ${n} resit dipulihkan dari Drive`); await init(); }
    } catch (e) { toast("Restore gagal: " + e.message); }
    refresh();
  }
  el("#btnDriveRestore").onclick = async () => {
    if (!confirm("Ambil semua resit dari Drive ke phone ni? Resit dengan ID sama akan ditimpa.")) return;
    if (!Drive.valid()) { try { localStorage.setItem("afterLogin", "restore"); } catch {} return Drive.connect(false); }
    doRestore();
  };
  el("#btnDriveOff").onclick = async () => {
    if (!confirm("Putuskan sambungan Drive? Fail dalam Drive tak dipadam.")) return;
    Drive.disconnect(); await DB.setMeta("driveOn", false); refresh();
  };

  // Tunggu receipts load dulu, lepas tu handle balik dari login Google
  setTimeout(async () => {
    if (Drive.justConnected()) {
      await DB.setMeta("driveOn", true);
      let next = null; try { next = localStorage.getItem("afterLogin"); localStorage.removeItem("afterLogin"); } catch {}
      show("set");
      // Phone kosong (baru install / tukar phone) → tarik semua dari Drive dulu
      if (next === "restore" || receipts.length === 0) { toast("✅ Disambung — memulihkan resit dari Drive..."); await doRestore(); }
      else toast("✅ Google Drive disambung");
      doSync(false);
    } else if (Drive.authError()) {
      toast(Drive.authError() === "access_denied" ? "Login dibatalkan" : "Login Google gagal: " + Drive.authError());
      show("set");
    }
    refresh();
  }, 600);
})();
