// ===== GEN.SWAGS Mode: HUB_1 «Quick Cash» =====
// Кешбокс в центре → подбор → перенос В РУКАХ (носитель замедлен) → бросок
// с физикой (G) или загрузка на станции (1.2с) → УДЕРЖАНИЕ 45С (враг может
// выкрасть) → +1000$. Матч 8 минут или 3000$.
// Ядро без DOM — тестируется в Node. События наружу через emit().
import * as THREE from 'three';

export const CashState = {
  IDLE: 'IDLE',           // кешбокс лежит
  CARRIED: 'CARRIED',     // несут (в руках)
  THROWN: 'THROWN',       // летит брошенный (физика)
  CHANNEL: 'CHANNEL',     // загрузка 1.2с
  DEPOSIT: 'DEPOSIT',     // удержание 45с
  COOLDOWN: 'COOLDOWN',   // пауза до нового кешбокса
  ENDED: 'ENDED',
};

const CHANNEL_TIME = 1.2;
const DEPOSIT_TIME = 45;
const STEAL_TIME = 3;
const COOLDOWN_TIME = 10;
const MATCH_TIME = 480;      // 8 минут
const WIN_CASH = 3000;
const CASHOUT_VALUE = 1000;
const REBUILD_EVERY = 120;   // 2 минуты
const PLAYER_RESPAWN = 2; // быстрое перерождение (−3 сек от старых 5)
const PICKUP_R = 1.6;
const STATION_R = 2.5;
const THROW_GRAV = 18;
const THROW_REST_T = 12;     // брошенный ложится через 12с

export class CashoutMode {
  constructor({ arena, destruction = null, sfx = null, headless = false,
    matchTime = MATCH_TIME, winCash = WIN_CASH, cashoutValue = CASHOUT_VALUE,
    killValue = 0, cashEnabled = true, rebuildEvery = REBUILD_EVERY } = {}) {
    this.arena = arena;
    this.destruction = destruction;
    this.sfx = sfx;
    this.headless = headless;

    // Параметры режима (дуэль/FFA настраивают поверх кешаут-базы)
    this.matchTime = matchTime;
    this.winCash = winCash;
    this.cashoutValue = cashoutValue;
    this.killValue = killValue;       // очков за килл (0 — киллы не дают очков)
    this.cashEnabled = cashEnabled;   // false — кешбокс/станции отключены (дуэль)
    this.rebuildEvery = rebuildEvery;

    this.playerTeam = 0;
    this.mpControlled = false; // MP: логика отключена, состояние зеркалит MPCashMirror
    this.scores = [0, 0, 0];
    this.timeLeft = this.matchTime;
    this.state = CashState.IDLE;
    this.running = false;

    // Кешбокс
    this.boxPos = arena.cashboxSpawn.clone();
    this.carrier = null;        // bot | 'player' | null
    this.carrierTeam = -1;
    this.playerCarrying = false;

    // Станции
    this.stations = arena.cashoutStations.map((s) => ({
      letter: s.letter, pos: s.pos, busy: false, team: -1,
    }));
    this.channelStation = null;
    this.channelT = 0;
    this._lastCarrierHp = null;
    this.depositT = 0;
    this.stealT = 0;
    this.cooldownT = 0;
    this.thrown = null;        // { pos, vel, team, restT } — брошенный кешбокс

    // Матч
    this.rebuildT = this.rebuildEvery;
    this.playerRespawnT = 0;
    this._rebuildCount = 0;

    // Колбэки
    this.emit = () => {};       // (type, data)
    this.getPlayer = null;

    this._v = new THREE.Vector3();
  }

  bind({ getPlayer, emit }) {
    if (getPlayer) this.getPlayer = getPlayer;
    if (emit) this.emit = emit;
  }

