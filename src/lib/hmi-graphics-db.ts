import type { HmiGraphic, HmiTemplate } from "@/types/hmi-screen";
import type { HmiLibraryCatalog } from "@/components/hmi-editor/tia-library-dialog";

const DB_NAME = "pac-forge-hmi-graphics";
const DB_VERSION = 3;
const STORE_NAME = "graphics";
const TEMPLATE_STORE = "templates";
const CATALOG_STORE = "tia_catalog";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "name" });
      }
      if (!db.objectStoreNames.contains(TEMPLATE_STORE)) {
        db.createObjectStore(TEMPLATE_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(CATALOG_STORE)) {
        db.createObjectStore(CATALOG_STORE, { keyPath: "libraryPath" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Load all graphics from IndexedDB */
export async function loadGraphics(): Promise<Map<string, HmiGraphic>> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const map = new Map<string, HmiGraphic>();
      for (const g of req.result as HmiGraphic[]) {
        map.set(g.name, g);
      }
      resolve(map);
    };
    req.onerror = () => reject(req.error);
    db.close();
  });
}

/** Save graphics to IndexedDB (merges with existing) */
export async function saveGraphics(graphics: Map<string, HmiGraphic>): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  for (const g of graphics.values()) {
    store.put(g);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/** Clear all graphics from IndexedDB */
export async function clearGraphics(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// ---- Template persistence ----

/** Load all templates from IndexedDB */
export async function loadTemplates(): Promise<HmiTemplate[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TEMPLATE_STORE, "readonly");
    const req = tx.objectStore(TEMPLATE_STORE).getAll();
    req.onsuccess = () => resolve(req.result as HmiTemplate[]);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/** Save or update a template */
export async function saveTemplate(template: HmiTemplate): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(TEMPLATE_STORE, "readwrite");
  tx.objectStore(TEMPLATE_STORE).put(template);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/** Delete a template by ID */
export async function deleteTemplate(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(TEMPLATE_STORE, "readwrite");
  tx.objectStore(TEMPLATE_STORE).delete(id);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// ---- TIA Library Catalog persistence ----

/** Load saved TIA library catalog */
export async function loadTiaCatalog(): Promise<HmiLibraryCatalog | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATALOG_STORE, "readonly");
    const req = tx.objectStore(CATALOG_STORE).getAll();
    req.onsuccess = () => {
      const results = req.result as HmiLibraryCatalog[];
      resolve(results.length > 0 ? results[0] : null);
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/** Save TIA library catalog (replaces any existing) */
export async function saveTiaCatalog(catalog: HmiLibraryCatalog): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(CATALOG_STORE, "readwrite");
  const store = tx.objectStore(CATALOG_STORE);
  store.clear();
  store.put(catalog);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
