// Snapshot only documents that are already open. BrowserContext.storageState() visits old origins in
// temporary pages, which makes a visible sign-in browser repeatedly open and close windows.
// Keep the last snapshot of origins no longer open, in Playwright's storage-state format.
export async function captureSignInStorage(context, previous = { origins: [] }) {
  const cookies = await context.cookies();
  const origins = new Map((previous.origins ?? []).map((o) => [o.origin, o]));
  for (const page of context.pages()) {
    for (const frame of page.frames()) {
      if (!/^https?:\/\//.test(frame.url())) continue;
      // A navigation may destroy this document mid-read. Keep its last successful snapshot.
      const state = await frame.evaluate(collectDocumentStorage).catch(() => null);
      if (state) origins.set(state.origin, { ...origins.get(state.origin), ...state });
    }
  }
  return { cookies, origins: [...origins.values()] };
}

// Runs inside an existing browser document. IndexedDB records use Playwright's encoded-value format
// so dates, binary keys, cycles and non-JSON authentication records survive a later newContext().
async function collectDocumentStorage() {
  const result = {
    origin: location.origin,
    localStorage: Object.keys(localStorage).map((name) => ({ name, value: localStorage.getItem(name) })),
  };
  const request = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const encode = (value, seen = new Map()) => {
    if (value === undefined) return { v: 'undefined' };
    if (value === null) return { v: 'null' };
    if (typeof value === 'number') {
      if (Object.is(value, -0)) return { v: '-0' };
      if (!Number.isFinite(value)) return { v: String(value) };
    }
    if (['string', 'number', 'boolean'].includes(typeof value)) return value;
    if (typeof value === 'bigint') return { bi: String(value) };
    if (value instanceof Date) return { d: value.toJSON() };
    if (value instanceof RegExp) return { r: { p: value.source, f: value.flags } };
    if (value instanceof Error) return { e: { n: value.name, m: value.message, s: value.stack } };
    const base64 = (bytes) => {
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    };
    if (value instanceof ArrayBuffer) return { ab: { b: base64(new Uint8Array(value)) } };
    const arrays = { Int8Array: 'i8', Uint8Array: 'ui8', Uint8ClampedArray: 'ui8c', Int16Array: 'i16', Uint16Array: 'ui16', Int32Array: 'i32', Uint32Array: 'ui32', Float32Array: 'f32', Float64Array: 'f64', BigInt64Array: 'bi64', BigUint64Array: 'bui64' };
    if (ArrayBuffer.isView(value) && arrays[value.constructor.name]) {
      return { ta: { k: arrays[value.constructor.name], b: base64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) } };
    }
    if (seen.has(value)) return { ref: seen.get(value) };
    const id = seen.size + 1;
    seen.set(value, id);
    if (Array.isArray(value)) return { a: value.map((v) => encode(v, seen)), id };
    if (value instanceof Map) return { m: [...value].map(([k, v]) => ({ k: encode(k, seen), v: encode(v, seen) })), id };
    if (value instanceof Set) return { s: [...value].map((v) => encode(v, seen)), id };
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Unsupported IndexedDB record');
    return { o: Object.keys(value).map((k) => ({ k, v: encode(value[k], seen) })), id };
  };
  try {
    result.indexedDB = await Promise.all((await indexedDB.databases()).map(async (info) => {
      const db = await request(indexedDB.open(info.name));
      try {
        const names = [...db.objectStoreNames];
        if (!names.length) return { name: info.name, version: db.version, stores: [] };
        const tx = db.transaction(names, 'readonly');
        // Queue all reads before awaiting so the read-only transaction stays active.
        const stores = await Promise.all(names.map(async (name) => {
          const store = tx.objectStore(name);
          const keys = request(store.getAllKeys()), values = request(store.getAll());
          const [ks, vs] = await Promise.all([keys, values]);
          return {
            name, autoIncrement: store.autoIncrement,
            ...(Array.isArray(store.keyPath) ? { keyPathArray: store.keyPath } : typeof store.keyPath === 'string' ? { keyPath: store.keyPath } : {}),
            indexes: [...store.indexNames].map((name) => {
              const index = store.index(name);
              return { name, unique: index.unique, multiEntry: index.multiEntry,
                ...(Array.isArray(index.keyPath) ? { keyPathArray: index.keyPath } : { keyPath: index.keyPath }) };
            }),
            records: vs.map((value, i) => ({ valueEncoded: encode(value), ...(store.keyPath === null ? { keyEncoded: encode(ks[i]) } : {}) })),
          };
        }));
        return { name: info.name, version: db.version, stores };
      } finally { db.close(); }
    }));
  } catch { /* Keep an earlier IndexedDB snapshot if this document is navigating or cannot be serialized. */ }
  return result;
}
