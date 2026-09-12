// ============================================================
// typefx.js — タイプ別 Canvas パーティクルエフェクト
// sprite-slot (position:relative) の中に一時的に <canvas> を差し込み、
// requestAnimationFrame でパーティクルを描画、アニメーション終了後に
// 要素を自動削除する。ui.js の playTypeEffect(side, moveType) から呼ばれる。
// gamedata.js / engine.js のロジックには一切依存しない、純粋な演出モジュール。
// ============================================================

(function (global) {
  'use strict';

  // ---- 汎用ユーティリティ ----
  function rand(min, max) { return min + Math.random() * (max - min); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInCubic(t) { return t * t * t; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgba(hex, a) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }

  // ============================================================
  // パーティクル基底クラス：各タイプの spawn 関数が生成する単純なオブジェクト
  // { x, y, vx, vy, life, maxLife, draw(ctx, t) } を配列で管理し、
  // 毎フレーム update → draw する共通ランナー。
  // ============================================================
  function runParticleScene({ canvas, durationMs, spawn, background }) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const particles = [];
    spawn(particles, w, h);

    return new Promise((resolve) => {
      const start = performance.now();
      function frame(now) {
        const elapsed = now - start;
        const t = clamp01(elapsed / durationMs);
        ctx.clearRect(0, 0, w, h);
        if (background) background(ctx, w, h, t);
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          const pt = clamp01((elapsed - (p.delay || 0)) / (p.maxLife || durationMs));
          if (elapsed < (p.delay || 0)) continue;
          p.update && p.update(pt, elapsed);
          p.draw(ctx, pt);
        }
        if (elapsed < durationMs) {
          requestAnimationFrame(frame);
        } else {
          ctx.clearRect(0, 0, w, h);
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  // ============================================================
  // タイプ別シーン定義
  // 各関数は (particles配列, w, h) を受け取り、パーティクルを push する。
  // 中心 (w/2, h/2) がポケモンの中心とみなす。
  // 各タイプごとに「通常版」と「豪華版（威力90超）」の2つを専用設計する。
  // ============================================================

  // ---- むし (bug)：鋭い緑の切り裂き線 + 舞う葉 ----
  function spawnBug(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    // 交差する斬撃ライン
    for (let i = 0; i < 3; i++) {
      const angle = rand(-0.5, 0.5) + i * 0.35 - 0.35;
      particles.push({
        delay: i * 60,
        maxLife: 260,
        draw(ctx, t) {
          const len = Math.max(w, h) * 0.9;
          const a = angle;
          const prog = easeOutCubic(t);
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(a);
          const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
          ctx.strokeStyle = rgba('#8fd13f', alpha);
          ctx.lineWidth = 5 * (1 - t * 0.4);
          ctx.shadowColor = rgba('#c8ff6e', 0.9);
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.moveTo(-len / 2 * prog, 0);
          ctx.lineTo(len / 2 * prog, 0);
          ctx.stroke();
          ctx.restore();
        }
      });
    }
    // 舞う葉のかけら
    for (let i = 0; i < 10; i++) {
      const a0 = rand(0, Math.PI * 2);
      const dist = rand(10, Math.max(w, h) * 0.4);
      particles.push({
        delay: rand(0, 120),
        maxLife: rand(360, 520),
        rot: rand(0, Math.PI * 2),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = cx + Math.cos(a0) * dist * e;
          const y = cy + Math.sin(a0) * dist * e - e * 14;
          const alpha = 1 - t;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 4);
          ctx.fillStyle = rgba(pick(['#7fc93f', '#a8e063', '#4f9d2a']), alpha);
          ctx.beginPath();
          ctx.ellipse(0, 0, 6, 3, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
    }
  }

  // ---- むし・豪華版：巨大な虫の羽根の残像が乱舞し、無数の斬撃十字が炸裂する ----
  function spawnBugBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 中心の毒々しい緑色フラッシュ
    particles.push({
      maxLife: 260,
      draw(ctx, t) {
        const alpha = t < 0.25 ? (t / 0.25) * 0.8 : 0.8 * (1 - (t - 0.25) / 0.75);
        const r = lerp(R * 0.1, R * 0.7, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#eaffb0', alpha));
        grad.addColorStop(0.5, rgba('#8fd13f', alpha * 0.8));
        grad.addColorStop(1, 'rgba(143,209,63,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 巨大な交差斬撃（通常版の3本→7本、全方位に伸びる）
    for (let i = 0; i < 7; i++) {
      const angle = (Math.PI * i) / 7 + rand(-0.15, 0.15);
      particles.push({
        delay: i * 45,
        maxLife: 380,
        draw(ctx, t) {
          const len = R * 1.15;
          const prog = easeOutCubic(t);
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          const alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
          ctx.strokeStyle = rgba('#a8ff5a', alpha);
          ctx.lineWidth = 6 * (1 - t * 0.5);
          ctx.shadowColor = rgba('#c8ff6e', 1);
          ctx.shadowBlur = 16;
          ctx.beginPath();
          ctx.moveTo(-len / 2 * prog, 0);
          ctx.lineTo(len / 2 * prog, 0);
          ctx.stroke();
          ctx.restore();
        }
      });
    }
    // 大きな半透明の羽根が2枚、左右に大きく展開して消える
    for (let side = -1; side <= 1; side += 2) {
      particles.push({
        delay: 60,
        maxLife: 460,
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const alpha = Math.sin(Math.PI * clamp01(t)) * 0.55;
          ctx.save();
          ctx.translate(cx + side * R * 0.22 * e, cy - R * 0.05 * e);
          ctx.rotate(side * (0.5 + t * 0.4));
          ctx.fillStyle = rgba('#c8ff6e', alpha);
          ctx.beginPath();
          ctx.ellipse(0, 0, R * 0.22 * e, R * 0.11 * e, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
    }
    // 舞い散る葉と鱗粉（数を大幅増量、遠くまで飛ぶ）
    for (let i = 0; i < 26; i++) {
      const a0 = rand(0, Math.PI * 2);
      const dist = rand(R * 0.15, R * 0.85);
      particles.push({
        delay: rand(0, 260),
        maxLife: rand(420, 620),
        rot: rand(0, Math.PI * 2),
        col: pick(['#7fc93f', '#a8e063', '#4f9d2a', '#d8ff8a']),
        size: rand(5, 9),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = cx + Math.cos(a0) * dist * e;
          const y = cy + Math.sin(a0) * dist * e - e * 22;
          const alpha = Math.sin(Math.PI * clamp01(t));
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 5);
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.shadowColor = rgba('#c8ff6e', 0.7);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.ellipse(0, 0, this.size, this.size * 0.45, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
    }
  }



  // ---- あく (dark)：闇の波動と紫の靄 ----
  function spawnDark(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    particles.push({
      maxLife: 420,
      draw(ctx, t) {
        const r = lerp(6, Math.max(w, h) * 0.55, easeOutCubic(t));
        const alpha = (1 - t) * 0.85;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#2b1a3a', alpha));
        grad.addColorStop(0.6, rgba('#1a0f26', alpha * 0.7));
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    for (let i = 0; i < 8; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(40, 200),
        maxLife: rand(300, 420),
        draw(ctx, t) {
          const dist = lerp(4, Math.max(w, h) * 0.42, easeOutCubic(t));
          const x = cx + Math.cos(a0) * dist;
          const y = cy + Math.sin(a0) * dist;
          const alpha = (1 - t) * 0.8;
          ctx.fillStyle = rgba('#6a3fa0', alpha);
          ctx.beginPath();
          ctx.arc(x, y, lerp(10, 2, t), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }

  // ---- あく・豪華版：画面を覆う漆黒の暗雲から無数の爪痕が走り、深紅の目が光る ----
  function spawnDarkBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 画面全体を覆う暗黒の靄（大きく・長く残る）
    particles.push({
      maxLife: 620,
      draw(ctx, t) {
        const alpha = (t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7) * 0.55;
        ctx.fillStyle = rgba('#0d0714', alpha);
        ctx.fillRect(0, 0, w, h);
        const r = lerp(R * 0.15, R * 0.8, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#3a2050', alpha * 1.3));
        grad.addColorStop(1, 'rgba(20,10,30,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 深紅に光る目が中心に浮かび上がる
    particles.push({
      delay: 100,
      maxLife: 340,
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t));
        ctx.fillStyle = rgba('#ff3b3b', alpha);
        ctx.shadowColor = rgba('#ff0000', 1);
        ctx.shadowBlur = 16;
        ctx.beginPath();
        ctx.ellipse(cx - 16, cy, 5, 7, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + 16, cy, 5, 7, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 巨大な爪痕（3本セットを2回、時差で交差させる）
    for (let group = 0; group < 2; group++) {
      const baseAngle = group === 0 ? -0.5 : 2.5;
      for (let i = 0; i < 3; i++) {
        const angle = baseAngle + i * 0.22;
        particles.push({
          delay: group * 140 + i * 30,
          maxLife: 320,
          draw(ctx, t) {
            const len = R * 1.1;
            const prog = easeOutCubic(t);
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(angle);
            const alpha = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5;
            ctx.strokeStyle = rgba('#8a4fd6', alpha);
            ctx.lineWidth = 5 * (1 - t * 0.4);
            ctx.shadowColor = rgba('#ff3b3b', 0.7);
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.moveTo(-len / 2 * prog, 0);
            ctx.lineTo(len / 2 * prog, 0);
            ctx.stroke();
            ctx.restore();
          }
        });
      }
    }
    // 飛び散る紫の靄玉（数を増量・大きめ）
    for (let i = 0; i < 16; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(60, 280),
        maxLife: rand(360, 520),
        draw(ctx, t) {
          const dist = lerp(4, R * 0.6, easeOutCubic(t));
          const x = cx + Math.cos(a0) * dist;
          const y = cy + Math.sin(a0) * dist;
          const alpha = (1 - t) * 0.85;
          ctx.fillStyle = rgba('#6a3fa0', alpha);
          ctx.shadowColor = rgba('#3a2050', 0.9);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(x, y, lerp(13, 2, t), 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }



  // ---- ドラゴン (dragon)：青紫の衝撃波リング + 螺旋光 ----
  function spawnDragon(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 2; i++) {
      particles.push({
        delay: i * 100,
        maxLife: 380,
        draw(ctx, t) {
          const r = lerp(4, Math.max(w, h) * 0.6, easeOutCubic(t));
          const alpha = (1 - t);
          ctx.strokeStyle = rgba('#5b6ee6', alpha);
          ctx.lineWidth = 4 * (1 - t);
          ctx.shadowColor = rgba('#8f6bff', 0.9);
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 螺旋の光点
    const nSpiral = 16;
    for (let i = 0; i < nSpiral; i++) {
      particles.push({
        delay: i * 12,
        maxLife: 320,
        idx: i,
        draw(ctx, t) {
          const ang = this.idx * 0.9 + t * 6;
          const r = lerp(Math.max(w, h) * 0.42, 2, easeInCubic(t));
          const x = cx + Math.cos(ang) * r;
          const y = cy + Math.sin(ang) * r * 0.85;
          const alpha = 1 - t;
          ctx.fillStyle = rgba('#b39dff', alpha);
          ctx.beginPath();
          ctx.arc(x, y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }

  // ---- ドラゴン・豪華版：巨大な竜の顎の衝撃波と青紫の螺旋光が渦を巻く ----
  function spawnDragonBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 中心の巨大フラッシュ
    particles.push({
      maxLife: 260,
      draw(ctx, t) {
        const alpha = t < 0.25 ? (t / 0.25) * 0.85 : 0.85 * (1 - (t - 0.25) / 0.75);
        const r = lerp(R * 0.1, R * 0.65, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#e6e9ff', alpha));
        grad.addColorStop(0.5, rgba('#6f7cf0', alpha * 0.85));
        grad.addColorStop(1, 'rgba(111,124,240,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 4重の拡大衝撃波リング
    for (let i = 0; i < 4; i++) {
      particles.push({
        delay: i * 80,
        maxLife: 460,
        draw(ctx, t) {
          const r = lerp(4, R * 0.85, easeOutCubic(t));
          const alpha = (1 - t);
          ctx.strokeStyle = rgba('#5b6ee6', alpha);
          ctx.lineWidth = 5 * (1 - t * 0.6);
          ctx.shadowColor = rgba('#8f6bff', 1);
          ctx.shadowBlur = 18;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 二重の巨大な螺旋光点（内向き・外向き）
    const nSpiral = 28;
    for (let i = 0; i < nSpiral; i++) {
      const outward = i % 2 === 0;
      particles.push({
        delay: i * 10,
        maxLife: 420,
        idx: i,
        draw(ctx, t) {
          const ang = this.idx * 0.7 + t * (outward ? 8 : -8);
          const r = outward ? lerp(4, R * 0.55, easeOutCubic(t)) : lerp(R * 0.55, 4, easeInCubic(t));
          const x = cx + Math.cos(ang) * r;
          const y = cy + Math.sin(ang) * r * 0.85;
          const alpha = Math.sin(Math.PI * clamp01(t));
          ctx.fillStyle = rgba(outward ? '#b39dff' : '#6f7cf0', alpha);
          ctx.shadowColor = rgba('#8f6bff', 0.9);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 竜の顎が噛みつくような巨大な三日月形の衝撃波（左右から）
    for (let side = -1; side <= 1; side += 2) {
      particles.push({
        delay: 40,
        maxLife: 300,
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const alpha = 1 - t;
          ctx.save();
          ctx.translate(cx + side * R * 0.05, cy);
          ctx.scale(side, 1);
          ctx.strokeStyle = rgba('#dcd6ff', alpha);
          ctx.lineWidth = 8 * (1 - t * 0.5);
          ctx.shadowColor = rgba('#8f6bff', 1);
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.arc(0, 0, R * 0.5 * e, -0.6, 0.6);
          ctx.stroke();
          ctx.restore();
        }
      });
    }
  }


  function zigzagPath(ctx, x0, y0, x1, y1, segments, jitter) {
    ctx.moveTo(x0, y0);
    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const x = lerp(x0, x1, t) + rand(-jitter, jitter);
      const y = lerp(y0, y1, t) + rand(-jitter, jitter);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(x1, y1);
  }
  function spawnElectric(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 4; i++) {
      const angle = rand(0, Math.PI * 2);
      const len = rand(Math.max(w, h) * 0.3, Math.max(w, h) * 0.55);
      const x1 = cx + Math.cos(angle) * len;
      const y1 = cy + Math.sin(angle) * len;
      particles.push({
        delay: i * 45,
        maxLife: 180,
        draw(ctx, t) {
          const alpha = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5;
          ctx.strokeStyle = rgba('#fff59d', alpha);
          ctx.lineWidth = 3;
          ctx.shadowColor = rgba('#ffe74c', 1);
          ctx.shadowBlur = 16;
          ctx.beginPath();
          zigzagPath(ctx, cx, cy, x1, y1, 5, 6);
          ctx.stroke();
          ctx.strokeStyle = rgba('#ffffff', alpha * 0.9);
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      });
    }
    // 中心のフラッシュ
    particles.push({
      maxLife: 150,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.9;
        const r = lerp(4, 46, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#fffde7', alpha));
        grad.addColorStop(1, 'rgba(255,235,59,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ---- でんき・豪華版：巨大な雷が全方位に落ち、画面が白く発光する ----
  function spawnElectricBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 全方位への巨大稲妻（8方向）
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8 + rand(-0.15, 0.15);
      const len = R * rand(0.6, 0.95);
      const x1 = cx + Math.cos(angle) * len;
      const y1 = cy + Math.sin(angle) * len;
      particles.push({
        delay: i * 25,
        maxLife: 220,
        draw(ctx, t) {
          const alpha = t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6;
          ctx.strokeStyle = rgba('#fff59d', alpha);
          ctx.lineWidth = 4;
          ctx.shadowColor = rgba('#ffe74c', 1);
          ctx.shadowBlur = 22;
          ctx.beginPath();
          zigzagPath(ctx, cx, cy, x1, y1, 6, 9);
          ctx.stroke();
          ctx.strokeStyle = rgba('#ffffff', alpha * 0.95);
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
      });
    }
    // 画面全体が瞬間的に白くフラッシュ（2回明滅）
    for (let i = 0; i < 2; i++) {
      particles.push({
        delay: i * 110,
        maxLife: 90,
        draw(ctx, t) {
          const alpha = (1 - t) * 0.5;
          ctx.fillStyle = rgba('#fffde7', alpha);
          ctx.fillRect(0, 0, w, h);
        }
      });
    }
    // 中心の巨大フラッシュ球
    particles.push({
      maxLife: 240,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.95;
        const r = lerp(4, R * 0.5, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#ffffff', alpha));
        grad.addColorStop(0.5, rgba('#fffde7', alpha * 0.8));
        grad.addColorStop(1, 'rgba(255,235,59,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 弾け飛ぶ小スパーク（多数）
    for (let i = 0; i < 18; i++) {
      const a0 = rand(0, Math.PI * 2);
      const dist = rand(R * 0.2, R * 0.7);
      particles.push({
        delay: rand(0, 200),
        maxLife: rand(180, 300),
        a0, dist,
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = cx + Math.cos(a0) * dist * e;
          const y = cy + Math.sin(a0) * dist * e;
          const alpha = 1 - t;
          ctx.fillStyle = rgba('#ffe74c', alpha);
          ctx.shadowColor = rgba('#fff59d', 1);
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }


  function drawStar(ctx, x, y, r, rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
      const a2 = a + Math.PI / 5;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.lineTo(Math.cos(a2) * r * 0.45, Math.sin(a2) * r * 0.45);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  function spawnFairy(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 12; i++) {
      const a0 = rand(0, Math.PI * 2);
      const dist = rand(Math.max(w, h) * 0.15, Math.max(w, h) * 0.45);
      particles.push({
        delay: rand(0, 160),
        maxLife: rand(320, 460),
        rot: rand(0, Math.PI * 2),
        col: pick(['#ff9fd6', '#ffd6ef', '#ffffff']),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = cx + Math.cos(a0) * dist * e;
          const y = cy + Math.sin(a0) * dist * e - Math.sin(t * Math.PI) * 8;
          const alpha = Math.sin(Math.PI * clamp01(t * 1.1));
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.shadowColor = rgba('#ffd6ef', 0.8);
          ctx.shadowBlur = 8;
          drawStar(ctx, x, y, lerp(7, 3, t), this.rot + t * 3);
        }
      });
    }
  }

  // ---- フェアリー・豪華版：無数の星屑がハート状の軌道を描き、虹色の光輪が広がる ----
  function spawnFairyBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 中心の淡いピンクフラッシュ
    particles.push({
      maxLife: 280,
      draw(ctx, t) {
        const alpha = t < 0.3 ? (t / 0.3) * 0.8 : 0.8 * (1 - (t - 0.3) / 0.7);
        const r = lerp(R * 0.1, R * 0.6, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#fff0fa', alpha));
        grad.addColorStop(0.5, rgba('#ff9fd6', alpha * 0.8));
        grad.addColorStop(1, 'rgba(255,159,214,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 虹色の光輪リング（多色）
    const ringColors = ['#ff9fd6', '#ffe98a', '#b3ffe0', '#c8b3ff'];
    for (let i = 0; i < 4; i++) {
      particles.push({
        delay: i * 60,
        maxLife: 460,
        col: ringColors[i],
        draw(ctx, t) {
          const r = lerp(4, R * 0.6, easeOutCubic(t));
          const alpha = (1 - t) * 0.75;
          ctx.strokeStyle = rgba(this.col, alpha);
          ctx.lineWidth = 3.5;
          ctx.shadowColor = rgba(this.col, 0.9);
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 大量の星が渦を巻きながら舞う（通常版12個→24個、外周まで広がる）
    for (let i = 0; i < 24; i++) {
      const a0 = rand(0, Math.PI * 2);
      const dist = rand(R * 0.15, R * 0.75);
      particles.push({
        delay: rand(0, 260),
        maxLife: rand(420, 620),
        a0, dist,
        rot: rand(0, Math.PI * 2),
        col: pick(['#ff9fd6', '#ffd6ef', '#ffffff', '#ffe98a']),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const spiral = this.a0 + t * 2.5;
          const x = cx + Math.cos(spiral) * this.dist * e;
          const y = cy + Math.sin(spiral) * this.dist * e - Math.sin(t * Math.PI) * 10;
          const alpha = Math.sin(Math.PI * clamp01(t * 1.1));
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.shadowColor = rgba('#ffd6ef', 0.9);
          ctx.shadowBlur = 10;
          drawStar(ctx, x, y, lerp(9, 3, t), this.rot + t * 4);
        }
      });
    }
  }


  function spawnFighting(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    particles.push({
      maxLife: 200,
      draw(ctx, t) {
        const alpha = (1 - t);
        const r = lerp(6, Math.max(w, h) * 0.35, easeOutCubic(t));
        ctx.strokeStyle = rgba('#ff6a3d', alpha);
        ctx.lineWidth = 6 * (1 - t);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    const n = 8;
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n + rand(-0.2, 0.2);
      particles.push({
        delay: 40,
        maxLife: 220,
        draw(ctx, t) {
          const len = lerp(6, Math.max(w, h) * 0.42, easeOutCubic(t));
          const alpha = 1 - t;
          const x0 = cx + Math.cos(angle) * len * 0.35;
          const y0 = cy + Math.sin(angle) * len * 0.35;
          const x1 = cx + Math.cos(angle) * len;
          const y1 = cy + Math.sin(angle) * len;
          ctx.strokeStyle = rgba('#d6431f', alpha);
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      });
    }
  }

  // ---- かくとう・豪華版：巨大な拳の衝撃波が3連続で炸裂し、赤い闘気が渦巻く ----
  function spawnFightingBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 3連続の巨大衝撃リング（インパクトを時間差で重ねる）
    for (let hit = 0; hit < 3; hit++) {
      particles.push({
        delay: hit * 130,
        maxLife: 220,
        draw(ctx, t) {
          const alpha = (1 - t);
          const r = lerp(6, R * 0.55, easeOutCubic(t));
          ctx.strokeStyle = rgba('#ff6a3d', alpha);
          ctx.lineWidth = 9 * (1 - t);
          ctx.shadowColor = rgba('#ffb347', 0.9);
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
      // 各インパクトの瞬間フラッシュ
      particles.push({
        delay: hit * 130,
        maxLife: 110,
        draw(ctx, t) {
          const alpha = (1 - t) * 0.7;
          ctx.fillStyle = rgba('#ffdcc8', alpha);
          const r = lerp(4, R * 0.3, easeOutCubic(t));
          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          grad.addColorStop(0, rgba('#fff2e0', alpha));
          grad.addColorStop(1, 'rgba(255,106,61,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 放射状の衝撃線（通常版8本→14本、太く長く）
    const n = 14;
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n + rand(-0.15, 0.15);
      particles.push({
        delay: 60 + (i % 3) * 30,
        maxLife: 320,
        draw(ctx, t) {
          const len = lerp(6, R * 0.65, easeOutCubic(t));
          const alpha = 1 - t;
          const x0 = cx + Math.cos(angle) * len * 0.3;
          const y0 = cy + Math.sin(angle) * len * 0.3;
          const x1 = cx + Math.cos(angle) * len;
          const y1 = cy + Math.sin(angle) * len;
          ctx.strokeStyle = rgba('#d6431f', alpha);
          ctx.lineWidth = 5;
          ctx.shadowColor = rgba('#ff6a3d', 0.8);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      });
    }
    // 渦巻く赤い闘気の粒子
    for (let i = 0; i < 12; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(0, 200),
        maxLife: rand(300, 440),
        a0,
        draw(ctx, t) {
          const dist = lerp(R * 0.45, R * 0.1, easeInCubic(t));
          const ang = a0 + t * 5;
          const x = cx + Math.cos(ang) * dist;
          const y = cy + Math.sin(ang) * dist;
          const alpha = Math.sin(Math.PI * clamp01(t));
          ctx.fillStyle = rgba('#ff8a5a', alpha);
          ctx.shadowColor = rgba('#ff6a3d', 0.9);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }


  function spawnFire(particles, w, h) {
    const cx = w / 2, cy = h * 0.62;
    // ベースの炎の塊
    for (let i = 0; i < 22; i++) {
      const x0 = cx + rand(-w * 0.16, w * 0.16);
      particles.push({
        delay: rand(0, 140),
        maxLife: rand(300, 480),
        x0,
        drift: rand(-8, 8),
        size: rand(10, 22),
        col: pick(['#ff7a1a', '#ff4d2e', '#ffb347', '#ffe17a']),
        draw(ctx, t) {
          const rise = h * 0.5;
          const y = cy - easeOutCubic(t) * rise;
          const x = this.x0 + this.drift * t + Math.sin(t * 8 + this.x0) * 4;
          const alpha = t < 0.15 ? t / 0.15 : (1 - (t - 0.15) / 0.85);
          const size = this.size * (1 - t * 0.55);
          const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
          grad.addColorStop(0, rgba('#fff6cf', alpha));
          grad.addColorStop(0.35, rgba(this.col, alpha * 0.95));
          grad.addColorStop(1, 'rgba(255,60,0,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 火の粉（上に流れる小さい光点）
    for (let i = 0; i < 10; i++) {
      const x0 = cx + rand(-w * 0.22, w * 0.22);
      particles.push({
        delay: rand(60, 220),
        maxLife: rand(260, 380),
        x0,
        draw(ctx, t) {
          const y = cy - easeOutCubic(t) * h * 0.65;
          const x = this.x0 + Math.sin(t * 10 + this.x0) * 5;
          const alpha = 1 - t;
          ctx.fillStyle = rgba('#ffd23f', alpha);
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }

  // ---- ほのお・豪華版：巨大な火柱が噴き上がり、画面全体に火の粉が舞う ----
  function spawnFireBig(particles, w, h) {
    const cx = w / 2, cy = h * 0.68;
    const R = Math.max(w, h);
    // 地面からの巨大フラッシュ（噴き上がりの起点）
    particles.push({
      maxLife: 260,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.85;
        const r = lerp(w * 0.1, w * 0.5, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#fff6cf', alpha));
        grad.addColorStop(0.4, rgba('#ff7a1a', alpha * 0.9));
        grad.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 巨大な火柱の塊（通常版22個→40個、より高く、より大きく）
    for (let i = 0; i < 40; i++) {
      const x0 = cx + rand(-w * 0.24, w * 0.24);
      particles.push({
        delay: rand(0, 220),
        maxLife: rand(380, 620),
        x0,
        drift: rand(-12, 12),
        size: rand(14, 30),
        col: pick(['#ff7a1a', '#ff4d2e', '#ffb347', '#ffe17a']),
        draw(ctx, t) {
          const rise = h * 0.75;
          const y = cy - easeOutCubic(t) * rise;
          const x = this.x0 + this.drift * t + Math.sin(t * 8 + this.x0) * 6;
          const alpha = t < 0.12 ? t / 0.12 : (1 - (t - 0.12) / 0.88);
          const size = this.size * (1 - t * 0.5);
          const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
          grad.addColorStop(0, rgba('#fff6cf', alpha));
          grad.addColorStop(0.35, rgba(this.col, alpha * 0.95));
          grad.addColorStop(1, 'rgba(255,60,0,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 渦を巻きながら舞い上がる火の粉（増量）
    for (let i = 0; i < 22; i++) {
      const x0 = cx + rand(-w * 0.3, w * 0.3);
      particles.push({
        delay: rand(60, 320),
        maxLife: rand(340, 500),
        x0,
        draw(ctx, t) {
          const y = cy - easeOutCubic(t) * h * 0.9;
          const x = this.x0 + Math.sin(t * 10 + this.x0) * 8;
          const alpha = 1 - t;
          ctx.fillStyle = rgba('#ffd23f', alpha);
          ctx.shadowColor = rgba('#ff7a1a', 0.9);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 左右に広がる爆発の輪
    particles.push({
      delay: 20,
      maxLife: 340,
      draw(ctx, t) {
        const r = lerp(w * 0.1, R * 0.6, easeOutCubic(t));
        const alpha = (1 - t) * 0.7;
        ctx.strokeStyle = rgba('#ff9142', alpha);
        ctx.lineWidth = 6 * (1 - t * 0.6);
        ctx.shadowColor = rgba('#ffb347', 0.9);
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.4, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }


  function spawnFlying(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 3; i++) {
      particles.push({
        delay: i * 60,
        maxLife: 360,
        idx: i,
        draw(ctx, t) {
          const alpha = (1 - t) * 0.85;
          const rBase = lerp(10, Math.max(w, h) * 0.5, easeOutCubic(t));
          ctx.strokeStyle = rgba('#eaf6ff', alpha);
          ctx.lineWidth = 3;
          ctx.beginPath();
          for (let a = 0; a <= Math.PI * 1.6; a += 0.15) {
            const r = rBase * (a / (Math.PI * 1.6));
            const x = cx + Math.cos(a + this.idx * 2 + t * 3) * r;
            const y = cy + Math.sin(a + this.idx * 2 + t * 3) * r * 0.6;
            if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      });
    }
    // 舞う羽根
    for (let i = 0; i < 6; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(0, 150),
        maxLife: rand(320, 440),
        a0,
        rot: rand(0, Math.PI * 2),
        draw(ctx, t) {
          const dist = lerp(6, Math.max(w, h) * 0.4, easeOutCubic(t));
          const x = cx + Math.cos(this.a0 + t * 2) * dist;
          const y = cy + Math.sin(this.a0 + t * 2) * dist * 0.7;
          const alpha = 1 - t;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 5);
          ctx.fillStyle = rgba('#ffffff', alpha * 0.9);
          ctx.beginPath();
          ctx.ellipse(0, 0, 7, 3, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
    }
  }

  // ---- ひこう・豪華版：巨大な竜巻状の風の渦が画面を覆い、羽根が無数に舞い散る ----
  function spawnFlyingBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 中心の白いフラッシュ
    particles.push({
      maxLife: 240,
      draw(ctx, t) {
        const alpha = t < 0.3 ? (t / 0.3) * 0.7 : 0.7 * (1 - (t - 0.3) / 0.7);
        const r = lerp(R * 0.1, R * 0.5, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#ffffff', alpha));
        grad.addColorStop(1, 'rgba(234,246,255,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 巨大な渦巻き風（通常版3本→6本、画面外周まで届く）
    for (let i = 0; i < 6; i++) {
      particles.push({
        delay: i * 45,
        maxLife: 480,
        idx: i,
        draw(ctx, t) {
          const alpha = (1 - t) * 0.85;
          const rBase = lerp(10, R * 0.75, easeOutCubic(t));
          ctx.strokeStyle = rgba('#eaf6ff', alpha);
          ctx.lineWidth = 3.5;
          ctx.shadowColor = rgba('#c8e8ff', 0.8);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          for (let a = 0; a <= Math.PI * 2; a += 0.15) {
            const r = rBase * (a / (Math.PI * 2));
            const x = cx + Math.cos(a + this.idx * 1.2 + t * 4) * r;
            const y = cy + Math.sin(a + this.idx * 1.2 + t * 4) * r * 0.6;
            if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      });
    }
    // 舞い散る羽根（大量、画面全体に広がる）
    for (let i = 0; i < 18; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(0, 260),
        maxLife: rand(420, 600),
        a0,
        rot: rand(0, Math.PI * 2),
        draw(ctx, t) {
          const dist = lerp(6, R * 0.7, easeOutCubic(t));
          const x = cx + Math.cos(this.a0 + t * 2.5) * dist;
          const y = cy + Math.sin(this.a0 + t * 2.5) * dist * 0.7;
          const alpha = 1 - t;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 6);
          ctx.fillStyle = rgba('#ffffff', alpha * 0.9);
          ctx.beginPath();
          ctx.ellipse(0, 0, 9, 4, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
    }
  }


  function spawnGhost(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 6; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(0, 160),
        maxLife: rand(340, 480),
        a0,
        draw(ctx, t) {
          const dist = lerp(4, Math.max(w, h) * 0.32, easeOutCubic(t));
          const x = cx + Math.cos(this.a0) * dist;
          const y = cy + Math.sin(this.a0) * dist - t * 14;
          const alpha = Math.sin(Math.PI * clamp01(t)) * 0.75;
          const r = lerp(6, 20, t);
          const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
          grad.addColorStop(0, rgba('#a97bd6', alpha));
          grad.addColorStop(1, 'rgba(120,80,160,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 光る目
    particles.push({
      delay: 40,
      maxLife: 260,
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t));
        ctx.fillStyle = rgba('#e6d6ff', alpha);
        ctx.shadowColor = rgba('#c78bff', 1);
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.ellipse(cx - 9, cy, 3.5, 5, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + 9, cy, 3.5, 5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ---- ゴースト・豪華版：巨大な顔が浮かび上がり、無数の霊魂が渦を巻いて包み込む ----
  function spawnGhostBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 画面を覆う紫の靄
    particles.push({
      maxLife: 500,
      draw(ctx, t) {
        const alpha = (t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7) * 0.5;
        const r = lerp(R * 0.15, R * 0.75, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#a97bd6', alpha));
        grad.addColorStop(1, 'rgba(80,50,110,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 巨大な光る目（通常版より大きく、二段階で拡大）
    particles.push({
      delay: 60,
      maxLife: 380,
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t));
        const scale = 1 + easeOutCubic(t) * 0.6;
        ctx.fillStyle = rgba('#e6d6ff', alpha);
        ctx.shadowColor = rgba('#c78bff', 1);
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.ellipse(cx - 16 * scale, cy, 5 * scale, 7.5 * scale, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + 16 * scale, cy, 5 * scale, 7.5 * scale, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 大量の漂う霊魂の靄玉（通常版6個→16個、より遠く・より長く）
    for (let i = 0; i < 16; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(0, 300),
        maxLife: rand(420, 620),
        a0,
        draw(ctx, t) {
          const dist = lerp(4, R * 0.55, easeOutCubic(t));
          const x = cx + Math.cos(this.a0 + t * 1.5) * dist;
          const y = cy + Math.sin(this.a0 + t * 1.5) * dist - t * 24;
          const alpha = Math.sin(Math.PI * clamp01(t)) * 0.8;
          const r = lerp(8, 28, t);
          const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
          grad.addColorStop(0, rgba('#a97bd6', alpha));
          grad.addColorStop(1, 'rgba(120,80,160,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // ぞわりと伸びる手のような紫の触手
    for (let i = 0; i < 5; i++) {
      const angle = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(80, 220),
        maxLife: 340,
        draw(ctx, t) {
          const len = lerp(4, R * 0.4, easeOutCubic(t));
          const alpha = (1 - t) * 0.7;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          ctx.strokeStyle = rgba('#8a5ab0', alpha);
          ctx.lineWidth = 6 * (1 - t * 0.5);
          ctx.shadowColor = rgba('#c78bff', 0.8);
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(len * 0.5, Math.sin(t * 5) * 20, len, Math.sin(t * 5 + 1) * 10);
          ctx.stroke();
          ctx.restore();
        }
      });
    }
  }


  function spawnGrass(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 14; i++) {
      const a0 = rand(0, Math.PI * 2);
      const dist = rand(Math.max(w, h) * 0.12, Math.max(w, h) * 0.42);
      particles.push({
        delay: rand(0, 150),
        maxLife: rand(340, 480),
        a0, dist,
        rot: rand(0, Math.PI * 2),
        col: pick(['#5cb85c', '#7fd35f', '#3f9142']),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = cx + Math.cos(this.a0) * this.dist * e;
          const y = cy + Math.sin(this.a0) * this.dist * e + Math.sin(t * Math.PI) * -6;
          const alpha = Math.sin(Math.PI * clamp01(t));
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 3);
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.beginPath();
          ctx.ellipse(0, 0, 8, 3.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
    }
    // 中心のポワッとした緑グロー
    particles.push({
      maxLife: 300,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.5;
        const r = lerp(6, Math.max(w, h) * 0.3, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#b6ff8f', alpha));
        grad.addColorStop(1, 'rgba(90,200,90,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ---- くさ・豪華版：巨大な花が咲き誇り、無数の葉とつるの渦が画面を包む ----
  function spawnGrassBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 中心の巨大な緑グロー（花が開くイメージ）
    particles.push({
      maxLife: 380,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.65;
        const r = lerp(6, R * 0.55, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#eaffb0', alpha));
        grad.addColorStop(0.5, rgba('#7fd35f', alpha * 0.8));
        grad.addColorStop(1, 'rgba(90,200,90,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 花びら状の8方向の花弁エフェクト
    const petals = 8;
    for (let i = 0; i < petals; i++) {
      const angle = (Math.PI * 2 * i) / petals;
      particles.push({
        delay: 40,
        maxLife: 400,
        draw(ctx, t) {
          const dist = lerp(4, R * 0.32, easeOutCubic(t));
          const x = cx + Math.cos(angle) * dist;
          const y = cy + Math.sin(angle) * dist;
          const alpha = Math.sin(Math.PI * clamp01(t));
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(angle);
          ctx.fillStyle = rgba(pick(['#ff9fd6', '#ffffff', '#ffe98a']), alpha);
          ctx.beginPath();
          ctx.ellipse(0, 0, 12, 6, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
    }
    // 舞い散る葉（通常版14個→28個、渦を巻きながら広がる）
    for (let i = 0; i < 28; i++) {
      const a0 = rand(0, Math.PI * 2);
      const dist = rand(R * 0.1, R * 0.7);
      particles.push({
        delay: rand(0, 260),
        maxLife: rand(420, 620),
        a0, dist,
        rot: rand(0, Math.PI * 2),
        col: pick(['#5cb85c', '#7fd35f', '#3f9142', '#b6ff8f']),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const spiral = this.a0 + t * 2;
          const x = cx + Math.cos(spiral) * this.dist * e;
          const y = cy + Math.sin(spiral) * this.dist * e + Math.sin(t * Math.PI) * -10;
          const alpha = Math.sin(Math.PI * clamp01(t));
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 4);
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.beginPath();
          ctx.ellipse(0, 0, 10, 4.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
    }
    // からみつくつる（弧を描く緑の線）
    for (let i = 0; i < 3; i++) {
      const angle = rand(0, Math.PI * 2);
      particles.push({
        delay: i * 70,
        maxLife: 420,
        draw(ctx, t) {
          const len = lerp(4, R * 0.5, easeOutCubic(t));
          const alpha = (1 - t) * 0.8;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          ctx.strokeStyle = rgba('#3f9142', alpha);
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(len * 0.5, Math.sin(t * 6) * 26, len, Math.sin(t * 6 + 1) * 14);
          ctx.stroke();
          ctx.restore();
        }
      });
    }
  }


  function spawnGround(particles, w, h) {
    const cx = w / 2, cy = h * 0.88;
    // 地割れの光る亀裂
    for (let i = 0; i < 5; i++) {
      const angle = rand(-1.2, 1.2);
      particles.push({
        delay: i * 20,
        maxLife: 260,
        draw(ctx, t) {
          const len = lerp(4, w * 0.5, easeOutCubic(t));
          const alpha = 1 - t;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          ctx.strokeStyle = rgba('#a97a3a', alpha);
          ctx.lineWidth = 3;
          ctx.beginPath();
          zigzagPath(ctx, 0, 0, len, 0, 4, 4);
          ctx.stroke();
          ctx.restore();
        }
      });
    }
    // 舞い上がる岩の破片
    for (let i = 0; i < 14; i++) {
      const x0 = cx + rand(-w * 0.35, w * 0.35);
      const vUp = rand(h * 0.35, h * 0.6);
      particles.push({
        delay: rand(0, 120),
        maxLife: rand(300, 460),
        x0, vUp,
        vx: rand(-1, 1) * 20,
        size: rand(4, 9),
        rot: rand(0, Math.PI * 2),
        col: pick(['#a0783c', '#8a6530', '#c79a5b']),
        draw(ctx, t) {
          const rise = easeOutCubic(Math.min(1, t * 1.6));
          const fall = t > 0.55 ? easeInCubic((t - 0.55) / 0.45) : 0;
          const y = cy - this.vUp * rise + fall * this.vUp * 0.7;
          const x = this.x0 + this.vx * t;
          const alpha = 1 - Math.max(0, (t - 0.75) / 0.25);
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 6);
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
          ctx.restore();
        }
      });
    }
    // 砂煙
    particles.push({
      maxLife: 380,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.5;
        const r = lerp(8, w * 0.5, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#c9a06a', alpha));
        grad.addColorStop(1, 'rgba(160,120,60,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // ---- じめん・豪華版：画面全体に地割れが走り、巨大な土煙と岩塊が吹き飛ぶ ----
  function spawnGroundBig(particles, w, h) {
    const cx = w / 2, cy = h * 0.88;
    const R = Math.max(w, h);
    // 画面いっぱいの地割れ亀裂（通常版5本→9本、扇状に大きく広がる）
    for (let i = 0; i < 9; i++) {
      const angle = rand(-1.4, 1.4);
      particles.push({
        delay: i * 15,
        maxLife: 300,
        draw(ctx, t) {
          const len = lerp(4, w * 0.75, easeOutCubic(t));
          const alpha = 1 - t;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          ctx.strokeStyle = rgba('#a97a3a', alpha);
          ctx.lineWidth = 4;
          ctx.shadowColor = rgba('#ffcf7a', 0.7);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          zigzagPath(ctx, 0, 0, len, 0, 5, 5);
          ctx.stroke();
          ctx.restore();
        }
      });
    }
    // 巨大な砂煙（通常版より濃く・大きく）
    particles.push({
      maxLife: 500,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.65;
        const r = lerp(8, w * 0.75, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#c9a06a', alpha));
        grad.addColorStop(1, 'rgba(160,120,60,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 舞い上がる岩の破片（通常版14個→28個、より高く、より大きい岩も混ぜる）
    for (let i = 0; i < 28; i++) {
      const x0 = cx + rand(-w * 0.45, w * 0.45);
      const vUp = rand(h * 0.45, h * 0.85);
      particles.push({
        delay: rand(0, 200),
        maxLife: rand(340, 540),
        x0, vUp,
        vx: rand(-1, 1) * 30,
        size: rand(5, 14),
        rot: rand(0, Math.PI * 2),
        col: pick(['#a0783c', '#8a6530', '#c79a5b']),
        draw(ctx, t) {
          const rise = easeOutCubic(Math.min(1, t * 1.6));
          const fall = t > 0.55 ? easeInCubic((t - 0.55) / 0.45) : 0;
          const y = cy - this.vUp * rise + fall * this.vUp * 0.7;
          const x = this.x0 + this.vx * t;
          const alpha = 1 - Math.max(0, (t - 0.75) / 0.25);
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 6);
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
          ctx.restore();
        }
      });
    }
    // 地面から突き上がる巨岩の柱（新規演出）
    for (let i = 0; i < 3; i++) {
      const x0 = cx + rand(-w * 0.28, w * 0.28);
      particles.push({
        delay: i * 60,
        maxLife: 360,
        x0,
        draw(ctx, t) {
          const rise = easeOutCubic(Math.min(1, t * 1.8));
          const h0 = h * 0.45 * rise;
          const alpha = 1 - Math.max(0, (t - 0.6) / 0.4);
          ctx.fillStyle = rgba('#8a6530', alpha);
          ctx.fillRect(this.x0 - 9, cy - h0, 18, h0);
          ctx.fillStyle = rgba('#c79a5b', alpha);
          ctx.fillRect(this.x0 - 9, cy - h0, 18, 6);
          ctx.restore && ctx.restore();
        }
      });
    }
  }


  function spawnIce(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    particles.push({
      maxLife: 260,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.7;
        const r = lerp(4, Math.max(w, h) * 0.4, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#eafcff', alpha));
        grad.addColorStop(1, 'rgba(140,220,240,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    for (let i = 0; i < 10; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(0, 120),
        maxLife: rand(280, 400),
        a0,
        rot: rand(0, Math.PI * 2),
        draw(ctx, t) {
          const dist = lerp(4, Math.max(w, h) * 0.42, easeOutCubic(t));
          const x = cx + Math.cos(this.a0) * dist;
          const y = cy + Math.sin(this.a0) * dist;
          const alpha = 1 - t;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 2);
          ctx.strokeStyle = rgba('#bdf1ff', alpha);
          ctx.lineWidth = 1.6;
          ctx.shadowColor = rgba('#8fe9ff', 0.8);
          ctx.shadowBlur = 6;
          for (let k = 0; k < 3; k++) {
            ctx.save();
            ctx.rotate((Math.PI / 3) * k);
            ctx.beginPath();
            ctx.moveTo(0, -6);
            ctx.lineTo(0, 6);
            ctx.moveTo(-3, -3);
            ctx.lineTo(0, -6);
            ctx.lineTo(3, -3);
            ctx.stroke();
            ctx.restore();
          }
          ctx.restore();
        }
      });
    }
  }

  // ---- こおり・豪華版：巨大な氷結フラッシュと無数の結晶が画面を覆う ----
  function spawnIceBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 中心の巨大な氷結フラッシュ
    particles.push({
      maxLife: 340,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.85;
        const r = lerp(4, R * 0.65, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#ffffff', alpha));
        grad.addColorStop(0.5, rgba('#eafcff', alpha * 0.85));
        grad.addColorStop(1, 'rgba(140,220,240,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 亀裂状に走る氷の閃光（8方向）
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8 + rand(-0.1, 0.1);
      particles.push({
        delay: i * 25,
        maxLife: 260,
        draw(ctx, t) {
          const len = lerp(4, R * 0.65, easeOutCubic(t));
          const alpha = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5;
          ctx.strokeStyle = rgba('#bdf1ff', alpha);
          ctx.lineWidth = 3;
          ctx.shadowColor = rgba('#8fe9ff', 1);
          ctx.shadowBlur = 14;
          ctx.beginPath();
          zigzagPath(ctx, cx, cy, cx + Math.cos(angle) * len, cy + Math.sin(angle) * len, 4, 5);
          ctx.stroke();
        }
      });
    }
    // 大量の氷の結晶（通常版10個→22個、より大きく回転）
    for (let i = 0; i < 22; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(0, 240),
        maxLife: rand(360, 540),
        a0,
        rot: rand(0, Math.PI * 2),
        scale: rand(0.8, 1.6),
        draw(ctx, t) {
          const dist = lerp(4, R * 0.6, easeOutCubic(t));
          const x = cx + Math.cos(this.a0) * dist;
          const y = cy + Math.sin(this.a0) * dist;
          const alpha = 1 - t;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 2);
          ctx.scale(this.scale, this.scale);
          ctx.strokeStyle = rgba('#bdf1ff', alpha);
          ctx.lineWidth = 1.8;
          ctx.shadowColor = rgba('#8fe9ff', 0.9);
          ctx.shadowBlur = 8;
          for (let k = 0; k < 3; k++) {
            ctx.save();
            ctx.rotate((Math.PI / 3) * k);
            ctx.beginPath();
            ctx.moveTo(0, -8);
            ctx.lineTo(0, 8);
            ctx.moveTo(-4, -4);
            ctx.lineTo(0, -8);
            ctx.lineTo(4, -4);
            ctx.stroke();
            ctx.restore();
          }
          ctx.restore();
        }
      });
    }
    // 舞い散る細かい雪片
    for (let i = 0; i < 14; i++) {
      const x0 = rand(0, w);
      particles.push({
        delay: rand(0, 260),
        maxLife: rand(400, 560),
        x0,
        draw(ctx, t) {
          const y = t * h;
          const x = this.x0 + Math.sin(t * 6 + this.x0) * 10;
          const alpha = Math.sin(Math.PI * clamp01(t));
          ctx.fillStyle = rgba('#eafcff', alpha);
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }


  function spawnNormal(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    particles.push({
      maxLife: 260,
      draw(ctx, t) {
        const r = lerp(6, Math.max(w, h) * 0.5, easeOutCubic(t));
        const alpha = (1 - t) * 0.8;
        ctx.strokeStyle = rgba('#f2f2ec', alpha);
        ctx.lineWidth = 4 * (1 - t);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    for (let i = 0; i < 3; i++) {
      const angle = rand(-0.4, 0.4) + i * 0.3 - 0.3;
      particles.push({
        delay: i * 50,
        maxLife: 220,
        draw(ctx, t) {
          const len = Math.max(w, h) * 0.7;
          const prog = easeOutCubic(t);
          const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          ctx.strokeStyle = rgba('#ffffff', alpha);
          ctx.lineWidth = 4 * (1 - t * 0.4);
          ctx.shadowColor = rgba('#dcdccb', 0.8);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.moveTo(-len / 2 * prog, 0);
          ctx.lineTo(len / 2 * prog, 0);
          ctx.stroke();
          ctx.restore();
        }
      });
    }
  }

  // ---- ノーマル・豪華版：純白の光が全方位に炸裂し、巨大な光の輪が広がる ----
  function spawnNormalBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 中心の純白フラッシュ
    particles.push({
      maxLife: 240,
      draw(ctx, t) {
        const alpha = t < 0.25 ? (t / 0.25) * 0.85 : 0.85 * (1 - (t - 0.25) / 0.75);
        const r = lerp(R * 0.1, R * 0.6, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#ffffff', alpha));
        grad.addColorStop(1, 'rgba(242,242,236,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 三重の拡大衝撃波
    for (let i = 0; i < 3; i++) {
      particles.push({
        delay: i * 70,
        maxLife: 420,
        draw(ctx, t) {
          const r = lerp(6, R * 0.75, easeOutCubic(t));
          const alpha = (1 - t) * 0.85;
          ctx.strokeStyle = rgba('#f2f2ec', alpha);
          ctx.lineWidth = 5 * (1 - t * 0.6);
          ctx.shadowColor = rgba('#ffffff', 0.7);
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 放射状の光の斬撃（通常版3本→6本）
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * i) / 6 + rand(-0.1, 0.1);
      particles.push({
        delay: i * 40,
        maxLife: 280,
        draw(ctx, t) {
          const len = R * 0.95;
          const prog = easeOutCubic(t);
          const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(angle);
          ctx.strokeStyle = rgba('#ffffff', alpha);
          ctx.lineWidth = 4 * (1 - t * 0.4);
          ctx.shadowColor = rgba('#dcdccb', 0.9);
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.moveTo(-len / 2 * prog, 0);
          ctx.lineTo(len / 2 * prog, 0);
          ctx.stroke();
          ctx.restore();
        }
      });
    }
    // 飛び散る光の粒子
    for (let i = 0; i < 16; i++) {
      const a0 = rand(0, Math.PI * 2);
      const dist = rand(R * 0.2, R * 0.65);
      particles.push({
        delay: rand(0, 200),
        maxLife: rand(280, 420),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const x = cx + Math.cos(a0) * dist * e;
          const y = cy + Math.sin(a0) * dist * e;
          const alpha = 1 - t;
          ctx.fillStyle = rgba('#ffffff', alpha);
          ctx.shadowColor = rgba('#f2f2ec', 0.8);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }


  function spawnPoison(particles, w, h) {
    const cx = w / 2, cy = h * 0.6;
    particles.push({
      maxLife: 360,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.5;
        const r = lerp(8, Math.max(w, h) * 0.4, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#c15adf', alpha));
        grad.addColorStop(1, 'rgba(120,40,150,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    for (let i = 0; i < 12; i++) {
      const x0 = cx + rand(-w * 0.22, w * 0.22);
      particles.push({
        delay: rand(0, 160),
        maxLife: rand(320, 460),
        x0,
        size: rand(4, 10),
        wob: rand(0, Math.PI * 2),
        col: pick(['#a020c0', '#c060e0', '#7a2aa0']),
        draw(ctx, t) {
          const y = cy - easeOutCubic(t) * h * 0.55;
          const x = this.x0 + Math.sin(t * 6 + this.wob) * 6;
          const alpha = Math.sin(Math.PI * clamp01(t)) * 0.85;
          ctx.strokeStyle = rgba(this.col, alpha);
          ctx.fillStyle = rgba(this.col, alpha * 0.5);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, this.size * (1 - t * 0.3), 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      });
    }
  }

  // ---- どく・豪華版：紫の毒の沼が画面を覆い、巨大な気泡が次々と弾ける ----
  function spawnPoisonBig(particles, w, h) {
    const cx = w / 2, cy = h * 0.55;
    const R = Math.max(w, h);
    // 画面を覆う毒の靄（濃く・長く残る）
    particles.push({
      maxLife: 560,
      draw(ctx, t) {
        const alpha = (t < 0.25 ? t / 0.25 : 1 - (t - 0.25) / 0.75) * 0.55;
        const r = lerp(8, R * 0.75, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#c15adf', alpha));
        grad.addColorStop(1, 'rgba(120,40,150,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 大きく弾ける毒泡（通常版12個→26個、より大きく）
    for (let i = 0; i < 26; i++) {
      const x0 = cx + rand(-w * 0.32, w * 0.32);
      particles.push({
        delay: rand(0, 260),
        maxLife: rand(380, 560),
        x0,
        size: rand(6, 16),
        wob: rand(0, Math.PI * 2),
        col: pick(['#a020c0', '#c060e0', '#7a2aa0', '#e0a0ff']),
        draw(ctx, t) {
          const y = cy - easeOutCubic(t) * h * 0.65;
          const x = this.x0 + Math.sin(t * 6 + this.wob) * 8;
          const alpha = Math.sin(Math.PI * clamp01(t)) * 0.9;
          ctx.strokeStyle = rgba(this.col, alpha);
          ctx.fillStyle = rgba(this.col, alpha * 0.5);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, this.size * (1 - t * 0.3), 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          // 弾ける瞬間の小さな飛沫（気泡が消える直前）
          if (t > 0.85) {
            const burstAlpha = (1 - (t - 0.85) / 0.15) * 0.6;
            for (let k = 0; k < 3; k++) {
              const ba = (Math.PI * 2 * k) / 3;
              ctx.fillStyle = rgba(this.col, burstAlpha);
              ctx.beginPath();
              ctx.arc(x + Math.cos(ba) * this.size, y + Math.sin(ba) * this.size, 2, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      });
    }
    // 毒の紋章のような同心リング
    for (let i = 0; i < 2; i++) {
      particles.push({
        delay: i * 100,
        maxLife: 400,
        draw(ctx, t) {
          const r = lerp(4, R * 0.4, easeOutCubic(t));
          const alpha = (1 - t) * 0.7;
          ctx.strokeStyle = rgba('#c15adf', alpha);
          ctx.lineWidth = 4;
          ctx.shadowColor = rgba('#e0a0ff', 0.9);
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
  }


  function spawnPsychic(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 3; i++) {
      particles.push({
        delay: i * 90,
        maxLife: 420,
        draw(ctx, t) {
          const r = lerp(4, Math.max(w, h) * 0.55, easeOutCubic(t));
          const alpha = (1 - t) * 0.8;
          ctx.strokeStyle = rgba('#e0559e', alpha);
          ctx.lineWidth = 3;
          ctx.shadowColor = rgba('#ff9fd6', 0.8);
          ctx.shadowBlur = 12;
          ctx.beginPath();
          for (let a = 0; a < Math.PI * 2; a += 0.1) {
            const wobble = Math.sin(a * 5 + t * 10) * 3;
            const rr = r + wobble;
            const x = cx + Math.cos(a) * rr;
            const y = cy + Math.sin(a) * rr;
            if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
        }
      });
    }
    // 浮遊する光点（念力の粒）
    for (let i = 0; i < 8; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(20, 160),
        maxLife: rand(320, 440),
        a0,
        draw(ctx, t) {
          const dist = lerp(6, Math.max(w, h) * 0.36, easeOutCubic(t));
          const ang = this.a0 + t * 3;
          const x = cx + Math.cos(ang) * dist;
          const y = cy + Math.sin(ang) * dist;
          const alpha = 1 - t;
          ctx.fillStyle = rgba('#f0a8d8', alpha);
          ctx.shadowColor = rgba('#ff9fd6', 0.8);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }

  // ---- エスパー・豪華版：巨大な念力の波紋が幾重にも歪み、光る第三の目が浮かぶ ----
  function spawnPsychicBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 中心にピンク〜紫のフラッシュ
    particles.push({
      maxLife: 280,
      draw(ctx, t) {
        const alpha = t < 0.3 ? (t / 0.3) * 0.8 : 0.8 * (1 - (t - 0.3) / 0.7);
        const r = lerp(R * 0.1, R * 0.55, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#ffe0f4', alpha));
        grad.addColorStop(0.5, rgba('#e0559e', alpha * 0.8));
        grad.addColorStop(1, 'rgba(224,85,158,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 光る第三の目
    particles.push({
      delay: 80,
      maxLife: 320,
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t));
        ctx.fillStyle = rgba('#ffffff', alpha);
        ctx.shadowColor = rgba('#ff9fd6', 1);
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.ellipse(cx, cy, 10, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgba('#e0559e', alpha);
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 大きく歪む波紋リング（通常版3本→5本、より大きく歪む）
    for (let i = 0; i < 5; i++) {
      particles.push({
        delay: i * 70,
        maxLife: 480,
        draw(ctx, t) {
          const r = lerp(4, R * 0.7, easeOutCubic(t));
          const alpha = (1 - t) * 0.85;
          ctx.strokeStyle = rgba('#e0559e', alpha);
          ctx.lineWidth = 3.5;
          ctx.shadowColor = rgba('#ff9fd6', 0.9);
          ctx.shadowBlur = 14;
          ctx.beginPath();
          for (let a = 0; a < Math.PI * 2; a += 0.08) {
            const wobble = Math.sin(a * 6 + t * 12) * 5;
            const rr = r + wobble;
            const x = cx + Math.cos(a) * rr;
            const y = cy + Math.sin(a) * rr;
            if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
        }
      });
    }
    // 浮遊する念力の光点（通常版8個→18個）
    for (let i = 0; i < 18; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(20, 260),
        maxLife: rand(360, 520),
        a0,
        draw(ctx, t) {
          const dist = lerp(6, R * 0.55, easeOutCubic(t));
          const ang = this.a0 + t * 4;
          const x = cx + Math.cos(ang) * dist;
          const y = cy + Math.sin(ang) * dist;
          const alpha = 1 - t;
          ctx.fillStyle = rgba('#f0a8d8', alpha);
          ctx.shadowColor = rgba('#ff9fd6', 0.9);
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }


  function spawnRock(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    particles.push({
      maxLife: 180,
      draw(ctx, t) {
        const r = lerp(6, Math.max(w, h) * 0.32, easeOutCubic(t));
        const alpha = (1 - t);
        ctx.fillStyle = rgba('#8a6a45', alpha * 0.5);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    for (let i = 0; i < 12; i++) {
      const angle = rand(0, Math.PI * 2);
      const dist = rand(Math.max(w, h) * 0.2, Math.max(w, h) * 0.48);
      particles.push({
        delay: rand(0, 90),
        maxLife: rand(280, 420),
        angle, dist,
        size: rand(6, 13),
        rot: rand(0, Math.PI * 2),
        col: pick(['#8a6a45', '#6e5335', '#a58257']),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const fall = t > 0.5 ? easeInCubic((t - 0.5) / 0.5) : 0;
          const x = cx + Math.cos(this.angle) * this.dist * e;
          const y = cy + Math.sin(this.angle) * this.dist * e + fall * 24;
          const alpha = 1 - Math.max(0, (t - 0.7) / 0.3);
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 5);
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.beginPath();
          ctx.moveTo(-this.size / 2, this.size / 2);
          ctx.lineTo(0, -this.size / 2);
          ctx.lineTo(this.size / 2, this.size / 2);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      });
    }
  }

  // ---- いわ・豪華版：巨大な岩塊が連続で叩きつけられ、地面が砕け散る ----
  function spawnRockBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 巨大な茶色フラッシュ
    particles.push({
      maxLife: 220,
      draw(ctx, t) {
        const r = lerp(6, R * 0.5, easeOutCubic(t));
        const alpha = (1 - t) * 0.6;
        ctx.fillStyle = rgba('#8a6a45', alpha * 0.7);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 連続落石インパクト（3連撃）
    for (let hit = 0; hit < 3; hit++) {
      const x0 = cx + rand(-w * 0.2, w * 0.2);
      particles.push({
        delay: hit * 120,
        maxLife: 200,
        x0,
        draw(ctx, t) {
          const alpha = (1 - t) * 0.8;
          const r = lerp(4, w * 0.28, easeOutCubic(t));
          ctx.strokeStyle = rgba('#6e5335', alpha);
          ctx.lineWidth = 6 * (1 - t);
          ctx.beginPath();
          ctx.arc(this.x0, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 飛び散る岩塊（通常版12個→26個、大きめの塊も混ぜる）
    for (let i = 0; i < 26; i++) {
      const angle = rand(0, Math.PI * 2);
      const dist = rand(R * 0.15, R * 0.7);
      particles.push({
        delay: rand(0, 160),
        maxLife: rand(320, 500),
        angle, dist,
        size: rand(7, 20),
        rot: rand(0, Math.PI * 2),
        col: pick(['#8a6a45', '#6e5335', '#a58257']),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const fall = t > 0.5 ? easeInCubic((t - 0.5) / 0.5) : 0;
          const x = cx + Math.cos(this.angle) * this.dist * e;
          const y = cy + Math.sin(this.angle) * this.dist * e + fall * 34;
          const alpha = 1 - Math.max(0, (t - 0.7) / 0.3);
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 6);
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.beginPath();
          ctx.moveTo(-this.size / 2, this.size / 2);
          ctx.lineTo(0, -this.size / 2);
          ctx.lineTo(this.size / 2, this.size / 2);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      });
    }
    // 舞い上がる砂埃
    particles.push({
      maxLife: 420,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.4;
        const r = lerp(8, R * 0.55, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#a58257', alpha));
        grad.addColorStop(1, 'rgba(140,110,70,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }


  function spawnSteel(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    particles.push({
      maxLife: 260,
      draw(ctx, t) {
        const r = lerp(4, Math.max(w, h) * 0.5, easeOutCubic(t));
        const alpha = (1 - t) * 0.7;
        ctx.strokeStyle = rgba('#c7d3da', alpha);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    // 十字型のきらめき（メタリックフラッシュ）
    for (let i = 0; i < 4; i++) {
      const angle = (Math.PI / 4) + (Math.PI / 2) * i;
      particles.push({
        delay: 30,
        maxLife: 240,
        draw(ctx, t) {
          const len = lerp(4, Math.max(w, h) * 0.4, easeOutCubic(t));
          const alpha = 1 - t;
          const x0 = cx - Math.cos(angle) * len;
          const y0 = cy - Math.sin(angle) * len;
          const x1 = cx + Math.cos(angle) * len;
          const y1 = cy + Math.sin(angle) * len;
          ctx.strokeStyle = rgba('#eef4f7', alpha);
          ctx.lineWidth = 2.4;
          ctx.shadowColor = rgba('#ffffff', 0.9);
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      });
    }
    // 金属片
    for (let i = 0; i < 6; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(20, 140),
        maxLife: rand(260, 360),
        a0,
        rot: rand(0, Math.PI * 2),
        draw(ctx, t) {
          const dist = lerp(4, Math.max(w, h) * 0.38, easeOutCubic(t));
          const x = cx + Math.cos(this.a0) * dist;
          const y = cy + Math.sin(this.a0) * dist;
          const alpha = 1 - t;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 4);
          ctx.fillStyle = rgba('#dfe8ec', alpha);
          ctx.fillRect(-4, -1.5, 8, 3);
          ctx.restore();
        }
      });
    }
  }

  // ---- はがね・豪華版：銀の巨大な刃が交差し、鋭いメタリックフラッシュが連続で輝く ----
  function spawnSteelBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 中心の銀白フラッシュ
    particles.push({
      maxLife: 240,
      draw(ctx, t) {
        const alpha = t < 0.25 ? (t / 0.25) * 0.9 : 0.9 * (1 - (t - 0.25) / 0.75);
        const r = lerp(R * 0.08, R * 0.55, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#ffffff', alpha));
        grad.addColorStop(0.5, rgba('#c7d3da', alpha * 0.85));
        grad.addColorStop(1, 'rgba(199,211,218,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 拡大するリング（通常版1本→3本）
    for (let i = 0; i < 3; i++) {
      particles.push({
        delay: i * 60,
        maxLife: 340,
        draw(ctx, t) {
          const r = lerp(4, R * 0.65, easeOutCubic(t));
          const alpha = (1 - t) * 0.75;
          ctx.strokeStyle = rgba('#c7d3da', alpha);
          ctx.lineWidth = 4;
          ctx.shadowColor = rgba('#ffffff', 0.7);
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 巨大な刃のようなメタリックフラッシュ十字（通常版4本→8本）
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI / 8) + (Math.PI / 4) * i;
      particles.push({
        delay: (i % 4) * 25,
        maxLife: 280,
        draw(ctx, t) {
          const len = lerp(4, R * 0.55, easeOutCubic(t));
          const alpha = 1 - t;
          const x0 = cx - Math.cos(angle) * len;
          const y0 = cy - Math.sin(angle) * len;
          const x1 = cx + Math.cos(angle) * len;
          const y1 = cy + Math.sin(angle) * len;
          ctx.strokeStyle = rgba('#eef4f7', alpha);
          ctx.lineWidth = 3;
          ctx.shadowColor = rgba('#ffffff', 1);
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      });
    }
    // 飛び散る金属片（通常版6個→16個）
    for (let i = 0; i < 16; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(20, 220),
        maxLife: rand(300, 440),
        a0,
        rot: rand(0, Math.PI * 2),
        draw(ctx, t) {
          const dist = lerp(4, R * 0.55, easeOutCubic(t));
          const x = cx + Math.cos(this.a0) * dist;
          const y = cy + Math.sin(this.a0) * dist;
          const alpha = 1 - t;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * 5);
          ctx.fillStyle = rgba('#dfe8ec', alpha);
          ctx.shadowColor = rgba('#ffffff', 0.9);
          ctx.shadowBlur = 6;
          ctx.fillRect(-5, -2, 10, 4);
          ctx.restore();
        }
      });
    }
  }


  function spawnWater(particles, w, h) {
    const cx = w / 2, cy = h * 0.6;
    particles.push({
      maxLife: 340,
      draw(ctx, t) {
        const r = lerp(6, Math.max(w, h) * 0.42, easeOutCubic(t));
        const alpha = (1 - t) * 0.6;
        ctx.strokeStyle = rgba('#3ca0e6', alpha);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r, r * 0.5, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    for (let i = 0; i < 14; i++) {
      const angle = rand(-Math.PI, 0);
      const dist = rand(Math.max(w, h) * 0.15, Math.max(w, h) * 0.42);
      particles.push({
        delay: rand(0, 120),
        maxLife: rand(280, 420),
        angle, dist,
        size: rand(3, 7),
        col: pick(['#3ca0e6', '#7cc4f0', '#1c6fb0']),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const fall = t > 0.4 ? easeInCubic((t - 0.4) / 0.6) : 0;
          const x = cx + Math.cos(this.angle) * this.dist * e;
          const y = cy + Math.sin(this.angle) * this.dist * e + fall * 30;
          const alpha = 1 - Math.max(0, (t - 0.65) / 0.35);
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.beginPath();
          ctx.arc(x, y, this.size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
  }

  // ---- みず・豪華版：巨大な水柱が噴き上がり、大量のしぶきと波紋が広がる ----
  function spawnWaterBig(particles, w, h) {
    const cx = w / 2, cy = h * 0.6;
    const R = Math.max(w, h);
    // 中心の青いフラッシュ
    particles.push({
      maxLife: 260,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.7;
        const r = lerp(6, R * 0.5, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#eaf8ff', alpha));
        grad.addColorStop(0.5, rgba('#3ca0e6', alpha * 0.85));
        grad.addColorStop(1, 'rgba(60,160,230,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 二重の波紋リング
    for (let i = 0; i < 3; i++) {
      particles.push({
        delay: i * 90,
        maxLife: 460,
        draw(ctx, t) {
          const r = lerp(6, R * 0.6, easeOutCubic(t));
          const alpha = (1 - t) * 0.65;
          ctx.strokeStyle = rgba('#3ca0e6', alpha);
          ctx.lineWidth = 3.5;
          ctx.beginPath();
          ctx.ellipse(cx, cy, r, r * 0.5, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 大量に噴き上がる水しぶき（通常版14個→30個）
    for (let i = 0; i < 30; i++) {
      const angle = rand(-Math.PI, 0);
      const dist = rand(R * 0.15, R * 0.6);
      particles.push({
        delay: rand(0, 220),
        maxLife: rand(340, 520),
        angle, dist,
        size: rand(4, 10),
        col: pick(['#3ca0e6', '#7cc4f0', '#1c6fb0', '#eaf8ff']),
        draw(ctx, t) {
          const e = easeOutCubic(t);
          const fall = t > 0.4 ? easeInCubic((t - 0.4) / 0.6) : 0;
          const x = cx + Math.cos(this.angle) * this.dist * e;
          const y = cy + Math.sin(this.angle) * this.dist * e + fall * 44;
          const alpha = 1 - Math.max(0, (t - 0.65) / 0.35);
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.shadowColor = rgba('#3ca0e6', 0.6);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(x, y, this.size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 中心から立ち上る巨大な水柱
    particles.push({
      maxLife: 380,
      draw(ctx, t) {
        const rise = easeOutCubic(Math.min(1, t * 1.5));
        const h0 = h * 0.55 * rise;
        const alpha = (1 - Math.max(0, (t - 0.6) / 0.4)) * 0.75;
        const grad = ctx.createLinearGradient(cx, cy, cx, cy - h0);
        grad.addColorStop(0, rgba('#3ca0e6', alpha));
        grad.addColorStop(1, rgba('#eaf8ff', 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(cx, cy - h0 / 2, 22, h0 / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }


  function spawnSound(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 4; i++) {
      particles.push({
        delay: i * 70,
        maxLife: 320,
        draw(ctx, t) {
          const r = lerp(4, Math.max(w, h) * 0.55, easeOutCubic(t));
          const alpha = (1 - t) * 0.75;
          ctx.strokeStyle = rgba('#ffb347', alpha);
          ctx.lineWidth = 3 * (1 - t * 0.5);
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
  }

  // ---- サウンド・豪華版：巨大な同心円の音波が連続で広がり、空気を震わせる ----
  function spawnSoundBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 中心のオレンジフラッシュ
    particles.push({
      maxLife: 220,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.7;
        const r = lerp(4, R * 0.35, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#fff2d9', alpha));
        grad.addColorStop(1, 'rgba(255,179,71,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 同心円状の音波リング（通常版4本→8本、より速く・より遠くまで）
    for (let i = 0; i < 8; i++) {
      particles.push({
        delay: i * 55,
        maxLife: 420,
        draw(ctx, t) {
          const r = lerp(4, R * 0.8, easeOutCubic(t));
          const alpha = (1 - t) * 0.75;
          ctx.strokeStyle = rgba('#ffb347', alpha);
          ctx.lineWidth = 4 * (1 - t * 0.5);
          ctx.shadowColor = rgba('#ffe0a8', 0.7);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // 震える波形の輪郭線（新規：音の揺らぎを表現）
    for (let i = 0; i < 2; i++) {
      particles.push({
        delay: i * 120,
        maxLife: 380,
        draw(ctx, t) {
          const rBase = lerp(6, R * 0.5, easeOutCubic(t));
          const alpha = (1 - t) * 0.6;
          ctx.strokeStyle = rgba('#ffcf7a', alpha);
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          for (let a = 0; a < Math.PI * 2; a += 0.1) {
            const wobble = Math.sin(a * 10 + t * 16) * 6;
            const r = rBase + wobble;
            const x = cx + Math.cos(a) * r;
            const y = cy + Math.sin(a) * r;
            if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
        }
      });
    }
  }


  function spawnShine(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    particles.push({
      maxLife: 340,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.85;
        const r = lerp(4, Math.max(w, h) * 0.42, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#fff6c8', alpha));
        grad.addColorStop(0.5, rgba('#ffd23f', alpha * 0.7));
        grad.addColorStop(1, 'rgba(255,210,63,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 放射状の光条
    const rays = 8;
    for (let i = 0; i < rays; i++) {
      const angle = (Math.PI * 2 * i) / rays;
      particles.push({
        delay: 30,
        maxLife: 300,
        draw(ctx, t) {
          const len = lerp(4, Math.max(w, h) * 0.55, easeOutCubic(t));
          const alpha = (1 - t) * 0.8;
          const x1 = cx + Math.cos(angle) * len;
          const y1 = cy + Math.sin(angle) * len;
          ctx.strokeStyle = rgba('#ffe98a', alpha);
          ctx.lineWidth = 2.5;
          ctx.shadowColor = rgba('#fff6c8', 0.9);
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      });
    }
    // きらめく星の粒子
    for (let i = 0; i < 10; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(20, 160),
        maxLife: rand(300, 420),
        a0,
        rot: rand(0, Math.PI * 2),
        draw(ctx, t) {
          const dist = lerp(6, Math.max(w, h) * 0.4, easeOutCubic(t));
          const x = cx + Math.cos(this.a0) * dist;
          const y = cy + Math.sin(this.a0) * dist;
          const alpha = Math.sin(Math.PI * clamp01(t));
          ctx.fillStyle = rgba('#fff2b0', alpha);
          ctx.shadowColor = rgba('#ffe98a', 0.9);
          ctx.shadowBlur = 8;
          drawStar(ctx, x, y, lerp(6, 2, t), this.rot + t * 3);
        }
      });
    }
  }

  // ---- シャイン・豪華版：黄金の巨大な太陽フレアが炸裂し、光条と星が画面を埋め尽くす ----
  function spawnShineBig(particles, w, h) {
    const cx = w / 2, cy = h / 2;
    const R = Math.max(w, h);
    // 中心の巨大な黄金グロー
    particles.push({
      maxLife: 420,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.9;
        const r = lerp(4, R * 0.65, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, rgba('#ffffff', alpha));
        grad.addColorStop(0.35, rgba('#fff6c8', alpha * 0.9));
        grad.addColorStop(0.7, rgba('#ffd23f', alpha * 0.6));
        grad.addColorStop(1, 'rgba(255,210,63,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 放射状の巨大な光条（通常版8本→16本、画面外周まで届く）
    const rays = 16;
    for (let i = 0; i < rays; i++) {
      const angle = (Math.PI * 2 * i) / rays;
      particles.push({
        delay: 20,
        maxLife: 380,
        draw(ctx, t) {
          const len = lerp(4, R * 0.85, easeOutCubic(t));
          const alpha = (1 - t) * 0.85;
          const x1 = cx + Math.cos(angle) * len;
          const y1 = cy + Math.sin(angle) * len;
          ctx.strokeStyle = rgba('#ffe98a', alpha);
          ctx.lineWidth = 3.5;
          ctx.shadowColor = rgba('#fff6c8', 1);
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      });
    }
    // ゆっくり回転する巨大リング（2重）
    for (let i = 0; i < 2; i++) {
      particles.push({
        delay: i * 90,
        maxLife: 460,
        draw(ctx, t) {
          const r = lerp(6, R * 0.6, easeOutCubic(t));
          const alpha = (1 - t) * 0.7;
          ctx.strokeStyle = rgba('#ffd23f', alpha);
          ctx.lineWidth = 4;
          ctx.shadowColor = rgba('#fff6c8', 0.9);
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }
    // きらめく星の粒子（通常版10個→24個、遠くまで広がる）
    for (let i = 0; i < 24; i++) {
      const a0 = rand(0, Math.PI * 2);
      particles.push({
        delay: rand(20, 260),
        maxLife: rand(360, 540),
        a0,
        rot: rand(0, Math.PI * 2),
        draw(ctx, t) {
          const dist = lerp(6, R * 0.7, easeOutCubic(t));
          const x = cx + Math.cos(this.a0) * dist;
          const y = cy + Math.sin(this.a0) * dist;
          const alpha = Math.sin(Math.PI * clamp01(t));
          ctx.fillStyle = rgba('#fff2b0', alpha);
          ctx.shadowColor = rgba('#ffe98a', 1);
          ctx.shadowBlur = 10;
          drawStar(ctx, x, y, lerp(9, 3, t), this.rot + t * 4);
        }
      });
    }
  }

  // ============================================================
  // 専用大技エフェクト（インフェルノ／メイルストローム／イルミンスール）
  // 通常のタイプエフェクトとは別枠。sprite-slotではなく戦闘画面全体（battle-field）
  // を覆う専用キャンバスで再生する、長め・大迫力の一点物演出。
  // 構成は共通して「地面（画面下部）から巨大な柱が突き上げる」→「そのまま持続」
  // →「周囲に欠片（火の粉／雨／土）が降り注ぐ」の3幕構成。
  // ============================================================

  // ---- インフェルノ：下から炎が噴き上げ、火の粉が舞い降りる ----
  function spawnInfernoSpecial(particles, w, h) {
    const cx = w / 2, groundY = h * 0.92;
    const R = Math.max(w, h);

    // 幕0: 地面が明滅するフラッシュ（予兆）
    particles.push({
      maxLife: 220,
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t)) * 0.8;
        const grad = ctx.createRadialGradient(cx, groundY, 0, cx, groundY, w * 0.55);
        grad.addColorStop(0, rgba('#ffdf8a', alpha));
        grad.addColorStop(0.5, rgba('#ff7a1a', alpha * 0.6));
        grad.addColorStop(1, 'rgba(255,90,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, groundY - h * 0.3, w, h * 0.5);
      }
    });

    // 幕1: 地割れのような亀裂の光（発生源）
    for (let i = 0; i < 5; i++) {
      const ang = rand(-1.3, -1.8);
      particles.push({
        delay: 40 + i * 15,
        maxLife: 300,
        ang,
        draw(ctx, t) {
          const len = lerp(6, w * 0.22, easeOutCubic(t));
          const alpha = (1 - t) * 0.9;
          ctx.save();
          ctx.translate(cx + rand(-40, 40), groundY);
          ctx.rotate(this.ang);
          ctx.strokeStyle = rgba('#ffb347', alpha);
          ctx.lineWidth = 3;
          ctx.shadowColor = rgba('#fff2b0', 1);
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(len, 0);
          ctx.stroke();
          ctx.restore();
        }
      });
    }

    // 幕2: 巨大な炎の柱が地面から突き上げる（メインビジュアル）
    const columnStart = 180;
    const columnRise = 520;
    for (let i = 0; i < 60; i++) {
      const x0 = cx + rand(-w * 0.2, w * 0.2);
      particles.push({
        delay: columnStart + rand(0, 260),
        maxLife: rand(560, 760),
        x0,
        drift: rand(-14, 14),
        size: rand(16, 34),
        col: pick(['#ff7a1a', '#ff4d2e', '#ffb347', '#ffe17a', '#fff2b0']),
        draw(ctx, t) {
          const rise = h * 1.05;
          const y = groundY - easeOutCubic(t) * rise;
          const x = this.x0 + this.drift * t + Math.sin(t * 9 + this.x0) * 7;
          const alpha = t < 0.1 ? t / 0.1 : (1 - (t - 0.1) / 0.9);
          const size = this.size * (1 - t * 0.45);
          const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
          grad.addColorStop(0, rgba('#fff6cf', alpha));
          grad.addColorStop(0.35, rgba(this.col, alpha * 0.95));
          grad.addColorStop(1, 'rgba(255,60,0,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 柱の芯（縦に伸びる明るいコア）
    particles.push({
      delay: columnStart,
      maxLife: columnRise + 260,
      draw(ctx, t) {
        const rise = easeOutCubic(Math.min(1, t * 1.4));
        const h0 = h * 0.85 * rise;
        const alpha = (1 - Math.max(0, (t - 0.55) / 0.45)) * 0.85;
        const grad = ctx.createLinearGradient(cx, groundY, cx, groundY - h0);
        grad.addColorStop(0, rgba('#fff6cf', alpha));
        grad.addColorStop(0.4, rgba('#ff9142', alpha * 0.9));
        grad.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(cx, groundY - h0 / 2, 30, h0 / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 爆風の輪（柱の根本から広がる）
    for (let i = 0; i < 2; i++) {
      particles.push({
        delay: columnStart + i * 100,
        maxLife: 380,
        draw(ctx, t) {
          const r = lerp(w * 0.08, R * 0.55, easeOutCubic(t));
          const alpha = (1 - t) * 0.7;
          ctx.strokeStyle = rgba('#ff9142', alpha);
          ctx.lineWidth = 7 * (1 - t * 0.6);
          ctx.shadowColor = rgba('#ffb347', 0.9);
          ctx.shadowBlur = 16;
          ctx.beginPath();
          ctx.ellipse(cx, groundY, r, r * 0.32, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }

    // 幕3: 火の粉（かけら）が画面全体からふわりと降ってくる
    const emberStart = 620;
    for (let i = 0; i < 34; i++) {
      const x0 = rand(w * 0.02, w * 0.98);
      const y0 = rand(-h * 0.15, h * 0.35);
      particles.push({
        delay: emberStart + rand(0, 480),
        maxLife: rand(680, 980),
        x0, y0,
        sway: rand(8, 22),
        swaySpeed: rand(1.4, 2.6),
        size: rand(2.5, 5.5),
        col: pick(['#ffb347', '#ffd23f', '#ff7a1a']),
        rot: rand(0, Math.PI * 2),
        draw(ctx, t) {
          const fall = easeInCubic(t);
          const y = this.y0 + fall * (h - this.y0) * 1.05;
          const x = this.x0 + Math.sin(t * this.swaySpeed * Math.PI + this.rot) * this.sway;
          const alpha = t < 0.08 ? t / 0.08 : (1 - Math.max(0, (t - 0.75) / 0.25));
          ctx.save();
          ctx.translate(x, y);
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.shadowColor = rgba('#ffdf8a', 0.9);
          ctx.shadowBlur = 7;
          ctx.beginPath();
          ctx.arc(0, 0, this.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      });
    }
  }

  // ---- メイルストローム：地面に渦潮ができ、回転しながら水柱が突き上げ、雨が降る ----
  function spawnMaelstromSpecial(particles, w, h) {
    const cx = w / 2, groundY = h * 0.92;
    const R = Math.max(w, h);

    // 幕1: 地面に渦潮（回転する同心の楕円）が広がる
    for (let i = 0; i < 4; i++) {
      particles.push({
        delay: i * 60,
        maxLife: 420,
        idx: i,
        draw(ctx, t) {
          const rx = lerp(w * 0.05, w * 0.34, easeOutCubic(t));
          const ry = rx * 0.32;
          const alpha = (1 - t) * 0.75;
          ctx.save();
          ctx.translate(cx, groundY);
          ctx.rotate(t * 6 + this.idx);
          ctx.strokeStyle = rgba('#3ca0e6', alpha);
          ctx.lineWidth = 3.5;
          ctx.shadowColor = rgba('#bfe8ff', 0.9);
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 1.5);
          ctx.stroke();
          ctx.restore();
        }
      });
    }
    // 渦の中心の暗い穴（吸い込まれる感じ）
    particles.push({
      maxLife: 300,
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t)) * 0.6;
        const grad = ctx.createRadialGradient(cx, groundY, 0, cx, groundY, w * 0.16);
        grad.addColorStop(0, rgba('#08344f', alpha));
        grad.addColorStop(1, 'rgba(8,52,79,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(cx, groundY, w * 0.16, w * 0.05, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // 幕2: 回転しながら突き上げる巨大な水柱
    const columnStart = 200;
    // 柱の芯
    particles.push({
      delay: columnStart,
      maxLife: 620,
      draw(ctx, t) {
        const rise = easeOutCubic(Math.min(1, t * 1.4));
        const h0 = h * 0.95 * rise;
        const alpha = (1 - Math.max(0, (t - 0.55) / 0.45)) * 0.8;
        const grad = ctx.createLinearGradient(cx, groundY, cx, groundY - h0);
        grad.addColorStop(0, rgba('#1c6fb0', alpha));
        grad.addColorStop(0.5, rgba('#3ca0e6', alpha * 0.9));
        grad.addColorStop(1, 'rgba(200,235,255,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(cx, groundY - h0 / 2, 32, h0 / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 柱に巻き付く螺旋の飛沫（回転しながら上昇）
    for (let i = 0; i < 46; i++) {
      const phase = rand(0, Math.PI * 2);
      const radius0 = rand(14, 40);
      particles.push({
        delay: columnStart + rand(0, 300),
        maxLife: rand(500, 700),
        phase, radius0,
        size: rand(4, 9),
        col: pick(['#3ca0e6', '#7cc4f0', '#eaf8ff', '#1c6fb0']),
        draw(ctx, t) {
          const rise = easeOutCubic(t);
          const y = groundY - rise * h * 0.95;
          const spin = t * 10 + this.phase;
          const rad = this.radius0 * (1 - t * 0.4);
          const x = cx + Math.cos(spin) * rad;
          const alpha = t < 0.08 ? t / 0.08 : (1 - Math.max(0, (t - 0.7) / 0.3));
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.shadowColor = rgba('#bfe8ff', 0.8);
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.ellipse(x, y, this.size, this.size * 1.4, spin, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 頂点で弾ける飛沫の爆発
    particles.push({
      delay: columnStart + 420,
      maxLife: 340,
      draw(ctx, t) {
        const alpha = (1 - t) * 0.85;
        const r = lerp(10, w * 0.3, easeOutCubic(t));
        const grad = ctx.createRadialGradient(cx, groundY - h * 0.82, 0, cx, groundY - h * 0.82, r);
        grad.addColorStop(0, rgba('#eaf8ff', alpha));
        grad.addColorStop(0.5, rgba('#3ca0e6', alpha * 0.8));
        grad.addColorStop(1, 'rgba(60,160,230,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, groundY - h * 0.82, r, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    // 底面に広がる波紋
    for (let i = 0; i < 3; i++) {
      particles.push({
        delay: columnStart + i * 110,
        maxLife: 420,
        draw(ctx, t) {
          const r = lerp(w * 0.06, R * 0.5, easeOutCubic(t));
          const alpha = (1 - t) * 0.6;
          ctx.strokeStyle = rgba('#3ca0e6', alpha);
          ctx.lineWidth = 3.5;
          ctx.beginPath();
          ctx.ellipse(cx, groundY, r, r * 0.3, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
    }

    // 幕3: 辺り一面に雨が降る
    const rainStart = 640;
    for (let i = 0; i < 40; i++) {
      const x0 = rand(-w * 0.05, w * 1.05);
      const y0 = rand(-h * 0.3, h * 0.1);
      particles.push({
        delay: rainStart + rand(0, 420),
        maxLife: rand(420, 620),
        x0, y0,
        len: rand(16, 28),
        draw(ctx, t) {
          const fall = easeInCubic(t);
          const y = this.y0 + fall * (h - this.y0 + 40);
          const x = this.x0 - fall * 18;
          const alpha = t < 0.1 ? t / 0.1 : (1 - Math.max(0, (t - 0.8) / 0.2));
          ctx.strokeStyle = rgba('#aee0ff', alpha * 0.85);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - 6, y + this.len);
          ctx.stroke();
        }
      });
    }
  }

  // ---- イルミンスール：大地から大樹が突き上げ、土くれが周囲に散らばる ----
  function spawnYggdrasillSpecial(particles, w, h) {
    const cx = w / 2, groundY = h * 0.92;
    const R = Math.max(w, h);

    // 幕1: 地面の隆起（土煙のフラッシュ）
    particles.push({
      maxLife: 240,
      draw(ctx, t) {
        const alpha = Math.sin(Math.PI * clamp01(t)) * 0.75;
        const grad = ctx.createRadialGradient(cx, groundY, 0, cx, groundY, w * 0.5);
        grad.addColorStop(0, rgba('#c9a15a', alpha));
        grad.addColorStop(0.5, rgba('#7a5230', alpha * 0.55));
        grad.addColorStop(1, 'rgba(122,82,48,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, groundY - h * 0.1, w, h * 0.25);
      }
    });
    // 地割れの亀裂
    for (let i = 0; i < 6; i++) {
      const ang = rand(-2.6, -0.5);
      particles.push({
        delay: 30 + i * 12,
        maxLife: 280,
        ang,
        draw(ctx, t) {
          const len = lerp(6, w * 0.18, easeOutCubic(t));
          const alpha = (1 - t) * 0.85;
          ctx.save();
          ctx.translate(cx + rand(-50, 50), groundY);
          ctx.rotate(this.ang);
          ctx.strokeStyle = rgba('#8a6a3a', alpha);
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(len, 0);
          ctx.stroke();
          ctx.restore();
        }
      });
    }

    // 幕2: 巨大な大樹が地面から突き上げる（幹＋広がる枝葉）
    const treeStart = 200;
    // 幹（下から上へ伸びる）
    particles.push({
      delay: treeStart,
      maxLife: 640,
      draw(ctx, t) {
        const rise = easeOutCubic(Math.min(1, t * 1.3));
        const h0 = h * 0.98 * rise;
        const alpha = (1 - Math.max(0, (t - 0.6) / 0.4)) * 0.95;
        const topW = 26, botW = 46;
        const x = cx, yBot = groundY, yTop = groundY - h0;
        ctx.save();
        ctx.globalAlpha = alpha;
        const grad = ctx.createLinearGradient(x, yBot, x, yTop);
        grad.addColorStop(0, '#5a3a1e');
        grad.addColorStop(1, '#8a6a3a');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(x - botW / 2, yBot);
        ctx.lineTo(x - topW / 2, yTop);
        ctx.lineTo(x + topW / 2, yTop);
        ctx.lineTo(x + botW / 2, yBot);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    });
    // 幹から左右に伸びる枝（複数、時間差でせり出す）
    for (let i = 0; i < 8; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const heightRatio = 0.3 + (i / 8) * 0.6;
      const branchLen = w * rand(0.14, 0.24);
      particles.push({
        delay: treeStart + 120 + i * 40,
        maxLife: 420,
        side, heightRatio, branchLen,
        draw(ctx, t) {
          const alpha = (1 - Math.max(0, (t - 0.6) / 0.4)) * 0.9;
          const grow = easeOutCubic(t);
          const y = groundY - h * 0.98 * this.heightRatio;
          const x0 = cx;
          const x1 = cx + this.side * this.branchLen * grow;
          const y1 = y - this.branchLen * 0.35 * grow;
          ctx.strokeStyle = rgba('#6a4a26', alpha);
          ctx.lineWidth = 8 * (1 - this.heightRatio * 0.5);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x0, y);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
      });
    }
    // 樹冠（枝葉が茂る緑のグロー、複数重ねて豊かに）
    for (let i = 0; i < 5; i++) {
      const ox = rand(-w * 0.22, w * 0.22);
      const oy = rand(-h * 0.06, h * 0.06);
      particles.push({
        delay: treeStart + 260 + i * 30,
        maxLife: 460,
        ox, oy,
        size: rand(w * 0.16, w * 0.26),
        col: pick(['#5cb85c', '#7fd35f', '#3f9142', '#a8e063']),
        draw(ctx, t) {
          const alpha = (1 - Math.max(0, (t - 0.6) / 0.4)) * 0.85 * clamp01(t * 3);
          const y = groundY - h * 0.98 + this.oy;
          const x = cx + this.ox;
          const grad = ctx.createRadialGradient(x, y, 0, x, y, this.size);
          grad.addColorStop(0, rgba(this.col, alpha));
          grad.addColorStop(1, 'rgba(63,145,66,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(x, y, this.size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // 根本の砂煙の爆風リング
    particles.push({
      delay: treeStart,
      maxLife: 360,
      draw(ctx, t) {
        const r = lerp(w * 0.08, R * 0.5, easeOutCubic(t));
        const alpha = (1 - t) * 0.65;
        ctx.strokeStyle = rgba('#a8875a', alpha);
        ctx.lineWidth = 7 * (1 - t * 0.6);
        ctx.beginPath();
        ctx.ellipse(cx, groundY, r, r * 0.3, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    // 幕3: 土くれが上から辺り一面に散らばる
    const debrisStart = 660;
    for (let i = 0; i < 30; i++) {
      const x0 = rand(w * 0.02, w * 0.98);
      const y0 = rand(-h * 0.2, h * 0.3);
      particles.push({
        delay: debrisStart + rand(0, 440),
        maxLife: rand(560, 820),
        x0, y0,
        size: rand(3, 6.5),
        rot: rand(0, Math.PI * 2),
        spin: rand(-4, 4),
        col: pick(['#8a6a3a', '#a8875a', '#6a4a26', '#c9a15a']),
        draw(ctx, t) {
          const fall = easeInCubic(t);
          const y = this.y0 + fall * (h - this.y0) * 1.05;
          const x = this.x0 + Math.sin(t * 3 + this.rot) * 6;
          const alpha = t < 0.08 ? t / 0.08 : (1 - Math.max(0, (t - 0.78) / 0.22));
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(this.rot + t * this.spin);
          ctx.fillStyle = rgba(this.col, alpha);
          ctx.beginPath();
          ctx.rect(-this.size / 2, -this.size / 2, this.size, this.size);
          ctx.fill();
          ctx.restore();
        }
      });
    }
  }

  // ---- レジストリ：moveType文字列 → spawn関数（通常版） ----
  const SCENES = {
    bug: spawnBug,
    dark: spawnDark,
    dragon: spawnDragon,
    electric: spawnElectric,
    fairy: spawnFairy,
    fighting: spawnFighting,
    fire: spawnFire,
    flying: spawnFlying,
    ghost: spawnGhost,
    grass: spawnGrass,
    ground: spawnGround,
    ice: spawnIce,
    normal: spawnNormal,
    poison: spawnPoison,
    psychic: spawnPsychic,
    rock: spawnRock,
    steel: spawnSteel,
    water: spawnWater,
    sound: spawnSound,
    shine: spawnShine,
  };
  const DURATION_MS = {
    bug: 480, dark: 460, dragon: 480, electric: 340, fairy: 500,
    fighting: 380, fire: 560, flying: 500, ghost: 520, grass: 500,
    ground: 520, ice: 440,
    normal: 300, poison: 460, psychic: 480, rock: 420, steel: 320,
    water: 420, sound: 380, shine: 420,
  };

  // ---- レジストリ：moveType文字列 → spawn関数（豪華版／威力90超）----
  // 各タイプごとに専用設計した豪華版シーンを使用（共通ブースターの使い回しは廃止）。
  const BIG_SCENES = {
    bug: spawnBugBig,
    dark: spawnDarkBig,
    dragon: spawnDragonBig,
    electric: spawnElectricBig,
    fairy: spawnFairyBig,
    fighting: spawnFightingBig,
    fire: spawnFireBig,
    flying: spawnFlyingBig,
    ghost: spawnGhostBig,
    grass: spawnGrassBig,
    ground: spawnGroundBig,
    ice: spawnIceBig,
    normal: spawnNormalBig,
    poison: spawnPoisonBig,
    psychic: spawnPsychicBig,
    rock: spawnRockBig,
    steel: spawnSteelBig,
    water: spawnWaterBig,
    sound: spawnSoundBig,
    shine: spawnShineBig,
  };
  // 豪華版は通常版より尺を伸ばし、「ちょっと長い豪華な演出」に見せる。
  const BIG_DURATION_MS = {};
  Object.keys(DURATION_MS).forEach((key) => {
    BIG_DURATION_MS[key] = Math.round(DURATION_MS[key] * 1.6) + 260;
  });

  // ============================================================
  // 公開API： playCanvasTypeEffect(wrapEl, moveType, big) -> Promise
  // wrapEl: sprite-slot要素（position:relative）
  // moveType: 'fire' 'water' 'bug' ... などのタイプキー
  // big: true のとき、威力90超の技向けの豪華版シーンを再生する。
  // 対応シーンが無いタイプ（未実装分）は null を返し、呼び出し側で
  // 従来の絵文字エフェクトにフォールバックできるようにする。
  // ============================================================
  function playCanvasTypeEffect(wrapEl, moveType, big) {
    const scenes = big ? BIG_SCENES : SCENES;
    const spawn = scenes[moveType];
    if (!spawn || !wrapEl) return null;
    const rect = wrapEl.getBoundingClientRect();
    const w = Math.max(60, Math.round(rect.width || wrapEl.offsetWidth || 120));
    const h = Math.max(60, Math.round(rect.height || wrapEl.offsetHeight || 120));
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '5';
    canvas.className = 'type-fx-canvas';
    wrapEl.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const duration = (big ? BIG_DURATION_MS[moveType] : DURATION_MS[moveType]) || 420;
    return runParticleScene({
      canvas: { getContext: () => ctx, width: w, height: h },
      durationMs: duration,
      spawn,
    }).then(() => {
      canvas.remove();
    });
  }

  // ============================================================
  // 専用大技エフェクト：技ID → spawn関数（技ごとの専用フルスクリーン演出）
  // wrapEl には battle-field 全体（スプライト枠ではない、画面全体のコンテナ）を渡す。
  // ============================================================
  const SPECIAL_SCENES = {
    480: spawnInfernoSpecial,       // インフェルノ
    483: spawnMaelstromSpecial,     // メイルストローム
    484: spawnYggdrasillSpecial,    // イルミンスール
  };
  const SPECIAL_DURATION_MS = {
    480: 1750,
    483: 1750,
    484: 1750,
  };

  function playSpecialTypeEffect(wrapEl, moveId) {
    const spawn = SPECIAL_SCENES[moveId];
    if (!spawn || !wrapEl) return null;
    const rect = wrapEl.getBoundingClientRect();
    const w = Math.max(60, Math.round(rect.width || wrapEl.offsetWidth || 300));
    const h = Math.max(60, Math.round(rect.height || wrapEl.offsetHeight || 300));
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.style.pointerEvents = 'none';
    canvas.className = 'special-fx-canvas';
    wrapEl.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const duration = SPECIAL_DURATION_MS[moveId] || 1600;
    return runParticleScene({
      canvas: { getContext: () => ctx, width: w, height: h },
      durationMs: duration,
      spawn,
    }).then(() => {
      canvas.remove();
    });
  }

  global.TypeFX = {
    play: playCanvasTypeEffect,
    playSpecial: playSpecialTypeEffect,
    SUPPORTED_TYPES: Object.keys(SCENES),
    SPECIAL_MOVE_IDS: Object.keys(SPECIAL_SCENES).map(Number),
  };
})(window);
