// ===== GEN.SWAGS Rating Store (server) =====
// Серверный ELO-рейтинг по нику: старт 1000, K=32.
// Кешаут команды = «победный» результат: члены команды +16 (score 1),
// остальные игроки комнаты −8 (score 0.25) против ожидания 0.5.
// Персист в data/ratings.json (атомарно, tmp+rename).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'ratings.json');

export const RANKS = [
  { min: 0, name: 'НЕЙРОН' },
  { min: 1100, name: 'СИНАПС' },
  { min: 1300, name: 'КОРТЕКС' },
  { min: 1500, name: 'ПСИХОНАВТ' },
  { min: 1800, name: 'ZE FLOW' },
];

export function rankFor(rating) {
  let r = RANKS[0];
  for (const rk of RANKS) if (rating >= rk.min) r = rk;
  return r.name;
}

const START = 1000;
const K = 32;
const MIN_RATING = 100;

export class RatingStore {
  constructor(file = FILE) {
    this._file = file;
    this._db = new Map(); // name -> { rating, matches, cashouts }
    this._load();
  }

  _entry(name) {
    if (!this._db.has(name)) this._db.set(name, { rating: START, matches: 0, cashouts: 0 });
    return this._db.get(name);
  }

  get(name) {
    const e = this._entry(name);
    return { name, rating: e.rating, matches: e.matches, cashouts: e.cashouts, rank: rankFor(e.rating) };
  }

  // Применить результат: score 0..1 против expected (по умолчанию 0.5).
  // Возвращает {name, rating, delta, rank}.
  applyResult(name, score, expected = 0.5) {
    const e = this._entry(name);
    const delta = Math.round(K * (score - expected));
    e.rating = Math.max(MIN_RATING, e.rating + delta);
    e.matches++;
    if (score >= 1) e.cashouts++;
    this.save();
    return { name, rating: e.rating, delta, rank: rankFor(e.rating) };
  }

  top(n = 10) {
    return [...this._db.entries()]
      .map(([name, e]) => ({ name, rating: e.rating, matches: e.matches }))
      .sort((a, b) => b.rating - a.rating)
      .slice(0, n);
  }

  _load() {
    try {
      const raw = fs.readFileSync(this._file, 'utf8');
      const json = JSON.parse(raw);
      for (const [name, rec] of Object.entries(json)) {
        this._db.set(name, {
          rating: Number.isFinite(rec.rating) ? rec.rating : START,
          matches: rec.matches || 0,
          cashouts: rec.cashouts || 0,
        });
      }
      console.log(`[rating] загружено ${this._db.size} записей`);
    } catch {
      // нет файла или битый — начинаем с чистого листа
    }
  }

  // Атомарная запись: tmp + rename
  save() {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const obj = {};
      for (const [name, rec] of this._db) obj[name] = rec;
      const tmp = this._file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
      fs.renameSync(tmp, this._file);
      return true;
    } catch (e) {
      console.error('[rating] ошибка сохранения:', e.message);
      return false;
    }
  }
}
