// Skrin pilih app (ResitKu / SplitLah) — keluar setiap kali app dibuka, lepas skrin login
(function () {
  const pk = document.getElementById("picker"), wel = document.getElementById("welcome");
  const q = new URLSearchParams(location.search);
  let done = q.get("go") === "resit";
  try { if (sessionStorage.getItem("picked")) done = true; } catch {}
  if (q.has("go")) history.replaceState(null, "", location.pathname + location.hash);
  const mark = () => { done = true; try { sessionStorage.setItem("picked", "1"); } catch {} };
  const open = () => { if (!done && wel.classList.contains("hidden")) pk.classList.remove("hidden"); };
  document.getElementById("pickResit").onclick = e => { e.preventDefault(); mark(); pk.classList.add("hidden"); };
  document.getElementById("pickSplit").onclick = () => mark();
  // tunggu skrin login diputuskan dulu, lepas tu tunjuk pemilih
  setTimeout(open, 700);
  new MutationObserver(open).observe(wel, { attributes: true, attributeFilter: ["class"] });
})();
