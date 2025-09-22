// RuneScene створює символічні руноподібні композиції з квантизованими параметрами.
// Логіка подібна до сцени ліссажу: окрема вступна анімація, 3D-нахил і авто-fallback у 2D.

class RuneScene {
  constructor() {
    this.width = CONFIG.global.DESIGN_WIDTH;
    this.height = CONFIG.global.DESIGN_HEIGHT;
    this.time = 0;
    this.phase = "intro";
    this.startedAt = performance.now();
    this.introDurationMs = CONFIG.global.INTRO_DURATION_MS;

    this.mode = CONFIG.global.ENABLE_3D_BY_DEFAULT ? "3d" : "2d";
    this.modeLockedTo2d = !CONFIG.global.ENABLE_3D_BY_DEFAULT;

    this.params = null;
  }

  /**
   * Ініціалізуємо руну на основі seed та PRNG.
   * @param {string} seedStr
   * @param {{ next: () => number }} prng
   */
  init(seedStr, prng) {
    this.seed = seedStr;
    this.time = 0;
    this.phase = "intro";
    this.startedAt = performance.now();
    this.mode = CONFIG.global.ENABLE_3D_BY_DEFAULT ? "3d" : "2d";
    this.modeLockedTo2d = !CONFIG.global.ENABLE_3D_BY_DEFAULT;

    const freqSet = CONFIG.rune.FREQ_SET;
    const freqX = this.pickFrequency(prng, freqSet);
    const freqY = this.pickFrequency(prng, freqSet, freqX);

    const phaseStep = (CONFIG.rune.PHASE_DEG_STEP * Math.PI) / 180;
    const maxSteps = Math.floor((Math.PI * 2) / phaseStep);
    const phaseX = Math.floor(prng.next() * maxSteps) * phaseStep;
    const phaseY = Math.floor(prng.next() * maxSteps) * phaseStep;

    const radialOptions = CONFIG.rune.RADIAL_SYMMETRY_OPTIONS;
    const radialSymmetry = radialOptions[Math.floor(prng.next() * radialOptions.length)];
    const mirrorX = prng.next() > 0.5;
    const mirrorY = prng.next() > 0.5;

    const marginRatioX = 0.12 + prng.next() * 0.05;
    const marginRatioY = 0.16 + prng.next() * 0.05;

    const lineRange = CONFIG.rune.LINE_WIDTH;
    const lineWidth = lineRange[0] + prng.next() * (lineRange[1] - lineRange[0]);

    const strokePalettes = [
      { stroke: "#f7f2e8", glow: "rgba(247, 242, 232, 0.35)" },
      { stroke: "#c8f5ff", glow: "rgba(200, 245, 255, 0.3)" },
      { stroke: "#ffd2ec", glow: "rgba(255, 210, 236, 0.32)" },
      { stroke: "#d9ffe5", glow: "rgba(217, 255, 229, 0.3)" },
    ];
    const palette = strokePalettes[Math.floor(prng.next() * strokePalettes.length)];

    const steps = 620;
    const depthFreq = 1 + Math.floor(prng.next() * 4);
    const depthPhase = prng.next() * Math.PI * 2;
    const basePoints = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = (i / steps) * Math.PI * 2;
      const normX = Math.sin(freqX * t + phaseX);
      const normY = Math.sin(freqY * t + phaseY);
      const derivativeX = freqX * Math.cos(freqX * t + phaseX);
      const derivativeY = freqY * Math.cos(freqY * t + phaseY);
      const depth = Math.sin(t * depthFreq + depthPhase);
      basePoints.push({
        x: normX,
        y: normY,
        z: depth,
        derivativeX,
        derivativeY,
        t,
      });
    }

    const transforms = this.buildTransforms(radialSymmetry, mirrorX, mirrorY);

    const decorationData = this.buildDecorations(basePoints, transforms, prng);
    const tickData = this.buildTickMarks(basePoints, transforms, prng);

    const rotationPerMinute = 3 + prng.next() * 2; // 3..5 градусів за хвилину.
    const driftRotationSpeed = (rotationPerMinute * Math.PI) / (180 * 60);
    const pulseSpeed = 0.25 + prng.next() * 0.2;
    const pulseAmplitude = 0.1 + prng.next() * 0.1;

