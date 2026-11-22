// IndexedDB kecil: store "receipts" (data + gambar Blob) dan "meta" (tetapan).
const DB = (() => {
  let dbp;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open("resitku", 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore("receipts", { keyPath: "id" });
        d.createObjectStore("meta");
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  }
  return {
    all: () => tx("receipts", "readonly", s => s.getAll()),
    put: rec => tx("receipts", "readwrite", s => s.put(rec)),
    del: id => tx("receipts", "readwrite", s => s.delete(id)),
    clear: () => tx("receipts", "readwrite", s => s.clear()),
    getMeta: k => tx("meta", "readonly", s => s.get(k)),
    setMeta: (k, v) => tx("meta", "readwrite", s => s.put(v, k)),
  };
})();
