'use strict';
/* =========================================================
   Pokedrock Battle Factory - UI / Game Flow
   ========================================================= */

const TYPE_CLASS = (t) => 't-' + (t || 'normal');

const TYPE_ID = {
  bug: 1, dark: 2, dragon: 3, electric: 4, fairy: 5, fighting: 6, fire: 7,
  flying: 8, ghost: 9, grass: 10, ground: 11, ice: 12, normal: 13, poison: 14,
  psychic: 15, rock: 16, steel: 17, water: 18, sound: 19, shine: 20,
};
function typeIconHtml(type) {
  const id = TYPE_ID[type];
  if (id === undefined) return '';
  return `<img src="./type${id}.png" alt="" class="move-row-type-icon" onerror="this.style.display='none'">`;
}

// 状態異常（まひ・やけど等）とこんらんを、両方かかっていれば両方まとめて返す。
// 例: [{key:'status1', label:'まひ'}, {key:'confuse', label:'こんらん'}]
function activeStatusBadges(poke) {
  const badges = [];
  if (poke && poke.status && poke.status !== 0) {
    badges.push({ key: 'status' + poke.status, label: STATUS_JP[poke.status] || '' });
  }
  if (poke && poke.confuseTurns > 0) {
    badges.push({ key: 'confuse', label: 'こんらん' });
  }
  return badges;
}

const state = {
  playerTeam: [],
  cpuTeam: [],
  playerActive: null,
  cpuActive: null,
  winStreak: 0,
  battleBusy: false,
  screen: 'title',
  // ---- マルチプレイ用 ----
  playerName: '',
  opponentName: '',
  roomId: null,
  isHost: false,
  multiplayer: false,
  mpHostEvents: [],
  turnNumber: 1,
};

/* =========================================================
   アセットプリロード（画像・効果音・BGM）
   ========================================================= */
const AssetPreloader = (() => {
  const imageCache = new Map(); // key: path, value: HTMLImageElement
  const audioBuffers = new Map(); // key: path, value: HTMLAudioElement (decoded/ready)

  function preloadImage(path) {
    if (imageCache.has(path)) return imageCache.get(path);
    const img = new Image();
    img.src = path;
    imageCache.set(path, img);
    return img;
  }

  function preloadAudio(path) {
    if (audioBuffers.has(path)) return audioBuffers.get(path);
    const a = new Audio();
    a.preload = 'auto';
    a.src = path;
    try { a.load(); } catch (e) {}
    audioBuffers.set(path, a);
    return a;
  }

  // 全ポケモン種族の通常/色違い画像を事前ロード
  function preloadAllSpeciesSprites() {
    try {
      const ids = Object.keys(GAME_DATA.species || {});
      ids.forEach((id) => {
        preloadImage(`./${id}.png`);
        preloadImage(`./${id}s.png`);
      });
    } catch (e) {}
  }

  // タイプアイコン画像の事前ロード
  function preloadTypeIcons() {
    for (let i = 1; i <= 20; i++) preloadImage(`./type${i}.png`);
  }

  // BGM候補の事前ロード（click.mp3は専用プールで別途プリロード済み）
  function preloadAudioAssets() {
    preloadAudio('./menu.mp3');
    for (let i = 1; i <= 20; i++) preloadAudio(`./${i}.mp3`);
  }

  function preloadAll() {
    preloadTypeIcons();
    preloadAudioAssets();
    // 種族画像は数が多いので、他の初期化を邪魔しないよう少し遅延して開始
    setTimeout(() => preloadAllSpeciesSprites(), 0);
  }

  return { preloadImage, preloadAudio, preloadAll, audioBuffers };
})();

/* ---------------- UIクリック効果音 ---------------- */
// 連打しても遅延なく鳴らせるよう、複数のAudioインスタンスをプールして使い回す
const CLICK_SOUND_POOL_SIZE = 6;
const clickSoundPool = [];
let clickSoundIdx = 0;
function initClickSoundPool() {
  for (let i = 0; i < CLICK_SOUND_POOL_SIZE; i++) {
    const a = new Audio('./click.mp3');
    a.preload = 'auto';
    a.volume = 0.5;
    try { a.load(); } catch (e) {}
    clickSoundPool.push(a);
  }
}
initClickSoundPool();

function playClickSound() {
  const a = clickSoundPool[clickSoundIdx];
  clickSoundIdx = (clickSoundIdx + 1) % clickSoundPool.length;
  try {
    a.currentTime = 0;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  } catch (err) {}
}

// クリックが成立した瞬間（＝ボタンをちゃんと押して離した時）だけ鳴らす。
// pointerdown/touchstartだと触れただけで発火してしまうため使わない。
// Audioはプリロード済みのプールから取るので、click発火から再生開始までの遅延はほぼない。
function handleClickSoundTrigger(e) {
  if (!e.target.closest('button')) return;
  playClickSound();
}
document.addEventListener('click', handleClickSoundTrigger, true);

/* ---------------- バトル効果音（タイプ相性／ランク変化） ---------------- */
// click.mp3と同じ「プール方式」で、連続再生してもラグなく鳴らせるようにする。
const BATTLE_SFX_POOL_SIZE = 4;
const battleSfxPools = {};
function getBattleSfxPool(path) {
  if (!battleSfxPools[path]) {
    const pool = [];
    for (let i = 0; i < BATTLE_SFX_POOL_SIZE; i++) {
      const a = new Audio(path);
      a.preload = 'auto';
      a.volume = 0.6;
      try { a.load(); } catch (e) {}
      pool.push(a);
    }
    battleSfxPools[path] = { pool, idx: 0 };
  }
  return battleSfxPools[path];
}
function playBattleSfx(path) {
  const entry = getBattleSfxPool(path);
  const a = entry.pool[entry.idx];
  entry.idx = (entry.idx + 1) % entry.pool.length;
  try {
    a.currentTime = 0;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  } catch (err) {}
}
// タイプ相性倍率に応じた効果音（等倍=hit、効果抜群系=supeff、効果今ひとつ系=noteff。4倍・4分の1も同じ扱い）
function playTypeEffectSound(typeMult) {
  if (typeMult > 1) playBattleSfx('./supeff.mp3');
  else if (typeMult > 0 && typeMult < 1) playBattleSfx('./noteff.mp3');
  else if (typeMult === 1) playBattleSfx('./hit.mp3');
  // typeMult === 0（無効）の場合は音を鳴らさない
}
function playRankUpSound() { playBattleSfx('./sup.mp3'); }
function playRankDownSound() { playBattleSfx('./fall.mp3'); }
// click.mp3同様、あらかじめプールを生成しておき初回再生の遅延を防ぐ
['./supeff.mp3', './noteff.mp3', './hit.mp3', './sup.mp3', './fall.mp3'].forEach(getBattleSfxPool);

/* ---------------- バトルBGM ---------------- */
const BattleBgm = (() => {
  let currentAudio = null;

  function pickTrackPath() {
    const n = rand(1, 20);
    return `./${n}.mp3`;
  }

  function start() {
    MenuBgm.stop();
    stop();
    const path = pickTrackPath();
    const preloaded = AssetPreloader.audioBuffers.get(path);
    const audio = preloaded ? preloaded : new Audio(path);
    audio.loop = true;
    audio.volume = 0.4;
    try { audio.currentTime = 0; } catch (e) {}
    currentAudio = audio;
    const p = audio.play();
    if (p && p.catch) p.catch(() => {});
  }

  function stop() {
    if (currentAudio) {
      try {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      } catch (e) {}
      currentAudio = null;
    }
  }

  return { start, stop };
})();

/* ---------------- ホーム/選出/ルーム待機中のBGM ---------------- */
// バトル本編（トレーナー戦・対人戦）に入っている間以外、基本的にこれを鳴らし続ける。
// すでに再生中なら再度呼ばれても再生し直さない（画面遷移のたびに音が途切れないように）。
const MenuBgm = (() => {
  let audio = null;
  let playing = false;

  function getAudio() {
    if (audio) return audio;
    const preloaded = AssetPreloader.audioBuffers.get('./menu.mp3');
    audio = preloaded ? preloaded : new Audio('./menu.mp3');
    audio.loop = true;
    audio.volume = 0.4;
    return audio;
  }

  function start() {
    if (playing) return;
    playing = true;
    const a = getAudio();
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  }

  function stop() {
    playing = false;
    if (audio) {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch (e) {}
    }
  }

  return { start, stop };
})();

function $(id) { return document.getElementById(id); }

/* ---------------- Fullscreen & orientation ---------------- */
const PC_MIN_WIDTH = 900;
function isPcDevice() {
  const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  const hasFinePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
  const pointerSaysPc = !hasTouch && hasFinePointer;
  const wideEnough = Math.max(window.innerWidth, window.innerHeight) >= PC_MIN_WIDTH;
  return pointerSaysPc || wideEnough;
}

function isFullscreenActive() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement ||
    document.mozFullScreenElement || document.msFullscreenElement);
}

function requestFullscreenAndLandscape() {
  const el = document.documentElement;
  const reqFs = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
  try {
    if (reqFs) {
      const p = reqFs.call(el);
      if (p && p.then) p.catch(() => {});
    }
  } catch (e) {}
  try {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(() => {});
    }
  } catch (e) {}
}

function checkOrientation() {
  if (isPcDevice()) { $('rotate-hint').classList.remove('show'); return; }
  if (state.screen === 'title') { $('rotate-hint').classList.remove('show'); return; }
  const isPortrait = window.innerHeight > window.innerWidth;
  $('rotate-hint').classList.toggle('show', isPortrait);
}
window.addEventListener('resize', checkOrientation);
window.addEventListener('orientationchange', checkOrientation);

// スマホでOS側の戻る操作や手動操作でフルスクリーンが解除されてしまった場合でも、
// タイトル画面に戻らないと再度全画面にできない問題への対応。
// フルスクリーンが解除された状態で画面のどこをタップしても、
// （PCでは何もせず）そのタップをきっかけに再度フルスクリーン＆横向きロックを試みる。
document.addEventListener('click', () => {
  if (isPcDevice()) return;
  if (isFullscreenActive()) return;
  requestFullscreenAndLandscape();
}, true);

/* ---------------- Screen switch ---------------- */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $('screen-' + name).classList.add('active');
  state.screen = name;
  checkOrientation();
}

/* ---------------- Sprite helpers ---------------- */
// 色違いなら "3s.png" のように末尾にsを付けたファイル名を返す
function spritePath(poke) {
  if (!poke) return '';
  return `./${poke.speciesId}${poke.shiny ? 's' : ''}.png`;
}
function spriteImgTag(poke, cls) {
  const speciesId = poke.speciesId;
  return `<img src="${spritePath(poke)}" class="${cls}" onerror="this.replaceWith(makeFallback(${speciesId}, this.className))">`;
}
function fallbackColor(speciesId) {
  const hue = (speciesId * 47) % 360;
  return `hsl(${hue},55%,58%)`;
}
window.makeFallback = function (speciesId, originalClass) {
  const div = document.createElement('div');
  div.className = 'sprite-fallback ' + originalClass;
  const isOpp = originalClass.includes('sprite-opp');
  div.style.width = isOpp ? '90px' : '116px';
  div.style.height = isOpp ? '90px' : '116px';
  div.style.background = fallbackColor(speciesId);
  div.style.fontSize = isOpp ? '30px' : '38px';
  div.textContent = '#' + speciesId;
  return div;
};

function renderTeamCard(poke, idx) {
  const t1 = poke.species.type1, t2 = poke.species.type2;
  return `
    <div class="trade-poke-card" data-idx="${idx}">
      <button class="tpc-info-btn" data-info-idx="${idx}" type="button"><span>!</span></button>
      <img src="${spritePath(poke)}" alt="${poke.species.name}" class="tpc-sprite"
           onerror="this.replaceWith(makeTeamCardFallback(${poke.speciesId}))">
      <div class="tpc-name">${poke.species.name}</div>
      <div class="tpc-types">
        <span class="type-chip ${TYPE_CLASS(t1)}">${typeJp(t1)}</span>
        ${t2 ? `<span class="type-chip ${TYPE_CLASS(t2)}">${typeJp(t2)}</span>` : ''}
      </div>
    </div>
  `;
}
window.makeTeamCardFallback = function (speciesId) {
  const div = document.createElement('div');
  div.className = 'tpc-noimg';
  div.textContent = '#' + speciesId;
  return div;
};

/* ---------------- Message queue ---------------- */
let msgQueue = [];
let msgResolve = null;
const MSG_AUTO_MS = 750;
const LOG_STACK_MAX = 6;
let logLines = [];

// 「ログを見る」オーバーレイ用の履歴（最大30件、古い→新しいの時系列順に描画する）。
const BATTLE_LOG_HISTORY_MAX = 30;
let battleLogHistory = [];
function pushBattleLogHistory(entry) {
  battleLogHistory.push(entry);
  while (battleLogHistory.length > BATTLE_LOG_HISTORY_MAX) battleLogHistory.shift();
}

function queueMessage(text, after, netMeta) {
  msgQueue.push({ text, after });
  // ホスト → ゲストへイベントを即時送信（ホストの演出テンポとゲストの受信をリアルタイム同期させる）
  if (state.multiplayer && state.isHost) {
    // 毎回、両者のアクティブポケモンの実データ（HP・状態異常）をスナップショットとして同梱する。
    // これにより、ダメージ演出の付いていないメッセージ（状態異常付与・天候ダメージ等）でも
    // ゲスト側のポケモンオブジェクトの実データ（currentHp/status）が確実に同期される。
    const pa = state.playerActive;
    const ca = state.cpuActive;
    Net.pushEvent({
      k: 'msg', t: text,
      h: netMeta && netMeta.hit ? netMeta.hit : null,
      hp: netMeta && netMeta.hp !== undefined ? netMeta.hp : null,
      f: netMeta && netMeta.faint ? netMeta.faint : null,
      mu: netMeta && netMeta.moveUse ? netMeta.moveUse : null,
      sid: netMeta && netMeta.speciesId !== undefined ? netMeta.speciesId : null,
      sh: netMeta && netMeta.shiny ? netMeta.shiny : false,
      tm: netMeta && netMeta.typeMult !== undefined ? netMeta.typeMult : null,
      rc: netMeta && netMeta.rankChange ? netMeta.rankChange : null,
      rs: netMeta && netMeta.rankSide ? netMeta.rankSide : null,
      mt: netMeta && netMeta.moveType ? netMeta.moveType : null,
      turn: netMeta && netMeta.turn ? netMeta.turn : null,
      pSnap: pa ? { sid: pa.speciesId, hp: pa.currentHp, mhp: pa.maxHp, st: pa.status || 0, cf: pa.confuseTurns || 0, fainted: !!pa.fainted } : null,
      cSnap: ca ? { sid: ca.speciesId, hp: ca.currentHp, mhp: ca.maxHp, st: ca.status || 0, cf: ca.confuseTurns || 0, fainted: !!ca.fainted } : null,
    });
  }
}

