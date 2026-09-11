'use strict';
/* =========================================================
   Pokedrock Battle Factory - Battle Engine
   本家ポケモンのバトルルールに準拠したバトルエンジン。
   GAME_DATA (gamedata.js) の種族値・技データ・タイプ相性・特性名を用いる。
   ========================================================= */

const NATURE_TABLE = {
  // id: [増加ステータス, 減少ステータス]  stat keys: atk, def, spa, spd, spe (null=無補正)
  1:  ['spe', 'def'], 2:  ['spd', 'def'], 3:  ['def', 'spd'], 4:  ['spa', 'spe'],
  5:  ['def', 'spe'], 6:  ['spa', 'def'], 7:  ['atk', 'spe'], 8:  [null, null],
  9:  ['spe', 'atk'], 10: [null, null],   11: ['def', 'spa'], 12: ['spd', 'spa'],
  13: ['spd', 'spe'], 14: ['spa', 'atk'], 15: ['spd', 'atk'], 16: ['spe', 'spa'],
  17: [null, null],   18: ['atk', 'def'], 19: ['def', 'atk'], 20: [null, null],
  21: ['spa', 'spd'], 22: ['atk', 'spa'], 23: ['spe', 'spd'], 24: ['atk', 'spd'],
};

const STATUS = {
  NONE: 0, PARALYZE: 1, BURN: 2, POISON: 3, BADLY_POISON: 4,
  SLEEP: 5, FREEZE: 7, CONFUSE: 8,
};
const STATUS_JP = {
  1: 'まひ', 2: 'やけど', 3: 'どく', 4: 'もうどく', 5: 'ねむり', 7: 'こおり', 8: 'こんらん',
};

function typeJp(key) {
  if (!key) return '';
  return (GAME_DATA.typeKeyToJp && GAME_DATA.typeKeyToJp[key]) || key;
}

function abilityJp(id) {
  return (GAME_DATA.abilityNames && GAME_DATA.abilityNames[id]) || ('特性' + id);
}

function rand(min, max) { // inclusive
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ---- 個体生成 (getpokemon方式) ----
function getFinalSpeciesIds() {
  const ids = [];
  for (const key in GAME_DATA.species) {
    const sp = GAME_DATA.species[key];
    if (!sp.evolutions || sp.evolutions.length === 0) ids.push(sp.id);
  }
  return ids;
}

function randomEvSpread(total, maxPerStat) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const cuts = [];
    for (let n = 0; n < 5; n++) cuts.push(rand(0, total));
    cuts.sort((a, b) => a - b);
    const bounds = [0, ...cuts, total];
    const evs = [];
    let overLimit = false;
    for (let n = 0; n < 6; n++) {
      const v = bounds[n + 1] - bounds[n];
      if (v > maxPerStat) { overLimit = true; break; }
      evs.push(v);
    }
    if (!overLimit) return evs;
  }
  const fb = [0, 0, 0, 0, 0, 0];
  let remaining = total;
  while (remaining > 0) {
    const idx = rand(0, 5);
    if (fb[idx] < maxPerStat) { fb[idx]++; remaining--; }
  }
  return fb;
}

function levelUpMoveIds(species) {
  const ids = [];
  for (const [lv, moveId] of species.levelMoves) {
    if (moveId !== undefined && !ids.includes(moveId)) ids.push(moveId);
  }
  return ids;
}

// 威力59以下でも例外的にダメージ技候補として採用するID
const LOW_POWER_EXCEPTION_MOVE_IDS = [1,271,503,504,111,107,155,221,162,295,324,77,341,405,461,472,498,494,48,189,309,367,388,229];

function chooseMoves(species) {
  const candidateIds = levelUpMoveIds(species);
  const statusMoves = [], damageMoves = [];
  for (const moveId of candidateIds) {
    const move = GAME_DATA.moves[moveId];
    if (!move) continue;
    if (move.category === 'status') statusMoves.push(moveId);
    else if ((move.power ?? 0) > 50 || LOW_POWER_EXCEPTION_MOVE_IDS.includes(moveId)) damageMoves.push(moveId);
  }
  const chosen = [];
  const poolOf = (arr) => arr.filter((id) => !chosen.includes(id));

  // 変化技の採用確率: 1枠目=75%、2枠目=25%、3枠目以降=変化技なし
  const statusChanceBySlot = [75, 25];

  for (let slot = 0; slot < 4; slot++) {
    const statusPool = poolOf(statusMoves), damagePool = poolOf(damageMoves);
    if (statusPool.length === 0 && damagePool.length === 0) break;
    const statusChance = statusChanceBySlot[slot] ?? 0;
    const wantStatus = statusChance > 0 && rand(1, 100) <= statusChance;
    let p;
    if (wantStatus && statusPool.length > 0) p = pick(statusPool);
    else if (damagePool.length > 0) p = pick(damagePool);
    else if (statusPool.length > 0) p = pick(statusPool);
    else break;
    chosen.push(p);
  }
  while (chosen.length < 4) chosen.push(0);
  return chosen;
}

function rollAbility(species) {
  if (Array.isArray(species.abilities) && species.abilities.length > 0) return pick(species.abilities);
  return 0;
}

function calcStat(base, iv, ev, level, isHp, natureMod) {
  if (isHp) {
    return Math.floor((2 * base + iv + Math.floor(ev / 4)) * level / 100) + level + 10;
  }
  let val = Math.floor((2 * base + iv + Math.floor(ev / 4)) * level / 100) + 5;
  val = Math.floor(val * natureMod);
  return val;
}

function natureMultiplier(natureId, statKey) {
  const entry = NATURE_TABLE[natureId];
  if (!entry) return 1.0;
  if (entry[0] === statKey) return 1.1;
  if (entry[1] === statKey) return 0.9;
  return 1.0;
}

// Level 100固定・個体値31固定・努力値510ランダム配分・性格ランダム・特性ランダム・技はレベル技から選出
function createRandomPokemon(speciesId, level = 100) {
  const species = GAME_DATA.species[speciesId];
  const nature = rand(1, 24);
  const ability = rollAbility(species);
  const moveIds = chooseMoves(species);
  const evs = randomEvSpread(510, 252); // [hp,atk,def,spa,spd,spe]
  const iv = 31;

  const base = species.baseStats;
  const stats = {
    hp: calcStat(base.hp, iv, evs[0], level, true, 1),
    atk: calcStat(base.atk, iv, evs[1], level, false, natureMultiplier(nature, 'atk')),
    def: calcStat(base.def, iv, evs[2], level, false, natureMultiplier(nature, 'def')),
    spa: calcStat(base.spa, iv, evs[3], level, false, natureMultiplier(nature, 'spa')),
    spd: calcStat(base.spd, iv, evs[4], level, false, natureMultiplier(nature, 'spd')),
    spe: calcStat(base.spe, iv, evs[5], level, false, natureMultiplier(nature, 'spe')),
  };

  const moves = moveIds.map((id) => {
    if (!id) return null;
    const m = GAME_DATA.moves[id];
    return { id, name: m.name, type: m.type, power: m.power, accuracy: m.accuracy,
      category: m.category, pp: m.pp, maxPp: m.pp, priority: m.priority || 0,
      selfRank: m.selfRank, oppRank: m.oppRank, selfStatus: m.selfStatus, oppStatus: m.oppStatus,
      flinchChance: m.flinchChance || 0,
      drainRatio: m.drainRatio || null, recoilRatio: m.recoilRatio || null,
      selfDestruct: !!m.selfDestruct, chargeTurn: !!m.chargeTurn,
      damageFormula: m.damageFormula || null, callRandomMove: !!m.callRandomMove,
      locked: false };
  }).filter(Boolean);
  // 技が1つも選べなかった場合の保険（たいあたり系）
  if (moves.length === 0) {
    const fallback = GAME_DATA.moves[241]; // たいあたり
    if (fallback) moves.push({ id: 241, name: fallback.name, type: fallback.type, power: fallback.power,
      accuracy: fallback.accuracy, category: fallback.category, pp: fallback.pp, maxPp: fallback.pp, priority: 0,
      drainRatio: null, recoilRatio: null, selfDestruct: false, chargeTurn: false,
      damageFormula: null, callRandomMove: false, locked: false });
  }

  const shiny = rand(1, 100) <= 5; // 5%の確率で色違い

  return {
    speciesId, species, level, nature, ability, shiny,
    evs, iv, stats, maxHp: stats.hp, currentHp: stats.hp,
    moves,
    status: STATUS.NONE, badlyPoisonCounter: 0, confuseTurns: 0,
    ranks: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, acc: 0, eva: 0 },
    flinch: false,
    fainted: false,
    fundoTriggered: false,
    moraibiActive: false,
    lazyTurns: false,
    firstTurn: true,
    gyakujouTriggered: false,
    energyStacks: 0,
    tauntTurns: 0, // 挑発ターン
    bindTurns: 0,  // バインド状態残りターン
    // ---- 新規追加 ----
    removedTypes: [],       // 消滅したタイプ（'dark', 'grass' など）
    changedType: null,      // ナナイロレーザーで変化したタイプ（'bug' など）
    typeLockTurns: 0,       // 特定タイプロック残りターン（インフェルノ用）
    typeLockType: null,     // ロックされたタイプ
    lastUsedMoveId: null,   // 前ターンに使った技ID（アンコール用）
    encoreMoveId: null,     // アンコールで強制される技ID
    encoreTurns: 0,         // アンコール残りターン
    utsusemiTurns: 0,       // うつせみカウント（相手に付与）
    infernoUsed: false,     // インフェルノを使用したフラグ
    deaigashiraLocked: false, // であいがしら：登場ターン以外はロック（交代で解除）
    gekirinTurns: 0,        // げきりん：強制連続使用の残りターン数
    gekirinMoveId: null,    // げきりん：強制されている技ID
  };
}

function drawRandomTeam(count = 3) {
  const pool = getFinalSpeciesIds();
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const chosenIds = shuffled.slice(0, count);
  return chosenIds.map((id) => createRandomPokemon(id, 100));
}

// ---- タイプ相性 ----
function getTypeEffectiveness(atkType, defType1, defType2) {
  const chart = GAME_DATA.typeChart[atkType];
  let mult = 1;
  if (chart) {
    // タイプ消失・変化を反映
    const types = [];
    if (defType1) types.push(defType1);
    if (defType2) types.push(defType2);
    for (const t of types) {
      if (chart[t] !== undefined) mult *= chart[t];
    }
  }
  return mult;
}

// ---- 実効タイプ（消失・変化を反映） ----
function getEffectiveTypes(poke) {
  const t1 = poke.species.type1;
  const t2 = poke.species.type2;
  let types = [];
  if (poke.changedType) {
    types = [poke.changedType];
  } else {
    if (t1 && !poke.removedTypes.includes(t1)) types.push(t1);
    if (t2 && !poke.removedTypes.includes(t2)) types.push(t2);
  }
  // 重複排除
  return [...new Set(types)];
}

// ---- ランク補正 ----
function rankMultiplier(rank) {
  if (rank >= 0) return (2 + rank) / 2;
  return 2 / (2 - rank);
}
function accEvaMultiplier(rank) {
  if (rank >= 0) return (3 + rank) / 3;
  return 3 / (3 - rank);
}

// ---- 特性ID定数 ----
const ABILITY = {
  SHINRYOKU: 41,
  MOUKA: 42,
  GEKIRYUU: 43,
  MUSHINOSHIRASE: 44,
  GANJOU: 5,
  HANDOUMUKOU: 45,
  CHIKUDEN: 9,
  CHOSUI: 10,
  MORAIBI: 14,
  MUSHIYOKE: 101,
  KABUTO_ARMOR: 4,
  KIZUTSUKEBODY: 17,
  CHIKARAMOCHI: 25,
  HIDERI: 46,
  SUNAOKOSHI: 31,
  AMEFURASHI: 2,
  YUKIFURASHI: 57,
  HOSHINOMADOROMI: 138,
  GRASS_MAKER: 116,
  ELECTRIC_MAKER: 117,
  PSYCHIC_MAKER: 118,
  MIST_MAKER: 119,
  MELODY_MAKER: 120,
  SUISUI: 23,
  YOURYOKUSO: 24,
  YUKIKAKI: 59,
  SUNAKAKI: 60,
  AMEUKEZARA: 30,
  SUN_POWER: 96,
  ICE_BREAK: 100,
  JUUNAN: 6,
  SEIDENKI: 8,
  FUMIN: 11,
  KONJOU: 39,
  FUSHIGINA_UROKO: 40,
  FUSHOKU: 54,
  HAYAASHI: 63,
  FUSHOKU_NO_TOGE: 131,
  HONOO_NO_KARADA: 34,
  FUYU: 19,
  RESONANCE: 72,
  KYOKKOU: 73,
  SKIN_FREEZE: 80,
  SKIN_ELECTRIC: 81,
  SKIN_DRAGON: 82,
  SKIN_PSYCHIC: 83,
  JISHINKAJOU: 112,
  AFURERUCHISHIKI: 113,
  FUNDO: 133,
  KASOKU: 3,
  IKAKU: 16,
  PRESSURE: 32,
  ATSUI_SHIBOU: 33,
  NAMAKE: 36,
  FUKUGAN: 51,
  TECHNICIAN: 53,
  TEN_NO_MEGUMI: 56,
  FAIRY_SKIN: 62,
  MULTISCALE: 64,
  AMANOJAKU: 65,
  CHIKARAZUKU: 66,
  CLEAR_BODY: 67,
  TEKIOURYOKU: 68,
  NO_GUARD: 69,
  KATAI_TSUME: 70,
  ITAZURA_GOKORO: 71,
  KYOUUN: 74,
  KATAYABURI: 75,
  TRACE: 76,
  HARD_ROCK: 77,
  SNIPER: 78,
  HARIKIRI: 79,
  HAYATE_NO_TSUBASA: 84,
  SEISHINRYOKU: 90,
  ARUKOBARENO: 91,
  SURUDOIME: 92,
  SUNA_NO_CHIKARA: 93,
  SOUSHOKU: 94,
  MURAKKE: 95,
  RINPUN: 97,
  MAKENKI: 98,
  KACHIKI: 99,
  JIKYUURYOKU: 102,
  KUDAKERU_YOROI: 103,
  YUUBABU: 104,
  KIREEJI: 86,
  GANJOUAGO: 87,
  MEGALAUNCHER: 88,
  TETSUNOKOBUSHI: 89,
  NOROWARE_BODY: 105,
  KAGAKUHENKAGASU: 106,
  SAISEIRYOKU: 107,
  BINJOU: 108,
  GYAKUJOU: 109,
  OMITOOSHI: 110,
  KIKIKAIHI: 111,   // きけんよち（オリジナル）
  SONIC_GUARD: 126,
  FAIR_COAT: 127,
  KOORI_NO_RINPUN: 128,
  TOUSOUSHIN: 129,
  TANJUN: 132,
  ENERGY_PERMANENT: 134,
  RAIL_GUN: 135,
  ENERGY_ENGINE: 136,
  ENERGY_SOUL: 137,
  SKILL_LINK: 115,
  MAGIC_MIRROR: 125,
  SURINUKE: 123,
  KIKENYOCHI_2: 122,
  KAGEFUMI: 121,
  NERVOUS_RAGE: 124,
  HAKKOU: 85,
};

const KIKENYOCHI_ABILITIES = [ABILITY.KIKIKAIHI, ABILITY.KIKENYOCHI_2];