  startMatch({ silent = false } = {}) {
    this.scores = [0, 0, 0];
    this.timeLeft = this.matchTime;
    this.state = CashState.IDLE;
    this.running = true;
    this.carrier = null;
    this.carrierTeam = -1;
    this.playerCarrying = false;
    this.boxPos.copy(this.arena.cashboxSpawn);
    for (const st of this.stations) { st.busy = false; st.team = -1; }
    this.channelStation = null;
    this.rebuildT = this.rebuildEvery;
    this.playerRespawnT = 0;
    this._syncBoxVisual();
    if (!silent) {
      this.emit('notify', {
        text: this.cashEnabled ? 'МАТЧ НАЧАЛСЯ — ЗАХВАТИТЕ КЕШБОКС' : 'МАТЧ НАЧАЛСЯ',
        cls: 'obj',
      });
    }
    this.emit('score', { scores: this.scores });
  }

  // Очки за килл (дуэль/FFA; в классическом кешауте killValue=0 — no-op)
  registerKill(team) {
    if (!this.killValue || !this.running || team == null || team < 0) return;
    this.scores[team] += this.killValue;
    this.emit('score', { scores: this.scores });
    if (this.scores[team] >= this.winCash) this._endMatch(team);
  }

  stopMatch() { this.running = false; }

  // ---------- Контекст для ботов ----------
  botContext() {
    return {
      state: this.state,
      boxPos: this.boxPos,
      boxAvailable: this.cashEnabled && (this.state === CashState.IDLE || this.state === CashState.THROWN),
      carrier: this.carrier,
      stations: this.stations,
      defendActiveFor: this.state === CashState.DEPOSIT && this.channelStation
        ? this.channelStation.team
        : (this.state === CashState.CHANNEL ? this.carrierTeam : -1),
    };
  }

  // ---------- События от ботов ----------
  botPickup(bot) {
    if (!this.cashEnabled) return false;
    if (this.state !== CashState.IDLE || !bot.alive) return false;
    if (this._dist(bot.pos, this.boxPos) > PICKUP_R) return false;
    this._setCarrier(bot, bot.team);
    return true;
  }

  botReachedStation(bot, station) {
    if (this.state !== CashState.CARRIED || this.carrier !== bot) return false;
    const st = this.stations.find((s) => s === station) || this._nearestStation(bot.pos, true);
    if (!st) return false;
    this._startChannel(st);
    bot.defendPos = st.pos;
    return true;
  }

  onCarrierDeath(bot) {
    if (this.carrier !== bot) return;
    this._dropBox(bot.pos);
  }

  onCarrierDamaged() {
    // Урон носителя во время канала — загрузка прервана
    if (this.state === CashState.CHANNEL) this._interruptChannel();
  }

  // Убийство (для kill feed); victim — бот или {isPlayer}
  onKill(victim, killerName = null) {
    this.emit('kill', { victim, killerName });
  }

  playerDied() {
    const player = this.getPlayer?.();
    if (this.carrier === 'player' && player) this._dropBox(player.body.pos);
    if (this.running && this.playerRespawnT <= 0) {
      this.playerRespawnT = PLAYER_RESPAWN;
      this.emit('player_death', { time: PLAYER_RESPAWN });
    }
  }

  // ---------- Внутреннее ----------
  _dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

  _setCarrier(ref, team) {
    this.carrier = ref;
    this.carrierTeam = team;
    this.state = CashState.CARRIED;
    this._lastCarrierHp = null;
    const mine = team === this.playerTeam;
    const who = ref === 'player' ? 'ВЫ' : ref.name;
    this.emit('notify', {
      text: mine ? `КЕШБОКС ПОДОБРАН (${who})` : `ПРОТИВНИК ПОДОБРАЛ КЕШБОКС`,
      cls: mine ? 'good' : 'bad',
    });
    this.sfx?.ui();
  }