// ターン区切り（--ターンN--）をメッセージキューとログ履歴の両方に積む。
// netMeta.turn を立てて送ることで、ゲスト側でも同じ区切りをログ履歴に残せるようにする。
function queueTurnDivider(turnNumber) {
  const text = `--ターン${turnNumber}--`;
  queueMessage(text, null, { turn: true });
  pushBattleLogHistory({ text, side: null, kind: 'turn', speciesId: null, shiny: false });
}

function hideMessageToast() {}
function pushLogLine(text) {
  const stack = $('battle-log-stack');
  const el = document.createElement('div');
  el.className = 'battle-log-line';
  el.textContent = text;
  stack.appendChild(el);
  logLines.push(el);
  while (logLines.length > LOG_STACK_MAX) {
    const old = logLines.shift();
    old.classList.add('leaving');
    old.addEventListener('animationend', () => old.remove(), { once: true });
    setTimeout(() => old.remove(), 200);
  }
}
function drainMessages() {
  return new Promise((resolve) => {
    async function showNext() {
      if (msgQueue.length === 0) { resolve(); return; }
      const item = msgQueue.shift();
      pushLogLine(item.text);
      if (item.after) { try { await item.after(); } catch (e) {} }
      let done = false;
      const advance = () => {
        if (done) return;
        done = true;
        msgResolve = null;
        clearTimeout(timer);
        showNext();
      };
      const timer = setTimeout(advance, MSG_AUTO_MS);
      msgResolve = advance;
    }
    showNext();
  });
}
$('battle-log-stack').addEventListener('click', () => { if (msgResolve) msgResolve(); });


/* ---------------- HUD update ---------------- */
function hpBarColor(ratio) {
  if (ratio > 0.5) return getComputedStyle(document.documentElement).getPropertyValue('--accent-hp');
  if (ratio > 0.2) return getComputedStyle(document.documentElement).getPropertyValue('--accent-hp-mid');
  return getComputedStyle(document.documentElement).getPropertyValue('--accent-hp-low');
}

function updateHud(poke, prefix, hpOverride) {
  $(prefix + '-name').textContent = poke.species.name;
  $(prefix + '-lv').textContent = 'Lv' + poke.level;
  const hp = hpOverride === undefined ? poke.currentHp : hpOverride;
  const ratio = Math.max(0, hp / poke.maxHp);
  const bar = $(prefix + '-hpbar');
  const committedWidth = getComputedStyle(bar).width;
  bar.style.width = committedWidth;
  void bar.offsetWidth;
  bar.style.width = (ratio * 100) + '%';
  bar.style.background = hpBarColor(ratio);
  const statusEl = $(prefix + '-status');
  const statusBadges = activeStatusBadges(poke);
  statusEl.innerHTML = statusBadges.map((b) =>
    `<span class="hud-status-chip ${b.key === 'confuse' ? 'status-confuse' : 'status-' + poke.status}">${b.label}</span>`
  ).join('');
  if (prefix === 'self') {
    $('self-hp-text').textContent = `${hp}/${poke.maxHp}`;
  } else {
    $('opp-hp-percent').textContent = `${Math.ceil(ratio * 100)}%`;
  }
}

function setSprite(poke, side) {
  const wrap = $(side === 'opp' ? 'sprite-opp-wrap' : 'sprite-self-wrap');
  const cls = side === 'opp' ? 'sprite sprite-opp enter-opp' : 'sprite sprite-self enter-self';
  wrap.innerHTML = spriteImgTag(poke, cls);
  if (state.multiplayer && state.isHost) {
    const hostSide = side === 'opp' ? 'cpu' : 'player';
    const team = hostSide === 'player' ? state.playerTeam : state.cpuTeam;
    const idx = team.indexOf(poke);
    Net.pushEvent({
      k: 'sprite', s: hostSide, idx,
      sid: poke.speciesId, n: poke.species.name, lv: poke.level,
      hp: poke.currentHp, mhp: poke.maxHp, st: poke.status || 0, cf: poke.confuseTurns || 0,
    });
  }
}

function flashHit(side) {
  const wrap = $(side === 'opp' ? 'sprite-opp-wrap' : 'sprite-self-wrap');
  const img = wrap.querySelector('img, .sprite-fallback');
  if (!img) return Promise.resolve();
  img.classList.add('hit');
  return new Promise((res) => setTimeout(() => { img.classList.remove('hit'); res(); }, 160));
}

// 能力ランク変化エフェクト（ダイヤモンド・パール風：上昇=赤フラッシュ／下降=青フラッシュ）。
// スプライトと同じ画像をマスクに使い、ポケモンのドット絵の輪郭に沿って光らせる。
// CSSでの中央寄せ（absolute+margin:auto）はスプライトのflex中央配置とズレることがあるため、
// img要素の実際の描画位置・サイズを getBoundingClientRect で取得し、そこに正確に重ねる。
// direction: 'up' | 'down'
const RANK_FX_DURATION_MS = 500;
function rankFlash(side, direction) {
  const wrap = $(side === 'opp' ? 'sprite-opp-wrap' : 'sprite-self-wrap');
  if (!wrap) return Promise.resolve();
  const img = wrap.querySelector('img, .sprite-fallback');
  if (!img) return Promise.resolve();

  const wrapRect = wrap.getBoundingClientRect();
  const imgRect = img.getBoundingClientRect();

  const overlay = document.createElement('div');
  overlay.className = `rank-fx-overlay ${direction === 'up' ? 'rank-fx-up' : 'rank-fx-down'}`;
  // wrap（position:relative の基準）から見た img の相対位置・サイズに正確に合わせる。
  overlay.style.position = 'absolute';
  overlay.style.left = (imgRect.left - wrapRect.left) + 'px';
  overlay.style.top = (imgRect.top - wrapRect.top) + 'px';
  overlay.style.width = imgRect.width + 'px';
  overlay.style.height = imgRect.height + 'px';
  if (img.tagName === 'IMG' && img.src) {
    overlay.style.webkitMaskImage = `url(${img.src})`;
    overlay.style.maskImage = `url(${img.src})`;
  }
  // self側のスプライトは左右反転表示されているため、オーバーレイのマスクも合わせて反転する。
  if (side === 'self') {
    overlay.style.transform = 'scaleX(-1)';
  }
  wrap.appendChild(overlay);

  if (direction === 'up') playRankUpSound();
  else playRankDownSound();

  return new Promise((res) => {
    setTimeout(() => {
      overlay.remove();
      res();
    }, RANK_FX_DURATION_MS);
  });
}
function playFaint(side) {
  const wrap = $(side === 'opp' ? 'sprite-opp-wrap' : 'sprite-self-wrap');
  const img = wrap.querySelector('img, .sprite-fallback');
  if (!img) return Promise.resolve();
  img.classList.add('faint');
  return new Promise((res) => setTimeout(res, 350));
}

// タイプ技の簡易エフェクト（1:むし〜12:じめん、+こおり）。
// sprite-slot（position:relative）の中に一時的なオーバーレイを差し込み、
// アニメーション終了後に自動で取り除く。
const TYPE_EFFECT_CONFIG = {
  bug:      { emoji: '🍃', cls: 'tfx-bug' },
  dark:     { emoji: '🌑', cls: 'tfx-dark' },
  dragon:   { emoji: '🌀', cls: 'tfx-dragon' },
  electric: { emoji: '⚡', cls: 'tfx-electric' },
  fairy:    { emoji: '✨', cls: 'tfx-fairy' },
  fighting: { emoji: '💥', cls: 'tfx-fighting' },
  fire:     { emoji: '🔥', cls: 'tfx-fire' },
  flying:   { emoji: '🌪️', cls: 'tfx-flying' },
  ghost:    { emoji: '👻', cls: 'tfx-ghost' },
  grass:    { emoji: '🌿', cls: 'tfx-grass' },
  ground:   { emoji: '🪨', cls: 'tfx-ground' },
  ice:      { emoji: '❄️', cls: 'tfx-ice' },
  normal:   { emoji: '⭐', cls: 'tfx-normal' },
  poison:   { emoji: '☠️', cls: 'tfx-poison' },
  psychic:  { emoji: '🔮', cls: 'tfx-psychic' },
  rock:     { emoji: '⛰️', cls: 'tfx-rock' },
  steel:    { emoji: '⚙️', cls: 'tfx-steel' },
  water:    { emoji: '💧', cls: 'tfx-water' },
  sound:    { emoji: '🎵', cls: 'tfx-sound' },
  shine:    { emoji: '🌟', cls: 'tfx-shine' },
};
const TYPE_EFFECT_DURATION_MS = 420;
function playTypeEffect(side, moveType) {
  const wrap = $(side === 'opp' ? 'sprite-opp-wrap' : 'sprite-self-wrap');
  if (!wrap) return Promise.resolve();
  // むし〜じめん（+こおり）は本格的なCanvasパーティクル演出。
  // 未対応タイプ（sound/shineなど演出専用の疑似タイプ）は
  // 従来の絵文字オーバーレイにフォールバックする。
  if (window.TypeFX && window.TypeFX.SUPPORTED_TYPES.indexOf(moveType) !== -1) {
    const p = window.TypeFX.play(wrap, moveType);
    if (p) return p;
  }
  const config = TYPE_EFFECT_CONFIG[moveType];
  if (!config) return Promise.resolve();
  const fx = document.createElement('div');
  fx.className = `type-fx ${config.cls}`;
  fx.textContent = config.emoji;
  wrap.appendChild(fx);
  return new Promise((res) => {
    setTimeout(() => {
      fx.remove();
      res();
    }, TYPE_EFFECT_DURATION_MS);
  });
}

/* ---------------- Command panel rendering ---------------- */
function renderActionMenu() {
  closeWatchOverlay();
  closeLogOverlay();
  const dock = $('cmd-dock');
  dock.classList.remove('dock-wide');
  const panel = $('cmd-panel');
  panel.style.cssText = '';
  panel.className = 'cmd-panel action-menu';
  panel.innerHTML = `
    <button class="neu-btn cmd-btn" id="act-fight">たたかう</button>
    <button class="neu-btn cmd-btn" id="act-switch">ポケモン</button>
  `;
  setWatchLogButtonsActive(true);
  $('act-watch').onclick = () => openWatchOverlay();
  $('act-fight').addEventListener('click', () => renderMoveMenu());
  $('act-switch').addEventListener('click', () => {
    if (state.playerActive.bindTurns > 0) {
      queueMessage(`${state.playerActive.species.name}はバインドされていて交代できない！`);
      drainMessages().then(() => {});
      return;
    }
    if (isTrappedByKagefumi(state.playerActive, state.cpuActive)) {
      queueMessage(`${state.cpuActive.species.name}のかげふみで交代できない！`);
      drainMessages().then(() => {});
      return;
    }
    renderSwitchMenu();
  });
}

// かげふみ：対人戦のみ、相手が交代できなくなる（とんぼがえり等の強制交代・瀕死時は対象外）
function isTrappedByKagefumi(self, opponent) {
  if (!state.multiplayer) return false;
  if (!opponent || opponent.fainted) return false;
  if (!self || self.fainted) return false;
  return opponent.ability === 121; // かげふみ
}

function isDeaigashiraLockedFor(poke, m) {
  return m.id === 4 && poke.deaigashiraLocked;
}

function renderMoveMenu() {
  const dock = $('cmd-dock');
  dock.classList.add('dock-wide');
  const panel = $('cmd-panel');
  panel.style.cssText = '';
  panel.className = 'cmd-panel move-list';
  const poke = state.playerActive;
  // げきりん強制中は、その技のみ選択可能（自動選択でもよいが、UIとしては強制技のみ表示）
  const gekirinForced = poke.gekirinTurns > 0 && poke.gekirinMoveId !== null
    ? poke.moves.find(m => m.id === poke.gekirinMoveId)
    : null;
  const moveButtons = poke.moves.map((m, idx) => {
    const deaiLocked = isDeaigashiraLockedFor(poke, m);
    const gekirinLocked = gekirinForced && m.id !== gekirinForced.id;
    const disabled = m.pp <= 0 || m.locked || deaiLocked || gekirinLocked;
    return `
    <button class="neu-btn cmd-btn move-row ${TYPE_CLASS(m.type)}-edge" data-idx="${idx}" ${disabled ? 'disabled' : ''}>
      ${typeIconHtml(m.type)}
      <span class="move-row-name">${m.name}</span>
      <span class="move-row-pp">PP ${m.pp}/${m.maxPp}</span>
      ${(m.locked || deaiLocked) ? '<span style="color:#ff5d5d;font-size:10px;font-weight:900;">🔒</span>' : ''}
    </button>
  `;
  }).join('');
  panel.innerHTML = moveButtons + `
    <button class="neu-btn cmd-btn move-row-back" id="act-move-back">もどる</button>
  `;
  panel.querySelectorAll('button[data-idx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      playerChooseMove(poke.moves[idx]);
    });
  });
  $('act-move-back').addEventListener('click', () => renderActionMenu());
  setWatchLogButtonsActive(true);
  $('act-watch').onclick = () => openWatchOverlay();
}

/* ---------------- Watch overlay ---------------- */
const RANK_JP = { atk: '攻撃', def: '防御', spa: '特攻', spd: '特防', spe: '素早さ', acc: '命中', eva: '回避' };
const RANK_ORDER = ['atk', 'def', 'spa', 'spd', 'spe', 'acc', 'eva'];
let watchSelectedSide = 'self';

function rankArrowsHtml(v) {
  const MAX = 6;
  const mag = Math.min(MAX, Math.abs(v || 0));
  if (v > 0) {
    const filled = '▲'.repeat(mag);
    const empty = '<span class="dim">' + '△'.repeat(MAX - mag) + '</span>';
    return `<span class="watch-rank-arrows up">${filled}${empty}</span>`;
  }
  if (v < 0) {
    const filled = '▼'.repeat(mag);
    const empty = '<span class="dim">' + '▽'.repeat(MAX - mag) + '</span>';
    return `<span class="watch-rank-arrows down">${filled}${empty}</span>`;
  }
  return `<span class="watch-rank-arrows"><span class="dim">${'△'.repeat(MAX)}</span></span>`;
}