const WEATHER_SET_ABILITY = {
  [ABILITY.HIDERI]: 'sun',
  [ABILITY.SUNAOKOSHI]: 'sand',
  [ABILITY.AMEFURASHI]: 'rain',
  [ABILITY.YUKIFURASHI]: 'snow',
  [ABILITY.HOSHINOMADOROMI]: 'starrysky',
};
const TERRAIN_SET_ABILITY = {
  [ABILITY.GRASS_MAKER]: 'grassy',
  [ABILITY.ELECTRIC_MAKER]: 'electric',
  [ABILITY.PSYCHIC_MAKER]: 'psychic',
  [ABILITY.MIST_MAKER]: 'misty',
  [ABILITY.MELODY_MAKER]: 'melody',
};
const WEATHER_SPEED_BOOST_ABILITY = {
  [ABILITY.SUISUI]: 'rain',
  [ABILITY.YOURYOKUSO]: 'sun',
  [ABILITY.YUKIKAKI]: 'snow',
  [ABILITY.SUNAKAKI]: 'sand',
};

function hasMajorStatus(poke) {
  return poke.status && poke.status !== STATUS.NONE;
}

// 実効素早さ
function effectiveSpeed(poke) {
  let spe = poke.stats.spe * rankMultiplier(poke.ranks.spe);
  const weatherKey = WEATHER_SPEED_BOOST_ABILITY[poke.ability];
  if (weatherKey && battleField.weather === weatherKey) spe *= 2;
  if (poke.ability === ABILITY.HAYAASHI && hasMajorStatus(poke)) spe *= 1.5;
  const tailwindTurns = poke.side === 'player' ? battleField.tailwindPlayer : battleField.tailwindCpu;
  if (tailwindTurns > 0) spe *= 2;
  return spe;
}

const PINCH_BOOST_ABILITY_TYPE = {
  [ABILITY.SHINRYOKU]: 'grass',
  [ABILITY.MOUKA]: 'fire',
  [ABILITY.GEKIRYUU]: 'water',
  [ABILITY.MUSHINOSHIRASE]: 'bug',
};

const TYPE_ABSORB_ABILITY_TYPE = {
  [ABILITY.CHIKUDEN]: 'electric',
  [ABILITY.CHOSUI]: 'water',
  [ABILITY.MORAIBI]: 'fire',
  [ABILITY.MUSHIYOKE]: 'bug',
  [ABILITY.SOUSHOKU]: 'grass',
};

const KIRU_MOVE_IDS = [1,23,45,68,150,152,168,183,187,247,266,281,32,328,387,389,406];
const KAMU_MOVE_IDS = [24,25,28,124,61,261,222,284,206,348];
const HADOU_MOVE_IDS = [218,334,32,54,112,352,376,394,501];
const KOBUSHI_MOVE_IDS = [461,62,84,102,106,107,117,122,164,223,226,250,324,327];
const ENERGY_CHARGE_MOVE_IDS = [66,77,79,83,97,115,127,157,177,184,218,225,294,315,334];

const MULTI_HIT_MOVES = {
  461: { maxHits: 5, minHits: 2, fixed: false, powerStep: 0, basePower: 25 },
  48:  { maxHits: 5, minHits: 2, fixed: false, powerStep: 0, basePower: 25 },
  229: { maxHits: 3, minHits: 3, fixed: true,  powerStep: 20, basePower: 20 },
  309: { maxHits: 5, minHits: 2, fixed: false, powerStep: 0, basePower: 25 },
  367: { maxHits: 5, minHits: 2, fixed: false, powerStep: 0, basePower: 35 },
  388: { maxHits: 5, minHits: 2, fixed: false, powerStep: 0, basePower: 50 },
  472: { maxHits: 6, minHits: 6, fixed: true,  powerStep: 5, basePower: 10 },
  189: { maxHits: 5, minHits: 2, fixed: false, powerStep: 0, basePower: 25 },
};

// ---- エナジースタック操作 ----
function addEnergyStacks(poke, amount, logFn) {
  if (!poke || poke.fainted) return;
  const before = poke.energyStacks;
  poke.energyStacks += amount;
  if (logFn) logFn(`${poke.species.name}のエナジースタックが${amount}増えた！（現在${poke.energyStacks}）`);

  const gasActive = battleField.chemicalGasActive;
  const gasImmune = poke.ability === ABILITY.KAGAKUHENKAGASU;

  if (poke.ability === ABILITY.ENERGY_ENGINE && !(gasActive && !gasImmune)) {
    const speCount = Math.floor(poke.energyStacks / 2) - Math.floor(before / 2);
    const defSpdCount = Math.floor(poke.energyStacks / 3) - Math.floor(before / 3);
    for (let i = 0; i < speCount; i++) {
      applyRankChange(poke, [100, 0, 0, 0, 0, 1, 0, 0], logFn);
    }
    for (let i = 0; i < defSpdCount; i++) {
      applyRankChange(poke, [100, 0, 2, 0, 2, 0, 0, 0], logFn);
    }
    if (speCount > 0 || defSpdCount > 0) {
      logFn(`${poke.species.name}のエナジーエンジンが発動！`);
    }
  }
}

function consumeEnergyStacks(poke, logFn) {
  if (!poke || poke.fainted) return 0;
  const consumed = poke.energyStacks;
  poke.energyStacks = 0;
  return consumed;
}

// ---- ランク変化適用 ----
function applyRankChange(target, rankData, logFn, attackerAbility) {
  if (!rankData) return;
  const chance = rankData[0] ?? 100;
  if (rand(1, 100) > chance) return;
  const keys = ['atk', 'def', 'spa', 'spd', 'spe', 'acc', 'eva'];
  let changed = false;
  const statName = { atk: 'こうげき', def: 'ぼうぎょ', spa: 'とくこう', spd: 'とくぼう', spe: 'すばやさ', acc: 'めいちゅう', eva: 'かいひ' };
  // 同じ変化幅（changePhrase）ごとにステータス名をまとめて、まとめてログ出力するためのバッファ。
  // 例：「こうげきとすばやさと命中率が上がった！」「ぼうぎょととくぼうが下がった！」
  const groups = new Map(); // changePhrase -> [statName, ...]
  const pushGroup = (phrase, name) => {
    if (!groups.has(phrase)) groups.set(phrase, []);
    groups.get(phrase).push(name);
  };
  const flushGroups = () => {
    groups.forEach((names, phrase) => {
      const rankMeta = phrase.includes('上がった')
        ? { rankChange: 'up', rankSide: target.side }
        : { rankChange: 'down', rankSide: target.side };
      logFn(`${target.species.name}の${formatStatNameList(names)}が\n${phrase}`, rankMeta);
    });
    groups.clear();
  };

  keys.forEach((k, idx) => {
    let delta = rankData[idx + 1];
    if (!delta) return;

    if (battleField.chemicalGasActive && target.ability !== ABILITY.KAGAKUHENKAGASU) return;
    if (target.ability === ABILITY.CLEAR_BODY && delta < 0) return;
    // はっこう：自分の命中率ランクが下がらない
    if (target.ability === ABILITY.HAKKOU && k === 'acc' && delta < 0) return;
    if (target.ability === ABILITY.TANJUN) delta *= 2;
    if (target.ability === ABILITY.AMANOJAKU) delta = -delta;

    const before = target.ranks[k];
    target.ranks[k] = Math.max(-6, Math.min(6, target.ranks[k] + delta));
    if (target.ranks[k] !== before) {
      changed = true;
      const actualDelta = target.ranks[k] - before;
      let changePhrase;
      if (actualDelta >= 3) changePhrase = 'ぐぐーんと上がった！';
      else if (actualDelta === 2) changePhrase = 'ぐーんと上がった！';
      else if (actualDelta === 1) changePhrase = '上がった！';
      else if (actualDelta === -1) changePhrase = '下がった！';
      else if (actualDelta === -2) changePhrase = 'ガクッと下がった！';
      else changePhrase = 'ガクッと下がった！';
      pushGroup(changePhrase, statName[k]);

      if (delta > 0 && target.ability === ABILITY.BINJOU && attackerAbility !== target.ability) {
        flushGroups();
        const traceDelta = [100, delta, delta, delta, delta, delta, delta, delta];
        applyRankChange(target, traceDelta, logFn, target.ability);
        logFn(`${target.species.name}のびんじょうが発動！`);
      }

      if (delta < 0) {
        if (k === 'atk' && target.ability === ABILITY.MAKENKI) {
          flushGroups();
          const boostData = [100, 2, 0, 0, 0, 0, 0, 0];
          applyRankChange(target, boostData, logFn);
          logFn(`${target.species.name}のまけんきが発動！`);
        }
        if (k === 'spa' && target.ability === ABILITY.KACHIKI) {
          flushGroups();
          const boostData = [100, 0, 0, 2, 0, 0, 0, 0];
          applyRankChange(target, boostData, logFn);
          logFn(`${target.species.name}のかちきが発動！`);
        }
      }
    }
  });
  flushGroups();
  return changed;
}

// ステータス名の配列を「AとBとC」の形式に整形する（1つなら単体、複数なら「と」で連結）。
function formatStatNameList(names) {
  return names.join('と');
}

function applyStatus(target, statusData, logFn, attackerAbility) {
  if (!statusData) return false;
  let chance = statusData[0] ?? 100;
  const statusId = statusData[1];
  if (!statusId) return false;

  if (battleField.chemicalGasActive && target.ability !== ABILITY.KAGAKUHENKAGASU) return false;
  if (target.ability === ABILITY.ARUKOBARENO) return false;

  if (statusId === STATUS.CONFUSE) {
    if (target.confuseTurns > 0) return false;
  } else if (target.status !== STATUS.NONE) {
    return false;
  }

  if (attackerAbility === ABILITY.TEN_NO_MEGUMI) chance = Math.min(100, chance * 2);

  if (rand(1, 100) > chance) return false;
  const t1 = target.species.type1, t2 = target.species.type2;
  const bypassPoisonImmunity = attackerAbility === ABILITY.FUSHOKU;
  if ((statusId === STATUS.POISON || statusId === STATUS.BADLY_POISON) && !bypassPoisonImmunity) {
    if (t1 === 'poison' || t2 === 'poison' || t1 === 'steel' || t2 === 'steel') return false;
  }
  if (statusId === STATUS.BURN && (t1 === 'fire' || t2 === 'fire')) return false;
  if (statusId === STATUS.FREEZE && (t1 === 'ice' || t2 === 'ice')) return false;
  if (statusId === STATUS.PARALYZE && (t1 === 'electric' || t2 === 'electric')) return false;
  if (statusId === STATUS.PARALYZE && target.ability === ABILITY.JUUNAN) return false;
  if (statusId === STATUS.SLEEP && target.ability === ABILITY.FUMIN) return false;
  if (statusId === STATUS.SLEEP && battleField.terrain === 'electric') return false;
  if (battleField.terrain === 'misty' &&
      [STATUS.PARALYZE, STATUS.BURN, STATUS.POISON, STATUS.BADLY_POISON, STATUS.SLEEP, STATUS.FREEZE].includes(statusId)) {
    return false;
  }
  if (statusId === STATUS.CONFUSE && battleField.terrain === 'psychic') return false;
  if (statusId === STATUS.CONFUSE) {
    target.confuseTurns = rand(1, 4);
    logFn(`${target.species.name}は${STATUS_JP[statusId]}になった！`);
    return true;
  }
  target.status = statusId;
  if (statusId === STATUS.BADLY_POISON) target.badlyPoisonCounter = 1;
  if (statusId === STATUS.SLEEP) target.sleepTurns = rand(1, 3);
  logFn(`${target.species.name}は${STATUS_JP[statusId]}になった！`);
  return true;
}

// ---- 天候・フィールド ----
const WEATHER_JP = {
  none: 'なし', sun: 'ひでり', rain: 'あめ', sand: 'すなあらし', snow: 'ゆき', starrysky: 'ほしぞら',
};
const TERRAIN_JP = {
  none: 'なし', grassy: 'グラスフィールド', electric: 'エレキフィールド',
  psychic: 'サイコフィールド', misty: 'ミストフィールド', melody: 'メロディフィールド',
};
const STARRY_SKY_BOOST_MOVE_IDS = [53, 93, 252, 327, 336, 451, 482];
const GRASSY_HALVED_MOVE_IDS = [201, 203];

const battleField = {
  weather: 'none', weatherTurns: 0,
  terrain: 'none', terrainTurns: 0,
  chemicalGasActive: false,
  playerReflect: 0,
  playerLightScreen: 0,
  cpuReflect: 0,
  cpuLightScreen: 0,
  tailwindPlayer: 0,
  tailwindCpu: 0,
  trickRoom: false,
  trickRoomTurns: 0,
};

function resetField() {
  battleField.weather = 'none';
  battleField.weatherTurns = 0;
  battleField.terrain = 'none';
  battleField.terrainTurns = 0;
  battleField.chemicalGasActive = false;
  battleField.playerReflect = 0;
  battleField.playerLightScreen = 0;
  battleField.cpuReflect = 0;
  battleField.cpuLightScreen = 0;
  battleField.tailwindPlayer = 0;
  battleField.tailwindCpu = 0;
  battleField.trickRoom = false;
  battleField.trickRoomTurns = 0;
}

function setWeather(key, turns, logFn) {
  battleField.weather = key;
  battleField.weatherTurns = turns;
  const msg = {
    sun: 'ひざしが　つよくなった！',
    rain: 'あめが　ふりはじめた！',
    sand: 'すなあらしが　ふきあれる！',
    snow: 'ゆきが　ふりはじめた！',
    starrysky: 'そらに　ほしが　またたきはじめた！',
  }[key];
  if (msg) logFn(msg);
}

function setTerrain(key, turns, logFn) {
  battleField.terrain = key;
  battleField.terrainTurns = turns;
  const msg = {
    grassy: 'あしもとに　草が　しげった！',
    electric: 'あたりに　でんきが　はしった！',
    psychic: 'あたりが　ふしぎな　かんじに　なった！',
    misty: 'あたりに　きりが　ひろがった！',
    melody: 'すてきな　メロディが　ながれはじめた！',
  }[key];
  if (msg) logFn(msg);
}

// 交代／登場時処理
function applyWeatherTerrainAbilityOnSwitchIn(poke, logFn, opponent) {
  if (!poke || poke.fainted) return;
  if (poke.ability === ABILITY.KAGAKUHENKAGASU) {
    battleField.chemicalGasActive = true;
    logFn(`${poke.species.name}の${abilityJp(poke.ability)}が発動！`);
  }
  if (poke.ability === ABILITY.TRACE && opponent && !opponent.fainted) {
    poke.ability = opponent.ability;
    logFn(`${poke.species.name}は${abilityJp(opponent.ability)}をコピーした！`);
  }
  if (poke.ability === ABILITY.IKAKU && opponent && !opponent.fainted) {
    const rankData = [100, -1, 0, 0, 0, 0, 0, 0];
    applyRankChange(opponent, rankData, logFn);
    logFn(`${poke.species.name}のいかくが発動！`);
  }
  if (KIKENYOCHI_ABILITIES.includes(poke.ability) && opponent && !opponent.fainted) {
    const dangerousMoves = opponent.moves.filter(m => {
      if (!m) return false;
      if (m.category === 'status') return true;
      return (m.power || 0) >= 80;
    });
    const shuffled = [...dangerousMoves].sort(() => Math.random() - 0.5);
    const shown = shuffled.slice(0, 2);
    if (shown.length > 0) {
      const names = shown.map(m => m.name).join('、');
      logFn(`${poke.species.name}のきけんよち！相手の危険な技：${names}`);
    } else {
      logFn(`${poke.species.name}のきけんよち！相手に危険な技はなさそうだ…`);
    }
  }
  if (poke.ability === ABILITY.OMITOOSHI && opponent && !opponent.fainted) {
    logFn(`${poke.species.name}のおみとおし！相手の特性は${abilityJp(opponent.ability)}！`);
  }

  const wKey = WEATHER_SET_ABILITY[poke.ability];
  if (wKey && battleField.weather !== wKey) {
    logFn(`${poke.species.name}の${abilityJp(poke.ability)}が発動！`);
    setWeather(wKey, 5, logFn);
  }
  const tKey = TERRAIN_SET_ABILITY[poke.ability];
  if (tKey && battleField.terrain !== tKey) {
    logFn(`${poke.species.name}の${abilityJp(poke.ability)}が発動！`);
    setTerrain(tKey, 5, logFn);
  }
}