    const tiltAmplitudeX = ((3 + prng.next() * 2) * Math.PI) / 180;
    const tiltAmplitudeY = ((2 + prng.next() * 2) * Math.PI) / 180;
    const tiltSpeedX = 0.18 + prng.next() * 0.18;
    const tiltSpeedY = 0.16 + prng.next() * 0.18;

    this.params = {
      freqX,
      freqY,
      phaseX,
      phaseY,
      basePoints,
      transforms,
      marginRatioX,
      marginRatioY,
      lineWidth,
      strokeColor: palette.stroke,
      glowColor: palette.glow,
      alpha: 0.92,
      decorationData,
      tickData,
      driftRotationSpeed,
      pulseSpeed,
      pulseAmplitude,
      depthScaleRatio: 0.08 + prng.next() * 0.06,
      perspectiveRatio: 1.2 + prng.next() * 0.5,
      tiltAmplitudeX,
      tiltAmplitudeY,
      tiltSpeedX,
      tiltSpeedY,
      glowStrength: 18 + prng.next() * 10,
    };

    this.updateGeometry();
  }

  /**
   * Готуємо амплітуди та центр після зміни розмірів.
   */
  updateGeometry() {
    if (!this.params) return;
    this.params.centerX = this.width / 2;
    this.params.centerY = this.height / 2;

    const marginX = this.width * this.params.marginRatioX;
    const marginY = this.height * this.params.marginRatioY;

    this.params.ampX = Math.max(80, this.width / 2 - marginX);
    this.params.ampY = Math.max(80, this.height / 2 - marginY);

    const baseRadius = Math.min(this.params.ampX, this.params.ampY);
    this.params.depthScale = baseRadius * this.params.depthScaleRatio;
    this.params.perspective = this.height * this.params.perspectiveRatio;
  }

  /**
   * Обробляємо зміну розміру дизайн-рамки.
   */
  resize(width, height) {
    this.width = Math.max(width, 200);
    this.height = Math.max(height, 200);
    this.updateGeometry();
  }

  /**
   * Під час intro чекаємо на завершення промальовування, потім запускаємо плавний drift.
   */
  update(dt, now) {
    if (!this.params) return;
    if (this.phase === "intro") {
      if (this.getIntroProgress(now) >= 1) {
        this.phase = "main";
      }
    } else {
      this.time += dt;
    }
  }

  /**
   * Рендеримо символ, декорації та насічки.
   */
  draw(ctx, now) {
    if (!this.params) return;

    const progress = this.getIntroProgress(now);
    const {
      basePoints,
      transforms,
      lineWidth,
      strokeColor,
      glowColor,
      alpha,
      decorationData,
      tickData,
      driftRotationSpeed,
      pulseSpeed,
      pulseAmplitude,
      ampX,
      ampY,
      centerX,
      centerY,
      depthScale,
      perspective,
      tiltAmplitudeX,
      tiltAmplitudeY,
      tiltSpeedX,
      tiltSpeedY,
      glowStrength,
    } = this.params;

    const rotation = this.time * driftRotationSpeed;
    const pulse = 1 + Math.sin(this.time * pulseSpeed) * pulseAmplitude;
    const visiblePoints = Math.max(2, Math.floor(basePoints.length * progress));

    const is3d = this.mode === "3d";
    const tiltX = is3d ? tiltAmplitudeX * Math.sin(this.time * tiltSpeedX) : 0;
    const tiltY = is3d ? tiltAmplitudeY * Math.sin(this.time * tiltSpeedY) : 0;
    const cosTiltX = Math.cos(tiltX);
    const sinTiltX = Math.sin(tiltX);
    const cosTiltY = Math.cos(tiltY);
    const sinTiltY = Math.sin(tiltY);

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = lineWidth * pulse;
    ctx.strokeStyle = this.applyAlpha(strokeColor, Math.min(1, alpha * pulse));
    ctx.shadowBlur = glowStrength;
    ctx.shadowColor = glowColor;

    for (let i = 0; i < transforms.length; i += 1) {
      const transform = transforms[i];
      const angleZ = transform.angle + rotation;
      const cosZ = Math.cos(angleZ);
      const sinZ = Math.sin(angleZ);

      ctx.beginPath();
      for (let j = 0; j < visiblePoints; j += 1) {
        const point = this.buildPoint(basePoints[j], ampX, ampY, depthScale);
        const projected = this.transformPoint(
          point,
          transform,
          cosZ,
          sinZ,
          cosTiltX,
          sinTiltX,
          cosTiltY,
          sinTiltY,
          perspective,
          is3d,
        );
        const drawX = centerX + projected.x;
        const drawY = centerY + projected.y;
        if (j === 0) {
          ctx.moveTo(drawX, drawY);
        } else {
          ctx.lineTo(drawX, drawY);
        }
      }
      ctx.stroke();
    }

    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";

    if (progress > 0.35) {
      this.drawDecorations(
        ctx,
        decorationData,
        basePoints,
        transforms,
        rotation,
        {
          cosTiltX,
          sinTiltX,
          cosTiltY,
          sinTiltY,
          perspective,
          is3d,
        },
        {
          ampX,
          ampY,
          depthScale,
          centerX,
          centerY,
          strokeColor,
          glowColor,
          pulse,
          progress,
        },
      );
    }

    if (progress > 0.5) {
      this.drawTickMarks(
        ctx,
        tickData,
        basePoints,
        transforms,
        rotation,
        {
          cosTiltX,
          sinTiltX,
          cosTiltY,
          sinTiltY,
          perspective,
          is3d,
        },
        {
          ampX,
          ampY,
          depthScale,
          centerX,
          centerY,
          strokeColor,
          pulse,
        },
      );
    }
  }

  /**
   * Будує 3D-точку на основі нормалізованих координат базової кривої.
   */
  buildPoint(basePoint, ampX, ampY, depthScale) {
    return {
      x: basePoint.x * ampX,
      y: basePoint.y * ampY,
      z: basePoint.z * depthScale,
      derivativeX: basePoint.derivativeX,
      derivativeY: basePoint.derivativeY,
    };
  }

  /**
   * Застосовуємо дзеркала, обертання та нахили. Повертаємо координати у площині XY.
   */
  transformPoint(point, transform, cosZ, sinZ, cosTiltX, sinTiltX, cosTiltY, sinTiltY, perspective, is3d) {
    let x = point.x;
    let y = point.y;
    let z = point.z;

    if (transform.mirrorX) {
      y = -y;
      z = -z;
    }
    if (transform.mirrorY) {
      x = -x;
      z = -z;
    }

    const rotX = x * cosZ - y * sinZ;
    const rotY = x * sinZ + y * cosZ;
    let rotZ = z;

    if (is3d) {
      const y1 = rotY * cosTiltX - rotZ * sinTiltX;
      const z1 = rotY * sinTiltX + rotZ * cosTiltX;

      const x2 = rotX * cosTiltY + z1 * sinTiltY;
      const z2 = -rotX * sinTiltY + z1 * cosTiltY;

      const scale = perspective / (perspective + z2);
      return { x: x2 * scale, y: y1 * scale };
    }

    return { x: rotX, y: rotY };
  }

  /**
   * Малюємо декоративні вузли-крапки.
   */
  drawDecorations(ctx, decorationData, basePoints, transforms, rotation, tiltConfig, frameConfig) {
    const { cosTiltX, sinTiltX, cosTiltY, sinTiltY, perspective, is3d } = tiltConfig;
    const { ampX, ampY, depthScale, centerX, centerY, strokeColor, glowColor, pulse, progress } = frameConfig;
    const opacity = Math.min(1, (progress - 0.35) / 0.25);

    ctx.fillStyle = this.applyAlpha(strokeColor, 0.7 * opacity);
    ctx.shadowBlur = 8;
    ctx.shadowColor = glowColor;

    for (let i = 0; i < decorationData.length; i += 1) {
      const deco = decorationData[i];
      const transform = transforms[deco.transformIndex % transforms.length];
      const angleZ = transform.angle + rotation;
      const cosZ = Math.cos(angleZ);
      const sinZ = Math.sin(angleZ);

      const basePoint = this.buildPoint(basePoints[deco.baseIndex], ampX, ampY, depthScale);
      const projected = this.transformPoint(
        basePoint,
        transform,
        cosZ,
        sinZ,
        cosTiltX,
        sinTiltX,
        cosTiltY,
        sinTiltY,
        perspective,
        is3d,
      );

      const drawX = centerX + projected.x;
      const drawY = centerY + projected.y;

      ctx.beginPath();
      ctx.arc(drawX, drawY, deco.radius * pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
  }

  /**
   * Малюємо короткі насічки та, за потреби, маленькі стрілки.
   */
  drawTickMarks(ctx, tickData, basePoints, transforms, rotation, tiltConfig, frameConfig) {
    const { cosTiltX, sinTiltX, cosTiltY, sinTiltY, perspective, is3d } = tiltConfig;
    const { ampX, ampY, depthScale, centerX, centerY, strokeColor, pulse } = frameConfig;

    ctx.strokeStyle = this.applyAlpha(strokeColor, 0.6 * pulse);
    ctx.lineWidth = Math.max(1.5, 0.6 * pulse * this.params.lineWidth);

    for (let i = 0; i < tickData.length; i += 1) {
      const tick = tickData[i];
      const transform = transforms[tick.transformIndex % transforms.length];
      const angleZ = transform.angle + rotation;
      const cosZ = Math.cos(angleZ);
      const sinZ = Math.sin(angleZ);

      const basePoint = this.buildPoint(basePoints[tick.baseIndex], ampX, ampY, depthScale);
      const tangentX = basePoint.derivativeX * ampX;
      const tangentY = basePoint.derivativeY * ampY;
      const normalX = -tangentY;
      const normalY = tangentX;
      const normalLength = Math.hypot(normalX, normalY) || 1;
      const normalizedNormal = {
        x: (normalX / normalLength) * tick.length * tick.direction,
        y: (normalY / normalLength) * tick.length * tick.direction,
      };

      const startProjected = this.transformPoint(
        basePoint,
        transform,
        cosZ,
        sinZ,
        cosTiltX,
        sinTiltX,
        cosTiltY,
        sinTiltY,
        perspective,
        is3d,
      );

      const endPoint = {
        x: basePoint.x + normalizedNormal.x,
        y: basePoint.y + normalizedNormal.y,
        z: basePoint.z,
        derivativeX: basePoint.derivativeX,
        derivativeY: basePoint.derivativeY,
      };

      const endProjected = this.transformPoint(
        {
          x: endPoint.x,
          y: endPoint.y,
          z: endPoint.z,
        },
        transform,
        cosZ,
        sinZ,
        cosTiltX,
        sinTiltX,
        cosTiltY,
        sinTiltY,
        perspective,
        is3d,
      );

      const startX = centerX + startProjected.x;
      const startY = centerY + startProjected.y;
      const endX = centerX + endProjected.x;
      const endY = centerY + endProjected.y;

      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      if (tick.arrow) {
        this.drawArrowHead(ctx, startX, startY, endX, endY, Math.max(6, 10 * pulse));
      }
    }
  }

  /**
   * Проміжна функція для промальовування невеликої стрілки на кінці насічки.
   */
  drawArrowHead(ctx, startX, startY, endX, endY, size) {
    const angle = Math.atan2(endY - startY, endX - startX);
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - Math.cos(angle - Math.PI / 6) * size, endY - Math.sin(angle - Math.PI / 6) * size);
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - Math.cos(angle + Math.PI / 6) * size, endY - Math.sin(angle + Math.PI / 6) * size);
    ctx.stroke();
  }

  /**
   * Вираховуємо прогрес вступу (0..1).
   */
  getIntroProgress(now) {
    const elapsed = now - this.startedAt;
    return Math.min(Math.max(elapsed / this.introDurationMs, 0), 1);
  }

  /**
   * Утиліта для додавання альфи до hex-кольору.
   */
  applyAlpha(color, alpha) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  }

  /**
   * Обираємо частоту з набору. Якщо передано попередню, намагаємося уникати кратності.
   */
  pickFrequency(prng, set, avoid) {
    let freq = set[Math.floor(prng.next() * set.length)];
    if (!avoid) return freq;
    for (let i = 0; i < set.length; i += 1) {
      const candidate = set[Math.floor(prng.next() * set.length)];
      if (this.gcd(candidate, avoid) === 1) {
        freq = candidate;
        break;
      }
    }
    return freq;
  }

  /**
   * Побудова трансформацій з урахуванням радіальної симетрії та дзеркал.
   */
  buildTransforms(radialSymmetry, mirrorX, mirrorY) {
    const transforms = [];
    const mirrorVariants = [{ mirrorX: false, mirrorY: false }];
    if (mirrorX) mirrorVariants.push({ mirrorX: true, mirrorY: false });
    if (mirrorY) mirrorVariants.push({ mirrorX: false, mirrorY: true });
    if (mirrorX && mirrorY) mirrorVariants.push({ mirrorX: true, mirrorY: true });

    for (let i = 0; i < radialSymmetry; i += 1) {
      const angle = (i / radialSymmetry) * Math.PI * 2;
      for (let j = 0; j < mirrorVariants.length; j += 1) {
        transforms.push({ angle, mirrorX: mirrorVariants[j].mirrorX, mirrorY: mirrorVariants[j].mirrorY });
      }
    }
    return transforms;
  }

  /**
   * Визначаємо індекси точок для декоративних крапок.
   */
  buildDecorations(basePoints, transforms, prng) {
    const candidates = [];
    for (let i = 1; i < basePoints.length - 1; i += 1) {
      const derivativeX = basePoints[i].derivativeX;
      const derivativeY = basePoints[i].derivativeY;
      if (Math.abs(derivativeX) < 0.1 || Math.abs(derivativeY) < 0.1) {
        candidates.push(i);
      }
    }
    if (candidates.length === 0) {
      for (let i = 0; i < basePoints.length; i += Math.floor(basePoints.length / 12)) {
        candidates.push(i);
      }
    }

    const target = Math.max(4, Math.round(candidates.length * CONFIG.rune.DECORATION_DENSITY));
    const picked = [];
    const available = candidates.slice();

    for (let i = 0; i < target && available.length > 0; i += 1) {
      const index = Math.floor(prng.next() * available.length);
      const baseIndex = available.splice(index, 1)[0];
      const transformIndex = Math.floor(prng.next() * transforms.length);
      const radius = 6 + prng.next() * 12;
      picked.push({ baseIndex, transformIndex, radius });
    }

    return picked;
  }

  /**
   * Визначаємо точки для насічок та стрілок.
   */
  buildTickMarks(basePoints, transforms, prng) {
    const tickData = [];
    const count = Math.max(3, Math.floor(basePoints.length * CONFIG.rune.DECORATION_DENSITY * 0.4));
    const step = Math.max(6, Math.floor(basePoints.length / count));
    for (let i = 0; i < basePoints.length && tickData.length < count; i += step) {
      const baseIndex = Math.min(i, basePoints.length - 1);
      tickData.push({
        baseIndex,
        transformIndex: tickData.length % transforms.length,
        length: 24 + prng.next() * 26,
        direction: prng.next() > 0.5 ? 1 : -1,
        arrow: prng.next() > 0.7,
      });
    }
    return tickData;
  }

  /**
   * Найбільший спільний дільник (для перевірки взаємної простоти частот).
   */
  gcd(a, b) {
    let x = a;
    let y = b;
    while (y !== 0) {
      const temp = y;
      y = x % y;
      x = temp;
    }
    return Math.abs(x);
  }

  /**
   * Примусовий перехід у 2D-режим.
   */
  force2dMode() {
    this.mode = "2d";
    this.modeLockedTo2d = true;
  }

  /**
   * Скидання прапорця блокування режиму після повного перезапуску.
   */
  resetModeLock() {
    this.modeLockedTo2d = !CONFIG.global.ENABLE_3D_BY_DEFAULT;
    this.mode = CONFIG.global.ENABLE_3D_BY_DEFAULT ? "3d" : "2d";
  }

  getMode() {
    return this.mode;
  }

  isModeLockedTo2d() {
    return this.modeLockedTo2d;
  }
}

window.runeScene = new RuneScene();
