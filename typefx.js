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

  // ---- でんき (electric)：ジグザグ稲妻 + スパーク ----
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

  // ---- フェアリー (fairy)：ピンクの星の粒子が舞う ----
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

  // ---- かくとう (fighting)：赤オレンジの衝撃線（インパクト）----
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

  // ---- ほのお (fire)：立ち上る炎の粒子 ----
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

  // ---- ひこう (flying)：白い風の渦 + 羽根 ----
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

  // ---- ゴースト (ghost)：紫の靄と揺らめく目 ----
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

  // ---- くさ (grass)：緑の葉とつるの躍動 ----
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

  // ---- じめん (ground)：地割れと舞い上がる岩の破片 ----
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

  // ---- こおり (ice)：氷の結晶が飛び散る（+αで用意） ----
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

  // ---- ノーマル (normal)：白い光の斬撃＋シンプルな衝撃波 ----
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

  // ---- どく (poison)：紫の毒々しい気泡が立ち上る ----
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

  // ---- エスパー (psychic)：ピンク〜紫のサイコウェーブと歪む波紋 ----
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

  // ---- いわ (rock)：茶色い岩塊が飛び散る重い衝撃 ----
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

  // ---- はがね (steel)：銀色の金属光沢と鋭い光の反射 ----
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

  // ---- みず (water)：青い水しぶきと波紋 ----
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

  // ---- サウンド (sound)：同心円状の音波リング ----
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

  // ---- シャイン (shine)：黄金の光の粒子と輝く光条 ----
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

  // ---- レジストリ：moveType文字列 → spawn関数 ----
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

  // ============================================================
  // 公開API： playCanvasTypeEffect(wrapEl, moveType) -> Promise
  // wrapEl: sprite-slot要素（position:relative）
  // moveType: 'fire' 'water' 'bug' ... などのタイプキー
  // 対応シーンが無いタイプ（未実装分）は null を返し、呼び出し側で
  // 従来の絵文字エフェクトにフォールバックできるようにする。
  // ============================================================
  function playCanvasTypeEffect(wrapEl, moveType) {
    const spawn = SCENES[moveType];
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

    const duration = DURATION_MS[moveType] || 420;
    return runParticleScene({
      canvas: { getContext: () => ctx, width: w, height: h },
      durationMs: duration,
      spawn,
    }).then(() => {
      canvas.remove();
    });
  }

  global.TypeFX = { play: playCanvasTypeEffect, SUPPORTED_TYPES: Object.keys(SCENES) };
})(window);