// ---- ダメージ計算（壁対応） ----
function calcDamage(attacker, defender, move, logFn) {
  // ふゆう（実効タイプを使用）
  const defTypes = getEffectiveTypes(defender);

  // ウェザーボール(503)・だいちのはどう(504)：
  // 天候／フィールドに対応があれば、そのタイプに変化しダメージ2倍（原作仕様）。
  // 対応がない場合（天候・フィールドなし等）はノーマルタイプ・威力そのまま。
  const effMoveType = resolveEffectiveMoveType(move, battleField);
  const weatherBallBoosted = (move.id === 503 || move.id === 504) && effMoveType !== move.type;
  const effMovePower = weatherBallBoosted ? move.power * 2 : move.power;
  move = { ...move, type: effMoveType, power: effMovePower };

  if (defender.ability === ABILITY.FUYU && move.type === 'ground' && attacker.ability !== ABILITY.KATAYABURI) {
    if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
      return { damage: 0, typeMult: 0, isCrit: false };
    }
  }

  const level = attacker.level;
  const isPhysical = move.category === 'physical';

  const ignoreWalls = attacker.ability === ABILITY.SURINUKE;

  let atkStat, defStat, atkRank, defRank;
  switch (move.damageFormula) {
    case 'selfDefVsOppDef':
      atkStat = attacker.stats.def; defStat = defender.stats.def;
      atkRank = attacker.ranks.def; defRank = defender.ranks.def;
      break;
    case 'selfSpaVsOppDef':
      atkStat = attacker.stats.spa; defStat = defender.stats.def;
      atkRank = attacker.ranks.spa; defRank = defender.ranks.def;
      break;
    case 'oppSpaVsOppSpd':
      atkStat = defender.stats.spa; defStat = defender.stats.spd;
      atkRank = defender.ranks.spa; defRank = defender.ranks.spd;
      break;
    case 'oppAtkVsOppDef':
      atkStat = defender.stats.atk; defStat = defender.stats.def;
      atkRank = defender.ranks.atk; defRank = defender.ranks.def;
      break;
    default:
      atkStat = isPhysical ? attacker.stats.atk : attacker.stats.spa;
      defStat = isPhysical ? defender.stats.def : defender.stats.spd;
      atkRank = isPhysical ? attacker.ranks.atk : attacker.ranks.spa;
      defRank = isPhysical ? defender.ranks.def : defender.ranks.spd;
  }

  if (attacker.ability === ABILITY.CHIKARAMOCHI && isPhysical && move.damageFormula !== 'oppAtkVsOppDef') {
    if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) atkStat *= 2;
  }

  // 急所ランク：base(0) + きょううん特性(+1) + 高確率急所技(+1) の合計で決定する。
  // ランク0=1/16, 1=1/8, 2=1/2, 3以上=確定（本家ポケモンの急所ランク仕様に準拠）。
  const HIGH_CRIT_MOVE_IDS = [23, 125, 152, 163, 182, 183, 204, 406, 264, 266, 281, 303, 328];
  let critRank = 0;
  if (attacker.ability === ABILITY.KYOUUN) critRank += 1;
  if (HIGH_CRIT_MOVE_IDS.includes(move.id)) critRank += 1;
  const CRIT_CHANCE_BY_RANK = [1 / 16, 1 / 8, 1 / 2, 1];
  const critChance = CRIT_CHANCE_BY_RANK[Math.min(critRank, 3)];
  const isCrit = defender.ability === ABILITY.KABUTO_ARMOR ? false : Math.random() < critChance;

  let effAtk = isCrit && atkRank < 0 ? atkStat : atkStat * rankMultiplier(atkRank);
  let effDef = isCrit && defRank > 0 ? defStat : defStat * rankMultiplier(defRank);

  const isAtkStat = atkStat === attacker.stats.atk;
  const isSpaStat = atkStat === attacker.stats.spa;
  const isDefSpd = (defStat === defender.stats.spd);
  const isDefDef = (defStat === defender.stats.def);
  if (battleField.weather === 'sand' && isDefSpd && defTypes.includes('rock')) effDef *= 1.5;
  if (battleField.weather === 'snow' && isDefDef && defTypes.includes('ice')) effDef *= 1.5;
  if (attacker.ability === ABILITY.KONJOU && attacker.status === STATUS.BURN && isAtkStat) {
    if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) effAtk *= 1.5;
  }
  if (attacker.ability === ABILITY.SUN_POWER && battleField.weather === 'sun' && isSpaStat) {
    if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) effAtk *= 1.5;
  }
  if (attacker.ability === ABILITY.ICE_BREAK && battleField.weather === 'snow' && (isAtkStat || isSpaStat)) {
    if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) effAtk *= 1.5;
  }
  if (defender.ability === ABILITY.FUSHIGINA_UROKO && hasMajorStatus(defender) && isDefDef) {
    if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) effDef *= 1.5;
  }
  if (attacker.ability === ABILITY.HARIKIRI && isPhysical) {
    if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) effAtk *= 1.5;
  }
  // ナーバスレイジ：自分がアンコール・ちょうはつ状態の時、攻撃技（物理・特殊）の威力が1.5倍
  if (attacker.ability === ABILITY.NERVOUS_RAGE && move.category !== 'status'
      && ((attacker.encoreTurns || 0) > 0 || (attacker.tauntTurns || 0) > 0)) {
    if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) effAtk *= 1.5;
  }

  const base = Math.floor(Math.floor((2 * level / 5 + 2) * move.power * effAtk / effDef) / 50) + 2;
  const atkTypes = [attacker.species.type1, attacker.species.type2].filter(Boolean);
  const stab = atkTypes.includes(move.type) ? 1.3 : 1.0;
  // 実効タイプを使用してタイプ相性計算
  let typeMult = 1;
  const chart = GAME_DATA.typeChart[move.type];
  if (chart) {
    for (const t of defTypes) {
      if (chart[t] !== undefined) typeMult *= chart[t];
    }
  }
  const dmgTypeMult = typeMult === 2 ? 1.6 : typeMult === 4 ? 2.56 : typeMult;
  const randomFactor = rand(85, 100) / 100;
  let critMult = isCrit ? 1.5 : 1.0;
  if (isCrit && attacker.ability === ABILITY.SNIPER) critMult = 2.25;

  const burnMult = (attacker.status === STATUS.BURN && isPhysical) ? 0.5 : 1.0;

  let pinchMult = 1.0;
  const pinchType = PINCH_BOOST_ABILITY_TYPE[attacker.ability];
  if (pinchType && move.type === pinchType && attacker.currentHp <= Math.floor(attacker.maxHp / 3)) {
    if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) {
      pinchMult = 1.5;
      if (logFn) logFn(`${attacker.species.name}の${abilityJp(attacker.ability)}が発動！`);
    }
  }
  const moraibiMult = (attacker.moraibiActive && move.type === 'fire') ? 1.5 : 1.0;

  let weatherMult = 1.0;
  if (battleField.weather === 'sun') {
    if (move.type === 'fire') weatherMult = 1.3;
    else if (move.type === 'water') weatherMult = 0.5;
  } else if (battleField.weather === 'rain') {
    if (move.type === 'water') weatherMult = 1.3;
    else if (move.type === 'fire') weatherMult = 0.5;
  } else if (battleField.weather === 'starrysky') {
    if (move.type === 'ghost' || move.type === 'psychic' || move.type === 'steel') weatherMult = 1.3;
    else if (move.type === 'shine') weatherMult = 0.5;
    if (STARRY_SKY_BOOST_MOVE_IDS.includes(move.id)) weatherMult *= 1.2;
  }

  let terrainMult = 1.0;
  if (battleField.terrain === 'grassy') {
    if (move.type === 'grass') terrainMult = 1.3;
    if (GRASSY_HALVED_MOVE_IDS.includes(move.id)) terrainMult *= 0.5;
  } else if (battleField.terrain === 'electric') {
    if (move.type === 'electric') terrainMult = 1.3;
  } else if (battleField.terrain === 'psychic') {
    if (move.type === 'psychic') terrainMult = 1.3;
  } else if (battleField.terrain === 'misty') {
    if (move.type === 'dragon') terrainMult = 0.5;
  } else if (battleField.terrain === 'melody') {
    if (move.type === 'sound') terrainMult = 1.2;
  }

  let dmg = Math.floor(base * stab * dmgTypeMult * randomFactor * critMult * burnMult * pinchMult * moraibiMult * weatherMult * terrainMult);

  const gasActive = battleField.chemicalGasActive;
  const gasImmune = (poke) => poke.ability === ABILITY.KAGAKUHENKAGASU;

  if (move.skinBoost) dmg = Math.floor(dmg * 1.2);
  if (attacker.ability === ABILITY.RESONANCE && move.type === 'sound') {
    if (!gasActive || gasImmune(attacker)) dmg = Math.floor(dmg * 1.2);
  }
  if (attacker.ability === ABILITY.KYOKKOU && move.type === 'shine') {
    if (!gasActive || gasImmune(attacker)) dmg = Math.floor(dmg * 1.2);
  }
  if (attacker.ability === ABILITY.TECHNICIAN && move.power <= 60) {
    if (!gasActive || gasImmune(attacker)) dmg = Math.floor(dmg * 1.5);
  }
  if (attacker.ability === ABILITY.CHIKARAZUKU) {
    if (!gasActive || gasImmune(attacker)) dmg = Math.floor(dmg * 1.3);
  }
  if (attacker.ability === ABILITY.KATAI_TSUME && move.category === 'physical') {
    if (!gasActive || gasImmune(attacker)) dmg = Math.floor(dmg * 1.3);
  }
  if (attacker.ability === ABILITY.TEKIOURYOKU && (attacker.species.type1 === move.type || attacker.species.type2 === move.type)) {
    if (!gasActive || gasImmune(attacker)) dmg = Math.floor(dmg * 1.5);
  }
  if (attacker.ability === ABILITY.SUNA_NO_CHIKARA && battleField.weather === 'sand' && 
      (move.type === 'rock' || move.type === 'ground' || move.type === 'steel')) {
    if (!gasActive || gasImmune(attacker)) dmg = Math.floor(dmg * 1.3);
  }
  if (attacker.ability === ABILITY.KIREEJI && KIRU_MOVE_IDS.includes(move.id)) {
    if (!gasActive || gasImmune(attacker)) dmg = Math.floor(dmg * 1.5);
  }
  if (attacker.ability === ABILITY.GANJOUAGO && KAMU_MOVE_IDS.includes(move.id)) {
    if (!gasActive || gasImmune(attacker)) dmg = Math.floor(dmg * 1.5);
  }
  if (attacker.ability === ABILITY.MEGALAUNCHER && HADOU_MOVE_IDS.includes(move.id)) {
    if (!gasActive || gasImmune(attacker)) dmg = Math.floor(dmg * 1.5);
  }
  if (attacker.ability === ABILITY.TETSUNOKOBUSHI && KOBUSHI_MOVE_IDS.includes(move.id)) {
    if (!gasActive || gasImmune(attacker)) dmg = Math.floor(dmg * 1.5);
  }
  if (attacker.ability === ABILITY.TOUSOUSHIN && attacker.firstTurn && move.category !== 'status') {
    if (!gasActive || gasImmune(attacker)) {
      dmg = Math.floor(dmg * 1.5);
      attacker.firstTurn = false;
    }
  }

  if (attacker.ability === ABILITY.ENERGY_SOUL && attacker.energyStacks > 0) {
    if (!gasActive || gasImmune(attacker)) {
      const soulBoost = 1 + (attacker.energyStacks * 0.2);
      dmg = Math.floor(dmg * soulBoost);
    }
  }

  if (!ignoreWalls && attacker.ability !== ABILITY.KATAYABURI) {
    const side = defender.side === 'player' ? 'player' : 'cpu';
    const reflectTurns = side === 'player' ? battleField.playerReflect : battleField.cpuReflect;
    const lightScreenTurns = side === 'player' ? battleField.playerLightScreen : battleField.cpuLightScreen;
    if (isPhysical && reflectTurns > 0) {
      dmg = Math.floor(dmg * 0.5);
    }
    if (!isPhysical && lightScreenTurns > 0) {
      dmg = Math.floor(dmg * 0.5);
    }
  }

  if (attacker.ability !== ABILITY.KATAYABURI) {
    if (defender.ability === ABILITY.MULTISCALE && defender.currentHp === defender.maxHp) {
      if (!gasActive || gasImmune(defender)) dmg = Math.floor(dmg * 0.5);
    }
    if (defender.ability === ABILITY.HARD_ROCK && typeMult > 1) {
      if (!gasActive || gasImmune(defender)) dmg = Math.floor(dmg * 0.75);
    }
    if (defender.ability === ABILITY.ATSUI_SHIBOU && (move.type === 'fire' || move.type === 'ice')) {
      if (!gasActive || gasImmune(defender)) dmg = Math.floor(dmg * 0.5);
    }
    if (defender.ability === ABILITY.FAIR_COAT && move.category === 'physical') {
      if (!gasActive || gasImmune(defender)) dmg = Math.floor(dmg * 0.5);
    }
    if (defender.ability === ABILITY.KOORI_NO_RINPUN && move.category === 'special') {
      if (!gasActive || gasImmune(defender)) dmg = Math.floor(dmg * 0.5);
    }
  }

  if (typeMult === 0) dmg = 0;
  if (dmg < 1 && typeMult > 0) dmg = 1;
  return { damage: dmg, typeMult, isCrit };
}

function checkAccuracy(attacker, defender, move) {
  if (move.accuracy === undefined || move.accuracy === null || move.accuracy >= 999) return true;
  if (attacker.ability === ABILITY.NO_GUARD || defender.ability === ABILITY.NO_GUARD) return true;

  const accRank = attacker.ranks.acc;
  const evaRank = defender.ranks.eva;
  const stage = Math.max(-6, Math.min(6, accRank - evaRank));
  let mult = accEvaMultiplier(stage);
  if (attacker.ability === ABILITY.FUKUGAN) mult *= 1.3;
  if (attacker.ability === ABILITY.HARIKIRI) mult *= 0.8;
  const finalAcc = Math.min(100, move.accuracy * mult);
  return rand(1, 100) <= finalAcc;
}