  _dropBox(atPos) {
    this.boxPos.set(atPos.x, 0.4, atPos.z);
    this.carrier = null;
    this.carrierTeam = -1;
    if (this.channelStation && this.state === CashState.CHANNEL) {
      this.channelStation.busy = false;
      this.channelStation = null;
    }
    this.state = CashState.IDLE;
    this.emit('notify', { text: 'КЕШБОКС ВЫПАЛ', cls: 'obj' });
    this._syncBoxVisual();
  }

  // ---------- Бросок кешбокса с физикой (G у носителя) ----------
  // dir — нормализованный вектор взгляда/броска; power в м/с.
  throwByPlayer(dir, power = 14) {
    if (this.state !== CashState.CARRIED || this.carrier !== 'player') return false;
    const p = this.getPlayer?.();
    if (!p) return false;
    const o = p.body.pos;
    const vel = new THREE.Vector3(dir.x, dir.y + 0.35, dir.z).normalize().multiplyScalar(power);
    this._throwBox(new THREE.Vector3(o.x, o.y + 1.3, o.z), vel, this.playerTeam);
    return true;
  }

  _throwBox(pos, vel, team) {
    this.thrown = { pos, vel, team, restT: THROW_REST_T };
    this.carrier = null;
    this.carrierTeam = -1;
    this.playerCarrying = false;
    this.state = CashState.THROWN;
    this.emit('notify', { text: 'КЕШБОКС БРОШЕН!', cls: 'obj' });
    this.emit('cash_thrown', { pos, team });
    this.sfx?.ui?.();
    this._syncBoxVisual();
  }

  _updateThrown(dt, player, bots) {
    const th = this.thrown;
    if (!th) { this.state = CashState.IDLE; return; }
    // физика: гравитация, отскок от пола, трение
    th.vel.y -= THROW_GRAV * dt;
    th.pos.addScaledVector(th.vel, dt);
    if (th.pos.y < 0.4) {
      th.pos.y = 0.4;
      if (Math.abs(th.vel.y) > 1.2) this.sfx?.land?.();
      th.vel.y = -th.vel.y * 0.42;
      th.vel.x *= 0.72; th.vel.z *= 0.72;
      if (Math.abs(th.vel.y) < 0.8) th.vel.y = 0;
    }
    this.boxPos.copy(th.pos);
    // Попадание в свободную кешаут-станцию — мгновенный депозит броском!
    for (const st of this.stations) {
      if (st.busy) continue;
      if (this._dist(th.pos, st.pos) < STATION_R && Math.abs(th.pos.y - st.pos.y) < 3.2) {
        this.thrown = null;
        this.carrierTeam = th.team;
        this.channelStation = st;
        st.busy = true;
        this._startDeposit();
        this.emit('notify', {
          text: th.team === this.playerTeam ? 'ТОЧНЫЙ БРОСОК — ДЕПОЗИТ!' : 'ВРАГ ЗАКИНУЛ КЕШБОКС',
          cls: th.team === this.playerTeam ? 'good' : 'bad',
        });
        return;
      }
    }
    // Подхват на лету/с земли: игрок или любой бот
    if (player?.alive && this._dist(player.body.pos, th.pos) < PICKUP_R && Math.abs(player.body.pos.y - th.pos.y) < 2.2) {
      this.thrown = null;
      this._setCarrier('player', this.playerTeam);
      return;
    }
    if (bots) {
      for (const b of bots) {
        if (!b.alive) continue;
        if (this._dist(b.pos, th.pos) < PICKUP_R && Math.abs(b.pos.y - th.pos.y) < 2.2) {
          this.thrown = null;
          this._setCarrier(b, b.team);
          return;
        }
      }
    }
    // Улёгся — просто лежит (IDLE)
    th.restT -= dt;
    const settled = th.vel.lengthSq() < 0.09 && th.pos.y <= 0.41;
    if (th.restT <= 0 || settled) {
      this.boxPos.copy(th.pos);
      this.thrown = null;
      this.state = CashState.IDLE;
      this._syncBoxVisual();
    }
  }

