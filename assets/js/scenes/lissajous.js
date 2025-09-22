// Сцена ліссажу відповідає за плавні об'ємні траєкторії.
// Клас нижче реалізує всі етапи життєвого циклу: ініціалізацію, ресайз, оновлення та промальовування.

class LissajousScene {
  constructor() {
    // Заздалегідь створюємо поля, щоб уникнути повторних виділень пам'яті.
    this.width = CONFIG.global.DESIGN_WIDTH;
    this.height = CONFIG.global.DESIGN_HEIGHT;
    this.time = 0; // Фізичний час анімації у секундах.
    this.phase = "intro"; // Стан сцени: intro (побудова) або main (звичайна анімація).
    this.startedAt = performance.now();
    this.introDurationMs = CONFIG.global.INTRO_DURATION_MS;

    this.mode = CONFIG.global.ENABLE_3D_BY_DEFAULT ? "3d" : "2d";
    this.modeLockedTo2d = !CONFIG.global.ENABLE_3D_BY_DEFAULT;

    this.seed = "";
    this.params = null;
    this.curves = [];
  }

  /**
   * Підготовка сцени на основі seed та генератора псевдовипадкових чисел.
   * @param {string} seedStr - Рядок, що описує дату та час.
   * @param {{ next: () => number }} prng - Детермінований генератор випадкових чисел.
   */
  init(seedStr, prng) {
    this.seed = seedStr;
    this.time = 0;
    this.phase = "intro";
    this.startedAt = performance.now();
    this.mode = CONFIG.global.ENABLE_3D_BY_DEFAULT ? "3d" : "2d";
    this.modeLockedTo2d = !CONFIG.global.ENABLE_3D_BY_DEFAULT;

    const freqX = 1 + Math.floor(prng.next() * 8);
    const freqY = 1 + Math.floor(prng.next() * 8);
    const freqZ = 1 + Math.floor(prng.next() * 6);

    const phaseBase = prng.next() * Math.PI * 2;
    const phaseSpeed = 0.2 + prng.next() * 0.35;
    const phaseOffsetZ = prng.next() * Math.PI * 2;

    const ampXRatio = 0.35 + prng.next() * 0.5;
    const ampYRatio = 0.35 + prng.next() * 0.5;
    const ampZRatio = 0.25 + prng.next() * 0.35;

    const lineWidth = 1.2 + prng.next() * 1.6;
    const alpha = 0.35 + prng.next() * 0.4;
    const iterationCount = 520 + Math.floor(prng.next() * 220);

    const rotationSpeedX = 0.12 + prng.next() * 0.22;
    const rotationSpeedY = 0.1 + prng.next() * 0.2;
    const rotationOffsetX = prng.next() * Math.PI * 2;
    const rotationOffsetY = prng.next() * Math.PI * 2;

    const pulseSpeed = 0.05 + prng.next() * 0.08;
    const pulseAmplitude = 0.12 + prng.next() * 0.08;

    const paletteCandidates = [
      ["#e8efff"],
      ["#e8efff", "#7f8cff"],
      ["#e8efff", "#7f8cff", "#00f6ff"],
      ["#f6d365", "#fda085"],
      ["#f0f3ff", "#7de2d1", "#ff8ba7"],
    ];
    const palette = paletteCandidates[Math.floor(prng.next() * paletteCandidates.length)];

    this.curves = palette.map((color) => ({
      color,
      offset: prng.next() * Math.PI * 2,
      zOffset: prng.next() * Math.PI * 2,
    }));

    this.params = {
      freqX,
      freqY,
      freqZ,
      phaseBase,
      phaseSpeed,
      phaseOffsetZ,
      ampXRatio,
      ampYRatio,
      ampZRatio,
      lineWidth,
      alpha,
      iterationCount,
      rotationSpeedX,
      rotationSpeedY,
      rotationOffsetX,
      rotationOffsetY,
      pulseSpeed,
      pulseAmplitude,
      perspectiveRatio: 1.15 + prng.next() * 0.6,
      glowStrength: 14 + prng.next() * 10,
    };

    this.updateGeometry();
  }

  /**
   * Перераховує амплітуди з урахуванням актуальних розмірів дизайн-рамки.
   */
  updateGeometry() {
    if (!this.params) return;

    this.params.centerX = this.width / 2;
    this.params.centerY = this.height / 2;

    const marginX = this.width * 0.08;
    const marginY = this.height * 0.1;

    this.params.ampX = (this.width / 2 - marginX) * this.params.ampXRatio;
    this.params.ampY = (this.height / 2 - marginY) * this.params.ampYRatio;

    const baseRadius = Math.min(this.params.ampX, this.params.ampY);
    this.params.ampZ = baseRadius * this.params.ampZRatio;

    this.params.perspective = this.height * this.params.perspectiveRatio;
  }

  /**
   * Оновлення розмірів дизайн-простору.
   * @param {number} width - Ширина дизайн-рамки.
   * @param {number} height - Висота дизайн-рамки.
   */
  resize(width, height) {
    this.width = Math.max(width, 200);
    this.height = Math.max(height, 200);
    this.updateGeometry();
  }

  /**
   * Оновлюємо логіку сцени. Під час intro час не рухається, щоб видно було промальовування.
   * @param {number} dt - Проміжок часу між кадрами у секундах.
   * @param {number} now - Поточний час (performance.now()).
   */
  update(dt, now) {
    if (!this.params) return;

    if (this.phase === "intro") {
      const progress = this.getIntroProgress(now);
      if (progress >= 1) {
        this.phase = "main";
      }
    } else {
      this.time += dt;
    }
  }