// ---- 状態異常によるターン開始時の行動不能判定 ----
function checkCanMove(poke, logFn) {
  if (poke.ability === ABILITY.SEISHINRYOKU) poke.flinch = false;

  if (poke.flinch) {
    logFn(`${poke.species.name}はひるんで動けなかった！`);
    poke.flinch = false;
    return false;
  }

  if (poke.ability === ABILITY.NAMAKE) {
    if (poke.lazyTurns) {
      logFn(`${poke.species.name}はなまけている…`);
      poke.lazyTurns = false;
      return false;
    } else {
      poke.lazyTurns = true;
    }
  }

  if (poke.status === STATUS.SLEEP) {
    if (poke.sleepTurns > 0) {
      poke.sleepTurns--;
      logFn(`${poke.species.name}は眠っている…`);
      return false;
    } else {
      poke.status = STATUS.NONE;
      logFn(`${poke.species.name}は目を覚ました！`);
    }
  }
  if (poke.status === STATUS.FREEZE) {
    if (rand(1, 100) <= 20) {
      poke.status = STATUS.NONE;
      logFn(`${poke.species.name}の氷が溶けた！`);
    } else {
      logFn(`${poke.species.name}は凍っていて動けない…`);
      return false;
    }
  }
  if (poke.status === STATUS.PARALYZE) {
    if (rand(1, 100) <= 25) {
      logFn(`${poke.species.name}はまひして体が動かない！`);
      return false;
    }
  }
  if (poke.confuseTurns > 0) {
    poke.confuseTurns--;
    if (rand(1, 100) <= 33) {
      const selfDmg = Math.max(1, Math.floor(poke.stats.atk / 8));
      poke.currentHp = Math.max(0, poke.currentHp - selfDmg);
      logFn(`${poke.species.name}は混乱して自分を攻撃した！`, { hit: poke.side });
      if (poke.currentHp <= 0) { poke.fainted = true; logFn(`${poke.species.name}は倒れた！`, { faint: poke.side }); }
      return false;
    }
  }
  return true;
}

// ---- 場の設置技 ----
const hazardState = {
  player: { stealthRock: false, replugTrap: false },
  cpu: { stealthRock: false, replugTrap: false },
};

function resetHazards() {
  hazardState.player.stealthRock = false;
  hazardState.player.replugTrap = false;
  hazardState.cpu.stealthRock = false;
  hazardState.cpu.replugTrap = false;
}

function setHazard(moveId, attackerSide, logFn) {
  const targetSide = attackerSide === 'player' ? 'cpu' : 'player';
  if (moveId === 318) {
    if (hazardState[targetSide].stealthRock) {
      logFn('しかし失敗した！');
      return;
    }
    hazardState[targetSide].stealthRock = true;
    logFn(`相手の足元に岩が浮かんだ！`);
  } else if (moveId === 495) {
    if (hazardState[targetSide].replugTrap) {
      logFn('しかし失敗した！');
      return;
    }
    hazardState[targetSide].replugTrap = true;
    logFn(`相手の場にリプループラグが仕掛けられた！`);
  }
}

function applyHazardsOnSwitchIn(poke, side, logFn) {
  if (poke.fainted) return;
  const hz = hazardState[side];
  if (hz.stealthRock) {
    const defTypes = getEffectiveTypes(poke);
    let mult = 1;
    const chart = GAME_DATA.typeChart['rock'];
    if (chart) {
      for (const t of defTypes) {
        if (chart[t] !== undefined) mult *= chart[t];
      }
    }
    if (mult > 0) {
      const dmg = Math.max(1, Math.floor(poke.maxHp * mult / 8));
      poke.currentHp = Math.max(0, poke.currentHp - dmg);
      logFn(`${poke.species.name}にとがった岩が突き刺さった！`, { hit: side });
      if (poke.currentHp <= 0) {
        poke.currentHp = 0;
        poke.fainted = true;
        logFn(`${poke.species.name}は倒れた！`, { faint: side });
      }
      checkAndTriggerFundo(poke, logFn);
      applyDamageTakenEffects(poke, logFn);
    }
  }
  if (hz.replugTrap && !poke.fainted) {
    const defTypes = getEffectiveTypes(poke);
    const isImmune = defTypes.includes('electric') || defTypes.includes('ground');
    if (isImmune) {
      logFn(`${poke.species.name}にはリプループラグが効かなかった！`);
    } else {
      const dmg = Math.max(1, Math.floor(poke.maxHp / 2));
      poke.currentHp = Math.max(0, poke.currentHp - dmg);
      logFn(`${poke.species.name}はリプループラグでダメージを受けた！`, { hit: side });
      if (poke.currentHp <= 0) {
        poke.currentHp = 0;
        poke.fainted = true;
        logFn(`${poke.species.name}は倒れた！`, { faint: side });
      }
      checkAndTriggerFundo(poke, logFn);
      applyDamageTakenEffects(poke, logFn);
    }
    hz.replugTrap = false;
  }
}

function applyEndOfTurnStatus(poke, logFn) {
  if (poke.fainted) return;

  // バインドダメージ
  if (poke.bindTurns > 0) {
    const dmg = Math.max(1, Math.floor(poke.maxHp / 16));
    poke.currentHp = Math.max(0, poke.currentHp - dmg);
    logFn(`${poke.species.name}はバインドのダメージを受けている…`, { hit: poke.side });
    poke.bindTurns--;
    if (poke.currentHp <= 0) {
      poke.currentHp = 0;
      poke.fainted = true;
      logFn(`${poke.species.name}は倒れた！`, { faint: poke.side });
    }
    if (poke.bindTurns === 0) {
      logFn(`${poke.species.name}のバインドが解けた！`);
    }
  }

  // うつせみダメージ
  if (poke.utsusemiTurns > 0) {
    poke.utsusemiTurns--;
    if (poke.utsusemiTurns === 0 && !poke.fainted) {
      const dmg = Math.max(1, Math.floor(poke.maxHp / 2));
      poke.currentHp = Math.max(0, poke.currentHp - dmg);
      logFn(`${poke.species.name}はうつせみのダメージを受けた！`, { hit: poke.side });
      if (poke.currentHp <= 0) {
        poke.currentHp = 0;
        poke.fainted = true;
        logFn(`${poke.species.name}は倒れた！`, { faint: poke.side });
      }
    }
  }

  if (poke.status === STATUS.POISON) {
    const dmg = Math.max(1, Math.floor(poke.maxHp / 8));
    poke.currentHp = Math.max(0, poke.currentHp - dmg);
    logFn(`${poke.species.name}は毒のダメージを受けている…`, { hit: poke.side });
  } else if (poke.status === STATUS.BADLY_POISON) {
    const dmg = Math.max(1, Math.floor(poke.maxHp * poke.badlyPoisonCounter / 16));
    poke.currentHp = Math.max(0, poke.currentHp - dmg);
    poke.badlyPoisonCounter++;
    logFn(`${poke.species.name}は猛毒のダメージを受けている…`, { hit: poke.side });
  } else if (poke.status === STATUS.BURN) {
    const dmg = Math.max(1, Math.floor(poke.maxHp / 16));
    poke.currentHp = Math.max(0, poke.currentHp - dmg);
    logFn(`${poke.species.name}はやけどのダメージを受けている…`, { hit: poke.side });
  }
  if (poke.currentHp <= 0) { poke.currentHp = 0; poke.fainted = true; logFn(`${poke.species.name}は倒れた！`, { faint: poke.side }); }
  checkAndTriggerFundo(poke, logFn);
  applyDamageTakenEffects(poke, logFn);
  applyMurakke(poke, logFn);
  applyKasoku(poke, logFn);

  if (poke.ability === ABILITY.GYAKUJOU && !poke.gyakujouTriggered && poke.currentHp <= poke.maxHp / 2) {
    poke.gyakujouTriggered = true;
    const rankData = [100, 0, 0, 1, 0, 0, 0, 0];
    applyRankChange(poke, rankData, logFn);
    logFn(`${poke.species.name}のぎゃくじょうが発動！`);
  }

  applyEnergyPermanent(poke, logFn);

  if (poke.tauntTurns > 0) {
    poke.tauntTurns--;
    if (poke.tauntTurns === 0) {
      logFn(`${poke.species.name}の挑発が解けた！`);
    }
  }

  // アンコール
  if (poke.encoreTurns > 0) {
    poke.encoreTurns--;
    if (poke.encoreTurns === 0) {
      logFn(`${poke.species.name}のアンコールが解けた！`);
      poke.encoreMoveId = null;
    }
  }

  // インフェルノのタイプロック解除
  if (poke.typeLockTurns > 0) {
    poke.typeLockTurns--;
    if (poke.typeLockTurns === 0) {
      logFn(`${poke.species.name}のタイプロックが解除された！`);
      poke.typeLockType = null;
    }
  }
}

// ---- ふんど ----
function checkAndTriggerFundo(poke, logFn) {
  if (!poke || poke.fainted) return;
  if (poke.ability === ABILITY.FUNDO && !poke.fundoTriggered && poke.currentHp <= poke.maxHp / 2) {
    poke.fundoTriggered = true;
    const rankData = [100, 1, -1, 1, -1, 1, 1, 0];
    applyRankChange(poke, rankData, logFn);
    logFn(`${poke.species.name}のふんどが発動した！`);
  }
}

// ---- ダメージを受けたときの特性 ----
function applyDamageTakenEffects(poke, logFn) {
  if (!poke || poke.fainted) return;
  if (poke.ability === ABILITY.JIKYUURYOKU) {
    const rankData = [100, 0, 1, 0, 0, 0, 0, 0];
    applyRankChange(poke, rankData, logFn);
    logFn(`${poke.species.name}のじきゅうりょくが発動！`);
  }
  if (poke.ability === ABILITY.KUDAKERU_YOROI) {
    const rankData = [100, 0, -1, 0, 0, 2, 0, 0];
    applyRankChange(poke, rankData, logFn);
    logFn(`${poke.species.name}のくだけるよろいが発動！`);
  }
}

// ---- ムラっけ ----
function applyMurakke(poke, logFn) {
  if (!poke || poke.fainted || poke.ability !== ABILITY.MURAKKE) return;
  const keys = ['atk', 'def', 'spa', 'spd', 'spe', 'acc', 'eva'];
  const shuffled = [...keys].sort(() => Math.random() - 0.5);
  const upKey = shuffled[0];
  const downKey = shuffled[1];
  const upData = [100, 0, 0, 0, 0, 0, 0, 0];
  const downData = [100, 0, 0, 0, 0, 0, 0, 0];
  const idxMap = { atk: 1, def: 2, spa: 3, spd: 4, spe: 5, acc: 6, eva: 7 };
  upData[idxMap[upKey]] = 2;
  downData[idxMap[downKey]] = -1;
  applyRankChange(poke, upData, logFn);
  applyRankChange(poke, downData, logFn);
  logFn(`${poke.species.name}のムラっけが発動！`);
}

// ---- かそく ----
function applyKasoku(poke, logFn) {
  if (!poke || poke.fainted || poke.ability !== ABILITY.KASOKU) return;
  const rankData = [100, 0, 0, 0, 0, 1, 0, 0];
  applyRankChange(poke, rankData, logFn);
  logFn(`${poke.species.name}のかそくが発動！`);
}

// ---- えいきゅうきかん ----
function applyEnergyPermanent(poke, logFn) {
  if (!poke || poke.fainted) return;
  if (poke.ability === ABILITY.ENERGY_PERMANENT) {
    const gasActive = battleField.chemicalGasActive;
    const gasImmune = poke.ability === ABILITY.KAGAKUHENKAGASU;
    if (!gasActive || gasImmune) {
      addEnergyStacks(poke, 1, logFn);
      logFn(`${poke.species.name}のえいきゅうきかんが発動！`);
    }
  }
}

// ---- ゆびをふる ----
let _randomMovePool = null;
function pickRandomMove() {
  if (!_randomMovePool) {
    _randomMovePool = Object.values(GAME_DATA.moves).filter((m) => !m.callRandomMove);
  }
  const src = _randomMovePool[rand(0, _randomMovePool.length - 1)];
  return {
    id: src.id, name: src.name, type: src.type, power: src.power, accuracy: src.accuracy,
    category: src.category, pp: 1, maxPp: 1, priority: 0,
    selfRank: src.selfRank, oppRank: src.oppRank, selfStatus: src.selfStatus, oppStatus: src.oppStatus,
    flinchChance: src.flinchChance || 0,
    drainRatio: src.drainRatio || null, recoilRatio: src.recoilRatio || null,
    selfDestruct: !!src.selfDestruct, chargeTurn: !!src.chargeTurn,
    damageFormula: src.damageFormula || null, callRandomMove: false,
  };
}

// ===========================
// 連続技処理（内部関数）
// ===========================
function executeMultiHit(attacker, defender, move, logFn) {
  const config = MULTI_HIT_MOVES[move.id];
  if (!config) return false;

  const isSkillLink = attacker.ability === ABILITY.SKILL_LINK;
  let hitCount;
  if (isSkillLink) {
    hitCount = config.maxHits;
  } else if (config.fixed) {
    hitCount = config.maxHits;
  } else {
    hitCount = rand(config.minHits, config.maxHits);
  }

  let totalDamage = 0;
  let hitIndex = 0;
  let anyHit = false;

  for (let i = 0; i < hitCount; i++) {
    if (attacker.fainted || defender.fainted) break;
    hitIndex = i + 1;

    let accuracySuccess = true;
    if (!isSkillLink) {
      const acc = (move.id === 229) ? 90 : move.accuracy;
      if (acc !== undefined && acc !== null && acc < 999) {
        if (rand(1, 100) > acc) {
          accuracySuccess = false;
        }
      }
    }
    if (!accuracySuccess) {
      logFn(`${attacker.species.name}の${move.name}は${defender.species.name}に外れた！`);
      break;
    }

    let power = config.basePower;
    if (move.id === 229) {
      power = 20 + (hitIndex - 1) * 20;
    } else if (move.id === 472) {
      power = 10 + (hitIndex - 1) * 5;
    }

    const tempMove = Object.assign({}, move, { power: power });
    const result = calcDamage(attacker, defender, tempMove, logFn);
    const damage = result.damage;
    const typeMult = result.typeMult;
    const isCrit = result.isCrit;

    if (damage === 0 && typeMult === 0) {
      logFn(`${defender.species.name}には効果がないようだ…`);
      break;
    }

    const wasFullHp = defender.currentHp === defender.maxHp;
    let survivedByGanjou = false;
    if (wasFullHp && defender.ability === ABILITY.GANJOU && damage >= defender.currentHp) {
      if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
        survivedByGanjou = true;
      }
    }

    defender.currentHp = Math.max(0, defender.currentHp - damage);
    if (survivedByGanjou) defender.currentHp = 1;
    logFn(`${defender.species.name}に${damage}のダメージ！`, { hit: defender.side, typeMult, moveType: move.type });
    if (isCrit) logFn('急所に当たった！');
    if (typeMult > 1) logFn('効果は抜群だ！');
    else if (typeMult < 1) logFn('効果は今ひとつのようだ…');
    if (survivedByGanjou) logFn(`${defender.species.name}はがんじょうで持ちこたえた！`);

    let suppressSecondary = false;
    if (attacker.ability === ABILITY.CHIKARAZUKU) suppressSecondary = true;
    if (!suppressSecondary) {
      if (move.flinchChance && rand(1, 100) <= move.flinchChance) {
        defender.flinch = true;
      }
      applyStatus(defender, move.oppStatus, logFn, attacker.ability);
    }

    if (move.category === 'physical' && !defender.fainted) {
      if (defender.ability === ABILITY.SEIDENKI && attacker.status === STATUS.NONE && rand(1, 100) <= 30) {
        if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
          applyStatus(attacker, [100, STATUS.PARALYZE], logFn);
        }
      } else if (defender.ability === ABILITY.FUSHOKU_NO_TOGE && attacker.status === STATUS.NONE && rand(1, 100) <= 50) {
        if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
          applyStatus(attacker, [100, STATUS.BADLY_POISON], logFn);
        }
      } else if (defender.ability === ABILITY.HONOO_NO_KARADA && attacker.status === STATUS.NONE && rand(1, 100) <= 30) {
        if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
          applyStatus(attacker, [100, STATUS.BURN], logFn);
        }
      }
    }

    if (defender.currentHp <= 0) {
      defender.fainted = true;
      logFn(`${defender.species.name}は倒れた！`, { faint: defender.side });
      anyHit = true;
      break;
    }
    anyHit = true;
  }

  // ランク変化（selfRank/oppRank）は連続ヒットの回数分ではなく、技を出した時に1回だけ適用する。
  // 相手を倒した一撃であっても技自体は命中しているため、selfRank（自分の能力変化）は発動する。
  if (anyHit && !attacker.fainted) {
    const suppressSecondary = attacker.ability === ABILITY.CHIKARAZUKU;
    if (!suppressSecondary) {
      if (!defender.fainted) applyRankChange(defender, move.oppRank, logFn);
      applyRankChange(attacker, move.selfRank, logFn);
    }
  }

  return true;
}