  _nearestStation(pos, freeOnly) {
    let best = null, bd = Infinity;
    for (const st of this.stations) {
      if (freeOnly && st.busy) continue;
      const d = this._dist(pos, st.pos);
      if (d < bd) { bd = d; best = st; }
    }
    return best;
  }

  _startChannel(st) {
    st.busy = true;
    this.channelStation = st;
    this.channelT = CHANNEL_TIME;
    this._lastCarrierHp = null;
    this.state = CashState.CHANNEL;
    this.emit('notify', { text: `ЗАГРУЗКА НА СТАНЦИИ ${st.letter} — 6С`, cls: 'obj' });
    this.emit('channel_start', { station: st, time: CHANNEL_TIME });
  }

  _interruptChannel() {
    const st = this.channelStation;
    if (st) { st.busy = false; }
    this.channelStation = null;
    this.state = CashState.CARRIED;
    this.emit('notify', { text: 'ЗАГРУЗКА ПРЕРВАНА!', cls: 'bad' });
    this.emit('channel_abort', {});
  }

  _startDeposit() {
    const st = this.channelStation;
    st.team = this.carrierTeam;
    this.depositT = DEPOSIT_TIME;
    this.stealT = 0;
    // Носитель освобождается — кешбокс «внутри» станции
    const carrier = this.carrier;
    this.carrier = null;
    this.playerCarrying = false;
    if (carrier && carrier.isBot) carrier.defendPos = st.pos;
    this.state = CashState.DEPOSIT;
    this.emit('notify', {
      text: this.carrierTeam === this.playerTeam
        ? `ДЕПОЗИТ НА ${st.letter} — ЗАЩИЩАЙТЕ 20С`
        : `ВРАГ ДЕЛАЕТ ДЕПОЗИТ НА ${st.letter}`,
      cls: this.carrierTeam === this.playerTeam ? 'good' : 'bad',
    });
    this.emit('deposit_start', { station: st, team: this.carrierTeam, time: DEPOSIT_TIME });
    this._syncBoxVisual();
  }

  _finishDeposit() {
    const st = this.channelStation;
    const team = st.team;
    this.scores[team] += this.cashoutValue;
    st.busy = false;
    st.team = -1;
    this.channelStation = null;
    this.emit('notify', {
      text: team === this.playerTeam ? `+${this.cashoutValue}$ ВАШЕЙ КОМАНДЕ!` : `ПРОТИВНИК ПОЛУЧИЛ +${this.cashoutValue}$`,
      cls: team === this.playerTeam ? 'good' : 'bad',
    });
    this.emit('score', { scores: this.scores, cashoutTeam: team });
    if (this.sfx?.cashout) this.sfx.cashout();
    else this.sfx?.kill();

    if (this.scores[team] >= this.winCash) {
      this._endMatch(team);
      return;
    }
    this.state = CashState.COOLDOWN;
    this.cooldownT = COOLDOWN_TIME;
    this.emit('state', { state: this.state, time: COOLDOWN_TIME });
  }

  _endMatch(winner) {
    this.state = CashState.ENDED;
    this.running = false;
    this.emit('match_end', {
      scores: [...this.scores],
      winner,
      playerWon: winner === this.playerTeam,
    });
  }

  _endByTimer() {
    let winner = 0;
    for (let i = 1; i < 3; i++) if (this.scores[i] > this.scores[winner]) winner = i;
    this._endMatch(winner);
  }

