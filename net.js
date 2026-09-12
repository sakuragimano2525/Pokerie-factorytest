'use strict';
/* =========================================================
   対人戦ネットワーク層（ホスト権威方式）
   - ホストが engine.js を実行し、battle events を Firebase へ push
   - ゲストは events を受信して順番に再生、自分の行動だけ送信
   ========================================================= */

const Net = {
  db: null,
  roomRef: null,
  isHost: false,
  roomId: null,
  playerName: '',
  opponentName: '',
  ready: false,
  _unsubs: [],

  init() {
    if (this.ready) return true;
    if (typeof firebase === 'undefined') {
      console.warn('[Net] Firebase SDK未読込');
      return false;
    }
    if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.databaseURL ||
        FIREBASE_CONFIG.databaseURL.indexOf('YOUR_PROJECT') >= 0) {
      console.warn('[Net] firebase-config.js が未設定');
      return false;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      this.db = firebase.database();
      this.ready = true;
      return true;
    } catch (e) {
      console.error('[Net] 初期化失敗', e);
      return false;
    }
  },

  reset() {
    this._unsubs.forEach((fn) => { try { fn(); } catch (e) {} });
    this._unsubs = [];
    this.roomRef = null;
    this.roomId = null;
    this.isHost = false;
    this.opponentName = '';
  },

  async createRoom(code, name) {
    if (!this.init()) return 'error';
    this.isHost = true;
    this.roomId = code;
    this.playerName = name;
    this.roomRef = this.db.ref('rooms/' + code);
    const snap = await this.roomRef.once('value');
    if (snap.exists()) return 'exists';
    await this.roomRef.set({
      meta: {
        hostName: name,
        guestName: null,
        status: 'waiting',
        createdAt: firebase.database.ServerValue.TIMESTAMP,
      },
      hostTeam: null,
      guestTeam: null,
    });
    this._armDisconnectClose();
    return 'ok';
  },

  async joinRoom(code, name) {
    if (!this.init()) return 'error';
    this.isHost = false;
    this.roomId = code;
    this.playerName = name;
    this.roomRef = this.db.ref('rooms/' + code);
    const snap = await this.roomRef.once('value');
    if (!snap.exists()) return 'not-found';
    const data = snap.val();
    if (!data.meta) return 'not-found';
    if (data.meta.guestName) return 'full';
    if (data.meta.status !== 'waiting') return 'full';
    this.opponentName = data.meta.hostName || '';
    await this.roomRef.child('meta').update({
      guestName: name,
      status: 'both-in',
    });
    this._armDisconnectClose();
    return 'ok';
  },

  /* ---- 切断時に自動で部屋を閉じる設定 ----
     ホスト・ゲストのどちらであっても、ブラウザが閉じられた／回線が切れた等で
     切断された瞬間、Firebase側が自動的に meta/status を 'closed' にする。
     相手はこれを監視して退出を検知する。 */
  _armDisconnectClose() {
    if (!this.roomRef) return;
    try {
      const statusRef = this.roomRef.child('meta/status');
      statusRef.onDisconnect().set('closed');
    } catch (e) {}
  },

  _disarmDisconnectClose() {
    if (!this.roomRef) return;
    try {
      this.roomRef.child('meta/status').onDisconnect().cancel();
    } catch (e) {}
  },

  /* ---- 部屋が閉じられた（相手が抜けた）ことを監視 ---- */
  onRoomClosed(cb) {
    if (!this.roomRef) return;
    const ref = this.roomRef.child('meta/status');
    const handler = (snap) => {
      if (snap.val() === 'closed') cb();
    };
    ref.on('value', handler);
    this._unsubs.push(() => ref.off('value', handler));
  },

  onGuestJoined(cb) {
    if (!this.roomRef) return;
    const ref = this.roomRef.child('meta');
    const handler = (snap) => {
      const data = snap.val() || {};
      if (data.guestName) {
        this.opponentName = data.guestName;
        cb(data.guestName);
      }
    };
    ref.on('value', handler);
    this._unsubs.push(() => ref.off('value', handler));
  },

  onStatusChange(cb) {
    if (!this.roomRef) return;
    const ref = this.roomRef.child('meta/status');
    const handler = (snap) => cb(snap.val());
    ref.on('value', handler);
    this._unsubs.push(() => ref.off('value', handler));
  },

  /* ---- 準備完了ルーム（ソシャゲ風の1番/2番待機部屋） ---- */
  async setReady(ready) {
    if (!this.roomRef) return;
    const path = this.isHost ? 'ready/hostReady' : 'ready/guestReady';
    await this.roomRef.child(path).set(!!ready);
  },

  // 自分・相手両方のready状態の変化を監視する（cbは {mine, opponent} を受け取る）
  onReadyChange(cb) {
    if (!this.roomRef) return;
    const ref = this.roomRef.child('ready');
    const handler = (snap) => {
      const data = snap.val() || {};
      const mine = this.isHost ? !!data.hostReady : !!data.guestReady;
      const opponent = this.isHost ? !!data.guestReady : !!data.hostReady;
      cb({ mine, opponent });
    };
    ref.on('value', handler);
    this._unsubs.push(() => ref.off('value', handler));
  },

  async clearReady() {
    if (!this.roomRef) return;
    await this.roomRef.child('ready').remove();
  },

  async sendTeam(team) {
    if (!this.roomRef) return;
    const path = this.isHost ? 'hostTeam' : 'guestTeam';
    const payload = team.map(serializePokeForNet);
    // 対戦相手が「相手の選出を待っています…」のまま固まるのを防ぐため、
    // 通信が不安定な場合は数回リトライしてから諦める（ここで例外を投げると
    // 以降の画面遷移ごと止まってしまうため、最終手段としてthrowはする）。
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.roomRef.child(path).set(payload);
        return;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    throw lastErr;
  },

  // 直前に登録された onOpponentTeam のリスナーを覚えておき、連戦などで再登録される際に
  // 必ず先に解除する。これを怠ると同じパスに複数の 'value' リスナーが積み重なり、
  // 片方のクロージャの done フラグと実際の受信が噛み合わずコールバックが呼ばれない
  // ことがある（「相手の選出を待っています…」のまま止まる不具合の一因）。
  _opponentTeamUnsub: null,
  onOpponentTeam(cb) {
    if (!this.roomRef) return;
    if (this._opponentTeamUnsub) { this._opponentTeamUnsub(); this._opponentTeamUnsub = null; }
    const path = this.isHost ? 'guestTeam' : 'hostTeam';
    const ref = this.roomRef.child(path);
    let done = false;
    const handler = (snap) => {
      if (done) return;
      const data = snap.val();
      if (data && Array.isArray(data) && data.length > 0) {
        done = true;
        ref.off('value', handler);
        this._opponentTeamUnsub = null;
        cb(data.map(deserializePokeFromNet));
      }
    };
    ref.on('value', handler);
    const unsub = () => ref.off('value', handler);
    this._opponentTeamUnsub = unsub;
    this._unsubs.push(unsub);
  },

  /* ---- 選出後の交換フェーズ（対人戦のみ） ---- */
  async setNegoDone(done) {
    if (!this.roomRef) return;
    const path = this.isHost ? 'nego/hostDone' : 'nego/guestDone';
    await this.roomRef.child(path).set(!!done);
  },

  onOpponentNegoDone(cb) {
    if (!this.roomRef) return;
    const path = this.isHost ? 'nego/guestDone' : 'nego/hostDone';
    const ref = this.roomRef.child(path);
    const handler = (snap) => cb(!!snap.val());
    ref.on('value', handler);
    const unsub = () => ref.off('value', handler);
    this._unsubs.push(unsub);
    return unsub;
  },

  async clearNego() {
    if (!this.roomRef) return;
    await this.roomRef.child('nego').remove();
  },

  async sendAction(action) {
    if (!this.roomRef) return;
    const path = this.isHost ? 'battle/hostAction' : 'battle/guestAction';
    await this.roomRef.child(path).set(serializeAction(action));
  },

  waitForOpponentAction(cb) {
    if (!this.roomRef) return;
    const path = this.isHost ? 'battle/guestAction' : 'battle/hostAction';
    const ref = this.roomRef.child(path);
    const handler = (snap) => {
      const data = snap.val();
      if (data) {
        ref.off('value', handler);
        ref.set(null);
        cb(data);
      }
    };
    ref.on('value', handler);
    this._unsubs.push(() => ref.off('value', handler));
  },

  /* ---- ホスト → ゲストへのイベント送信 ---- */
  async pushEvents(events) {
    if (!this.roomRef || !this.isHost) return;
    for (const ev of events) {
      await this.roomRef.child('battle/events').push(ev);
    }
  },

  async pushEvent(ev) {
    if (!this.roomRef || !this.isHost) return;
    await this.roomRef.child('battle/events').push(ev);
  },

  onEvent(cb) {
    if (!this.roomRef || this.isHost) return;
    const ref = this.roomRef.child('battle/events');
    const handler = (snap) => {
      const ev = snap.val();
      if (ev) cb(ev);
    };
    ref.on('child_added', handler);
    this._unsubs.push(() => ref.off('child_added', handler));
  },

  async clearEvents() {
    if (!this.roomRef) return;
    await this.roomRef.child('battle/events').remove();
    await this.roomRef.child('battle/hostAction').remove();
    await this.roomRef.child('battle/guestAction').remove();
  },

  /* ---- 対戦終了後の連戦/退出選択 ---- */
  async setRematchChoice(choice) {
    // choice: 'rematch' | 'leave'
    if (!this.roomRef) return;
    const path = this.isHost ? 'rematch/hostChoice' : 'rematch/guestChoice';
    await this.roomRef.child(path).set(choice);
  },

  // 一度だけ相手の選択を受け取り、受け取った時点でリスナーを解除する（使い捨て）。
  // これにより、後続の resetForNextBattle() による削除（null化）を
  // 「相手の選択」として誤検知することがなくなる。
  onOpponentRematchChoice(cb) {
    if (!this.roomRef) return;
    const path = this.isHost ? 'rematch/guestChoice' : 'rematch/hostChoice';
    const ref = this.roomRef.child(path);
    let done = false;
    const handler = (snap) => {
      if (done) return;
      const v = snap.val();
      if (v) {
        done = true;
        ref.off('value', handler);
        cb(v);
      }
    };
    ref.on('value', handler);
    this._unsubs.push(() => ref.off('value', handler));
  },

  // 自分が相手の選択を受け取ったことを相手に伝える（ack）。
  async ackRematchChoice() {
    if (!this.roomRef) return;
    const path = this.isHost ? 'rematch/hostAck' : 'rematch/guestAck';
    await this.roomRef.child(path).set(true);
  },

  // 相手からのackを一度だけ待つ（相手が自分の選択を確実に受信したことの確認用）。
  waitOpponentAck() {
    if (!this.roomRef) return Promise.resolve();
    const path = this.isHost ? 'rematch/guestAck' : 'rematch/hostAck';
    const ref = this.roomRef.child(path);
    return new Promise((resolve) => {
      let done = false;
      const handler = (snap) => {
        if (done) return;
        if (snap.val()) {
          done = true;
          ref.off('value', handler);
          resolve();
        }
      };
      ref.on('value', handler);
      this._unsubs.push(() => ref.off('value', handler));
    });
  },

  async clearRematch() {
    if (!this.roomRef) return;
    await this.roomRef.child('rematch').remove();
  },

  // 連戦時：バトル・選出・交換フェーズのデータを次戦用にクリアする
  async resetForNextBattle() {
    if (!this.roomRef) return;
    await this.roomRef.child('battle').remove();
    await this.roomRef.child('nego').remove();
    await this.roomRef.child('rematch').remove();
    await this.roomRef.child('ready').remove();
    await this.roomRef.child('hostTeam').remove();
    await this.roomRef.child('guestTeam').remove();
  },

  /* ---- 部屋を明示的に閉じる（相手に通知） ---- */
  async closeRoom() {
    if (!this.roomRef) return;
    try { await this.roomRef.child('meta/status').set('closed'); } catch (e) {}
  },

  async leave() {
    if (this.roomRef) {
      try {
        this._disarmDisconnectClose();
        await this.closeRoom();
        if (this.isHost) {
          await this.roomRef.remove();
        } else {
          await this.roomRef.child('meta/guestName').remove();
          await this.roomRef.child('guestTeam').remove();
          await this.roomRef.child('battle').remove();
          await this.roomRef.child('nego').remove();
          await this.roomRef.child('rematch').remove();
          await this.roomRef.child('ready').remove();
        }
      } catch (e) {}
    }
    this.reset();
  },
};