// ---- 優先度計算 ----
function effectivePriority(attacker, move, defenderFainted) {
  let p = move.priority || 0;
  if (battleField.terrain === 'psychic' && p > 0) return 0;
  
  if (attacker.ability === ABILITY.SONIC_GUARD && p >= 1) {
    return -999;
  }
  
  if (move.id === 501 && battleField.terrain === 'electric') {
    p = Math.max(1, p + 1);
  }
  
  if (attacker.ability === ABILITY.HAYATE_NO_TSUBASA && attacker.currentHp === attacker.maxHp && move.type === 'flying') {
    p = Math.max(1, p + 1);
  }
  if (attacker.ability === ABILITY.ITAZURA_GOKORO && move.category === 'status') {
    p = Math.max(1, p + 1);
  }
  return p;
}

// ---- HPによる威力変動関数 ----
function calcVariablePower(moveId, currentHp, maxHp) {
  const ratio = currentHp / maxHp;
  let power = 0;
  if (moveId === 109) { // きしかいせい
    if (ratio >= 0.7) power = 20;
    else if (ratio >= 0.4) power = 40;
    else if (ratio >= 0.2) power = 80;
    else if (ratio >= 0.1) power = 140;
    else power = 200;
  } else if (moveId === 179) { // 不倶戴天
    if (ratio >= 0.5) power = 10;
    else if (ratio >= 0.3) power = 40;
    else if (ratio >= 0.1) power = 100;
    else if (ratio >= 0.04) power = 150;
    else power = 240;
  }
  return power;
}