  // ---------- Пересборка арены ----------
  _rebuildArena() {
    this._rebuildCount++;
    if (!this.headless && this.destruction && this.arena.centerWalls) {
      const walls = this.arena.centerWalls;
      // Восстановить часть центральных стен
      for (const w of walls) this.destruction.restoreWall(w);
      // Перестановка: чётные ребилды — одна конфигурация, нечётные — другая
      const cfg = this._rebuildCount % 2;
      const offsets = cfg
        ? [[-10, -12, 0.5], [16, 4, -0.3], [8, -18, 0.9]]
        : [[-14, -8, 0], [14, 8, 0.2], [12, -14, -0.15]];
      for (let i = 0; i < walls.length; i++) {
        const block = Math.floor(i / 3);
        const w = walls[i];
        const [bx, bz, rot] = offsets[block];
        // Стены блока сохраняют взаимное расположение: восстановим по исходной схеме
        const role = i % 3; // 0: z-4, 1: z+4, 2: x-4 (повернутая)
        const px = role === 2 ? bx - 4 : bx;
        const pz = role === 0 ? bz - 4 : role === 1 ? bz + 4 : bz;
        const ry = role === 2 ? rot + Math.PI / 2 : rot;
        this.destruction.moveWall(w, px, pz, ry);
      }
    }
    this.emit('notify', { text: 'АРЕНА ПЕРЕСОБИРАЕТСЯ', cls: 'obj' });
    this.emit('arena_rebuild', { count: this._rebuildCount });
  }

  // ---------- Визуал кешбокса ----------
  _syncBoxVisual() {
    if (this.headless) return;
    const box = this.arena.cashbox;
    if (!box) return;
    if (!this.cashEnabled) { box.visible = false; return; } // дуэль: кеша нет
    if (this.state === CashState.CHANNEL || this.state === CashState.DEPOSIT) {
      box.visible = false;
      return;
    }
    box.visible = true;
    if (this.state === CashState.THROWN && this.thrown) {
      box.userData.freeY = null;
      box.position.copy(this.thrown.pos);
      box.rotation.x += 0.09; box.rotation.y += 0.13; // кувыркается в полёте
    } else if (this.carrier && this.carrier !== 'player') {
      box.userData.freeY = 1.15; // в руках у бота — на уровне рук
      box.position.set(this.carrier.pos.x, 1.15, this.carrier.pos.z);
      box.rotation.x = 0;
    } else if (this.carrier === 'player') {
      // позицию задаёт main._updateCarryVisual (кеш в руках перед камерой)
      box.userData.freeY = null;
      box.rotation.x = 0;
    } else {
      box.userData.freeY = null;
      box.position.set(this.boxPos.x, this.boxPos.y, this.boxPos.z);
    }
  }

  // ---------- Главный апдейт ----------
  update(dt) {
    if (this.mpControlled) return; // в MP сервер авторитетен (зеркалит MPCashMirror)
    if (!this.running || this.state === CashState.ENDED) return;
    const player = this.getPlayer?.();

    // Таймер матча
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this._endByTimer();
      return;
    }

    // Пересборка арены
    this.rebuildT -= dt;
    if (this.rebuildT <= 0) {
      this.rebuildT = REBUILD_EVERY;
      this._rebuildArena();
    }

    // Респавн игрока
    if (player && !player.alive && this.playerRespawnT > 0) {
      this.playerRespawnT -= dt;
      this.emit('death_tick', { time: Math.max(0, this.playerRespawnT) });
      if (this.playerRespawnT <= 0) {
        const sp = this.arena.spawns[this.playerTeam % this.arena.spawns.length];
        player.spawn(sp.pos, sp.yaw);
        this.emit('player_respawn', {});
      }
    }

    // Прерывание канала уроном носителя (любой источник)
    if (this.state === CashState.CHANNEL) {
      const hp = this.carrier === 'player' ? player?.hp : this.carrier?.hp;
      if (this._lastCarrierHp !== null && hp !== undefined && hp < this._lastCarrierHp) {
        this._interruptChannel();
      }
      if (hp !== undefined) this._lastCarrierHp = hp;
    }