function getEffectiveTypesForDisplay(poke) {
  if (!poke || !poke.species) return [];
  const t1 = poke.species.type1;
  const t2 = poke.species.type2;
  let types = [];
  if (poke.changedType) {
    types = [poke.changedType];
  } else {
    if (t1 && !poke.removedTypes.includes(t1)) types.push(t1);
    if (t2 && !poke.removedTypes.includes(t2)) types.push(t2);
  }
  return [...new Set(types)];
}

function typesHtml(poke) {
  if (!poke || !poke.species) return '';
  const types = getEffectiveTypesForDisplay(poke);
  return types.map((t) => `
    <span class="watch-type-chip">
      ${typeIconHtml(t)}
      <span class="watch-type-name">${GAME_DATA.typeKeyToJp[t] || t}</span>
    </span>
  `).join('');
}

function ranksHtml(poke) {
  const ranks = poke && poke.ranks;
  if (!ranks) return `<div class="watch-empty">変化なし</div>`;
  const rows = RANK_ORDER.map((k) => {
    const v = ranks[k] || 0;
    return `<div class="watch-rank-row"><span class="watch-rank-name">${RANK_JP[k]}</span>${rankArrowsHtml(v)}</div>`;
  });
  return rows.join('');
}

function statusBadgeLabel(poke) {
  const badges = activeStatusBadges(poke);
  if (badges.length === 0) return null;
  return badges.map((b) => b.label).join(' ');
}

function typeChangeLabel(poke) {
  if (!poke) return null;
  const parts = [];
  if (poke.changedType) {
    parts.push(`タイプ: ${typeJp(poke.changedType)}（変化）`);
  }
  if (poke.removedTypes && poke.removedTypes.length > 0) {
    parts.push(`タイプ消失: ${poke.removedTypes.map(t => typeJp(t)).join('、')}`);
  }
  if (poke.typeLockTurns > 0 && poke.typeLockType) {
    parts.push(`タイプロック: ${typeJp(poke.typeLockType)} ${poke.typeLockTurns}ターン`);
  }
  return parts.length > 0 ? parts.join('、') : null;
}

function watchSideItemHtml(poke, side, isSelected) {
  const label = side === 'self' ? 'じぶん' : 'あいて';
  const ratio = poke ? Math.max(0, poke.currentHp / poke.maxHp) : 0;
  const iconHtml = poke
    ? `<img src="${spritePath(poke)}" alt="" class="wsi-icon" onerror="this.replaceWith(makeTeamCardFallback(${poke.speciesId}))">`
    : `<div class="wsi-icon">-</div>`;
  const typeLabel = poke ? getEffectiveTypesForDisplay(poke).map(t => typeJp(t)).join('/') : '-';
  return `
    <button class="watch-side-item ${isSelected ? 'active' : ''}" data-side="${side}">
      ${iconHtml}
      <div class="wsi-info">
        <div class="wsi-tag">${label}</div>
        <div class="wsi-name">${poke ? poke.species.name : '-'} <span style="font-size:10px;color:var(--ink-soft);">${typeLabel}</span></div>
        <div class="wsi-hpbar-outer"><div class="wsi-hpbar-inner" style="width:${ratio * 100}%; background:${hpBarColor(ratio)}"></div></div>
      </div>
    </button>
  `;
}

function renderWatchSideList() {
  const self = state.playerActive;
  const opp = state.cpuActive;
  $('watch-side-list').innerHTML = [
    watchSideItemHtml(self, 'self', watchSelectedSide === 'self'),
    watchSideItemHtml(opp, 'opp', watchSelectedSide === 'opp'),
  ].join('');
  $('watch-side-list').querySelectorAll('.watch-side-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      watchSelectedSide = btn.dataset.side;
      renderWatchOverlay();
    });
  });
}

function renderWatchDetail() {
  const poke = watchSelectedSide === 'self' ? state.playerActive : state.cpuActive;
  $('watch-detail-name').textContent = poke ? poke.species.name : '-';
  $('watch-detail-lv').textContent = poke ? `Lv${poke.level}` : '';
  const ratio = poke ? Math.max(0, poke.currentHp / poke.maxHp) : 0;
  $('watch-detail-hpbar').style.width = `${ratio * 100}%`;
  $('watch-detail-hpbar').style.background = hpBarColor(ratio);
  if (!poke) {
    $('watch-detail-hp-text').textContent = '0/0';
  } else if (watchSelectedSide === 'self') {
    $('watch-detail-hp-text').textContent = `${poke.currentHp}/${poke.maxHp}`;
  } else {
    $('watch-detail-hp-text').textContent = `HP ${Math.ceil(ratio * 100)}%`;
  }
  $('watch-detail-types').innerHTML = poke ? typesHtml(poke) : '';
  $('watch-detail-ranks').innerHTML = ranksHtml(poke);

  const badgeEl = $('watch-detail-status-badge');
  const badgeLabel = statusBadgeLabel(poke);
  if (badgeLabel) {
    badgeEl.textContent = badgeLabel;
    badgeEl.style.display = '';
  } else {
    badgeEl.textContent = '';
    badgeEl.style.display = 'none';
  }

  const typeChangeLabelEl = document.getElementById('watch-detail-type-change');
  if (!typeChangeLabelEl) {
    const el = document.createElement('div');
    el.id = 'watch-detail-type-change';
    el.style.cssText = 'font-size:11px;font-weight:700;color:var(--accent-b);margin-top:4px;';
    $('watch-detail-hp-text').after(el);
  }
  const label = typeChangeLabel(poke);
  document.getElementById('watch-detail-type-change').textContent = label || '';
}

function renderWatchField() {
  const poke = watchSelectedSide === 'self' ? state.playerActive : state.cpuActive;
  const chips = [];

  if (battleField.weather && battleField.weather !== 'none') {
    chips.push(`${WEATHER_JP[battleField.weather] || battleField.weather} ${battleField.weatherTurns}ターン`);
  }
  if (battleField.terrain && battleField.terrain !== 'none') {
    chips.push(`${TERRAIN_JP[battleField.terrain] || battleField.terrain} ${battleField.terrainTurns}ターン`);
  }

  if (battleField.tailwindPlayer > 0 && watchSelectedSide === 'self') {
    chips.push(`おいかぜ ${battleField.tailwindPlayer}ターン`);
  } else if (battleField.tailwindCpu > 0 && watchSelectedSide === 'opp') {
    chips.push(`おいかぜ ${battleField.tailwindCpu}ターン`);
  }

  if (battleField.trickRoom) {
    chips.push(`トリックルーム ${battleField.trickRoomTurns}ターン`);
  }

  const tauntTurns = poke ? poke.tauntTurns || 0 : 0;
  if (tauntTurns > 0) chips.push(`ちょうはつ ${tauntTurns}ターン`);

  const reflectTurns = watchSelectedSide === 'self' ? battleField.playerReflect : battleField.cpuReflect;
  const lightScreenTurns = watchSelectedSide === 'self' ? battleField.playerLightScreen : battleField.cpuLightScreen;
  if (reflectTurns > 0) chips.push(`リフレクター ${reflectTurns}ターン`);
  if (lightScreenTurns > 0) chips.push(`ひかりのかべ ${lightScreenTurns}ターン`);

  if (poke && poke.bindTurns > 0) {
    chips.push(`バインド ${poke.bindTurns}ターン`);
  }

  if (poke && poke.utsusemiTurns > 0) {
    chips.push(`うつせみ ${poke.utsusemiTurns}ターン後に発動`);
  }

  if (poke && poke.encoreTurns > 0 && poke.encoreMoveId !== null) {
    const move = poke.moves.find(m => m.id === poke.encoreMoveId);
    chips.push(`アンコール ${move ? move.name : ''} ${poke.encoreTurns}ターン`);
  }

  if (poke && poke.typeLockTurns > 0 && poke.typeLockType) {
    chips.push(`タイプロック: ${typeJp(poke.typeLockType)} ${poke.typeLockTurns}ターン`);
  }

  if (poke && poke.removedTypes && poke.removedTypes.length > 0) {
    chips.push(`タイプ消失: ${poke.removedTypes.map(t => typeJp(t)).join('、')}`);
  }

  if (poke && poke.changedType) {
    chips.push(`タイプ変化: ${typeJp(poke.changedType)}`);
  }

  const hazardSideKey = watchSelectedSide === 'self' ? 'player' : 'cpu';
  const hz = (typeof hazardState !== 'undefined') ? hazardState[hazardSideKey] : null;
  if (hz && hz.stealthRock) chips.push('ステルスロック');
  if (hz && hz.replugTrap) chips.push('リプループラグ');

  const row = $('watch-status-row');
  row.innerHTML = chips.length
    ? chips.map((c) => `<span class="watch-status-chip">${c}</span>`).join('')
    : `<span class="watch-empty">なし</span>`;
}

function renderWatchOverlay() {
  renderWatchSideList();
  renderWatchDetail();
  renderWatchField();
}

function setWatchLogButtonsActive(active) {
  const watchBtn = $('act-watch');
  const logBtn = $('act-log');
  watchBtn.disabled = !active;
  if (active) {
    watchBtn.classList.remove('hide-when-acting');
    logBtn.classList.remove('hide-when-acting');
  } else {
    watchBtn.classList.add('hide-when-acting');
    logBtn.classList.add('hide-when-acting');
  }
}

function openWatchOverlay() {
  watchSelectedSide = 'self';
  renderWatchOverlay();
  $('watch-overlay').classList.add('show');
}
function closeWatchOverlay() {
  $('watch-overlay').classList.remove('show');
}
$('watch-close').addEventListener('click', () => closeWatchOverlay());

/* ---------------- Battle log overlay（ログを見る） ---------------- */
function logEntryHtml(entry) {
  if (entry.kind === 'turn') {
    return `<div class="log-turn-divider">${entry.text}</div>`;
  }
  const sideClass = entry.side ? `side-${entry.side === 'player' ? 'player' : 'cpu'}` : '';
  const kindClass = `kind-${entry.kind}`;
  const tag = entry.kind === 'move' ? 'わざ' : (entry.kind === 'damage' ? 'HP減少' : '');
  let iconHtml = '';
  if (entry.speciesId) {
    const src = `./${entry.speciesId}${entry.shiny ? 's' : ''}.png`;
    iconHtml = `<img src="${src}" class="log-entry-icon" onerror="this.style.visibility='hidden'">`;
  }
  return `
    <div class="log-entry ${sideClass} ${kindClass}">
      ${iconHtml}
      <span class="log-entry-text">${tag ? `<span class="log-entry-tag">${tag}</span>` : ''}${entry.text}</span>
    </div>
  `;
}
function renderLogOverlay() {
  const list = $('log-panel-list');
  if (battleLogHistory.length === 0) {
    list.innerHTML = `<div class="log-panel-empty">まだログがありません</div>`;
    return;
  }
  // 上が古い、下が最新の時系列順で描画する。
  list.innerHTML = battleLogHistory.map((e) => logEntryHtml(e)).join('');
  // 開いた直後は一番下（＝最新）が見えるようにスクロールしておく。
  list.scrollTop = list.scrollHeight;
}
function openLogOverlay() {
  renderLogOverlay();
  $('log-overlay').classList.add('show');
}
function closeLogOverlay() {
  $('log-overlay').classList.remove('show');
}
$('log-close').addEventListener('click', () => closeLogOverlay());
$('act-log').addEventListener('click', () => openLogOverlay());

function renderSwitchMenu() {
  openPartyOverlay('switch');
}

/* ---------------- Party (Pokémon select) overlay ---------------- */
const JA_STAT_NAME = { hp: 'HP', atk: '攻撃', def: '防御', spa: '特攻', spd: '特防', spe: '素早さ' };