  /**
   * Малювання кривих на контексті канви.
   * @param {CanvasRenderingContext2D} ctx - 2D контекст.
   * @param {number} now - Поточний час у мілісекундах (performance.now()).
   */
  draw(ctx, now) {
    if (!this.params) return;

    const progress = this.getIntroProgress(now);
    const {
      freqX,
      freqY,
      freqZ,
      phaseBase,
      phaseSpeed,
      phaseOffsetZ,
      ampX,
      ampY,
      ampZ,
      lineWidth,
      alpha,
      iterationCount,
      rotationSpeedX,
      rotationSpeedY,
      rotationOffsetX,
      rotationOffsetY,
      pulseSpeed,
      pulseAmplitude,
      perspective,
      centerX,
      centerY,
      glowStrength,
    } = this.params;

    const phase = phaseBase + this.time * phaseSpeed;
    const totalCycles = Math.PI * 2 * (1 + Math.max(freqX, freqY));
    const visiblePoints = Math.max(2, Math.floor(iterationCount * progress));

    const driftRotationX = rotationOffsetX + (this.mode === "3d" ? this.time * rotationSpeedX : 0);
    const driftRotationY = rotationOffsetY + (this.mode === "3d" ? this.time * rotationSpeedY : 0);
    const pulseFactor = 1 + Math.sin(this.time * pulseSpeed) * pulseAmplitude;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowBlur = glowStrength;
    ctx.globalCompositeOperation = "lighter";

    for (let i = 0; i < this.curves.length; i += 1) {
      const curve = this.curves[i];
      ctx.strokeStyle = this.applyAlpha(curve.color, Math.min(1, alpha * pulseFactor));
      ctx.shadowColor = this.applyAlpha(curve.color, 0.25);
      ctx.lineWidth = lineWidth * pulseFactor;

      ctx.beginPath();
      for (let j = 0; j < visiblePoints; j += 1) {
        const t = (j / (iterationCount - 1)) * totalCycles;
        const baseX = Math.sin(freqX * t + phase + curve.offset) * ampX;
        const baseY = Math.sin(freqY * t + curve.offset) * ampY;

        let drawX = centerX + baseX;
        let drawY = centerY + baseY;

        if (this.mode === "3d") {
          const baseZ = Math.sin(freqZ * t + phaseOffsetZ + curve.zOffset) * ampZ;
          const rotated = this.rotatePoint3d(baseX, baseY, baseZ, driftRotationX, driftRotationY);
          const projected = this.projectPoint(rotated, perspective);
          drawX = centerX + projected.x;
          drawY = centerY + projected.y;
        }

        if (j === 0) {
          ctx.moveTo(drawX, drawY);
        } else {
          ctx.lineTo(drawX, drawY);
        }
      }
      ctx.stroke();
    }

    ctx.globalCompositeOperation = "source-over";
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
  }

  /**
   * Обчислюємо прогрес вступної анімації (0..1).
   * @param {number} now - Поточний час performance.now().
   */
  getIntroProgress(now) {
    const elapsed = now - this.startedAt;
    return Math.min(Math.max(elapsed / this.introDurationMs, 0), 1);
  }

  /**
   * Повертає кольори з доданою прозорістю у форматі rgba().
   * @param {string} color - Колір у форматі #RRGGBB.
   * @param {number} alpha - Прозорість 0..1.
   */
  applyAlpha(color, alpha) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  }

  /**
   * Обертання точки у 3D навколо осей X та Y.
   */
  rotatePoint3d(x, y, z, angleX, angleY) {
    const cosX = Math.cos(angleX);
    const sinX = Math.sin(angleX);
    const y1 = y * cosX - z * sinX;
    const z1 = y * sinX + z * cosX;

    const cosY = Math.cos(angleY);
    const sinY = Math.sin(angleY);
    const x2 = x * cosY + z1 * sinY;
    const z2 = -x * sinY + z1 * cosY;

    return { x: x2, y: y1, z: z2 };
  }

  /**
   * Проста перспективна проєкція точки на площину XY.
   */
  projectPoint(point, perspective) {
    const scale = perspective / (perspective + point.z);
    return { x: point.x * scale, y: point.y * scale };
  }

  /**
   * Примусово переводимо сцену у 2D-режим та запам'ятовуємо, що повернення до 3D не дозволено.
   */
  force2dMode() {
    this.mode = "2d";
    this.modeLockedTo2d = true;
  }

  /**
   * Скидаємо прапорець блокування режиму (використовується під час повного перезапуску).
   */
  resetModeLock() {
    this.modeLockedTo2d = !CONFIG.global.ENABLE_3D_BY_DEFAULT;
    this.mode = CONFIG.global.ENABLE_3D_BY_DEFAULT ? "3d" : "2d";
  }

  /**
   * Повертає поточний режим відображення.
   */
  getMode() {
    return this.mode;
  }

  /**
   * Перевіряє, чи заборонено повертатися у 3D без повного перезапуску.
   */
  isModeLockedTo2d() {
    return this.modeLockedTo2d;
  }
}

// Створюємо єдиний екземпляр сцени та робимо його доступним глобально.
window.lissajousScene = new LissajousScene();