// ---- 1ターンの技実行 ----
function executeMove(attacker, defender, move, logFn) {
  // ---- マジックミラー ----
  if (defender.ability === ABILITY.MAGIC_MIRROR && move.category === 'status' && attacker !== defender) {
    logFn(`${defender.species.name}のマジックミラーが発動！${attacker.species.name}に跳ね返した！`);
    const tempAttacker = defender;
    const tempDefender = attacker;
    if (move.id === 318 || move.id === 495) {
      setHazard(move.id, tempAttacker.side, logFn);
    } else {
      if (move.selfRank) applyRankChange(tempAttacker, move.selfRank, logFn);
      if (move.oppRank) applyRankChange(tempAttacker, move.oppRank, logFn);
      if (move.selfStatus) applyStatus(tempAttacker, move.selfStatus, logFn);
      if (move.oppStatus) applyStatus(tempAttacker, move.oppStatus, logFn);
    }
    return;
  }

  // ---- アンコール強制チェック ----
  if (attacker.encoreTurns > 0 && attacker.encoreMoveId !== null) {
    const forcedMove = attacker.moves.find(m => m.id === attacker.encoreMoveId);
    if (forcedMove && forcedMove !== move) {
      logFn(`${attacker.species.name}はアンコールで${forcedMove.name}を強制された！`);
      move = forcedMove;
    }
  }

  // ---- げきりん強制連続使用チェック ----
  if (attacker.gekirinTurns > 0 && attacker.gekirinMoveId !== null) {
    const forcedGekirin = attacker.moves.find(m => m.id === attacker.gekirinMoveId);
    if (forcedGekirin && forcedGekirin !== move) {
      move = forcedGekirin;
    }
  }

  // ---- 挑発チェック ----
  if (attacker.tauntTurns > 0 && move.category === 'status') {
    logFn(`${attacker.species.name}は挑発されていて変化技が出せない！`);
    return;
  }

  // ---- タイプロックチェック ----
  if (attacker.typeLockTurns > 0 && attacker.typeLockType === move.type) {
    logFn(`${attacker.species.name}の${typeJp(move.type)}タイプの技はロックされていて出せない！`);
    return;
  }

  // 挑発・タイプロック等でブロックされず、実際に技を使うことが確定した時点で記録する
  // （アンコール・ひややかパンチ用）。個別分岐でreturnする変化技（リフレクター等）も含めて
  // ここで一元的に記録し、途中の各処理で上書きされても同じ値が入るだけなので問題ない。
  attacker.lastUsedMoveId = move.id;

  // ---- のろわれボディ ----
  if (defender.ability === ABILITY.NOROWARE_BODY && move.category === 'physical' && !defender.fainted) {
    if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
      if (rand(1, 100) <= 30) {
        const unlockable = attacker.moves.filter(m => m && !m.locked);
        if (unlockable.length > 0) {
          const target = pick(unlockable);
          target.locked = true;
          logFn(`${defender.species.name}ののろわれボディ！${attacker.species.name}の${target.name}が封じられた！`);
        }
      }
    }
  }

  // ---- スキン系 ----
  const skinMap = {
    [ABILITY.SKIN_FREEZE]: 'ice',
    [ABILITY.SKIN_ELECTRIC]: 'electric',
    [ABILITY.SKIN_DRAGON]: 'dragon',
    [ABILITY.SKIN_PSYCHIC]: 'psychic',
    [ABILITY.FAIRY_SKIN]: 'fairy',
  };
  if (skinMap[attacker.ability] && move.type === 'normal') {
    move.type = skinMap[attacker.ability];
    move.skinBoost = true;
  }

  let suppressSecondary = false;
  if (attacker.ability === ABILITY.CHIKARAZUKU) suppressSecondary = true;

  // プレッシャー
  if (defender.ability === ABILITY.PRESSURE && move.pp > 0) {
    if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
      move.pp = Math.max(0, move.pp - 1);
    }
  }

  if (move.pp <= 0) {
    logFn(`${attacker.species.name}は技が出せない！`);
    return;
  }
  move.pp--;
  logFn(`${attacker.species.name}の${move.name}！`, { moveUse: attacker.side });

  if (move.callRandomMove) {
    const randomMove = pickRandomMove();
    logFn(`${randomMove.name}が飛び出した！`);
    executeMove(attacker, defender, randomMove, logFn);
    return;
  }

  // ---- であいがしら：使用したら次のターンからロック（交代で解除） ----
  if (move.id === 4) {
    attacker.deaigashiraLocked = true;
  }

  // ---- げきりん：強制連続使用の管理 ----
  if (move.id === 43) {
    if (attacker.gekirinTurns <= 0) {
      // 新規発動：2〜3ターン継続（本ターンを含む）
      attacker.gekirinTurns = rand(2, 3);
      attacker.gekirinMoveId = 43;
    }
    attacker.gekirinTurns--;
    if (attacker.gekirinTurns <= 0) {
      attacker.gekirinMoveId = null;
      // 強制ターン終了後、自分が混乱する
      applyStatus(attacker, [100, STATUS.CONFUSE], logFn);
    }
  }

  // ---- 変化技の特殊処理 ----
  if (move.id === 160) { // おいかぜ
    const side = attacker.side === 'player' ? 'player' : 'cpu';
    if (side === 'player') battleField.tailwindPlayer = 4;
    else battleField.tailwindCpu = 4;
    logFn(`${attacker.species.name}はおいかぜを吹かせた！`);
    return;
  }
  if (move.id === 478) { // きりばらい
    if (attacker.side === 'player') {
      battleField.cpuReflect = 0;
      battleField.cpuLightScreen = 0;
    } else {
      battleField.playerReflect = 0;
      battleField.playerLightScreen = 0;
    }
    hazardState.player.stealthRock = false;
    hazardState.cpu.stealthRock = false;
    logFn(`${attacker.species.name}はきりばらいで場を払った！`);
    return;
  }
  if (move.id === 180) { // テラーバインド
    if (attacker.side === 'player' && defender.side === 'cpu') {
      const unlockable = defender.moves.filter(m => m && !m.locked);
      if (unlockable.length > 0) {
        const target = pick(unlockable);
        target.locked = true;
        logFn(`${defender.species.name}の${target.name}が封じられた！`);
      } else {
        logFn(`しかし、全ての技が既に封じられている！`);
      }
    } else {
      logFn(`テラーバインドはNPCには効果がないようだ…`);
    }
    return;
  }
  if (move.id === 474) { // トリックルーム
    if (battleField.trickRoom) {
      battleField.trickRoom = false;
      battleField.trickRoomTurns = 0;
      logFn(`トリックルームが解除された！`);
    } else {
      battleField.trickRoom = true;
      battleField.trickRoomTurns = 5;
      logFn(`トリックルームが発動した！`);
    }
    return;
  }

  // ---- つみほろぼし (481) ----
  if (move.id === 481) {
    if (!attacker.removedTypes.includes('dark')) {
      attacker.removedTypes.push('dark');
      logFn(`${attacker.species.name}のあくタイプが消滅した！`);
    } else {
      logFn(`しかし、既にあくタイプは消滅している！`);
    }
    // 攻撃技なので、この後ダメージ計算に進む
  }

  // ---- こだまのさけび (491) ----
  if (move.id === 491) {
    if (!attacker.removedTypes.includes('grass')) {
      attacker.removedTypes.push('grass');
      logFn(`${attacker.species.name}のくさタイプが消滅した！`);
    } else {
      logFn(`しかし、既にくさタイプは消滅している！`);
    }
    // 攻撃技なので、この後ダメージ計算に進む
  }

  // ---- ナナイロレーザー (482) ----
  if (move.id === 482) {
    const typeKeys = ['bug','dark','dragon','electric','fairy','fighting','fire','flying','ghost','grass','ground','ice','normal','poison','psychic','rock','steel','water','sound','shine'];
    const newType = typeKeys[rand(0, typeKeys.length - 1)];
    attacker.changedType = newType;
    logFn(`${attacker.species.name}のタイプが${typeJp(newType)}に変わった！`);
    // 攻撃技なので、この後ダメージ計算に進む
  }

  // ---- フィールド設置技 ----
  if (move.id === 486) { setTerrain('grassy', 5, logFn); return; }
  if (move.id === 487) { setTerrain('electric', 5, logFn); return; }
  if (move.id === 488) { setTerrain('psychic', 5, logFn); return; }
  if (move.id === 489) { setTerrain('misty', 5, logFn); return; }
  if (move.id === 490) { setTerrain('melody', 5, logFn); return; }

  // ---- うつせみ (493) ----
  if (move.id === 493) {
    if (defender.utsusemiTurns > 0) {
      logFn(`しかし、既にうつせみがかかっている！`);
    } else {
      defender.utsusemiTurns = 4;
      logFn(`${defender.species.name}はうつせみの術にかかった！`);
    }
    return;
  }

  // ---- アンコール (492) ----
  if (move.id === 492) {
    if (defender.lastUsedMoveId !== null) {
      const lastMove = defender.moves.find(m => m.id === defender.lastUsedMoveId);
      if (lastMove && lastMove.pp > 0) {
        defender.encoreMoveId = defender.lastUsedMoveId;
        defender.encoreTurns = 3;
        logFn(`${defender.species.name}は${lastMove.name}をアンコールされた！`);
      } else {
        logFn(`しかし、相手は技を使っていない！`);
      }
    } else {
      logFn(`しかし、相手は技を使っていない！`);
    }
    return;
  }

  // ---- ひややかパンチ (226) ----
  if (move.id === 226) {
    if (defender.lastUsedMoveId !== null) {
      const targetMove = defender.moves.find(m => m.id === defender.lastUsedMoveId);
      if (targetMove && targetMove.pp > 0) {
        const reduce = Math.min(4, targetMove.pp);
        targetMove.pp -= reduce;
        logFn(`${defender.species.name}の${targetMove.name}のPPが${reduce}減った！`);
      } else {
        logFn(`しかし、相手は技を使っていない！`);
      }
    } else {
      logFn(`しかし、相手は技を使っていない！`);
    }
    // ひややかパンチは物理攻撃なので、ダメージ計算に進む
  }

  // ---- インフェルノ (480) ----
  if (move.id === 480) {
    // 使用後、次のターンにほのおタイプをロック
    attacker.typeLockTurns = 2;
    attacker.typeLockType = 'fire';
    logFn(`${attacker.species.name}は次のターン、ほのおタイプの技が使えなくなる！`);
    // ダメージ計算は通常通り
  }

  // ---- メイルストローム (483) / イルミンスール (484) ----
  // 特別な処理はなし（強力な水/草技として動作）

  // ---- 威力変動技 ----
  let modifiedPower = move.power;
  if (move.id === 109 || move.id === 179) {
    modifiedPower = calcVariablePower(move.id, attacker.currentHp, attacker.maxHp);
    logFn(`${move.name}の威力は${modifiedPower}になった！`);
  }
  if ((move.id === 128 || move.id === 169) && attacker.currentHp <= attacker.maxHp / 2) {
    modifiedPower = move.power * 2;
    logFn(`${move.name}の威力は${modifiedPower}になった！`);
  }

  // ---- 天候・地形による威力変更 ----
  if (move.id === 501 && battleField.terrain === 'electric') {
    modifiedPower = 80; // 基本威力はそのまま、命中は後で
  }
  if (move.id === 502 && battleField.weather === 'rain') {
    modifiedPower = move.power * 2;
    logFn(`${move.name}の威力は${modifiedPower}になった！`);
  }
  if (move.id === 150 && battleField.weather === 'rain') {
    modifiedPower = 180;
    logFn(`${move.name}の威力は${modifiedPower}になった！`);
  }
  if (move.id === 496 && battleField.weather === 'rain') {
    modifiedPower = 120;
    logFn(`${move.name}の威力は${modifiedPower}になった！`);
  }
  if (move.id === 498 && battleField.weather === 'sun') {
    modifiedPower = 130;
    logFn(`${move.name}の威力は${modifiedPower}になった！`);
  }
  if (move.id === 499 && battleField.terrain === 'grassy') {
    modifiedPower = 160;
    logFn(`${move.name}の威力は${modifiedPower}になった！`);
  }
  if (move.id === 59 && battleField.terrain !== 'none') {
    // エルダーバースト：フィールドがあれば必中
  }
  if (move.id === 494 && (defender.status === STATUS.POISON || defender.status === STATUS.BADLY_POISON)) {
    modifiedPower = 150;
    logFn(`${move.name}の威力は${modifiedPower}になった！`);
  }
  if (move.id === 70 && battleField.terrain === 'electric') {
    modifiedPower = 120;
    logFn(`${move.name}の威力は${modifiedPower}になった！`);
  }

  // ---- エルダーバースト (59) フィールドチェック ----
  if (move.id === 59 && battleField.terrain === 'none') {
    logFn(`${defender.species.name}には効果がないようだ…`);
    return;
  }

  // 命中修正
  let modifiedAccuracy = move.accuracy;
  if ((move.id === 501 && battleField.terrain === 'electric') ||
      (move.id === 496 && battleField.weather === 'rain') ||
      (move.id === 498 && battleField.weather === 'sun') ||
      (move.id === 59 && battleField.terrain !== 'none')) {
    modifiedAccuracy = 999;
  }

  // ========== 連続技チェック ==========
  if (MULTI_HIT_MOVES[move.id]) {
    const handled = executeMultiHit(attacker, defender, move, logFn);
    if (handled) {
      if (defender.fainted && !attacker.fainted && defender.ability === ABILITY.YUUBABU) {
        if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
          const burstDmg = Math.max(1, Math.floor(defender.maxHp / 4));
          attacker.currentHp = Math.max(0, attacker.currentHp - burstDmg);
          logFn(`${defender.species.name}のゆうばくが発動！${attacker.species.name}は${burstDmg}のダメージを受けた！`, { hit: attacker.side });
          if (attacker.currentHp <= 0) {
            attacker.fainted = true;
            logFn(`${attacker.species.name}は倒れた！`, { faint: attacker.side });
          }
        }
      }
      if (defender.fainted && !attacker.fainted) {
        if (attacker.ability === ABILITY.JISHINKAJOU) {
          if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) {
            applyRankChange(attacker, [100, 1, 0, 0, 0, 0, 0, 0], logFn);
            logFn(`${attacker.species.name}のじしんかじょうが発動！`);
          }
        }
        if (attacker.ability === ABILITY.AFURERUCHISHIKI) {
          if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) {
            applyRankChange(attacker, [100, 0, 0, 1, 0, 0, 0, 0], logFn);
            logFn(`${attacker.species.name}のあふれるちしきが発動！`);
          }
        }
      }
      checkAndTriggerFundo(attacker, logFn);
      checkAndTriggerFundo(defender, logFn);
      applyDamageTakenEffects(attacker, logFn);
      applyDamageTakenEffects(defender, logFn);
      // 技を使った本人（attacker）のlastUsedMoveIdを記録（アンコール・ひややかパンチ用）
      attacker.lastUsedMoveId = move.id;
      return;
    }
  }

  // ========== 通常技（連続技以外） ==========
  const gasActive = battleField.chemicalGasActive;
  const gasImmune = (poke) => poke.ability === ABILITY.KAGAKUHENKAGASU;

  // チャージ
  if (move.id === 505) {
    if (!gasActive || gasImmune(attacker)) {
      addEnergyStacks(attacker, 3, logFn);
    }
  } else if (ENERGY_CHARGE_MOVE_IDS.includes(move.id)) {
    if ((move.id === 218 || move.id === 334) && attacker.energyStacks > 0) {
      // チャージしない
    } else {
      if (!gasActive || gasImmune(attacker)) {
        addEnergyStacks(attacker, 1, logFn);
      }
    }
  }

  // スタック消費技
  let energyConsumed = 0;
  if (move.id === 218 || move.id === 334) {
    if (attacker.energyStacks >= 2) {
      energyConsumed = consumeEnergyStacks(attacker, logFn);
      if (energyConsumed > 0) {
        modifiedPower += energyConsumed * 20;
        logFn(`${attacker.species.name}は エナジースタック ${energyConsumed} を 全て 消費して わざの 威力が上がった！`);
        if (energyConsumed >= 5) {
          const rankData = [100, 0, 0, 2, 0, 0, 0, 0];
          applyRankChange(attacker, rankData, logFn);
          logFn(`${attacker.species.name}の特攻が2段階上がった！`);
        }
      }
    }
  } else if (move.id === 498) {
    if (attacker.energyStacks > 0) {
      energyConsumed = consumeEnergyStacks(attacker, logFn);
      if (energyConsumed > 0) {
        modifiedPower += energyConsumed * 25;
        logFn(`${attacker.species.name}は エナジースタック ${energyConsumed} を 全て 消費して わざの 威力が上がった！`);
      }
    }
  }

  // レールガン（でんきタイプの攻撃技のみ対象。変化技ではスタックを消費しない）
  if (move.type === 'electric' && move.category !== 'status' && attacker.ability === ABILITY.RAIL_GUN && energyConsumed === 0) {
    if (!gasActive || gasImmune(attacker)) {
      if (attacker.energyStacks > 0) {
        const railConsumed = consumeEnergyStacks(attacker, logFn);
        if (railConsumed > 0) {
          modifiedPower += railConsumed * 30;
          logFn(`${attacker.species.name}のレールガン！ エナジースタック ${railConsumed} を 全て 消費して わざの 威力が上がった！`);
        }
      }
    }
  }

  // ----- 変化技（特殊処理以外） -----
  if (move.category === 'status') {
    if (modifiedAccuracy !== undefined && modifiedAccuracy < 999) {
      if (!checkAccuracy(attacker, defender, { ...move, accuracy: modifiedAccuracy })) {
        logFn(`しかし当たらなかった！`);
        return;
      }
    } else if (!checkAccuracy(attacker, defender, move)) {
      logFn(`しかし当たらなかった！`);
      return;
    }
    if (move.id === 318 || move.id === 495) {
      setHazard(move.id, attacker.side, logFn);
      if (!suppressSecondary) applyRankChange(attacker, move.selfRank, logFn);
      if (!suppressSecondary) applyStatus(attacker, move.selfStatus, logFn);
      return;
    }
    if (move.id === 477) {
      if (!suppressSecondary) applyRankChange(attacker, move.selfRank, logFn);
      if (!suppressSecondary) applyStatus(attacker, move.selfStatus, logFn);
      attacker.pendingSwitchOut = true;
      attacker.batonPass = {
        ranks: { ...attacker.ranks },
        confuseTurns: attacker.confuseTurns || 0,
      };
      return;
    }
    if (move.id === 475) {
      const side = attacker.side === 'player' ? 'player' : 'cpu';
      if (side === 'player') battleField.playerReflect = 5;
      else battleField.cpuReflect = 5;
      logFn(`${attacker.species.name}はリフレクターを張った！`);
      return;
    }
    if (move.id === 476) {
      const side = attacker.side === 'player' ? 'player' : 'cpu';
      if (side === 'player') battleField.playerLightScreen = 5;
      else battleField.cpuLightScreen = 5;
      logFn(`${attacker.species.name}はひかりのかべを張った！`);
      return;
    }
    if (move.id === 485) {
      if (defender.tauntTurns > 0) {
        logFn('しかし失敗した！');
        return;
      }
      defender.tauntTurns = 3;
      logFn(`${defender.species.name}は挑発された！`);
      return;
    }

    if (!suppressSecondary) applyRankChange(attacker, move.selfRank, logFn);
    if (!suppressSecondary) applyRankChange(defender, move.oppRank, logFn);
    if (!suppressSecondary) applyStatus(attacker, move.selfStatus, logFn);
    if (!suppressSecondary) applyStatus(defender, move.oppStatus, logFn, attacker.ability);
    // 技を使った本人（attacker）のlastUsedMoveIdを記録（アンコール・ひややかパンチ用）
    attacker.lastUsedMoveId = move.id;
    return;
  }

  // ----- 攻撃技 -----
  // 命中判定
  const accForCheck = modifiedAccuracy !== undefined ? modifiedAccuracy : move.accuracy;
  if (accForCheck !== undefined && accForCheck !== null && accForCheck < 999) {
    if (!checkAccuracy(attacker, defender, { ...move, accuracy: accForCheck })) {
      logFn(`しかし${defender.species.name}には当たらなかった！`);
      return;
    }
  }

  // タイプ吸収系（実効タイプを使用）
  const absorbType = TYPE_ABSORB_ABILITY_TYPE[defender.ability];
  if (absorbType && move.type === absorbType && attacker.ability !== ABILITY.KATAYABURI) {
    if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
      if (defender.ability === ABILITY.CHIKUDEN) {
        logFn(`${defender.species.name}のちくでんが発動！`);
        applyRankChange(defender, [100, 0, 0, 1, 0, 0, 0, 0], logFn);
      } else if (defender.ability === ABILITY.CHOSUI) {
        logFn(`${defender.species.name}のちょすいが発動！`);
        const healAmt = Math.max(1, Math.floor(defender.maxHp / 4));
        defender.currentHp = Math.min(defender.maxHp, defender.currentHp + healAmt);
        logFn(`${defender.species.name}のHPが回復した！`, { hit: defender.side });
      } else if (defender.ability === ABILITY.MORAIBI) {
        if (!defender.moraibiActive) {
          defender.moraibiActive = true;
          logFn(`${defender.species.name}のもらいびが発動！`);
        }
      } else if (defender.ability === ABILITY.MUSHIYOKE) {
        logFn(`${defender.species.name}のむしよけが発動！`);
        applyRankChange(defender, [100, 0, 1, 0, 0, 0, 0, 0], logFn);
      } else if (defender.ability === ABILITY.SOUSHOKU) {
        logFn(`${defender.species.name}のそうしょくが発動！`);
        applyRankChange(defender, [100, 1, 0, 0, 0, 0, 0, 0], logFn);
      }
      return;
    }
  }

  const moveForCalc = { ...move, power: modifiedPower };
  const { damage, typeMult, isCrit } = calcDamage(attacker, defender, moveForCalc, logFn);
  if (typeMult === 0) {
    logFn(`${defender.species.name}には効果がないようだ…`);
    return;
  }

  const wasFullHp = defender.currentHp === defender.maxHp;
  let survivedByGanjou = false;
  if (wasFullHp && defender.ability === ABILITY.GANJOU && damage >= defender.currentHp) {
    if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
      survivedByGanjou = true;
    }
  }

  const hpBeforeDamage = defender.currentHp;
  defender.currentHp = Math.max(0, defender.currentHp - damage);
  if (survivedByGanjou) defender.currentHp = 1;
  const actualDamageDealt = hpBeforeDamage - defender.currentHp;
  logFn(`${defender.species.name}に${damage}のダメージ！`, { hit: defender.side, typeMult, moveType: move.type });
  if (isCrit) logFn('急所に当たった！');
  if (typeMult > 1) logFn('効果は抜群だ！');
  else if (typeMult < 1) logFn('効果は今ひとつのようだ…');
  if (survivedByGanjou) logFn(`${defender.species.name}はがんじょうで持ちこたえた！`);

  // きずつけボディ
  if (defender.ability === ABILITY.KIZUTSUKEBODY && move.category === 'physical' && !attacker.fainted) {
    if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
      const roughDmg = Math.max(1, Math.floor(attacker.maxHp / 8));
      attacker.currentHp = Math.max(0, attacker.currentHp - roughDmg);
      logFn(`${defender.species.name}のきずつけボディ！${attacker.species.name}はダメージを受けた！`, { hit: attacker.side });
      if (attacker.currentHp <= 0) { attacker.fainted = true; logFn(`${attacker.species.name}は倒れた！`, { faint: attacker.side }); }
    }
  }

  // サンパワー / アイスブレイク
  if (attacker.ability === ABILITY.SUN_POWER && battleField.weather === 'sun' && !attacker.fainted) {
    if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) {
      const selfDmg = Math.max(1, Math.floor(attacker.maxHp / 8));
      attacker.currentHp = Math.max(0, attacker.currentHp - selfDmg);
      logFn(`${attacker.species.name}のサンパワー！自分もダメージを受けた！`, { hit: attacker.side });
      if (attacker.currentHp <= 0) { attacker.fainted = true; logFn(`${attacker.species.name}は倒れた！`, { faint: attacker.side }); }
    }
  }
  if (attacker.ability === ABILITY.ICE_BREAK && battleField.weather === 'snow' && !attacker.fainted) {
    if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) {
      const selfDmg = Math.max(1, Math.floor(attacker.maxHp / 8));
      attacker.currentHp = Math.max(0, attacker.currentHp - selfDmg);
      logFn(`${attacker.species.name}のアイスブレイク！自分もダメージを受けた！`, { hit: attacker.side });
      if (attacker.currentHp <= 0) { attacker.fainted = true; logFn(`${attacker.species.name}は倒れた！`, { faint: attacker.side }); }
    }
  }

  if (move.selfDestruct) {
    attacker.currentHp = 0;
  } else if (move.recoilRatio) {
    if (attacker.ability === ABILITY.HANDOUMUKOU) {
      logFn(`${attacker.species.name}のはんどうむこうが発動！`);
    } else {
      const recoilDmg = Math.max(1, Math.floor(damage * move.recoilRatio));
      attacker.currentHp = Math.max(0, attacker.currentHp - recoilDmg);
      logFn(`${attacker.species.name}は反動でダメージを受けた！`, { hit: attacker.side });
    }
  } else if (move.drainRatio) {
    const healAmt = Math.max(1, Math.floor(actualDamageDealt * move.drainRatio));
    attacker.currentHp = Math.min(attacker.maxHp, attacker.currentHp + healAmt);
    logFn(`${attacker.species.name}は体力を吸い取った！`, { hit: attacker.side });
  }

  // ---- エルダーバースト：フィールド破壊 ----
  if (move.id === 59 && battleField.terrain !== 'none') {
    battleField.terrain = 'none';
    battleField.terrainTurns = 0;
    logFn(`フィールドが破壊された！`);
  }

  // ---- くろしお：バインド付与 ----
  if (move.id === 502 && battleField.weather === 'rain' && !defender.fainted) {
    if (defender.bindTurns === 0) {
      defender.bindTurns = 6;
      logFn(`${defender.species.name}はバインド状態になった！`);
    }
  }

  // ---- むらくもばらい：天気をなしに ----
  if (move.id === 150 && battleField.weather === 'rain') {
    battleField.weather = 'none';
    battleField.weatherTurns = 0;
    logFn(`天気が晴れになった！`);
  }

  if (attacker.currentHp <= 0) {
    attacker.fainted = true;
    logFn(`${attacker.species.name}は倒れた！`, { faint: attacker.side });
  }

  if (defender.currentHp <= 0) {
    defender.fainted = true;
    logFn(`${defender.species.name}は倒れた！`, { faint: defender.side });
    // 相手を倒した場合でも、技自体は命中しているため自分のランク変化（selfRank）は発動する。
    if (!attacker.fainted && !suppressSecondary) {
      applyRankChange(attacker, move.selfRank, logFn);
    }
    if (defender.ability === ABILITY.YUUBABU && !attacker.fainted) {
      if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
        const burstDmg = Math.max(1, Math.floor(defender.maxHp / 4));
        attacker.currentHp = Math.max(0, attacker.currentHp - burstDmg);
        logFn(`${defender.species.name}のゆうばくが発動！${attacker.species.name}は${burstDmg}のダメージを受けた！`, { hit: attacker.side });
        if (attacker.currentHp <= 0) {
          attacker.fainted = true;
          logFn(`${attacker.species.name}は倒れた！`, { faint: attacker.side });
        }
      }
    }
  } else if (!attacker.fainted) {
    if (!suppressSecondary) {
      let flinchChance = move.flinchChance || 0;
      if (attacker.ability === ABILITY.TEN_NO_MEGUMI) flinchChance = Math.min(100, flinchChance * 2);
      if (flinchChance && rand(1, 100) <= flinchChance) defender.flinch = true;
      applyRankChange(defender, move.oppRank, logFn);
      applyRankChange(attacker, move.selfRank, logFn);
      applyStatus(defender, move.oppStatus, logFn, attacker.ability);
    }
    if (move.category === 'physical' && !defender.fainted) {
      if (defender.ability === ABILITY.SEIDENKI && attacker.status === STATUS.NONE && rand(1, 100) <= 30) {
        if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
          applyStatus(attacker, [100, STATUS.PARALYZE], logFn);
        }
      } else if (defender.ability === ABILITY.FUSHOKU_NO_TOGE && attacker.status === STATUS.NONE && rand(1, 100) <= 50) {
        if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
          applyStatus(attacker, [100, STATUS.BADLY_POISON], logFn);
        }
      } else if (defender.ability === ABILITY.HONOO_NO_KARADA && attacker.status === STATUS.NONE && rand(1, 100) <= 30) {
        if (!battleField.chemicalGasActive || defender.ability === ABILITY.KAGAKUHENKAGASU) {
          applyStatus(attacker, [100, STATUS.BURN], logFn);
        }
      }
    }
  }

  // 倒したときの特性
  if (defender.fainted && !attacker.fainted) {
    if (attacker.ability === ABILITY.JISHINKAJOU) {
      if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) {
        applyRankChange(attacker, [100, 1, 0, 0, 0, 0, 0, 0], logFn);
        logFn(`${attacker.species.name}のじしんかじょうが発動！`);
      }
    }
    if (attacker.ability === ABILITY.AFURERUCHISHIKI) {
      if (!battleField.chemicalGasActive || attacker.ability === ABILITY.KAGAKUHENKAGASU) {
        applyRankChange(attacker, [100, 0, 0, 1, 0, 0, 0, 0], logFn);
        logFn(`${attacker.species.name}のあふれるちしきが発動！`);
      }
    }
  }

  checkAndTriggerFundo(attacker, logFn);
  checkAndTriggerFundo(defender, logFn);
  applyDamageTakenEffects(attacker, logFn);
  applyDamageTakenEffects(defender, logFn);

  // 技を使った本人（attacker）のlastUsedMoveIdを記録（アンコール・ひややかパンチ用）
  attacker.lastUsedMoveId = move.id;

  if ((move.id === 3 || move.id === 349 || move.id === 80) && !attacker.fainted) {
    attacker.pendingSwitchOut = true;
  }
}