    switch (this.state) {
      case CashState.IDLE: {
        // Подбор игроком
        if (this.cashEnabled && player && player.alive && this._dist(player.body.pos, this.boxPos) < PICKUP_R) {
          this._setCarrier('player', this.playerTeam);
        }
        break;
      }
      case CashState.CARRIED: {
        // Кешбокс следует за носителем
        const cp = this.carrier === 'player' ? player?.body.pos : this.carrier?.pos;
        if (cp) this.boxPos.set(cp.x, 0.4, cp.z);
        // Носитель-бот умер (подстраховка)
        if (this.carrier && this.carrier !== 'player' && !this.carrier.alive) {
          this._dropBox(this.carrier.pos);
          break;
        }
        // Игрок у станции — начать загрузку
        if (this.carrier === 'player' && player?.alive) {
          const st = this._nearestStation(player.body.pos, true);
          if (st && this._dist(player.body.pos, st.pos) < STATION_R) {
            this._startChannel(st);
          }
        }
        break;
      }
      case CashState.THROWN: {
        this._updateThrown(dt, player, this.getBots?.());
        break;
      }
      case CashState.CHANNEL: {
        const st = this.channelStation;
        if (!st) { this.state = CashState.IDLE; break; }
        // Носитель должен оставаться у станции
        const cp = this.carrier === 'player' ? player?.body.pos : this.carrier?.pos;
        const carrierAlive = this.carrier === 'player' ? player?.alive : this.carrier?.alive;
        if (!carrierAlive) { this._dropBox(cp || st.pos); break; }
        if (!cp || this._dist(cp, st.pos) > 3.5) {
          this._interruptChannel();
          break;
        }
        this.channelT -= dt;
        this.emit('channel_tick', { left: this.channelT, total: CHANNEL_TIME, station: st });
        if (this.channelT <= 0) this._startDeposit();
        break;
      }
      case CashState.DEPOSIT: {
        const st = this.channelStation;
        this.depositT -= dt;
        // Перехват: враг рядом со станцией 3с
        let enemyNear = null;
        if (this.getEnemiesNear) {
          enemyNear = this.getEnemiesNear(st.pos, STATION_R, st.team);
        }
        if (enemyNear) {
          this.stealT += dt;
          if (this.stealT >= STEAL_TIME) {
            // Выкрасть кеш: кешбокс выпрыгивает из станции к перехватчику
            this.stealT = 0;
            st.busy = false; st.team = -1;
            this.channelStation = null;
            if (enemyNear.bot) {
              this._setCarrier(enemyNear.bot, enemyNear.bot.team);
              this.emit('notify', { text: 'КЕШБОКС ВЫКРАЛИ!', cls: 'bad' });
            } else if (enemyNear.player) {
              this._setCarrier('player', this.playerTeam);
              this.emit('notify', { text: 'ВЫ ВЫКРАЛИ КЕШБОКС!', cls: 'good' });
            } else {
              st.team = enemyNear.team;
              this.channelStation = st; // станция остаётся депозитом новой команды
              this.state = CashState.DEPOSIT;
            }
            this.emit('deposit_steal', { station: st, team: enemyNear.team });
          }
        } else {
          this.stealT = Math.max(0, this.stealT - dt * 2);
        }
        this.emit('deposit_tick', {
          left: this.depositT, total: DEPOSIT_TIME, station: st,
          steal: this.stealT / STEAL_TIME,
        });
        if (this.depositT <= 0) this._finishDeposit();
        break;
      }
      case CashState.COOLDOWN: {
        this.cooldownT -= dt;
        if (this.cooldownT <= 0) {
          this.boxPos.copy(this.arena.cashboxSpawn);
          this.state = CashState.IDLE;
          this.emit('notify', { text: 'НОВЫЙ КЕШБОКС В ЦЕНТРЕ', cls: 'obj' });
          this._syncBoxVisual();
        }
        break;
      }
    }

    // Замедление носителя-игрока применяет main через playerCarrying
    this.playerCarrying = this.carrier === 'player';
    this._syncBoxVisual();
  }
}