function abilityNameById(id) {
  if (id == null) return null;
  const names = (typeof GAME_DATA !== 'undefined' && GAME_DATA.abilityNames) || {};
  return names[id] != null ? names[id] : null;
}
const ABILITY_DESC_BY_ID = {
3: '毎ターン すばやさが あがる',
16: '登場時に相手の攻撃を1段階下げる',
32: '相手のPPを余計に消費させる',
33: 'ほのお・こおりタイプのダメージを半減する',
36: '連続行動できなくなる',
51: '技の命中率が1.3倍になる',
53: '威力60以下の技の威力が1.5倍になる',
56: '技の追加効果が出やすくなる（確率2倍）',
62: 'ノーマルの技がフェアリーになる（威力1.2倍）',
64: 'HP満タン時に受けるダメージが半減する',
65: '能力ランクの変化が逆転する',
66: '技の威力が1.3倍になるが追加効果がなくなる',
67: '相手から能力を下げられない',
68: '自分と同じタイプの技の威力が1.5倍になる',
69: 'お互いの技が必中する',
70: '接触する技（物理技）の威力が1.3倍になる',
71: '変化技を優先的に出せる（優先度+1）',
74: '急所に当たりやすくなる',
75: '相手の特性の効果を無視する',
76: '登場時に相手の特性をコピーする',
77: '効果抜群のダメージを0.75倍に軽減する',
78: '急所ダメージが2.25倍になる',
79: '攻撃が1.5倍になるが命中率が0.8倍になる',
84: 'HP満タン時、飛行技の優先度が+1される',
90: 'ひるみ状態にならない',
91: 'すべての状態異常にならない',
92: '命中ランクが下がらない',
93: '砂嵐時、岩・地面・鋼技の威力が1.3倍になる',
94: '草技を無効化し攻撃が1段階上がる',
95: '毎ターン、ランダムな能力+2、別の能力-1',
97: '技の追加効果を受けない',
98: '能力が下がると攻撃が+2される',
99: '能力が下がると特攻が+2される',
102: '攻撃を受けると防御が+1される',
103: 'ダメージを受けると防御-1、素早さ+2',
104: '瀕死時に相手に最大HPの1/4ダメージ',
19: 'じめんタイプのわざをうけない',
72: 'サウンドタイプの技の威力が1.2倍になる',
73: 'シャインタイプの技の威力が1.2倍になる',
80: 'ノーマルの技がこおりになる（威力1.2倍）',
81: 'ノーマルの技がでんきになる（威力1.2倍）',
82: 'ノーマルの技がドラゴンになる（威力1.2倍）',
83: 'ノーマルの技がエスパーになる（威力1.2倍）',
112: '相手を倒すたびに攻撃が上がる',
113: '相手を倒すたびに特攻が上がる',
133: 'HPが減るとACSが+1、BDが-1',
86: 'きるタイプの技の威力が1.5倍になる',
87: 'かむタイプの技の威力が1.5倍になる',
88: 'はどうタイプの技の威力が1.5倍になる',
89: 'こぶしタイプの技の威力が1.5倍になる',
105: '物理技を受けると30%で相手の技を1つ封じる',
106: '場に出ている間、全員の特性が無効になる',
107: '控えに戻るとHPが最大の1/3回復する',
108: '相手の能力上昇をトレース',
109: 'HP半分で特攻+1',
110: '相手の特性がわかる',
111: '相手の危険な技を2つログ表示',
126: '相手の優先度+1以上の技を無効化',
127: '物理技のダメージが半減する',
128: '特殊技のダメージが半減する',
129: '初ターンの技威力が1.5倍になる',
132: '自分にかかる能力変化が2倍になる',
134: '毎ターン、エナジースタックを1つ獲得する',
135: '電気技を使う時、全スタック消費して威力上昇（×30）',
136: 'スタック2で素早さ+1、3で防御・特防+2',
137: 'スタック数×0.2倍、技威力が上昇する',
115: '連続技が必ず最大回数当たる',
122: '相手の危険な技を2つログ表示（111と同じ）',
123: '相手の壁（リフレクター・ひかりのかべ）を貫通する',
125: '変化技を跳ね返す',
85: '自分の命中率ランクが下がらない',
121: '（対人戦）相手を交代できなくする',
124: '自分がアンコール・ちょうはつ中、攻撃技の威力が1.5倍になる',
  41: 'ピンチに くさのいりょくが あがる',
  42: 'ピンチに ほのおのいりょくが あがる',
  43: 'ピンチに みずのいりょくが あがる',
  44: 'ピンチに むしのいりょくが あがる',
  5: 'HPが 満タンのとき 技を 受けても 一撃で 倒されることが ない',
  45: 'わざの はんどうダメージ をうけない',
  9: 'でんきを うけない',
  10: 'みずを うけない',
  14: 'ほのおを うけない',
  101: 'むしを うけない',
  4: 'わざを きゅうしょに うけない',
  17: 'さわった あいてを キズつける',
  25: 'こうげきが 2ばいになる',
  46: 'とうじょう したときに 5ターンのあいだ てんきを ひでりに する',
  31: 'とうじょう したときに 5ターンのあいだ てんきを すなあらしに する',
  2: 'とうじょう したときに 5ターンのあいだ てんきを あめに する',
  57: 'とうじょう したときに 5ターンのあいだ てんきを ゆきに する',
  138: 'とうじょう したときに 5ターンのあいだ てんきを ほしぞらに する',
  116: 'とうじょう したときに 5ターンのあいだ フィールドを グラスフィールドにする',
  117: 'とうじょう したときに 5ターンのあいだ フィールドを エレキフィールドにする',
  118: 'とうじょう したときに 5ターンのあいだ フィールドを サイコフィールドにする',
  119: 'とうじょう したときに 5ターンのあいだ フィールドを ミストフィールドにする',
  120: 'とうじょう したときに 5ターンのあいだ フィールドを メロディフィールドにする',
  23: 'あめの とき すばやさが 2ばいになる',
  24: 'ひでりの とき すばやさが 2ばいになる',
  59: 'ゆきの とき すばやさが 2ばいになる',
  60: 'すなあらしの とき すばやさが 2ばいになる',
  30: 'あめの とき ターン終了時に すこしずつ HPが かいふくする',
  100: 'ゆきの とき こうげき と とくこうが 1.5ばいに あがるが、こうげき したあと じぶんも ダメージを うける',
  96: 'ひでりの とき とくこうが 1.5ばいに あがるが、こうげき したあと じぶんも ダメージを うける',
  6: 'まひ状態に ならない',
  8: 'さわった あいてを 30%の かくりつで まひ状態に する',
  11: 'ねむり状態に ならない',
  39: 'やけど状態の とき こうげきが 1.5ばいに あがる',
  40: 'じょうたいいじょうの とき ぼうぎょが 1.5ばいに あがる',
  54: 'はがねタイプや どくタイプの あいてにも どく状態の わざを あてられる',
  63: 'じょうたいいじょうの とき すばやさが 1.5ばいに あがる',
  131: 'さわった あいてを 50%の かくりつで もうどく状態に する',
  34: 'さわった あいてを 30%の かくりつで やけど状態に する',
};
function abilityDescById(id) {
  if (id == null) return '';
  return ABILITY_DESC_BY_ID[id] || '';
}
function getAbilityInfo(poke) {
  const a = poke.ability;
  if (a && typeof a === 'object') {
    const id = a.id;
    return { name: a.name || abilityNameById(id) || '', desc: a.desc || a.description || abilityDescById(id) };
  }
  if (a != null) {
    const nm = abilityNameById(a);
    if (nm) return { name: nm, desc: abilityDescById(a) };
  }
  if (poke.abilityId != null) {
    const nm = abilityNameById(poke.abilityId);
    if (nm) return { name: nm, desc: abilityDescById(poke.abilityId) };
  }
  const speciesAbilities = poke.species && poke.species.abilities;
  if (Array.isArray(speciesAbilities) && speciesAbilities.length > 0) {
    const nm = abilityNameById(speciesAbilities[0]);
    if (nm) return { name: nm, desc: abilityDescById(speciesAbilities[0]) };
  }
  return null;
}
function getStatBlock(poke) {
  const stats = poke.stats || (poke.species && poke.species.baseStats);
  const evsRaw = poke.evs || {};
  const order = ['hp', 'spe', 'atk', 'def', 'spa', 'spd'];
  const evs = Array.isArray(evsRaw)
    ? { hp: evsRaw[0], atk: evsRaw[1], def: evsRaw[2], spa: evsRaw[3], spd: evsRaw[4], spe: evsRaw[5] }
    : evsRaw;
  return order.map((key) => ({
    key,
    label: JA_STAT_NAME[key],
    value: stats && stats[key] != null ? stats[key] : null,
    ev: evs && evs[key] != null ? evs[key] : null,
  }));
}

function partyListItemHtml(p, idx) {
  const isActive = p === state.playerActive;
  const ratio = Math.max(0, p.currentHp / p.maxHp);
  const statusTag = activeStatusBadges(p).map((b) =>
    `<span class="pli-status-tag ${b.key === 'confuse' ? 'status-confuse' : 'status-' + p.status}">${b.label}</span>`
  ).join('');
  let typeChangeText = '';
  if (p.changedType) {
    typeChangeText = `→${typeJp(p.changedType)}`;
  } else if (p.removedTypes && p.removedTypes.length > 0) {
    typeChangeText = `(${p.removedTypes.map(t => typeJp(t)).join('')}消失)`;
  }
  return `
    <button class="party-list-item ${isActive ? 'active' : ''} ${p.fainted ? 'fainted' : ''}" data-idx="${idx}" ${p.fainted ? 'disabled' : ''}>
      <img src="${spritePath(p)}" alt="" class="pli-icon" onerror="this.replaceWith(makeTeamCardFallback(${p.speciesId}))">
      <div class="pli-info">
        <div class="pli-name">${p.species.name} <span style="font-size:10px;color:var(--accent-b);">${typeChangeText}</span></div>
        <div class="pli-hpbar-outer"><div class="pli-hpbar-inner" style="width:${ratio * 100}%; background:${hpBarColor(ratio)};"></div></div>
        <div class="pli-hp-text">${p.currentHp}/${p.maxHp}</div>
        ${isActive ? '<div class="pli-active-tag">たたかっている</div>' : statusTag}
        <div class="pli-hp-text" style="font-size:8.5px;color:var(--accent-b);">スタック: ${p.energyStacks || 0}</div>
      </div>
    </button>
  `;
}

function partyDetailHtml(p) {
  const effectiveTypes = getEffectiveTypesForDisplay(p);
  const typeDisplay = effectiveTypes.map(t => `
    <span class="type-chip ${TYPE_CLASS(t)}">${typeJp(t)}</span>
  `).join('');
  const movesHtml = p.moves.map((m) => `
    <div class="pd-move-row ${TYPE_CLASS(m.type)}-edge ${m.locked ? 'pd-move-locked' : ''}" style="${m.locked ? 'opacity:0.4;border-left-color:#ff5d5d;' : ''}">
      ${typeIconHtml(m.type)}
      <span class="pd-move-name">${m.name}${m.locked ? ' 🔒' : ''}</span>
      <span class="pd-move-pp">PP ${m.pp}/${m.maxPp}</span>
    </div>
  `).join('');
  const ability = getAbilityInfo(p);
  const statBlock = getStatBlock(p);
  const statsHtml = statBlock.map((s) => `
    <div class="pd-stat-row">
      <span class="pd-stat-name">${s.label}</span>
      <span class="pd-stat-values">
        <span class="pd-stat-value">${s.value != null ? s.value : '—'}</span>${s.ev != null ? `<span class="pd-stat-ev">${s.ev}</span>` : ''}
      </span>
    </div>
  `).join('');

  let typeChangeInfo = '';
  if (p.changedType) {
    typeChangeInfo = `<div style="font-size:11px;font-weight:700;color:var(--accent-b);">タイプ: ${typeJp(p.changedType)}（変化）</div>`;
  }
  if (p.removedTypes && p.removedTypes.length > 0) {
    typeChangeInfo += `<div style="font-size:11px;font-weight:700;color:#ff5d5d;">タイプ消失: ${p.removedTypes.map(t => typeJp(t)).join('、')}</div>`;
  }

  return `
    <div class="pd-header">
      <span class="pd-name">${p.species.name}</span>
      <span class="pd-lv">Lv${p.level}</span>
      <div class="pd-types">
        ${typeDisplay}
      </div>
    </div>
    ${typeChangeInfo}
    <div class="pd-section-title">わざ</div>
    <div class="pd-moves">${movesHtml}</div>
    <div class="pd-lower">
      <div class="pd-ability-box">
        <div class="pd-ability-label">特性</div>
        <div class="pd-ability-name">${ability ? ability.name : '—'}</div>
        ${ability && ability.desc ? `<div class="pd-ability-desc">${ability.desc}</div>` : ''}
      </div>
      <div class="pd-stats">${statsHtml}</div>
    </div>
  `;
}

let partySelectedIdx = null;
let partyArmedIdx = null;
let partyMode = 'switch';
let forcedSwitchResolve = null;

function openPartyOverlay(mode) {
  partyMode = mode || 'switch';
  partyArmedIdx = null;
  if (partyMode === 'forced') {
    const firstAlive = state.playerTeam.findIndex((p) => !p.fainted);
    partySelectedIdx = firstAlive >= 0 ? firstAlive : 0;
  } else {
    partySelectedIdx = state.playerTeam.indexOf(state.playerActive);
  }
  renderPartyOverlay();
  $('party-overlay').classList.add('show');
  $('party-close').style.display = partyMode === 'forced' ? 'none' : '';
}
function closePartyOverlay() {
  $('party-overlay').classList.remove('show');
}

function renderPartyOverlay() {
  const list = $('party-list');
  list.innerHTML = state.playerTeam.map((p, idx) => partyListItemHtml(p, idx)).join('');
  renderPartyDetail();
}

function renderPartyDetail() {
  const idx = partySelectedIdx != null ? partySelectedIdx : 0;
  const p = state.playerTeam[idx];
  $('party-detail').innerHTML = partyDetailHtml(p);
}

$('party-close').addEventListener('click', () => closePartyOverlay());

/* ---- Switch confirmation dialog ---- */
function askConfirm(text) {
  return new Promise((resolve) => {
    $('confirm-text').textContent = text;
    $('confirm-overlay').classList.add('show');
    const yesBtn = $('confirm-yes');
    const noBtn = $('confirm-no');
    const cleanup = () => {
      $('confirm-overlay').classList.remove('show');
      yesBtn.onclick = null;
      noBtn.onclick = null;
    };
    yesBtn.onclick = () => { cleanup(); resolve(true); };
    noBtn.onclick = () => { cleanup(); resolve(false); };
  });
}

function attachPartySwitchHandler() {
  $('party-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('.party-list-item');
    if (!btn || btn.disabled) return;
    const idx = parseInt(btn.dataset.idx, 10);

    if (partyMode !== 'switch' && partyMode !== 'forced') {
      partySelectedIdx = idx;
      renderPartyDetail();
      return;
    }

    if (partyMode === 'switch' && state.playerTeam[idx] === state.playerActive) {
      partySelectedIdx = idx;
      partyArmedIdx = null;
      renderPartyDetail();
      return;
    }

    const alreadyArmed = partyArmedIdx === idx;
    partySelectedIdx = idx;
    renderPartyDetail();

    if (!alreadyArmed) {
      partyArmedIdx = idx;
      return;
    }

    const target = state.playerTeam[idx];
    const ok = await askConfirm(`${target.species.name}と交代しますか？`);
    if (ok) {
      closePartyOverlay();
      if (partyMode === 'forced') {
        if (forcedSwitchResolve) { const r = forcedSwitchResolve; forcedSwitchResolve = null; r(idx); }
      } else {
        playerChooseSwitch(idx);
      }
    }
  });
}
attachPartySwitchHandler();

/* ---------------- Battle flow ---------------- */
let turnResolve = null;

function playerChooseMove(move) {
  const action = { type: 'move', move };
  $('cmd-panel').innerHTML = '';
  $('cmd-dock').classList.remove('dock-wide');
  setWatchLogButtonsActive(false);
  if (turnResolve) { const r = turnResolve; turnResolve = null; r(action); }
}
function playerChooseSwitch(idx) {
  const action = { type: 'switch', idx };
  $('cmd-panel').innerHTML = '';
  $('cmd-dock').classList.remove('dock-wide');
  setWatchLogButtonsActive(false);
  if (turnResolve) { const r = turnResolve; turnResolve = null; r(action); }
}

function waitForPlayerAction() {
  renderActionMenu();
  return new Promise((resolve) => { turnResolve = resolve; });
}

function updateFieldDisplay() {
  state.weather = battleField.weather !== 'none'
    ? { label: `${WEATHER_JP[battleField.weather]}（残り${battleField.weatherTurns}ターン）` }
    : null;
  state.terrain = battleField.terrain !== 'none'
    ? { label: `${TERRAIN_JP[battleField.terrain]}（残り${battleField.terrainTurns}ターン）` }
    : null;
}