// ---- ターン処理 ----
// onImmediateSwitch: 交代技（とんぼがえり等）でpendingSwitchOutが立ったポケモンを
// その場で交代させるための非同期コールバック（ui.js側で実装）。
// 呼び出しシグネチャ: onImmediateSwitch(side) -> Promise<新しいアクティブポケモン or null>
// null は「交代できなかった（控えなし／バインド中など）」を意味し、その場合は元のポケモンのまま続行する。
async function runTurn(playerAction, cpuAction, playerPoke, cpuPoke, logFn, onImmediateSwitch) {
  const actions = [];
  if (playerAction.type === 'move') actions.push({ side: 'player', poke: playerPoke, target: cpuPoke, move: playerAction.move });
  if (cpuAction.type === 'move') actions.push({ side: 'cpu', poke: cpuPoke, target: playerPoke, move: cpuAction.move });

  if (battleField.terrain === 'psychic') {
    actions.forEach((a) => {
      if ((a.move.priority || 0) > 0) {
        logFn(`サイコフィールドが　${a.poke.species.name}の先制を　うちけした！`);
      }
    });
  }

  if (battleField.trickRoom) {
    actions.sort((a, b) => {
      const pa = effectivePriority(a.poke, a.move), pb = effectivePriority(b.poke, b.move);
      if (pa !== pb) return pb - pa;
      return effectiveSpeed(a.poke) - effectiveSpeed(b.poke);
    });
  } else {
    actions.sort((a, b) => {
      const pa = effectivePriority(a.poke, a.move), pb = effectivePriority(b.poke, b.move);
      if (pa !== pb) return pb - pa;
      return effectiveSpeed(b.poke) - effectiveSpeed(a.poke);
    });
  }

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (action.poke.fainted || action.target.fainted) continue;
    if (!checkCanMove(action.poke, logFn)) continue;
    executeMove(action.poke, action.target, action.move, logFn);
    if (action.target.fainted || action.poke.fainted) break;

    // とんぼがえり等で交代予約が立った場合、原作同様にここで即座に交代を解決する。
    // まだ実行されていない後続の行動があれば、そのtargetを新しいポケモンに差し替える。
    if (action.poke.pendingSwitchOut && !action.poke.fainted && typeof onImmediateSwitch === 'function') {
      action.poke.pendingSwitchOut = false;
      const newActive = await onImmediateSwitch(action.side);
      if (newActive) {
        for (let j = i + 1; j < actions.length; j++) {
          if (actions[j].poke === action.poke) actions[j].poke = newActive;
          if (actions[j].target === action.poke) actions[j].target = newActive;
        }
        if (action.side === 'player') playerPoke = newActive; else cpuPoke = newActive;
      }
    }
  }

  // このターンの行動機会は既に終了しているため、これ以上消費されずに残ったひるみフラグは
  // 次ターンへ持ち越さずここで破棄する（「先攻に当てたひるみが次のターンに発動する」誤動作を防止）。
  if (!playerPoke.fainted) playerPoke.flinch = false;
  if (!cpuPoke.fainted) cpuPoke.flinch = false;

  [playerPoke, cpuPoke].forEach((p) => { if (!p.fainted) applyEndOfTurnStatus(p, logFn); });
  const alivePokes = [playerPoke, cpuPoke].filter((p) => !p.fainted);
  if (alivePokes.length > 0) applyEndOfTurnField(alivePokes, logFn);
}


// ---- ターン終了時フィールド効果 ----
function applyEndOfTurnField(pokeList, logFn) {
  if (battleField.weather === 'sand') {
    pokeList.forEach((poke) => {
      if (poke.fainted) return;
      const defTypes = getEffectiveTypes(poke);
      const immune = defTypes.includes('rock') || defTypes.includes('ground') || defTypes.includes('steel');
      if (!immune) {
        const dmg = Math.max(1, Math.floor(poke.maxHp / 16));
        poke.currentHp = Math.max(0, poke.currentHp - dmg);
        logFn(`${poke.species.name}は　すなあらしの　ダメージを受けている…`, { hit: poke.side });
        if (poke.currentHp <= 0) { poke.currentHp = 0; poke.fainted = true; logFn(`${poke.species.name}は倒れた！`, { faint: poke.side }); }
        checkAndTriggerFundo(poke, logFn);
        applyDamageTakenEffects(poke, logFn);
      }
    });
  }
  if (battleField.terrain === 'grassy') {
    pokeList.forEach((poke) => {
      if (poke.fainted) return;
      const heal = Math.max(1, Math.floor(poke.maxHp / 16));
      poke.currentHp = Math.min(poke.maxHp, poke.currentHp + heal);
      logFn(`${poke.species.name}は　グラスフィールドで　HPが回復した！`, { hit: poke.side });
    });
  }
  if (battleField.weather === 'rain') {
    pokeList.forEach((poke) => {
      if (poke.fainted || poke.ability !== ABILITY.AMEUKEZARA || poke.currentHp >= poke.maxHp) return;
      const heal = Math.max(1, Math.floor(poke.maxHp / 16));
      poke.currentHp = Math.min(poke.maxHp, poke.currentHp + heal);
      logFn(`${poke.species.name}のあめうけざらでHPが回復した！`, { hit: poke.side });
    });
  }

  if (battleField.weather !== 'none') {
    battleField.weatherTurns--;
    if (battleField.weatherTurns <= 0) {
      const endMsg = {
        sun: 'ひざしが　もとに戻った。',
        rain: 'あめが　やんだ。',
        sand: 'すなあらしが　おさまった。',
        snow: 'ゆきが　やんだ。',
        starrysky: 'ほしの　またたきが　おさまった。',
      }[battleField.weather];
      battleField.weather = 'none';
      if (endMsg) logFn(endMsg);
    }
  }
  if (battleField.terrain !== 'none') {
    battleField.terrainTurns--;
    if (battleField.terrainTurns <= 0) {
      battleField.terrain = 'none';
      logFn('フィールドの　効果が　きえた。');
    }
  }

  if (battleField.playerReflect > 0) {
    battleField.playerReflect--;
    if (battleField.playerReflect === 0) logFn('自分のリフレクターが消えた！');
  }
  if (battleField.playerLightScreen > 0) {
    battleField.playerLightScreen--;
    if (battleField.playerLightScreen === 0) logFn('自分のひかりのかべが消えた！');
  }
  if (battleField.cpuReflect > 0) {
    battleField.cpuReflect--;
    if (battleField.cpuReflect === 0) logFn('相手のリフレクターが消えた！');
  }
  if (battleField.cpuLightScreen > 0) {
    battleField.cpuLightScreen--;
    if (battleField.cpuLightScreen === 0) logFn('相手のひかりのかべが消えた！');
  }

  if (battleField.tailwindPlayer > 0) {
    battleField.tailwindPlayer--;
    if (battleField.tailwindPlayer === 0) logFn('プレイヤー側のおいかぜが止んだ！');
  }
  if (battleField.tailwindCpu > 0) {
    battleField.tailwindCpu--;
    if (battleField.tailwindCpu === 0) logFn('相手側のおいかぜが止んだ！');
  }

  if (battleField.trickRoom) {
    battleField.trickRoomTurns--;
    if (battleField.trickRoomTurns <= 0) {
      battleField.trickRoom = false;
      logFn('トリックルームの効果が切れた！');
    }
  }
}

// ---- CPU AI ----
function weatherTerrainScoreMult(moveType, moveId) {
  let mult = 1.0;
  if (battleField.weather === 'sun') {
    if (moveType === 'fire') mult *= 1.5;
    else if (moveType === 'water') mult *= 0.5;
  } else if (battleField.weather === 'rain') {
    if (moveType === 'water') mult *= 1.5;
    else if (moveType === 'fire') mult *= 0.5;
  } else if (battleField.weather === 'starrysky') {
    if (moveType === 'ghost' || moveType === 'psychic' || moveType === 'steel') mult *= 1.3;
    else if (moveType === 'shine') mult *= 0.5;
    if (STARRY_SKY_BOOST_MOVE_IDS.includes(moveId)) mult *= 1.2;
  }
  if (battleField.terrain === 'grassy') {
    if (moveType === 'grass') mult *= 1.3;
    if (GRASSY_HALVED_MOVE_IDS.includes(moveId)) mult *= 0.5;
  } else if (battleField.terrain === 'electric') {
    if (moveType === 'electric') mult *= 1.3;
  } else if (battleField.terrain === 'psychic') {
    if (moveType === 'psychic') mult *= 1.3;
  } else if (battleField.terrain === 'misty') {
    if (moveType === 'dragon') mult *= 0.5;
  } else if (battleField.terrain === 'melody') {
    if (moveType === 'sound') mult *= 1.2;
  }
  return mult;
}

function chooseCpuAction(cpuPoke, playerPoke) {
  const usable = cpuPoke.moves.filter((m) => m.pp > 0 && !m.locked && !(m.id === 4 && cpuPoke.deaigashiraLocked));
  if (usable.length === 0) return { type: 'move', move: cpuPoke.moves.find(m => m.pp > 0) || cpuPoke.moves[0] };

  // げきりん強制連続使用
  if (cpuPoke.gekirinTurns > 0 && cpuPoke.gekirinMoveId !== null) {
    const forcedGekirin = cpuPoke.moves.find(m => m.id === cpuPoke.gekirinMoveId);
    if (forcedGekirin && forcedGekirin.pp > 0 && !forcedGekirin.locked) {
      return { type: 'move', move: forcedGekirin };
    }
  }

  // アンコール強制
  if (cpuPoke.encoreTurns > 0 && cpuPoke.encoreMoveId !== null) {
    const forced = cpuPoke.moves.find(m => m.id === cpuPoke.encoreMoveId);
    if (forced && forced.pp > 0 && !forced.locked) {
      return { type: 'move', move: forced };
    }
  }

  const best = chooseTrainerAttack(cpuPoke, playerPoke, usable);
  return { type: 'move', move: best };
}

/* =========================================================================
   高度なCPU/野生AI（マイクラ版 pokedrock.js の chooseTrainerAttack を移植）
   -------------------------------------------------------------------------
   元実装は Minecraft Bedrock のエンティティ/タグ/動的プロパティを直接参照する
   コードだったため、データ取得部分のみこのゲームの battleField / poke オブジェクト
   構造に翻訳し、スコアリングの判断基準はそのまま踏襲している。
   技IDは原作と共通の体系（例: 485=ちょうはつ, 318=ステルスロック）なので、
   個別技の分岐はIDそのまま利用できる。
   ========================================================================= */

// ウェザーボール(503)・だいちのはどう(504) の実効タイプを、天候/フィールドの
// 現在の状態から解決する。対象外の技はそのままの固定タイプを返す。
function resolveEffectiveMoveType(move, battleField) {
  if (move.id === 503) {
    const map = { sun: 'fire', rain: 'water', snow: 'ice', sand: 'rock', starrysky: 'ghost' };
    return map[battleField.weather] || move.type;
  }
  if (move.id === 504) {
    const map = { electric: 'electric', grassy: 'grass', misty: 'fairy', psychic: 'psychic', melody: 'sound' };
    return map[battleField.terrain] || move.type;
  }
  return move.type;
}

const HYPNOSIS_MOVE_ID = 293; // ねむり付与技の代表ID（実際の効果は applyMoveEffects 側で処理済み。ここは優先度スコア用の目印）

// AI評価用：連続技（複数回ヒットする技）の実質威力上書き。
// 原作のオーバーライド値をそのまま踏襲（該当技がない場合は無害）。
const _AI_MULTI_HIT_POWER_OVERRIDE = {
  472: 100, 48: 80, 309: 80, 189: 80, 461: 80, 388: 150, 367: 100,
};

function isDamagingMoveAI(move) {
  return move.category !== 'status' && (move.power || 0) > 0;
}

// 技IDから { chance, ranks:[atk,def,spa,spd,spe,acc,eva] } 形式を取り出す
// (gamedata.js の selfRank/oppRank は [chance, atk, def, spa, spd, spe, acc, eva] の配列形式)
function getSelfBoostAI(move) {
  if (!move.selfRank) return null;
  const r = move.selfRank;
  const target = (move.oppRankTarget === true) ? 'opp' : 'self'; // このゲームのselfRankは常に自分対象
  return { chance: r[0] || 0, ranks: r, target };
}
function getOppBoostAI(move) {
  if (!move.oppRank) return null;
  const r = move.oppRank;
  return { chance: r[0] || 0, ranks: r, target: 'opp' };
}
function getOppStatusEffectAI(move) {
  return move.oppStatus ? { chance: move.oppStatus[0] || 0, status: move.oppStatus[1] } : null;
}

// ranks配列 [chance, atk, def, spa, spd, spe, acc, eva] とcur(ranksオブジェクト)を比較し、
// 「上げようとしている/下げようとしている能力が、対象側で軒並み最大/最小に達している」かを判定
const RANK_KEYS_AI = ['atk', 'def', 'spa', 'spd', 'spe', 'acc', 'eva'];
function ranksAtMaxAI(ranksArr, curRanksObj) {
  let anyBoost = false, allMaxed = true;
  for (let i = 0; i < 7; i++) {
    const delta = ranksArr[i + 1] || 0;
    const key = RANK_KEYS_AI[i];
    const cur = (curRanksObj && curRanksObj[key]) || 0;
    if (delta > 0) {
      anyBoost = true;
      if (cur < 6) allMaxed = false;
    } else if (delta < 0) {
      anyBoost = true;
      if (cur > -6) allMaxed = false;
    }
  }
  return anyBoost && allMaxed;
}

