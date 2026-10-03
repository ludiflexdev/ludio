let database;
function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('fish-studio', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('recordings', { keyPath: 'id' });
    request.onerror = () => reject(new Error('Browser storage is unavailable.'));
    request.onblocked = () => reject(new Error('Close other studio tabs to enable recording storage.'));
    request.onsuccess = () => resolve(request.result);
  });
  return database;
}
export async function loadRecordings() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('recordings').objectStore('recordings').getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.createdAt - a.createdAt));
    request.onerror = () => reject(new Error('Could not load saved recordings.'));
  });
}
export async function saveRecording(recording) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('recordings', 'readwrite');
    const store = transaction.objectStore('recordings');
    let full = false;
    const count = store.count();
    count.onsuccess = () => {
      if (count.result >= 50) { full = true; transaction.abort(); }
      else store.add(recording);
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () => reject(new Error(full ? 'Recording limit reached (50). This clip is available to download but was not saved.' : 'Could not save this recording. Download it to keep a copy.'));
  });
}
export async function removeRecording(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('recordings', 'readwrite');
    transaction.objectStore('recordings').delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = transaction.onabort = () => reject(new Error('Could not remove this recording.'));
  });
}
export function readPreferences() {
  try { return JSON.parse(localStorage.getItem('fish-studio-preferences') || '{}') || {}; }
  catch { return {}; }
}
export function savePreferences(preferences) {
  try { localStorage.setItem('fish-studio-preferences', JSON.stringify(preferences)); return true; }
  catch { return false; }
}
