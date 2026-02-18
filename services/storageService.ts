
import { SongHistoryItem } from "../types";

const DB_NAME = "SunoMastermindDB";
const STORE_NAME = "songHistory";
const DB_VERSION = 1;

/**
 * Öffnet die IndexedDB Verbindung
 */
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

/**
 * Lädt alle Songs aus der Datenbank
 */
export const loadHistoryFromDB = async (): Promise<SongHistoryItem[]> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const sorted = (request.result as SongHistoryItem[]).sort((a, b) => b.timestamp - a.timestamp);
        resolve(sorted);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error("Failed to load history from IndexedDB", e);
    return [];
  }
};

/**
 * Speichert einen Song oder aktualisiert ihn
 */
export const saveSongToDB = async (item: SongHistoryItem): Promise<void> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(item);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error("Failed to save song to IndexedDB", e);
  }
};

/**
 * Löscht einen Song aus der Datenbank
 */
export const deleteSongFromDB = async (id: string): Promise<void> => {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error("Failed to delete song from IndexedDB", e);
  }
};

/**
 * Exportiert das gesamte Archiv als JSON String
 */
export const exportArchive = async (): Promise<string> => {
  const history = await loadHistoryFromDB();
  return JSON.stringify(history, null, 2);
};

/**
 * Importiert Songs aus einem JSON String in die Datenbank
 */
export const importArchive = async (jsonString: string): Promise<number> => {
  try {
    const items = JSON.parse(jsonString) as SongHistoryItem[];
    if (!Array.isArray(items)) throw new Error("Ungültiges Format");
    
    const db = await openDB();
    let count = 0;
    
    for (const item of items) {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(item);
        request.onsuccess = () => { count++; resolve(); };
        request.onerror = () => reject(request.error);
      });
    }
    return count;
  } catch (e) {
    console.error("Import failed", e);
    throw e;
  }
};