function makeLogFn() {
  return (text, meta) => {
    let uiSide = null;
    let hpSnapshot = null;
    if (meta && meta.hit) {
      uiSide = meta.hit === 'player' ? 'self' : 'opp';
      const poke = meta.hit === 'player' ? state.playerActive : state.cpuActive;
      hpSnapshot = poke ? poke.currentHp : 0;
    }

    // 能力ランク変化がどちら側のポケモンに起きたか（'player'|'cpu'→'self'|'opp'）
    let rankUiSide = null;
    if (meta && meta.rankChange && meta.rankSide) {
      rankUiSide = meta.rankSide === 'player' ? 'self' : 'opp';
    }

    // ログ履歴（「ログを見る」オーバーレイ用）に記録。
    let logSide = null, logKind = 'plain', logSpeciesId = null, logShiny = false;
    if (meta && meta.moveUse) {
      const poke = meta.moveUse === 'player' ? state.playerActive : state.cpuActive;
      logSide = meta.moveUse; logKind = 'move';
      logSpeciesId = poke ? poke.speciesId : null; logShiny = poke ? poke.shiny : false;
    } else if (meta && meta.hit) {
      const poke = meta.hit === 'player' ? state.playerActive : state.cpuActive;
      logSide = meta.hit; logKind = 'damage';
      logSpeciesId = poke ? poke.speciesId : null; logShiny = poke ? poke.shiny : false;
    }
    pushBattleLogHistory({ text, side: logSide, kind: logKind, speciesId: logSpeciesId, shiny: logShiny });

    const moveType = meta && meta.moveType ? meta.moveType : null;

    queueMessage(text, async () => {
      if (uiSide) {
        // タイプ別の簡易エフェクト → 効果音 → ヒット演出 → HP反映、の順で見せる
        if (moveType) {
          await playTypeEffect(uiSide, moveType);
        }
        if (meta && meta.typeMult !== undefined) {
          playTypeEffectSound(meta.typeMult);
        }
        await flashHit(uiSide);
        const poke = meta.hit === 'player' ? state.playerActive : state.cpuActive;
        updateHud(poke, uiSide, hpSnapshot);
      }
      // 能力ランク変化：このログ行が画面に表示されるタイミングでエフェクト＋効果音を同時再生し、
      // エフェクトが終わるまでバトル進行（次のメッセージ）を待たせる。
      if (rankUiSide) {
        await rankFlash(rankUiSide, meta.rankChange);
      }
    }, {
      hit: meta && meta.hit ? meta.hit : null,
      hp: hpSnapshot,
      faint: meta && meta.faint ? meta.faint : null,
      moveUse: meta && meta.moveUse ? meta.moveUse : null,
      speciesId: logSpeciesId,
      shiny: logShiny,
      typeMult: meta && meta.typeMult !== undefined ? meta.typeMult : null,
      rankChange: meta && meta.rankChange ? meta.rankChange : null,
      rankSide: meta && meta.rankSide ? meta.rankSide : null,
      moveType: moveType,
    });
  };
}

async function doSwitch(newActive, side) {
  newActive.side = side;
  newActive.deaigashiraLocked = false; // 場に出た最初のターンはであいがしら使用可能
  newActive.gekirinTurns = 0; // 交代でげきりんの強制状態は解除
  newActive.gekirinMoveId = null;
  if (side === 'player') {
    state.playerActive = newActive;
    setSprite(newActive, 'self');
    updateHud(newActive, 'self');
  } else {
    state.cpuActive = newActive;
    setSprite(newActive, 'opp');
    updateHud(newActive, 'opp');
  }
  applyHazardsOnSwitchIn(newActive, side, makeLogFn());
  await drainMessages();
  const opponent = side === 'player' ? state.cpuActive : state.playerActive;
  applyWeatherTerrainAbilityOnSwitchIn(newActive, makeLogFn(), opponent);
  await drainMessages();
  updateHud(newActive, side === 'player' ? 'self' : 'opp');
  updateFieldDisplay();
}

async function pickNextAlive(team) {
  return team.find((p) => !p.fainted) || null;
}

function hasAliveBackup(team, active) {
  return team.some((p) => p !== active && !p.fainted);
}

async function resolvePendingSwitchOuts() {
  if (state.cpuActive.pendingSwitchOut && !state.cpuActive.fainted) {
    state.cpuActive.pendingSwitchOut = false;
    if (state.cpuActive.bindTurns > 0) {
      queueMessage(`${state.cpuActive.species.name}はバインドされていて交代できない！`);
      await drainMessages();
    } else if (hasAliveBackup(state.cpuTeam, state.cpuActive)) {
      const outgoing = state.cpuActive;
      const next = state.cpuTeam.find((p) => p !== outgoing && !p.fainted);
      if (next) {
        applyBatonPass(outgoing, next);
        queueMessage(`相手は${outgoing.species.name}をひっこめた！`);
        await drainMessages();
        queueMessage(`相手は${next.species.name}をくり出した！`);
        await drainMessages();
        await doSwitch(next, 'cpu');
      }
    }
  }
  if (state.playerActive.pendingSwitchOut && !state.playerActive.fainted) {
    state.playerActive.pendingSwitchOut = false;
    if (state.playerActive.bindTurns > 0) {
      queueMessage(`${state.playerActive.species.name}はバインドされていて交代できない！`);
      await drainMessages();
    } else if (hasAliveBackup(state.playerTeam, state.playerActive)) {
      const outgoing = state.playerActive;
      queueMessage(`${outgoing.species.name}、もどれ！`);
      await drainMessages();
      const idx = await waitForForcedSwitch();
      const next = state.playerTeam[idx];
      applyBatonPass(outgoing, next);
      await doSwitch(next, 'player');
      queueMessage(`ゆけっ！${next.species.name}！`);
      await drainMessages();
    }
  }
}

function applyBatonPass(outgoing, incoming) {
  if (!outgoing.batonPass) return;
  incoming.ranks = { ...outgoing.batonPass.ranks };
  incoming.confuseTurns = outgoing.batonPass.confuseTurns || 0;
  outgoing.batonPass = null;
}

async function resolveImmediateSwitch(side) {
  if (side === 'cpu') {
    const outgoing = state.cpuActive;
    if (outgoing.bindTurns > 0) {
      queueMessage(`${outgoing.species.name}はバインドされていて交代できない！`);
      await drainMessages();
      return null;
    }
    if (!hasAliveBackup(state.cpuTeam, outgoing)) return null;
    const next = state.cpuTeam.find((p) => p !== outgoing && !p.fainted);
    if (!next) return null;
    applyBatonPass(outgoing, next);
    queueMessage(`相手は${outgoing.species.name}をひっこめた！`);
    await drainMessages();
    queueMessage(`相手は${next.species.name}をくり出した！`);
    await drainMessages();
    await doSwitch(next, 'cpu');
    return next;
  } else {
    const outgoing = state.playerActive;
    if (outgoing.bindTurns > 0) {
      queueMessage(`${outgoing.species.name}はバインドされていて交代できない！`);
      await drainMessages();
      return null;
    }
    if (!hasAliveBackup(state.playerTeam, outgoing)) return null;
    queueMessage(`${outgoing.species.name}、もどれ！`);
    await drainMessages();
    const idx = await waitForForcedSwitch();
    const next = state.playerTeam[idx];
    applyBatonPass(outgoing, next);
    await doSwitch(next, 'player');
    queueMessage(`ゆけっ！${next.species.name}！`);
    await drainMessages();
    return next;
  }
}

async function runBattleLoop() {
  state.battleBusy = true;
  battleLogHistory = [];
  BattleBgm.start();
  state.playerActive.side = 'player';
  state.cpuActive.side = 'cpu';
  updateHud(state.playerActive, 'self');
  updateHud(state.cpuActive, 'opp');
  setSprite(state.cpuActive, 'opp');
  setSprite(state.playerActive, 'self');

  queueMessage(`${state.cpuActive.species.name}が現れた！`);
  queueMessage(`ゆけっ！${state.playerActive.species.name}！`);
  await drainMessages();
  resetHazards();
  resetField();
  updateFieldDisplay();
  applyWeatherTerrainAbilityOnSwitchIn(state.cpuActive, makeLogFn(), state.playerActive);
  await drainMessages();
  applyWeatherTerrainAbilityOnSwitchIn(state.playerActive, makeLogFn(), state.cpuActive);
  await drainMessages();
  updateFieldDisplay();

  state.turnNumber = 1;

  while (true) {
    if (state.playerTeam.every((p) => p.fainted)) { await endBattle(false); return; }
    if (state.cpuTeam.every((p) => p.fainted)) { await endBattle(true); return; }

    queueTurnDivider(state.turnNumber);
    await drainMessages();

    const playerAction = await waitForPlayerAction();

    if (playerAction.type === 'switch') {
      const newP = state.playerTeam[playerAction.idx];
      queueMessage(`${state.playerActive.species.name}、もどれ！`);
      await drainMessages();
      await doSwitch(newP, 'player');
      queueMessage(`ゆけっ！${newP.species.name}！`);
      await drainMessages();
      if (!state.playerActive.fainted) {
        const cpuAction = chooseCpuAction(state.cpuActive, state.playerActive);
        await runTurn({ type: 'none' }, cpuAction, state.playerActive, state.cpuActive, makeLogFn(), resolveImmediateSwitch);
        await drainMessages();
      }
      await postTurnCleanupAndRender();
      state.turnNumber++;
      continue;
    }

    const cpuAction = chooseCpuAction(state.cpuActive, state.playerActive);
    await runTurn(playerAction, cpuAction, state.playerActive, state.cpuActive, makeLogFn(), resolveImmediateSwitch);
    await drainMessages();
    await postTurnCleanupAndRender();
    state.turnNumber++;
  }
}

async function postTurnCleanupAndRender() {
  await resolvePendingSwitchOuts();

  while (state.cpuActive.fainted) {
    await playFaint('opp');
    if (state.cpuTeam.every((p) => p.fainted)) break;
    const next = await pickNextAlive(state.cpuTeam);
    if (!next) break;
    queueMessage(`相手は${next.species.name}をくり出した！`);
    await drainMessages();
    await doSwitch(next, 'cpu');
  }
  while (state.playerActive.fainted) {
    await playFaint('self');
    const alive = state.playerTeam.filter((p) => !p.fainted);
    if (alive.length === 0) break;
    queueMessage(`つぎのポケモンをえらんでください`);
    await drainMessages();
    const idx = await waitForForcedSwitch();
    await doSwitch(state.playerTeam[idx], 'player');
  }
  updateHud(state.playerActive, 'self');
  updateHud(state.cpuActive, 'opp');
  updateFieldDisplay();
}

function waitForForcedSwitch() {
  $('cmd-dock').classList.remove('dock-wide');
  setWatchLogButtonsActive(false);
  $('cmd-panel').innerHTML = '';
  return new Promise((resolve) => {
    forcedSwitchResolve = resolve;
    openPartyOverlay('forced');
  });
}

async function endBattle(playerWon) {
  state.battleBusy = false;
  BattleBgm.stop();
  if (playerWon) state.winStreak++;
  const overlay = $('result-overlay');
  $('result-title').textContent = playerWon ? 'WIN' : 'LOSE';
  $('result-title').className = 'result-title ' + (playerWon ? 'win' : 'lose');
  $('result-desc').textContent = playerWon
    ? `${state.winStreak}連勝中！つぎの相手が待っている。`
    : `連勝は${state.winStreak}でストップ。またチャレンジしよう！`;
  overlay.classList.add('show');

  $('btn-result-next').onclick = async () => {
    overlay.classList.remove('show');
    if (playerWon) {
      MenuBgm.start();
      await runTradeSequence();
      renderReorderScreen();
    } else {
      state.winStreak = 0;
      MenuBgm.start();
      showScreen('title');
    }
  };
}

/* ---------------- Post-win trade sequence ---------------- */
function tradeCardHtml(p, idx, disabled) {
  const effectiveTypes = getEffectiveTypesForDisplay(p);
  const typeDisplay = effectiveTypes.map(t => `
    <span class="type-chip ${TYPE_CLASS(t)}">${typeJp(t)}</span>
  `).join('');
  return `
    <div class="trade-poke-card ${disabled ? 'disabled' : ''}" data-idx="${idx}">
      <button class="tpc-info-btn" data-info-idx="${idx}" type="button"><span>!</span></button>
      <img src="${spritePath(p)}" alt="${p.species.name}" class="tpc-sprite"
           onerror="this.replaceWith(makeTeamCardFallback(${p.speciesId}))">
      <div class="tpc-name">${p.species.name}</div>
      <div class="tpc-types">
        ${typeDisplay}
      </div>
      <div class="tpc-hp">HP ${p.currentHp}/${p.maxHp}</div>
    </div>
  `;
}

function showTradeDetail(poke) {
  $('trade-detail-card').innerHTML = partyDetailHtml(poke);
  $('trade-detail-overlay').classList.add('show');
}
$('trade-detail-close').addEventListener('click', () => {
  $('trade-detail-overlay').classList.remove('show');
});

function runTradeSequence() {
  return new Promise((resolve) => {
    const offerOverlay = $('trade-overlay');
    const offerRow = $('trade-offer-row');
    offerRow.innerHTML = state.cpuTeam.map((p, idx) => tradeCardHtml(p, idx, false)).join('');
    offerOverlay.classList.add('show');

    const onOfferClick = async (e) => {
      const infoBtn = e.target.closest('.tpc-info-btn');
      if (infoBtn) {
        const idx = parseInt(infoBtn.dataset.infoIdx, 10);
        showTradeDetail(state.cpuTeam[idx]);
        return;
      }
      const card = e.target.closest('.trade-poke-card');
      if (!card) return;
      const offerIdx = parseInt(card.dataset.idx, 10);
      const chosen = state.cpuTeam[offerIdx];
      const ok = await askConfirm(`${chosen.species.name}をもらいますか？`);
      if (!ok) return;
      offerRow.removeEventListener('click', onOfferClick);
      offerOverlay.classList.remove('show');
      runReplaceStep(chosen, resolve);
    };
    offerRow.addEventListener('click', onOfferClick);
  });
}