/* ---- シリアライズ ---- */
function serializePokeForNet(p) {
  return {
    sid: p.speciesId,
    lv: p.level,
    nat: p.nature,
    ab: p.ability,
    evs: p.evs,
    iv: p.iv,
    stats: p.stats,
    mhp: p.maxHp,
    hp: p.currentHp,
    mids: p.moves.map((m) => m.id),
    st: p.status || 0,
    rk: p.ranks,
    es: p.energyStacks || 0,
    sh: !!p.shiny,
  };
}

function deserializePokeFromNet(d) {
  const species = GAME_DATA.species[d.sid];
  const moves = d.mids.map((id) => {
    if (!id) return null;
    const m = GAME_DATA.moves[id];
    if (!m) return null;
    return {
      id, name: m.name, type: m.type, power: m.power, accuracy: m.accuracy,
      category: m.category, pp: m.pp, maxPp: m.pp, priority: m.priority || 0,
      selfRank: m.selfRank, oppRank: m.oppRank, selfStatus: m.selfStatus,
      oppStatus: m.oppStatus, flinchChance: m.flinchChance || 0,
      drainRatio: m.drainRatio || null, recoilRatio: m.recoilRatio || null,
      selfDestruct: !!m.selfDestruct, chargeTurn: !!m.chargeTurn,
      damageFormula: m.damageFormula || null, callRandomMove: !!m.callRandomMove,
      locked: false,
    };
  }).filter(Boolean);
  return {
    speciesId: d.sid, species, level: d.lv, nature: d.nat, ability: d.ab,
    evs: d.evs, iv: d.iv, stats: d.stats, maxHp: d.mhp, currentHp: d.hp,
    moves,
    shiny: !!d.sh,
    status: d.st || 0, badlyPoisonCounter: 0, confuseTurns: 0, sleepTurns: 0,
    ranks: d.rk || { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 },
    flinch: false, fainted: false,
    fundoTriggered: false, moraibiActive: false, lazyTurns: false,
    firstTurn: true, gyakujouTriggered: false, energyStacks: d.es || 0,
    tauntTurns: 0, bindTurns: 0,
    removedTypes: [], changedType: null,
    typeLockTurns: 0, typeLockType: null,
    lastUsedMoveId: null, encoreMoveId: null, encoreTurns: 0,
    utsusemiTurns: 0, infernoUsed: false,
    deaigashiraLocked: false, turnsOnField: 0, gekirinTurns: 0, gekirinMoveId: null,
    protecting: false, protectStreak: 0,
  };
}

function serializeAction(a) {
  if (!a) return { type: 'none' };
  if (a.type === 'move') return { type: 'move', moveId: a.move.id };
  if (a.type === 'switch') return { type: 'switch', idx: a.idx };
  return { type: 'none' };
}