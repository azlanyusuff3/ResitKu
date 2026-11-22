// Butang "Pasang kat Home Screen" untuk Android & iOS.
// Android/Chrome/Edge/Samsung: guna beforeinstallprompt (popup install native).
// iOS: Apple takde API install, jadi tunjuk langkah Share → Add to Home Screen.
(() => {
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isIOSSafari = isIOS && !/crios|fxios|edgios|gsa\//i.test(ua);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  let deferred = null;

  const els = ["#btnInstall", "#btnInstall2"].map(s => document.querySelector(s));
  const banner = document.querySelector("#installBanner");

  function showButtons(on) {
    els.forEach(b => b && b.classList.toggle("hidden", !on));
    const dismissed = localStorageGet("installDismissed");
    banner.classList.toggle("hidden", !on || dismissed);
  }
  function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

  if (standalone) return showButtons(false); // dah install

  // iOS: sentiasa boleh tunjuk butang (manual steps)
  if (isIOS) showButtons(true);

  window.addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    deferred = e;
    showButtons(true);
  });
  window.addEventListener("appinstalled", () => {
    deferred = null; showButtons(false);
    if (typeof toast === "function") toast("ResitKu dah dipasang 🎉");
  });

  // Android tanpa prompt (cth: Firefox / dah dismiss) — tunjuk juga lepas 3s dengan arahan manual
  setTimeout(() => { if (!deferred && !isIOS && /android/i.test(ua)) showButtons(true); }, 3000);

  async function install() {
    if (deferred) {
      deferred.prompt();
      const { outcome } = await deferred.userChoice;
      deferred = null;
      if (outcome === "accepted") showButtons(false);
      return;
    }
    const steps = document.querySelector("#iosSteps");
    if (isIOS && !isIOSSafari) {
      steps.innerHTML = `<p>Kat iPhone/iPad, kena buka dalam <b>Safari</b> dulu.</p><ol>
        <li>Copy link page ni</li><li>Buka <b>Safari</b> & paste</li><li>Tekan butang 📲 Install semula</li></ol>`;
    } else if (isIOS) {
      steps.innerHTML = `<ol>
        <li>Tekan butang <span class="ico">⬆️ Share</span> kat bawah (atau atas) Safari</li>
        <li>Scroll & pilih <span class="ico">➕ Add to Home Screen</span></li>
        <li>Tekan <b>Add</b> kat bucu kanan atas</li></ol>
        <p class="note">Lepas tu buka ResitKu dari ikon kat home screen. Data lebih selamat daripada dalam browser biasa.</p>`;
    } else {
      steps.innerHTML = `<ol>
        <li>Tekan menu <span class="ico">⋮</span> browser (bucu kanan atas)</li>
        <li>Pilih <span class="ico">Install app</span> atau <span class="ico">Add to Home screen</span></li>
        <li>Tekan <b>Install</b></li></ol>
        <p class="note">Paling senang guna Chrome. Kalau takde pilihan tu, buka link ni dalam Chrome.</p>`;
    }
    document.querySelector("#iosModal").classList.remove("hidden");
  }

  els.forEach(b => b && (b.onclick = install));
  document.querySelector("#installLink").onclick = e => { e.preventDefault(); install(); };
  document.querySelector("#installDismiss").onclick = e => { e.preventDefault(); localStorageSet("installDismissed", "1"); banner.classList.add("hidden"); };
  document.querySelector("#iosClose").onclick = () => document.querySelector("#iosModal").classList.add("hidden");
  document.querySelector("#iosModal").onclick = e => { if (e.target.id === "iosModal") e.target.classList.add("hidden"); };
})();