function runReplaceStep(incoming, doneResolve) {
  const replaceOverlay = $('trade-replace-overlay');
  const replaceRow = $('trade-replace-row');
  $('trade-replace-title').textContent = `${incoming.species.name}と交換するポケモンをえらんでください`;
  replaceRow.innerHTML = state.playerTeam.map((p, idx) => tradeCardHtml(p, idx, false)).join('');
  replaceOverlay.classList.add('show');

  const onReplaceClick = async (e) => {
    const infoBtn = e.target.closest('.tpc-info-btn');
    if (infoBtn) {
      const idx = parseInt(infoBtn.dataset.infoIdx, 10);
      showTradeDetail(state.playerTeam[idx]);
      return;
    }
    const card = e.target.closest('.trade-poke-card');
    if (!card) return;
    const replaceIdx = parseInt(card.dataset.idx, 10);
    const outgoing = state.playerTeam[replaceIdx];
    const ok = await askConfirm(`${outgoing.species.name}と${incoming.species.name}を交換しますか？`);
    if (!ok) return;
    replaceRow.removeEventListener('click', onReplaceClick);
    replaceOverlay.classList.remove('show');

    const incomingCopy = Object.assign({}, incoming);
    incomingCopy.moves = incoming.moves.map((m) => Object.assign({}, m));
    resetPokeForBattle(incomingCopy);
    state.playerTeam[replaceIdx] = incomingCopy;

    doneResolve();
  };
  replaceRow.addEventListener('click', onReplaceClick);
}

/* ---------------- Battle setup ---------------- */
function resetPokeForBattle(poke) {
  poke.currentHp = poke.maxHp;
  poke.status = 0;
  poke.badlyPoisonCounter = 0;
  poke.confuseTurns = 0;
  poke.sleepTurns = 0;
  poke.flinch = false;
  poke.fainted = false;
  poke.ranks = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 };
  poke.moves.forEach((m) => { m.pp = m.maxPp; m.locked = false; });
  poke.energyStacks = 0;
  poke.fundoTriggered = false;
  poke.moraibiActive = false;
  poke.lazyTurns = false;
  poke.firstTurn = true;
  poke.gyakujouTriggered = false;
  poke.tauntTurns = 0;
  poke.bindTurns = 0;
  poke.removedTypes = [];
  poke.changedType = null;
  poke.typeLockTurns = 0;
  poke.typeLockType = null;
  poke.lastUsedMoveId = null;
  poke.encoreMoveId = null;
  poke.encoreTurns = 0;
  poke.utsusemiTurns = 0;
  poke.infernoUsed = false;
  poke.deaigashiraLocked = false;
  poke.gekirinTurns = 0;
  poke.gekirinMoveId = null;
}

function startNextCpuBattle() {
  state.cpuTeam = drawRandomTeam(3);
  state.cpuTeam.forEach(resetPokeForBattle);
  state.playerTeam.forEach(resetPokeForBattle);
  state.playerActive = state.playerTeam.find((p) => !p.fainted) || state.playerTeam[0];
  state.cpuActive = state.cpuTeam[0];
  showScreen('battle');
  msgQueue = [];
  runBattleLoop();
}

/* ---------------- Initial pick ---------------- */
let pickPool = [];
let pickedIds = [];
let pickTimerInterval = null;
const PICK_TIME_LIMIT = 30;

function clearPickTimer() {
  if (pickTimerInterval) { clearInterval(pickTimerInterval); pickTimerInterval = null; }
  $('pick-timer-badge').style.display = 'none';
  $('pick-timer-badge').classList.remove('warn');
}

function startPickTimer(onTimeout) {
  clearPickTimer();
  let remaining = PICK_TIME_LIMIT;
  const badge = $('pick-timer-badge');
  const num = $('pick-timer-num');
  badge.style.display = 'flex';
  badge.classList.remove('warn');
  num.textContent = String(remaining);
  pickTimerInterval = setInterval(() => {
    remaining -= 1;
    num.textContent = String(Math.max(0, remaining));
    if (remaining <= 10) badge.classList.add('warn');
    if (remaining <= 0) {
      clearPickTimer();
      onTimeout();
    }
  }, 1000);
}

function pickCardHtml(poke, idx) {
  const t1 = poke.species.type1, t2 = poke.species.type2;
  const orderPos = pickedIds.indexOf(idx);
  const orderLabel = orderPos >= 0 ? `${orderPos + 1}` : '';
  return `
    <div class="trade-poke-card ${orderPos >= 0 ? 'selected' : ''}" data-idx="${idx}">
      <button class="tpc-info-btn" data-info-idx="${idx}" type="button"><span>!</span></button>
      ${orderPos >= 0 ? `<span class="pick-order-badge">${orderLabel}</span>` : ''}
      <img src="${spritePath(poke)}" alt="${poke.species.name}" class="tpc-sprite"
           onerror="this.replaceWith(makeTeamCardFallback(${poke.speciesId}))">
      <div class="tpc-name">${poke.species.name}</div>
      <div class="tpc-types">
        <span class="type-chip ${TYPE_CLASS(t1)}">${typeJp(t1)}</span>
        ${t2 ? `<span class="type-chip ${TYPE_CLASS(t2)}">${typeJp(t2)}</span>` : ''}
      </div>
    </div>
  `;
}

function renderPickRow() {
  $('pick-row').innerHTML = pickPool.map((p, idx) => pickCardHtml(p, idx)).join('');
  $('pick-count').textContent = `${pickedIds.length} / 3 選択中`;
  $('btn-pick-confirm').disabled = state.multiplayer ? false : pickedIds.length !== 3;
}

function showInitialPickOverlay() {
  clearPickTimer();
  const ids = [...getFinalSpeciesIds()].sort(() => Math.random() - 0.5).slice(0, 6);
  pickPool = ids.map((id) => createRandomPokemon(id, 100));
  pickedIds = [];
  renderPickRow();
  $('pick-overlay').classList.add('show');
}

$('pick-row').addEventListener('click', (e) => {
  const infoBtn = e.target.closest('.tpc-info-btn');
  if (infoBtn) {
    const idx = parseInt(infoBtn.dataset.infoIdx, 10);
    showTradeDetail(pickPool[idx]);
    return;
  }
  const card = e.target.closest('.trade-poke-card');
  if (!card) return;
  const idx = parseInt(card.dataset.idx, 10);
  const already = pickedIds.indexOf(idx);
  if (already >= 0) {
    pickedIds.splice(already, 1);
  } else if (pickedIds.length < 3) {
    pickedIds.push(idx);
  }
  renderPickRow();
});

function confirmPick() {
  clearPickTimer();
  // 未選択が残っている場合は左（先頭）から自動補完
  if (pickedIds.length < 3) {
    for (let i = 0; i < pickPool.length && pickedIds.length < 3; i++) {
      if (!pickedIds.includes(i)) pickedIds.push(i);
    }
  }
  state.playerTeam = pickedIds.slice(0, 3).map((idx) => pickPool[idx]);
  $('pick-overlay').classList.remove('show');
  if (state.multiplayer) {
    onMultiplayerPickConfirm();
  } else {
    renderReorderScreen();
  }
}

$('btn-pick-confirm').addEventListener('click', () => {
  if (state.multiplayer) { confirmPick(); return; }
  if (pickedIds.length !== 3) return;
  confirmPick();
});

/* ---------------- Team reorder screen ---------------- */
let reorderMode = false;
let reorderArmedIdx = null;

function renderReorderScreen() {
  MenuBgm.start();
  reorderMode = false;
  reorderArmedIdx = null;
  $('btn-reorder-toggle').textContent = '並び替えをする';
  $('team-cards').classList.remove('reorder-mode');
  renderReorderCards();
  showScreen('team');
}

function renderReorderCards() {
  const cardsHtml = state.playerTeam.map((poke, idx) => {
    const armed = reorderMode && reorderArmedIdx === idx;
    const base = renderTeamCard(poke, idx);
    return base.replace(
      'class="trade-poke-card"',
      `class="trade-poke-card reorder-poke-card ${armed ? 'swap-armed' : ''}"`
    );
  }).join('');
  $('team-cards').innerHTML = cardsHtml;
}

$('btn-reorder-toggle').addEventListener('click', () => {
  reorderMode = !reorderMode;
  reorderArmedIdx = null;
  $('btn-reorder-toggle').textContent = reorderMode ? '並び替えをやめる' : '並び替えをする';
  $('team-cards').classList.toggle('reorder-mode', reorderMode);
  renderReorderCards();
});

$('team-cards').addEventListener('click', (e) => {
  const infoBtn = e.target.closest('.tpc-info-btn');
  if (infoBtn) {
    const idx = parseInt(infoBtn.dataset.infoIdx, 10);
    showTradeDetail(state.playerTeam[idx]);
    return;
  }
  if (!reorderMode) return;
  const card = e.target.closest('.reorder-poke-card');
  if (!card) return;
  const idx = parseInt(card.dataset.idx, 10);
  if (reorderArmedIdx === null) {
    reorderArmedIdx = idx;
  } else if (reorderArmedIdx === idx) {
    reorderArmedIdx = null;
  } else {
    const tmp = state.playerTeam[reorderArmedIdx];
    state.playerTeam[reorderArmedIdx] = state.playerTeam[idx];
    state.playerTeam[idx] = tmp;
    reorderArmedIdx = null;
  }
  renderReorderCards();
});

function startNewRun() {
  MenuBgm.start();
  state.multiplayer = false;
  state.winStreak = 0;
  showInitialPickOverlay();
}

/* =========================================================
   マルチプレイ用UI
   ========================================================= */

function generateRoomId() {
  return String(Math.floor(Math.random() * 9000) + 1000);
}

function showMultiplayerMenu() {
  MenuBgm.start();
  showScreen('multiplayer');
}

/* 名前入力を廃止したため、表示用のプレイヤー名は自動生成する */
function generateAutoPlayerName() {
  const n = 1000 + Math.floor(Math.random() * 9000);
  return `トレーナー${n}`;
}

function updateNameCharCount() {
  const codeLen = ($('input-room-code').value || '').length;
  $('code-char-count').textContent = codeLen;
}

function openNameModal() {
  // 「あいことばで入室」専用モーダル（ルーム作成は名前入力なしで即実行するため呼ばれない）
  MenuBgm.start(); // 既に再生中なら何もしない（MenuBgm.start内部でガード済み）
  $('name-modal-title').textContent = 'あいことばで入室';
  $('input-room-code').value = '';
  updateNameCharCount();
  $('name-modal').classList.add('show');
  setTimeout(() => {
    try { $('input-room-code').focus(); } catch (e) {}
  }, 60);
}

function closeNameModal() {
  $('name-modal').classList.remove('show');
}

function onNameModalConfirm() {
  const code = ($('input-room-code').value || '').trim();
  if (!/^\d{4}$/.test(code)) { $('input-room-code').focus(); return; }
  if (!state.playerName) state.playerName = generateAutoPlayerName();
  closeNameModal();
  joinRoom(code);
}

/* ---- 相手が離脱した時の共通処理 ---- */
let roomClosedHandled = false;
function forceLeaveOnRoomClosed() {
  if (roomClosedHandled) return;
  roomClosedHandled = true;
  state.multiplayer = false;
  state.battleBusy = false;
  BattleBgm.stop();
  try { $('pick-overlay').classList.remove('show'); } catch (e) {}
  try { $('negotiate-overlay').classList.remove('show'); } catch (e) {}
  try { $('nego-wait-overlay').classList.remove('show'); } catch (e) {}
  try { $('result-overlay').classList.remove('show'); } catch (e) {}
  try { $('rematch-overlay').classList.remove('show'); } catch (e) {}
  clearNegoTimer();
  clearPickTimer();
  Net.reset();
  MenuBgm.start();
  showScreen('title');
  alert('相手が退出したため、部屋を閉じました。');
}

async function startHostRoom() {
  roomClosedHandled = false;
  state.isHost = true;
  let code = null;
  for (let i = 0; i < 8; i++) {
    const candidate = generateRoomId();
    const r = await Net.createRoom(candidate, state.playerName);
    if (r === 'ok') { code = candidate; break; }
  }
  if (!code) {
    alert('ルーム作成に失敗しました。firebase-config.js と通信環境を確認してください。');
    showMultiplayerMenu();
    return;
  }
  state.roomId = code;
  $('host-wait-title').textContent = 'ルームを作成しました';
  $('host-wait-player-name').textContent = `${state.playerName} さん`;
  $('host-room-id').textContent = code;
  $('host-wait-hint').textContent = '友達にこの4ケタの番号を伝えてください';
  $('host-wait-cancel').textContent = 'キャンセル';
  showScreen('host-waiting');
  MenuBgm.start();

  Net.onRoomClosed(() => forceLeaveOnRoomClosed());

  Net.onGuestJoined((guestName) => {
    state.opponentName = guestName;
    $('host-wait-hint').textContent = `${guestName} さんが入室しました！`;
    setTimeout(() => { startMultiplayerPick(); }, 700);
  });
}

async function joinRoom(code) {
  roomClosedHandled = false;
  state.isHost = false;
  const r = await Net.joinRoom(code, state.playerName);
  if (r === 'not-found') { alert('そのルームは見つかりませんでした。'); return; }
  if (r === 'full') { alert('そのルームは満員、またはすでに対戦中です。'); return; }
  if (r === 'error') { alert('接続に失敗しました。'); return; }
  state.roomId = code;
  $('host-wait-title').textContent = 'ルームに参加しました';
  $('host-wait-player-name').textContent = `${state.playerName} さん`;
  $('host-room-id').textContent = code;
  $('host-wait-hint').textContent = `ホスト（${Net.opponentName} さん）の準備を待っています…`;
  $('host-wait-cancel').textContent = 'もどる';
  showScreen('host-waiting');
  MenuBgm.start();

  Net.onRoomClosed(() => forceLeaveOnRoomClosed());

  Net.onStatusChange((status) => {
    if (status === 'both-in') { startMultiplayerPick(); }
  });
}

function cancelHostRoom() {
  Net.leave();
  state.roomId = null;
  state.isHost = false;
  showMultiplayerMenu();
}

/* ---- 選出 ---- */
function startMultiplayerPick() {
  MenuBgm.start();
  state.multiplayer = true;
  state.winStreak = 0;
  state.opponentName = Net.opponentName || '';
  const ids = [...getFinalSpeciesIds()].sort(() => Math.random() - 0.5).slice(0, 6);
  pickPool = ids.map((id) => createRandomPokemon(id, 100));
  pickedIds = [];
  renderPickRow();
  $('pick-overlay').classList.add('show');
  startPickTimer(() => { confirmPick(); });
}

/* =========================================================
   選出後の交換フェーズ（対人戦のみ）
   手持ち1/2/3 → 決定 / 入れ替える / 手持ちを変える（最大5回）
   ========================================================= */
const NEGO_TIME_LIMIT = 30;
const NEGO_SWAP_MAX = 5;
let negoTimerInterval = null;
let negoSwapsLeft = NEGO_SWAP_MAX;
let negoArmedIdx = null;

