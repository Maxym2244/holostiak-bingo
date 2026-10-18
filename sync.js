// Шар синхронізації: Firebase Realtime Database (безкоштовний Spark-план) або локальний режим.
// Структура в БД:  rooms/<room>/players/<playerId> = { name, d: { <key>: <value>, ... } }
import config from "./firebase-config.js";

export const hasFirebase = Boolean(config && config.databaseURL);

const SDK = "https://www.gstatic.com/firebasejs/10.12.2";
const FLUSH_MS = 250;

export async function createSync({ room, id, name, onPlayers, onStatus }) {
  if (!hasFirebase) {
    onStatus("local");
    return { mode: "local", write() {}, clear() {}, flush() {} };
  }

  onStatus("connecting");
  const [{ initializeApp }, db] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-database.js`),
  ]);

  const database = db.getDatabase(initializeApp(config));
  const meRef = db.ref(database, `rooms/${room}/players/${id}`);
  const dataRef = db.child(meRef, "d");

  db.onValue(db.ref(database, ".info/connected"), (snap) =>
    onStatus(snap.val() ? "online" : "offline"),
  );
  db.onValue(db.ref(database, `rooms/${room}/players`), (snap) => onPlayers(snap.val() || {}));
  db.update(meRef, { name }).catch((e) => {
    console.error(e);
    onStatus("error");
  });

  // Тексти пишемо пачками, щоб не слати апдейт на кожну літеру.
  let pending = {};
  let timer = null;
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    if (!Object.keys(pending).length) return;
    const batch = pending;
    pending = {};
    db.update(dataRef, batch).catch((e) => {
      console.error(e);
      onStatus("error");
    });
  };
  addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => document.hidden && flush());

  return {
    mode: "firebase",
    write(key, value) {
      pending[key] = value; // null = видалити ключ
      clearTimeout(timer);
      timer = setTimeout(flush, FLUSH_MS);
    },
    clear() {
      pending = {};
      return db.set(dataRef, null);
    },
    flush,
  };
}