// ダメージの最大乱数(1.0倍)見積もり。damage()本体と近い簡易式で、AIの選択比較専用。
function estimateMaxDamageAI(attacker, move, defender, atkTypes, mult) {
  if (!defender || !isDamagingMoveAI(move)) return 0;
  if (mult == null) mult = 1;
  if (mult === 0) return 0;
  const isSpecial = move.category === 'special';
  const atkStatKey = isSpecial ? 'spa' : 'atk';
  const defStatKey = isSpecial ? 'spd' : 'def';
  let atkVal = attacker.stats[atkStatKey];
  let atkRank = attacker.ranks[atkStatKey];
  // クリアカード/イカサマ相当（このゲームのdamageFormulaで表現されている場合はそちらを優先）
  if (move.damageFormula === 'useOppSpAtk') { atkVal = defender.stats.spa; atkRank = defender.ranks.spa; }
  if (move.damageFormula === 'useOppAtk') { atkVal = defender.stats.atk; atkRank = defender.ranks.atk; }
  const defVal = defender.stats[defStatKey];
  const defRank = defender.ranks[defStatKey];
  const effAtk = atkVal * rankMultiplier(atkRank);
  const effDef = defVal * rankMultiplier(defRank);
  let power = _AI_MULTI_HIT_POWER_OVERRIDE[move.id] ?? (move.power || 0);
  // きしかいせい(109)／不倶戴天(179)：残りHP割合による威力補正（damage()本体と同じ基準）
  if (move.id === 109 || move.id === 179) {
    const remRatio = attacker.maxHp > 0 ? attacker.currentHp / attacker.maxHp : 1;
    if (move.id === 109) {
      if (remRatio <= 0.09) power *= 10;
      else if (remRatio <= 0.10) power *= 7;
      else if (remRatio <= 0.20) power *= 4;
      else if (remRatio <= 0.40) power *= 2;
    } else {
      if (remRatio <= 0.03) power *= 24;
      else if (remRatio <= 0.04) power *= 15;
      else if (remRatio <= 0.10) power *= 10;
      else if (remRatio <= 0.30) power *= 4;
    }
  }
  const effType = resolveEffectiveMoveType(move, battleField);
  const stab = atkTypes.includes(effType) ? 1.5 : 1;
  const lv = attacker.level || 100;
  return 0.01 * stab * mult * 100 * ((0.2 * lv + 1) * effAtk * power / (25 * effDef) + 2);
}
// 先制技の確実KO判定用：最低乱数(0.85倍)でのダメージ
function estimateMinDamageAI(attacker, move, defender, atkTypes, mult) {
  return estimateMaxDamageAI(attacker, move, defender, atkTypes, mult) * 0.85;
}

// フィールド設置技(グラス/エレキ/サイコ/ミスト/メロディ)：moveId → { terrainKey, moveType }
const _FIELD_SET_MOVE_INFO_AI = {
  486: { terrainKey: 'grassy', moveType: 'grass' },
  487: { terrainKey: 'electric', moveType: 'electric' },
  488: { terrainKey: 'psychic', moveType: 'psychic' },
  489: { terrainKey: 'misty', moveType: 'fairy' },
  490: { terrainKey: 'melody', moveType: 'sound' },
};
// 持ち技リストの中に、指定タイプの「攻撃技」が他に存在するか
function _hasOtherAttackOfTypeAI(usableMoves, moveType, excludeMoveId) {
  return usableMoves.some((m) => m.id !== excludeMoveId && m.type === moveType && isDamagingMoveAI(m));
}

// 特性によるタイプ無効化（吸収系特性＋ふゆう）を判定する。
// 既存の TYPE_ABSORB_ABILITY_TYPE（ちくでん/ちょすい/もらいび/むしよけ/そうしょく）と
// ABILITY.FUYU（じめん技無効、ただしはかいこうせん等の貫通特性は考慮しない簡易判定）を利用。
function isAbilityTypeImmuneAI(moveType, ability) {
  if (ability === ABILITY.FUYU && moveType === 'ground') return true;
  return TYPE_ABSORB_ABILITY_TYPE[ability] === moveType;
}

// 原作 chooseTrainerAttack の移植版。シングルバトル専用（このゲームはダブルバトル非対応）。
function chooseTrainerAttack(attacker, defender, usableMoves) {
  const defTypes = getEffectiveTypes(defender);
  if (!defTypes || defTypes.length === 0) {
    return usableMoves[Math.floor(Math.random() * usableMoves.length)];
  }
  const atkTypes = getEffectiveTypes(attacker);
  const oppCurHp = defender.currentHp;
  const oppStatusVal = defender.status || STATUS.NONE;
  const oppRanks = defender.ranks;

  let scored = [];
  for (const move of usableMoves) {
    let score = 0, blocked = false;

    // ちょうはつ(485)：相手が変化技を選ぶと読める時だけ最優先。既にちょうはつ状態同士なら使わない。
    if (move.id === 485) {
      const alreadyTaunted = (attacker.tauntTurns || 0) > 0;
      const oppAlreadyTaunted = (defender.tauntTurns || 0) > 0;
      // プレイヤー操作の技を事前に知る手段がないため、「相手の技が全て変化技寄り」かどうかでは判定できない。
      // 原作は「相手が選んだ技」を参照できたが、このゲームでは選択前に評価する必要があるため、
      // 相手の変化技所持率が高い（＝5割以上）場合を "変化技を選びがち" とみなして優先させる。
      const oppMoves = (defender.moves || []).filter((m) => m.pp > 0);
      const oppStatusMoveRatio = oppMoves.length
        ? oppMoves.filter((m) => m.category === 'status').length / oppMoves.length : 0;
      if (alreadyTaunted || oppAlreadyTaunted || oppStatusMoveRatio < 0.5) {
        scored.push([move, -99, -1]);
        continue;
      } else {
        scored.push([move, 9, -1]);
        continue;
      }
    }

    // ちょうはつ中は変化技を選択肢から除外
    if ((attacker.tauntTurns || 0) > 0 && move.category === 'status') blocked = true;
    // アンコール中はアンコールされた技以外を除外（呼び出し元で既にフィルタ済みだが二重チェック）
    if ((attacker.encoreTurns || 0) > 0 && attacker.encoreMoveId && move.id !== attacker.encoreMoveId) blocked = true;
    // うつせみ：むしタイプ技使用不可状態なら除外
    if (attacker.utsusemiMoveLock && move.type === 'bug') blocked = true;

    const effType = resolveEffectiveMoveType(move, battleField);
    // 特性によるタイプ無効化（ちくでん/ちょすい/もらいび/むしよけ/そうしょく/ふゆう）：
    // 無効化される攻撃技は選ばれにくくする（ダメージ技として全く機能しないため）
    if (isDamagingMoveAI(move) && isAbilityTypeImmuneAI(effType, defender.ability)) blocked = true;
    const mult = getTypeEffectiveness(effType, defTypes[0], defTypes[1]);
    if (mult === 0) blocked = true;

    // マジックミラー：相手がこの特性を持つ場合、自分に向けた変化技は跳ね返されて自分が不利益を受けるため使わない
    if (!blocked && move.category === 'status' && defender.ability === ABILITY.MAGIC_MIRROR) blocked = true;

    const oppStatusEff = getOppStatusEffectAI(move);
    if (!blocked && oppStatusEff && oppStatusVal !== STATUS.NONE) blocked = true;

    const selfBoost = getSelfBoostAI(move);
    const oppBoostEff = getOppBoostAI(move);
    if (!blocked && selfBoost && selfBoost.target === 'self' && ranksAtMaxAI(selfBoost.ranks, attacker.ranks)) blocked = true;
    if (!blocked && oppBoostEff && oppRanks && ranksAtMaxAI(oppBoostEff.ranks, oppRanks)) blocked = true;

    // ステルスロック(318)：相手の場に既にあるなら除外
    if (!blocked && move.id === 318) {
      const side = attacker.side === 'player' ? 'cpu' : 'player';
      if (hazardState[side] && hazardState[side].stealthRock) blocked = true;
    }
    // トリックルーム(474系):既にかかっているなら除外
    if (!blocked && move.id === 474 && battleField.trickRoom) blocked = true;
    // リフレクター(475)：自分の場に既にあるなら除外
    if (!blocked && move.id === 475) {
      const already = attacker.side === 'player' ? battleField.playerReflect : battleField.cpuReflect;
      if (already > 0) blocked = true;
    }
    // ひかりのかべ(476)：自分の場に既にあるなら除外
    if (!blocked && move.id === 476) {
      const already = attacker.side === 'player' ? battleField.playerLightScreen : battleField.cpuLightScreen;
      if (already > 0) blocked = true;
    }
    // おいかぜ(160)：自分の場に既にあるなら除外
    if (!blocked && move.id === 160) {
      const already = attacker.side === 'player' ? battleField.tailwindPlayer : battleField.tailwindCpu;
      if (already > 0) blocked = true;
    }
    // エルダーバースト(59)・有刺鉄線(500)：フィールドが無いなら除外
    if (!blocked && (move.id === 59 || move.id === 500)) {
      if (!battleField.terrain || battleField.terrain === 'none') blocked = true;
    }
    // フィールド設置技(486〜490)：対応フィールドが既に張られているなら除外
    if (!blocked && _FIELD_SET_MOVE_INFO_AI[move.id]) {
      if (battleField.terrain === _FIELD_SET_MOVE_INFO_AI[move.id].terrainKey) blocked = true;
    }
    // サイコフィールド中：優先度+1以上の技は必ず失敗する
    if (!blocked && (move.priority || 0) >= 1 && battleField.terrain === 'psychic') blocked = true;
    // ソニックガード：相手がこの特性を持つ場合、優先度+1以上の技は無効
    if (!blocked && (move.priority || 0) >= 1 && defender.ability === ABILITY.SONIC_GUARD) blocked = true;

    if (blocked) {
      scored.push([move, -99, -1]);
      continue;
    }

    const isDamaging = isDamagingMoveAI(move);
    const isPriority = (move.priority || 0) > 0;
    const dmg = isDamaging ? estimateMaxDamageAI(attacker, move, defender, atkTypes, mult) : 0;
    const canKO = isDamaging && oppCurHp != null && dmg >= oppCurHp;
    const minDmg = isDamaging && isPriority ? estimateMinDamageAI(attacker, move, defender, atkTypes, mult) : 0;
    const canKOGuaranteed = isDamaging && isPriority && oppCurHp != null && minDmg >= oppCurHp;
    const isBoostMove = selfBoost && selfBoost.target === 'self' &&
      ((selfBoost.ranks[1] || 0) > 0 || (selfBoost.ranks[3] || 0) > 0) && // 自分の攻撃or特攻を上げる技
      !isDamaging; // 攻撃技についでにランクが上がるタイプ(例:インファイト)は「積み技」として扱わない

    // ステルスロック：未設置なら最優先(+9)
    if (move.id === 318) { score += 9; }
    // トリックルーム/リフレクター/ひかりのかべ/おいかぜ：未設置なら+2
    else if ([474, 475, 476, 160].includes(move.id)) { score += 2; }
    // フィールド技：対応タイプの攻撃技を他に持つ場合のみ+2、持たない場合は-4
    else if (_FIELD_SET_MOVE_INFO_AI[move.id]) {
      score += _hasOtherAttackOfTypeAI(usableMoves, _FIELD_SET_MOVE_INFO_AI[move.id].moveType, move.id) ? 2 : -4;
    }
    // あさなぎ(498)：ひでり(sun)の時のみ使う
    else if (move.id === 498) {
      score += battleField.weather === 'sun' ? 4 : -4;
    }
    // ハリケーン(496)・黒潮(502)：あめ(rain)の時のみ使う
    else if ([496, 502].includes(move.id)) {
      score += battleField.weather === 'rain' ? 4 : -4;
    }
    // ゆびをふる(479)：自分の持ち技に相手への有効打(等倍以上)が一つも無い時、優先的に使う
    else if (move.id === 479) {
      const noEffectiveHit = usableMoves.every((other) => {
        if (other.id === 479) return true;
        if (!isDamagingMoveAI(other)) return true;
        const otherEffType = resolveEffectiveMoveType(other, battleField);
        const otherMult = getTypeEffectiveness(otherEffType, defTypes[0], defTypes[1]);
        return otherMult < 1;
      });
      if (noEffectiveHit) { score += 3; }
    }
    // くろいきり(239)：自分の能力ランクいずれかが-2以下なら+2
    else if (move.id === 239 && Object.values(attacker.ranks).some((r) => (r || 0) <= -2)) { score += 2; }
    else if (isPriority && canKOGuaranteed) score += 6;
    else if (move.id === HYPNOSIS_MOVE_ID && oppStatusVal === STATUS.NONE) score += 5;
    else if (isDamaging && canKO && !isPriority) score += 4;
    else if (isDamaging && canKO && isPriority) score += 4;
    if (move.id !== 318 && isPriority && !canKOGuaranteed) score -= 2;
    else if (isBoostMove) {
      // 積み技：積んだ後に他のダメージ技で確定KOできる状況になるなら+3
      const atkDelta = (selfBoost.ranks[1] || 0), spAtkDelta = (selfBoost.ranks[3] || 0);
      const newAtkRank = Math.max(-6, Math.min(6, attacker.ranks.atk + atkDelta));
      const newSpAtkRank = Math.max(-6, Math.min(6, attacker.ranks.spa + spAtkDelta));
      const boostedAtk = attacker.stats.atk * rankMultiplier(newAtkRank);
      const boostedSpAtk = attacker.stats.spa * rankMultiplier(newSpAtkRank);
      let canKoAfter = false;
      for (const other of usableMoves) {
        if (other.id === move.id) continue;
        if (!isDamagingMoveAI(other)) continue;
        const otherMult = getTypeEffectiveness(other.type, defTypes[0], defTypes[1]);
        if (otherMult === 0) continue;
        const otherIsSpecial = other.category === 'special';
        if (otherIsSpecial && spAtkDelta === 0) continue;
        if (!otherIsSpecial && atkDelta === 0) continue;
        const boostedAtkVal = otherIsSpecial ? boostedSpAtk : boostedAtk;
        const defStatKey = otherIsSpecial ? 'spd' : 'def';
        const effDef = defender.stats[defStatKey] * rankMultiplier(defender.ranks[defStatKey]);
        const power = other.power || 0;
        const stab = atkTypes.includes(other.type) ? 1.5 : 1;
        const lv = attacker.level || 100;
        const otherDmg = 0.01 * stab * otherMult * 100 * ((0.2 * lv + 1) * boostedAtkVal * power / (25 * effDef) + 2);
        if (oppCurHp != null && otherDmg >= oppCurHp) { canKoAfter = true; break; }
      }
      if (canKoAfter) score += 3;
    }

    if (score === 0 && isDamaging) score = 1;
    if (isDamaging && mult < 1 && mult > 0) score -= 3;
    scored.push([move, score, isDamaging ? dmg : -1]);
  }

  if (scored.length === 0) return usableMoves[Math.floor(Math.random() * usableMoves.length)];

  // 攻撃技が全て「いまひとつ以下」の場合の救済処理
  const allDamagingIneffective = usableMoves.some((m) => isDamagingMoveAI(m)) &&
    usableMoves.every((m) => {
      if (!isDamagingMoveAI(m)) return true;
      const effType = resolveEffectiveMoveType(m, battleField);
      const mult = getTypeEffectiveness(effType, defTypes[0], defTypes[1]);
      return mult < 1;
    });
  if (allDamagingIneffective) {
    const fingerFlick = usableMoves.find((m) => m.id === 479);
    if (fingerFlick) return fingerFlick;
    const dmgCandidates = scored.filter(([m, sc, dmg]) => isDamagingMoveAI(m) && dmg >= 0);
    if (dmgCandidates.length > 0) {
      const maxDmg = Math.max(...dmgCandidates.map(([, , dmg]) => dmg));
      const bestDmgMoves = dmgCandidates.filter(([, , dmg]) => dmg === maxDmg).map(([m]) => m);
      return bestDmgMoves[Math.floor(Math.random() * bestDmgMoves.length)];
    }
  }

  // NaN対策の防御的フォールバック
  const safeScored = scored.map(([m, sc, dmg]) => [m, Number.isFinite(sc) ? sc : -99, Number.isFinite(dmg) ? dmg : -1]);
  const bestScore = Math.max(...safeScored.map(([, sc]) => sc));
  const topTier = safeScored.filter(([, sc]) => sc === bestScore);
  const maxDmg = topTier.length ? Math.max(...topTier.map(([, , dmg]) => dmg)) : -1;
  const bestMoves = topTier.filter(([, , dmg]) => dmg === maxDmg).map(([m]) => m);
  return bestMoves.length ? bestMoves[Math.floor(Math.random() * bestMoves.length)] : usableMoves[Math.floor(Math.random() * usableMoves.length)];
}