function clearNegoTimer() {
  if (negoTimerInterval) { clearInterval(negoTimerInterval); negoTimerInterval = null; }
}

function startNegoTimer(onTimeout) {
  clearNegoTimer();
  let remaining = NEGO_TIME_LIMIT;
  const badge = $('nego-timer-badge');
  const num = $('nego-timer-num');
  badge.classList.remove('warn');
  num.textContent = String(remaining);
  negoTimerInterval = setInterval(() => {
    remaining -= 1;
    num.textContent = String(Math.max(0, remaining));
    if (remaining <= 10) badge.classList.add('warn');
    if (remaining <= 0) {
      clearNegoTimer();
      onTimeout();
    }
  }, 1000);
}

function negoCardHtml(p, idx) {
  const effectiveTypes = getEffectiveTypesForDisplay(p);
  const typeDisplay = effectiveTypes.map(t => `
    <span class="type-chip ${TYPE_CLASS(t)}">${typeJp(t)}</span>
  `).join('');
  return `
    <div class="trade-poke-card" data-idx="${idx}">
      <button class="tpc-info-btn" data-info-idx="${idx}" type="button"><span>!</span></button>
      <img src="${spritePath(p)}" alt="${p.species.name}" class="tpc-sprite"
           onerror="this.replaceWith(makeTeamCardFallback(${p.speciesId}))">
      <div class="tpc-name">${p.species.name}</div>
      <div class="tpc-types">${typeDisplay}</div>
    </div>
  `;
}

function renderNegoCards() {
  $('nego-cards').innerHTML = state.playerTeam.map((p, idx) => negoCardHtml(p, idx)).join('');
  $('nego-swap-count').textContent = `交換のこり ${negoSwapsLeft}回`;
  $('btn-nego-swap').disabled = negoSwapsLeft <= 0;
}

$('nego-cards').addEventListener('click', (e) => {
  const infoBtn = e.target.closest('.tpc-info-btn');
  if (infoBtn) {
    const idx = parseInt(infoBtn.dataset.infoIdx, 10);
    showTradeDetail(state.playerTeam[idx]);
  }
});

function runNegotiatePhase() {
  return new Promise((resolve) => {
    negoSwapsLeft = NEGO_SWAP_MAX;
    negoArmedIdx = null;
    renderNegoCards();
    $('nego-hint').textContent = '';
    $('negotiate-overlay').classList.add('show');

    let finished = false;
    const finishMine = async () => {
      if (finished) return;
      finished = true;
      clearNegoTimer();
      $('negotiate-overlay').classList.remove('show');
      $('nego-wait-overlay').classList.add('show');
      await Net.setNegoDone(true);

      // 相手の完了を待つ
      await new Promise((res) => {
        Net.onOpponentNegoDone((done) => { if (done) res(); });
      });
      $('nego-wait-overlay').classList.remove('show');
      await Net.clearNego();
      resolve();
    };

    const onConfirmClick = () => {
      $('btn-nego-confirm').removeEventListener('click', onConfirmClick);
      $('btn-nego-reorder').removeEventListener('click', onReorderClick);
      $('btn-nego-swap').removeEventListener('click', onSwapClick);
      finishMine();
    };
    const onReorderClick = () => {
      openNegoReorderOverlay();
    };
    const onSwapClick = () => {
      if (negoSwapsLeft <= 0) return;
      openNegoSwapOverlay(() => {
        negoSwapsLeft -= 1;
        renderNegoCards();
        startNegoTimer(() => {
          $('btn-nego-confirm').removeEventListener('click', onConfirmClick);
          $('btn-nego-reorder').removeEventListener('click', onReorderClick);
          $('btn-nego-swap').removeEventListener('click', onSwapClick);
          finishMine();
        });
      });
    };

    $('btn-nego-confirm').addEventListener('click', onConfirmClick);
    $('btn-nego-reorder').addEventListener('click', onReorderClick);
    $('btn-nego-swap').addEventListener('click', onSwapClick);

    startNegoTimer(() => {
      $('btn-nego-confirm').removeEventListener('click', onConfirmClick);
      $('btn-nego-reorder').removeEventListener('click', onReorderClick);
      $('btn-nego-swap').removeEventListener('click', onSwapClick);
      finishMine();
    });
  });
}

/* ---- 入れ替える ---- */
function openNegoReorderOverlay() {
  negoArmedIdx = null;
  renderNegoReorderCards();
  $('negotiate-overlay').classList.remove('show');
  $('nego-reorder-overlay').classList.add('show');
}

function renderNegoReorderCards() {
  const cardsHtml = state.playerTeam.map((poke, idx) => {
    const armed = negoArmedIdx === idx;
    const base = negoCardHtml(poke, idx);
    return base.replace(
      'class="trade-poke-card"',
      `class="trade-poke-card ${armed ? 'swap-armed' : ''}"`
    );
  }).join('');
  $('nego-reorder-cards').innerHTML = cardsHtml;
}

$('nego-reorder-cards').addEventListener('click', (e) => {
  const infoBtn = e.target.closest('.tpc-info-btn');
  if (infoBtn) {
    const idx = parseInt(infoBtn.dataset.infoIdx, 10);
    showTradeDetail(state.playerTeam[idx]);
    return;
  }
  const card = e.target.closest('.trade-poke-card');
  if (!card) return;
  const idx = parseInt(card.dataset.idx, 10);
  if (negoArmedIdx === null) {
    negoArmedIdx = idx;
  } else if (negoArmedIdx === idx) {
    negoArmedIdx = null;
  } else {
    const tmp = state.playerTeam[negoArmedIdx];
    state.playerTeam[negoArmedIdx] = state.playerTeam[idx];
    state.playerTeam[idx] = tmp;
    negoArmedIdx = null;
  }
  renderNegoReorderCards();
});

$('btn-nego-reorder-done').addEventListener('click', () => {
  $('nego-reorder-overlay').classList.remove('show');
  renderNegoCards();
  $('negotiate-overlay').classList.add('show');
});

/* ---- 手持ちを変える（ランダム3匹から1匹→手持ちの1匹と交換） ---- */
let negoSwapPool = [];

function openNegoSwapOverlay(onDone) {
  const ids = [...getFinalSpeciesIds()].sort(() => Math.random() - 0.5).slice(0, 3);
  negoSwapPool = ids.map((id) => createRandomPokemon(id, 100));
  const offerRow = $('nego-swap-offer-row');
  offerRow.innerHTML = negoSwapPool.map((p, idx) => tradeCardHtml(p, idx, false)).join('');
  $('negotiate-overlay').classList.remove('show');
  $('nego-swap-overlay').classList.add('show');

  // 「やめる」で選び直し（リセマラ）できないよう、一度開いたら必ず1匹選んで交換する仕様。

  const onOfferClick = async (e) => {
    const infoBtn = e.target.closest('.tpc-info-btn');
    if (infoBtn) {
      const idx = parseInt(infoBtn.dataset.infoIdx, 10);
      showTradeDetail(negoSwapPool[idx]);
      return;
    }
    const card = e.target.closest('.trade-poke-card');
    if (!card) return;
    const offerIdx = parseInt(card.dataset.idx, 10);
    const chosen = negoSwapPool[offerIdx];
    const ok = await askConfirm(`${chosen.species.name}をもらいますか？`);
    if (!ok) return;
    offerRow.removeEventListener('click', onOfferClick);
    $('nego-swap-overlay').classList.remove('show');
    openNegoSwapReplaceOverlay(chosen, onDone);
  };

  offerRow.addEventListener('click', onOfferClick);
}

function openNegoSwapReplaceOverlay(incoming, onDone) {
  const replaceOverlay = $('nego-swap-replace-overlay');
  const replaceRow = $('nego-swap-replace-row');
  $('nego-swap-replace-title').textContent = `${incoming.species.name}と交換するポケモンをえらんでください`;
  replaceRow.innerHTML = state.playerTeam.map((p, idx) => tradeCardHtml(p, idx, false)).join('');
  replaceOverlay.classList.add('show');

  const onReplaceClick = async (e) => {
    const infoBtn = e.target.closest('.tpc-info-btn');
    if (infoBtn) {
      const idx = parseInt(infoBtn.dataset.infoIdx, 10);
      showTradeDetail(state.playerTeam[idx]);
      return;
    }
    const card = e.target.closest('.trade-poke-card');
    if (!card) return;
    const replaceIdx = parseInt(card.dataset.idx, 10);
    const outgoing = state.playerTeam[replaceIdx];
    const ok = await askConfirm(`${outgoing.species.name}と${incoming.species.name}を交換しますか？`);
    if (!ok) return;
    replaceRow.removeEventListener('click', onReplaceClick);
    replaceOverlay.classList.remove('show');
    $('negotiate-overlay').classList.add('show');

    const incomingCopy = Object.assign({}, incoming);
    incomingCopy.moves = incoming.moves.map((m) => Object.assign({}, m));
    resetPokeForBattle(incomingCopy);
    state.playerTeam[replaceIdx] = incomingCopy;

    onDone();
  };
  replaceRow.addEventListener('click', onReplaceClick);
}

async function onMultiplayerPickConfirm() {
  state.playerTeam.forEach(resetPokeForBattle);

  // ---- 選出後の交換フェーズ ----
  await runNegotiatePhase();

  await Net.sendTeam(state.playerTeam);

  // バトル画面へ移動して待機
  showScreen('battle');
  $('battle-log-stack').innerHTML = '';
  logLines = [];
  msgQueue = [];
  pushLogLine('相手の選出を待っています…');

  Net.onOpponentTeam(async (oppTeam) => {
    state.cpuTeam = oppTeam;
    state.cpuTeam.forEach(resetPokeForBattle);
    state.playerActive = state.playerTeam[0];
    state.cpuActive = state.cpuTeam[0];
    state.playerActive.side = 'player';
    state.cpuActive.side = 'cpu';

    // 初期描画
    updateHud(state.playerActive, 'self');
    updateHud(state.cpuActive, 'opp');
    setSprite(state.playerActive, 'self');
    setSprite(state.cpuActive, 'opp');

    $('battle-log-stack').innerHTML = '';
    logLines = [];

    BattleBgm.start();

    if (state.isHost) {
      await runMultiplayerBattleHost();
    } else {
      await runMultiplayerBattleGuest();
    }
  });
}

/* =========================================================
   ホスト側バトルループ
   ========================================================= */
async function runMultiplayerBattleHost() {
  await Net.clearEvents();
  state.battleBusy = true;

  resetHazards();
  resetField();
  updateFieldDisplay();

  queueMessage(`${state.cpuActive.species.name}が現れた！`);
  queueMessage(`ゆけっ！${state.playerActive.species.name}！`);
  await drainMessages();

  applyWeatherTerrainAbilityOnSwitchIn(state.cpuActive, makeLogFn(), state.playerActive);
  await drainMessages();
  applyWeatherTerrainAbilityOnSwitchIn(state.playerActive, makeLogFn(), state.cpuActive);
  await drainMessages();

  await Net.pushEvent({ k: 'turn-end' });

  state.turnNumber = 1;

  while (true) {
    if (state.playerTeam.every((p) => p.fainted)) { await endMultiplayerBattleHost(true); return; }
    if (state.cpuTeam.every((p) => p.fainted)) { await endMultiplayerBattleHost(false); return; }

    queueTurnDivider(state.turnNumber);
    await drainMessages();

    const myAction = await waitForPlayerAction();
    await Net.sendAction(myAction);

    const guestRaw = await new Promise((resolve) => {
      Net.waitForOpponentAction(resolve);
    });
    const guestAction = resolveRemoteAction(guestRaw, state.cpuActive);

    msgQueue = [];

    if (myAction.type === 'switch') {
      const newP = state.playerTeam[myAction.idx];
      queueMessage(`${state.playerActive.species.name}、もどれ！`);
      await drainMessages();
      await doSwitch(newP, 'player');
      queueMessage(`ゆけっ！${newP.species.name}！`);
      await drainMessages();
    }

    if (state.playerActive && !state.playerActive.fainted &&
        state.cpuActive && !state.cpuActive.fainted) {
      const playerAct = myAction.type === 'switch' ? { type: 'none' } : myAction;
      await runTurn(playerAct, guestAction, state.playerActive, state.cpuActive,
                    makeLogFn(), resolveImmediateSwitchMultiplayer);
      await drainMessages();
    }

    await postTurnCleanupMultiplayerHost();
    state.turnNumber++;

    await Net.pushEvent({ k: 'turn-end' });
  }
}

async function resolveImmediateSwitchMultiplayer(side) {
  if (side === 'cpu') {
    const outgoing = state.cpuActive;
    if (outgoing.bindTurns > 0) {
      queueMessage(`${outgoing.species.name}はバインドされていて交代できない！`);
      await drainMessages();
      return null;
    }
    if (!hasAliveBackup(state.cpuTeam, outgoing)) return null;
    Net.pushEvent({ k: 'force-switch', s: 'cpu' });
    const raw = await new Promise((resolve) => {
      Net.waitForOpponentAction(resolve);
    });
    const idx = raw && typeof raw.idx === 'number' ? raw.idx : 0;
    const next = state.cpuTeam[idx] || state.cpuTeam.find((p) => p !== outgoing && !p.fainted);
    if (!next) return null;
    applyBatonPass(outgoing, next);
    queueMessage(`相手は${outgoing.species.name}をひっこめた！`);
    await drainMessages();
    queueMessage(`相手は${next.species.name}をくり出した！`);
    await drainMessages();
    await doSwitch(next, 'cpu');
    return next;
  } else {
    const outgoing = state.playerActive;
    if (outgoing.bindTurns > 0) {
      queueMessage(`${outgoing.species.name}はバインドされていて交代できない！`);
      await drainMessages();
      return null;
    }
    if (!hasAliveBackup(state.playerTeam, outgoing)) return null;
    queueMessage(`${outgoing.species.name}、もどれ！`);
    await drainMessages();
    const idx = await waitForForcedSwitch();
    const next = state.playerTeam[idx];
    applyBatonPass(outgoing, next);
    await doSwitch(next, 'player');
    queueMessage(`ゆけっ！${next.species.name}！`);
    await drainMessages();
    return next;
  }
}

