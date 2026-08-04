// ===== GEN.SWAGS Friends Store =====
// Хранение друзей в памяти + атомарный персист в data/friends.json.
// Структура: { "NICK": { friends: ["NICK2"], incoming: ["NICK3"] } }
// incoming — входящие заявки (кто-то добавил NICK, но NICK ещё не принял).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'friends.json');

export class FriendsStore {
  constructor() {
    this._db = new Map(); // name -> { friends:Set, incoming:Set }
    this._load();
  }

  _entry(name) {
    if (!this._db.has(name)) this._db.set(name, { friends: new Set(), incoming: new Set() });
    return this._db.get(name);
  }

  _load() {
    try {
      const raw = fs.readFileSync(FILE, 'utf8');
      const json = JSON.parse(raw);
      for (const [name, rec] of Object.entries(json)) {
        this._db.set(name, {
          friends: new Set(rec.friends || []),
          incoming: new Set(rec.incoming || []),
        });
      }
      console.log(`[friends] загружено ${this._db.size} записей`);
    } catch {
      // нет файла или битый — начинаем с чистого листа
    }
  }

  // Атомарная запись: tmp + rename
  save() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const obj = {};
      for (const [name, rec] of this._db) {
        obj[name] = { friends: [...rec.friends], incoming: [...rec.incoming] };
      }
      const tmp = FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
      fs.renameSync(tmp, FILE);
      return true;
    } catch (e) {
      console.error('[friends] ошибка сохранения:', e.message);
      return false;
    }
  }

  // Запрос в друзья. Возвращает 'requested' | 'auto-accepted' | 'already' | 'self'
  add(from, to) {
    if (from === to) return 'self';
    const f = this._entry(from);
    if (f.friends.has(to)) return 'already';
    const t = this._entry(to);
    if (f.incoming.has(to)) {
      // Взаимная заявка — сразу друзья
      f.incoming.delete(to);
      f.friends.add(to);
      t.friends.add(from);
      this.save();
      return 'auto-accepted';
    }
    if (t.incoming.has(from)) return 'already'; // заявка уже висит
    t.incoming.add(from);
    this.save();
    return 'requested';
  }

  // Принять заявку от name
  accept(name, from) {
    const n = this._entry(name);
    if (!n.incoming.has(from)) return false;
    n.incoming.delete(from);
    n.friends.add(from);
    this._entry(from).friends.add(name);
    this.save();
    return true;
  }

  // Отклонить заявку
  decline(name, from) {
    const n = this._entry(name);
    if (!n.incoming.has(from)) return false;
    n.incoming.delete(from);
    this.save();
    return true;
  }

  // Удалить из друзей (двусторонне)
  remove(name, friend) {
    const n = this._entry(name);
    const had = n.friends.delete(friend);
    this._entry(friend).friends.delete(name);
    if (had) this.save();
    return had;
  }

  // Список для клиента: друзья + входящие заявки
  list(name) {
    const e = this._entry(name);
    return { friends: [...e.friends], requests: [...e.incoming] };
  }

  areFriends(a, b) {
    return this._db.get(a)?.friends.has(b) || false;
  }
}
