// ===== GEN.SWAGS Rating =====
// ELO-рейтинг соло-игрока: старт 1000, K=32, ожидание от места команды
// (1/2/3) + личная статистика (K/D, perfect-%). Персист в localStorage.
// Чистая логика — тестируется в Node (storage инжектится).

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

// Прогресс до следующего ранга 0..1 (для UI)
export function rankProgress(rating) {
  let i = 0;
  for (let k = 0; k < RANKS.length; k++) if (rating >= RANKS[k].min) i = k;
  if (i >= RANKS.length - 1) return 1;
  return (rating - RANKS[i].min) / (RANKS[i + 1].min - RANKS[i].min);
}

const MIN_RATING = 100;

export class RatingSystem {
  constructor({ storage = null, key = 'genswags.rating.v1', k = 32, start = 1000 } = {}) {
    this.k = k;
    this.start = start;
    this._storage = storage; // localStorage-подобный {getItem,setItem} или null
    this._key = key;
    this.rating = start;
    this.matches = 0;
    this.wins = 0;
    this._load();
  }

  _load() {
    try {
      const raw = this._storage?.getItem(this._key);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (Number.isFinite(d.rating)) this.rating = d.rating;
      if (Number.isFinite(d.matches)) this.matches = d.matches;
      if (Number.isFinite(d.wins)) this.wins = d.wins;
    } catch { /* повреждённый сейв — стартуем с нуля */ }
  }

  _save() {
    try {
      this._storage?.setItem(this._key, JSON.stringify({
        rating: this.rating, matches: this.matches, wins: this.wins,
      }));
    } catch { /* приватный режим — рейтинг живёт до перезагрузки */ }
  }

  get rank() { return rankFor(this.rating); }

  // Место команды игрока 1..3 по счёту
  static placeOf(scores, playerTeam) {
    const my = scores[playerTeam] ?? 0;
    let place = 1;
    for (let i = 0; i < scores.length; i++) if (i !== playerTeam && scores[i] > my) place++;
    return place;
  }

  // Записать результат матча. Возвращает {delta, rating, oldRating, rank, oldRank}.
  recordMatch({ place = 2, kills = 0, deaths = 0, perfectPct = 0, flowMax = 0 } = {}) {
    const oldRating = this.rating;
    const oldRank = this.rank;
    // Фактический результат по месту: 1→1.0, 2→0.5, 3→0.0
    const actual = place <= 1 ? 1 : place === 2 ? 0.5 : 0;
    const expected = 0.5; // равное поле (боты ~1000)
    let delta = this.k * (actual - expected);
    // Личная статистика: K/D до ±25% K
    const kd = Math.max(-1, Math.min(1, (kills - deaths) / 8));
    delta += this.k * 0.25 * kd;
    // Ритм-точность: perfect-% выше/ниже 30% до ±15% K
    delta += this.k * 0.15 * Math.max(-1, Math.min(1, (perfectPct - 0.3) / 0.4));
    delta = Math.round(delta);

    this.rating = Math.max(MIN_RATING, this.rating + delta);
    this.matches++;
    if (place === 1) this.wins++;
    this._save();
    return { delta, rating: this.rating, oldRating, rank: this.rank, oldRank };
  }
}