async function postTurnCleanupMultiplayerHost() {
  while (state.cpuActive.fainted) {
    await playFaint('opp');
    if (state.cpuTeam.every((p) => p.fainted)) break;
    Net.pushEvent({ k: 'force-switch', s: 'cpu' });
    const raw = await new Promise((resolve) => {
      Net.waitForOpponentAction(resolve);
    });
    const idx = raw && typeof raw.idx === 'number' ? raw.idx : 0;
    const next = state.cpuTeam[idx] || state.cpuTeam.find((p) => !p.fainted);
    if (!next) break;
    queueMessage(`相手は${next.species.name}をくり出した！`);
    await drainMessages();
    await doSwitch(next, 'cpu');
  }
  while (state.playerActive.fainted) {
    await playFaint('self');
    const alive = state.playerTeam.filter((p) => !p.fainted);
    if (alive.length === 0) break;
    queueMessage(`つぎのポケモンをえらんでください`);
    await drainMessages();
    const idx = await waitForForcedSwitch();
    await doSwitch(state.playerTeam[idx], 'player');
  }
  updateHud(state.playerActive, 'self');
  updateHud(state.cpuActive, 'opp');
  updateFieldDisplay();
}

async function endMultiplayerBattleHost(hostWon) {
  state.battleBusy = false;
  BattleBgm.stop();
  const overlay = $('result-overlay');
  $('result-title').textContent = hostWon ? 'WIN' : 'LOSE';
  $('result-title').className = 'result-title ' + (hostWon ? 'win' : 'lose');
  $('result-desc').textContent = hostWon ? '勝利！' : '敗北…';
  overlay.classList.add('show');
  Net.pushEvent({ k: 'end', win: hostWon });
  await runMultiplayerRematchFlow();
}

/* =========================================================
   対人戦終了後：連戦する/抜けるの選択フロー（ホスト・ゲスト共通）
   ========================================================= */
async function runMultiplayerRematchFlow() {
  const overlay = $('result-overlay');
  const waitOverlay = $('rematch-wait-overlay');
  $('btn-result-next').style.display = 'none';
  $('result-mp-actions').style.display = 'flex';

  const choice = await new Promise((resolve) => {
    const onRematch = () => {
      $('btn-mp-rematch').removeEventListener('click', onRematch);
      $('btn-mp-leave').removeEventListener('click', onLeave);
      resolve('rematch');
    };
    const onLeave = () => {
      $('btn-mp-rematch').removeEventListener('click', onRematch);
      $('btn-mp-leave').removeEventListener('click', onLeave);
      resolve('leave');
    };
    $('btn-mp-rematch').addEventListener('click', onRematch);
    $('btn-mp-leave').addEventListener('click', onLeave);
  });

  overlay.classList.remove('show');
  $('result-mp-actions').style.display = 'none';
  $('btn-result-next').style.display = '';

  if (choice === 'leave') {
    roomClosedHandled = true; // 自分から明示的に退出するので、切断検知の二重処理を防ぐ
    await Net.leave();
    state.multiplayer = false;
    MenuBgm.start();
    showScreen('title');
    return;
  }

  // 連戦を希望 → 相手の意思を待つ
  await Net.setRematchChoice('rematch');
  waitOverlay.classList.add('show');
  $('rematch-wait-desc').textContent = '相手の返事を待っています…';

  const opponentChoice = await new Promise((resolve) => {
    Net.onOpponentRematchChoice((v) => resolve(v));
  });

  if (opponentChoice === 'leave') {
    // 相手は退出済み（Net.leave()でルームを離れる可能性があるため、
    // ack待ちはせずすぐに離脱処理へ進む）
    waitOverlay.classList.remove('show');
    roomClosedHandled = true; // 相手の退出はここで処理するので、切断検知の二重処理を防ぐ
    alert('相手が退出したため、部屋を閉じました。');
    await Net.leave();
    state.multiplayer = false;
    MenuBgm.start();
    showScreen('title');
    return;
  }

  // 相手の選択を受け取ったことを伝え、相手からのackも待つ。
  // これにより、両者が確実に相手の選択を受信し終えてから
  // rematchデータの削除（resetForNextBattle）に進めるので、
  // 削除タイミングと選択受信タイミングの競合で片方が取り残されることがなくなる。
  await Net.ackRematchChoice();
  await Net.waitOpponentAck();

  waitOverlay.classList.remove('show');

  // 両者が連戦を希望 → 次戦の準備
  if (state.isHost) {
    await Net.resetForNextBattle();
  } else {
    await Net.clearRematch();
  }
  startMultiplayerPick();
}

/* =========================================================
   ゲスト側バトルループ
   ========================================================= */
let guestEventQueue = [];
let guestProcessing = false;
let guestTurnEndResolve = null;

function waitForGuestTurnEnd() {
  return new Promise((resolve) => { guestTurnEndResolve = resolve; });
}

function enqueueGuestEvent(ev) {
  guestEventQueue.push(ev);
  if (!guestProcessing) processGuestEvents();
}

async function processGuestEvents() {
  if (guestEventQueue.length === 0) { guestProcessing = false; return; }
  guestProcessing = true;
  const ev = guestEventQueue.shift();
  await handleGuestEvent(ev);
  processGuestEvents();
}

async function handleGuestEvent(ev) {
  if (!ev) return;

  if (ev.k === 'msg') {
    const uiSide = ev.h === 'player' ? 'opp' : ev.h === 'cpu' ? 'self' : null;
    const poke = ev.h === 'player' ? state.cpuActive : ev.h === 'cpu' ? state.playerActive : null;
    const hpSnapshot = ev.hp;

    // ホストから毎回送られてくる両アクティブの実データスナップショットを、
    // 表示更新の前にまず実データへ反映する。ホスト視点 player はホストの自分側＝
    // ゲスト画面では相手(opp)、ホスト視点 cpu はホストの相手側＝ゲスト画面では自分(self) に対応する。
    // （ev.h や logSide の変換と同じ player↔cpu 反転をここでも揃える）
    // ダメージ演出のないメッセージ（状態異常付与・天候ダメージ等）でも
    // currentHp/statusが確実に同期されるようにするための処理。
    if (ev.pSnap && state.cpuActive && state.cpuActive.speciesId === ev.pSnap.sid) {
      state.cpuActive.currentHp = ev.pSnap.hp;
      state.cpuActive.maxHp = ev.pSnap.mhp;
      state.cpuActive.status = ev.pSnap.st;
      state.cpuActive.confuseTurns = ev.pSnap.cf || 0;
      state.cpuActive.fainted = ev.pSnap.fainted;
    }
    if (ev.cSnap && state.playerActive && state.playerActive.speciesId === ev.cSnap.sid) {
      state.playerActive.currentHp = ev.cSnap.hp;
      state.playerActive.maxHp = ev.cSnap.mhp;
      state.playerActive.status = ev.cSnap.st;
      state.playerActive.confuseTurns = ev.cSnap.cf || 0;
      state.playerActive.fainted = ev.cSnap.fainted;
    }

    // 能力ランク変化がどちら側に起きたか（ホスト視点 player/cpu → ゲスト画面の opp/self に変換）
    const rankUiSide = ev.rc && ev.rs ? (ev.rs === 'player' ? 'opp' : 'self') : null;

    // ログ履歴（「ログを見る」オーバーレイ用）。ホスト視点の player/cpu を
    // ゲスト画面上の自分（self）/相手（opp）に対応する player/cpu 表記へ変換する。
    // ゲスト画面では「自分」=ホスト視点の cpu 側、「相手」=ホスト視点の player 側。
    let logSide = null, logKind = 'plain';
    if (ev.turn) {
      logKind = 'turn';
    } else if (ev.mu) {
      logSide = ev.mu === 'cpu' ? 'player' : 'cpu'; // 自分=player表記, 相手=cpu表記に揃える
      logKind = 'move';
    } else if (ev.h) {
      logSide = ev.h === 'cpu' ? 'player' : 'cpu';
      logKind = 'damage';
    }
    if (logSide) {
      pushBattleLogHistory({ text: ev.t, side: logSide, kind: logKind, speciesId: ev.sid, shiny: ev.sh });
    } else {
      pushBattleLogHistory({ text: ev.t, side: null, kind: logKind, speciesId: null, shiny: false });
    }

    msgQueue.push({
      text: ev.t,
      after: async () => {
        if (uiSide && poke) {
          if (ev.mt) {
            await playTypeEffect(uiSide, ev.mt);
          }
          if (ev.tm !== null && ev.tm !== undefined) {
            playTypeEffectSound(ev.tm);
          }
          await flashHit(uiSide);
          updateHud(poke, uiSide, hpSnapshot);
        }
        if (rankUiSide) {
          await rankFlash(rankUiSide, ev.rc);
        }
        // ダメージ演出のない状態異常付与メッセージ等でも、HUD（HPバー・状態異常アイコン）を
        // 毎回両者分とも最新の実データで更新しておく（表示漏れ防止）。
        if (state.playerActive) updateHud(state.playerActive, 'self');
        if (state.cpuActive) updateHud(state.cpuActive, 'opp');
        if (ev.f) {
          const fUiSide = ev.f === 'player' ? 'opp' : 'self';
          await playFaint(fUiSide);
        }
      },
    });
    await playGuestMessages();
    return;
  }

  if (ev.k === 'sprite') {
    const uiSide = ev.s === 'player' ? 'opp' : 'self';
    const team = uiSide === 'self' ? state.playerTeam : state.cpuTeam;
    const poke = team.find((p) => p.speciesId === ev.sid && !p.fainted) || team[0];
    if (!poke) return;
    poke.currentHp = ev.hp !== undefined ? ev.hp : poke.currentHp;
    poke.maxHp = ev.mhp !== undefined ? ev.mhp : poke.maxHp;
    poke.status = ev.st !== undefined ? ev.st : poke.status;
    poke.confuseTurns = ev.cf !== undefined ? ev.cf : poke.confuseTurns;
    if (uiSide === 'self') state.playerActive = poke; else state.cpuActive = poke;
    setSprite(poke, uiSide);
    updateHud(poke, uiSide);
    return;
  }

  if (ev.k === 'force-switch') {
    const mySide = ev.s === 'cpu' ? 'self' : 'opp';
    if (mySide === 'self') {
      const idx = await waitGuestForcedSwitch();
      await Net.sendAction({ type: 'switch', idx });
    }
    return;
  }

  if (ev.k === 'turn-end') {
    if (guestTurnEndResolve) {
      const r = guestTurnEndResolve;
      guestTurnEndResolve = null;
      r();
    }
    return;
  }

  if (ev.k === 'end') {
    state.battleBusy = false;
    BattleBgm.stop();
    const guestWon = !ev.win;
    const overlay = $('result-overlay');
    $('result-title').textContent = guestWon ? 'WIN' : 'LOSE';
    $('result-title').className = 'result-title ' + (guestWon ? 'win' : 'lose');
    $('result-desc').textContent = guestWon ? '勝利！' : '敗北…';
    overlay.classList.add('show');
    await runMultiplayerRematchFlow();
    return;
  }
}

async function playGuestMessages() {
  return new Promise((resolve) => {
    function showNext() {
      if (msgQueue.length === 0) { resolve(); return; }
      const item = msgQueue.shift();
      pushLogLine(item.text);
      const afterPromise = item.after ? item.after() : Promise.resolve();
      afterPromise.then(() => {
        setTimeout(() => { showNext(); }, MSG_AUTO_MS);
      });
    }
    showNext();
  });
}

function waitGuestForcedSwitch() {
  $('cmd-dock').classList.remove('dock-wide');
  setWatchLogButtonsActive(false);
  $('cmd-panel').innerHTML = '';
  return new Promise((resolve) => {
    forcedSwitchResolve = (idx) => {
      forcedSwitchResolve = null;
      closePartyOverlay();
      resolve(idx);
    };
    openPartyOverlay('forced');
  });
}

async function runMultiplayerBattleGuest() {
  state.battleBusy = true;
  guestEventQueue = [];
  guestProcessing = false;
  guestTurnEndResolve = null;

  Net.onEvent((ev) => enqueueGuestEvent(ev));

  while (true) {
    if (state.playerTeam.every((p) => p.fainted)) return;
    if (state.cpuTeam.every((p) => p.fainted)) return;

    const myAction = await waitForPlayerAction();
    await Net.sendAction(myAction);
    await waitForGuestTurnEnd();
  }
}

/* ---- 共通ヘルパー ---- */
function resolveRemoteAction(raw, remotePoke) {
  if (!raw) return { type: 'none' };
  if (raw.type === 'move') {
    const move = remotePoke.moves.find((m) => m.id === raw.moveId);
    if (move) return { type: 'move', move };
    return { type: 'none' };
  }
  if (raw.type === 'switch') return { type: 'switch', idx: raw.idx };
  return { type: 'none' };
}

/* ---------------- Wiring ---------------- */
$('btn-npc-battle').addEventListener('click', () => { startMenuBgmOnFirstInteraction(); startNewRun(); });
$('btn-player-battle').addEventListener('click', () => { startMenuBgmOnFirstInteraction(); showMultiplayerMenu(); });
$('btn-to-battle').addEventListener('click', () => { startNextCpuBattle(); });

$('btn-create-room').addEventListener('click', () => {
  // 名前入力なしで即ルーム作成
  if (!state.playerName) state.playerName = generateAutoPlayerName();
  startHostRoom();
});
$('btn-join-room').addEventListener('click', () => openNameModal());
$('multi-back-to-title').addEventListener('click', () => showScreen('title'));

$('name-modal-cancel').addEventListener('click', () => closeNameModal());
$('name-modal-confirm').addEventListener('click', () => onNameModalConfirm());

$('input-room-code').addEventListener('input', (e) => {
  e.target.value = (e.target.value || '').replace(/\D/g, '').slice(0, 4);
  updateNameCharCount();
});

$('input-room-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); onNameModalConfirm(); }
});

$('host-wait-cancel').addEventListener('click', () => cancelHostRoom());

// フルスクリーン化は document 全体の click リスナー（isFullscreenActive 判定つき）に
// 一本化してあるため、タイトル画面限定のリスナーは不要（重複呼び出し防止のため削除）。

checkOrientation();
showScreen('title');

// アセット（画像・効果音・BGM）を事前読み込みしておく
AssetPreloader.preloadAll();

// ブラウザの自動再生制限のため、最初のユーザー操作でホームBGMを開始する
function startMenuBgmOnFirstInteraction() {
  MenuBgm.start();
  document.removeEventListener('pointerdown', startMenuBgmOnFirstInteraction, true);
  document.removeEventListener('click', startMenuBgmOnFirstInteraction, true);
}
document.addEventListener('pointerdown', startMenuBgmOnFirstInteraction, true);
document.addEventListener('click', startMenuBgmOnFirstInteraction, true);