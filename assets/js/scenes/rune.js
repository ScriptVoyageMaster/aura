// RuneScene створює символічні руноподібні композиції.
// ОНОВЛЕНО: додано "рунічний" режим із простими прямими відрізками,
// без крапочок/насічок, зі снапінгом до ґріда й октагональних кутів.
// У вступі лінія "будується" від простого до повного контуру, далі — легкий дрейф.
// 3D-нахил збережено, але за замовчуванням можна примусово тримати 2D.

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
   * Ініціалізуємо сцену на основі seed та PRNG.
   * Рунічний режим керується прапорцями в CONFIG.rune.
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

    // ── Параметри стилю (нове)
    const RUNIC = CONFIG.rune.RUNIC_MODE ?? true; // вкл/викл «рунічного» стилю
    const SNAP_GRID = CONFIG.rune.SNAP_TO_GRID ?? true; // вкл/викл ґрід-снепінгу
    const GRID = CONFIG.rune.GRID_SIZE ?? 16; // крок ґріда в px (до масштабу сцени)
    const ANG_STEP_DEG = CONFIG.rune.SNAP_ANGLE_STEP_DEG ?? 45; // октагональні напрямки
    const DP_TOL = CONFIG.rune.SIMPLIFY_TOLERANCE_PX ?? 6; // допуск спрощення (Дуглас–Пейкер)
    const MIN_SEG = CONFIG.rune.MIN_SEGMENT_PX ?? 18; // мін. довжина відрізка після спрощення

    const freqSet = CONFIG.rune.FREQ_SET;
    const freqX = this.pickFrequency(prng, freqSet);
    const freqY = this.pickFrequency(prng, freqSet, freqX);

    const phaseStep = (CONFIG.rune.PHASE_DEG_STEP * Math.PI) / 180;
    const maxSteps = Math.floor((Math.PI * 2) / phaseStep);
    const phaseX = Math.floor(prng.next() * maxSteps) * phaseStep;
    const phaseY = Math.floor(prng.next() * maxSteps) * phaseStep;

    // Трохи менш агресивна симетрія за замовчуванням, щоб форма була читкіша
    const radialOptions = CONFIG.rune.RADIAL_SYMMETRY_OPTIONS;
    const radialSymmetry = Math.min(
      CONFIG.rune.MAX_RADIAL_FOR_RUNIC ?? 4,
      radialOptions[Math.floor(prng.next() * radialOptions.length)]
    );

    // Дзеркала робимо рідше, щоб уникати «каші»
    const mirrorX = RUNIC ? prng.next() > 0.7 : prng.next() > 0.5;
    const mirrorY = RUNIC ? prng.next() > 0.7 : prng.next() > 0.5;

    // Більші поля — більше «повітря» навколо руни
    const marginRatioX = (RUNIC ? 0.18 : 0.12) + prng.next() * (RUNIC ? 0.03 : 0.05);
    const marginRatioY = (RUNIC ? 0.22 : 0.16) + prng.next() * (RUNIC ? 0.03 : 0.05);

    const lineRange = CONFIG.rune.LINE_WIDTH;
    const baseLW = lineRange[0] + prng.next() * (lineRange[1] - lineRange[0]);
    const lineWidth = RUNIC ? Math.max(baseLW * 1.2, baseLW + 1.0) : baseLW;

    // Обмежена, спокійна палітра
    const strokePalettes = [
      { stroke: "#f7f2e8", glow: "rgba(247, 242, 232, 0.25)" },
      { stroke: "#e6e1d5", glow: "rgba(230, 225, 213, 0.22)" },
      { stroke: "#dcd6c9", glow: "rgba(220, 214, 201, 0.20)" },
    ];
    const palette = strokePalettes[Math.floor(prng.next() * strokePalettes.length)];

    // Базова контурна крива (Ліссажу) — далі її перетворимо у «полілінію-руну»
    const steps = RUNIC ? 360 : 620; // менше точок = чистіші форми
    const depthFreq = 1 + Math.floor(prng.next() * 2); // менша «глибина», щоб не «шуміло»
    const depthPhase = prng.next() * Math.PI * 2;
    const basePoints = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = (i / steps) * Math.PI * 2;
      const normX = Math.sin(freqX * t + phaseX);
      const normY = Math.sin(freqY * t + phaseY);
      const derivativeX = freqX * Math.cos(freqX * t + phaseX);
      const derivativeY = freqY * Math.cos(freqY * t + phaseY);
      const depth = Math.sin(t * depthFreq + depthPhase);
      basePoints.push({ x: normX, y: normY, z: depth, derivativeX, derivativeY, t });
    }

    const transforms = this.buildTransforms(radialSymmetry, mirrorX, mirrorY);

    // !!! Вимикаємо «шум»: ніяких крапочок чи насічок у рунічному стилі
    const useDecorations = (CONFIG.rune.USE_DECORATIONS ?? false) && !RUNIC;
    const useTicks = (CONFIG.rune.USE_TICKS ?? false) && !RUNIC;

    const rotationPerMinute = 2.2 + prng.next() * 1.1; // трохи повільніше
    const driftRotationSpeed = (rotationPerMinute * Math.PI) / (180 * 60);
    const pulseSpeed = RUNIC ? 0.18 + prng.next() * 0.12 : 0.25 + prng.next() * 0.2;
    const pulseAmplitude = RUNIC ? 0.06 + prng.next() * 0.06 : 0.1 + prng.next() * 0.1;

    // 3D-нахили скромніші, аби лінії лишались читкими
    const tiltAmplitudeX = ((RUNIC ? 1.8 : 3) * Math.PI) / 180;
    const tiltAmplitudeY = ((RUNIC ? 1.6 : 2) * Math.PI) / 180;
    const tiltSpeedX = 0.14 + prng.next() * 0.12;
    const tiltSpeedY = 0.12 + prng.next() * 0.12;

    this.params = {
      // базові
      freqX, freqY, phaseX, phaseY,
      basePoints, transforms,
      marginRatioX, marginRatioY,
      lineWidth,
      strokeColor: palette.stroke,
      glowColor: palette.glow,
      alpha: RUNIC ? 1.0 : 0.92,
      driftRotationSpeed, pulseSpeed, pulseAmplitude,
      depthScaleRatio: RUNIC ? 0.05 : 0.08 + prng.next() * 0.06,
      perspectiveRatio: RUNIC ? 1.0 : 1.2 + prng.next() * 0.5,
      tiltAmplitudeX, tiltAmplitudeY, tiltSpeedX, tiltSpeedY,
      glowStrength: RUNIC ? 10 : 18 + prng.next() * 10,

      // фічі
      RUNIC, SNAP_GRID, GRID, ANG_STEP_DEG, DP_TOL, MIN_SEG,

      // декор (вимкнено у RUNIC)
      decorationData: useDecorations ? this.buildDecorations(basePoints, transforms, prng) : [],
      tickData: useTicks ? this.buildTickMarks(basePoints, transforms, prng) : [],
      useDecorations, useTicks,
    };

    this.updateGeometry();
  }

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

  resize(width, height) {
    this.width = Math.max(width, 200);
    this.height = Math.max(height, 200);
    this.updateGeometry();
  }

  update(dt, now) {
    if (!this.params) return;
    if (this.phase === "intro") {
      if (this.getIntroProgress(now) >= 1) this.phase = "main";
    } else {
      this.time += dt;
    }
  }

  draw(ctx, now) {
    if (!this.params) return;

    const progress = this.getIntroProgress(now);
    const p = this.params;

    // Загальні модифікатори руху
    const rotation = this.time * p.driftRotationSpeed;
    const pulse = 1 + Math.sin(this.time * p.pulseSpeed) * p.pulseAmplitude;

    // 3D/2D
    const is3d = this.mode === "3d";
    const tiltX = is3d ? p.tiltAmplitudeX * Math.sin(this.time * p.tiltSpeedX) : 0;
    const tiltY = is3d ? p.tiltAmplitudeY * Math.sin(this.time * p.tiltSpeedY) : 0;
    const cosTiltX = Math.cos(tiltX), sinTiltX = Math.sin(tiltX);
    const cosTiltY = Math.cos(tiltY), sinTiltY = Math.sin(tiltY);

    // Параметри пензля
    ctx.lineCap = p.RUNIC ? "butt" : "round";
    ctx.lineJoin = p.RUNIC ? "miter" : "round";
    ctx.miterLimit = 4;
    ctx.lineWidth = p.lineWidth * (p.RUNIC ? 1.05 : pulse);
    ctx.strokeStyle = this.applyAlpha(p.strokeColor, Math.min(1, p.alpha * (p.RUNIC ? 1 : pulse)));
    ctx.shadowBlur = p.glowStrength;
    ctx.shadowColor = p.glowColor;

    // Скільки точок показувати під час intro
    const total = p.basePoints.length;
    const visibleCount = Math.max(2, Math.floor(total * progress));

    // ─────────────────────────────────────────────────────────────
    // 1) Готуємо «рунічний» (полігональний) шлях у локальних координатах
    //    — спрощуємо, снапимо до октагональних кутів і ґріда.
    // ─────────────────────────────────────────────────────────────
    let pathPts = p.basePoints.slice(0, visibleCount).map(bp =>
      this.buildPoint(bp, p.ampX, p.ampY, p.depthScale)
    );

    if (p.RUNIC) {
      pathPts = this.buildRunicPolyline(
        pathPts,
        p.DP_TOL,
        p.MIN_SEG,
        p.SNAP_GRID,
        p.GRID,
        (p.ANG_STEP_DEG * Math.PI) / 180
      );
    } else {
      // У не-рунічному режимі просто легке спрощення, щоб уникнути «каші»
      pathPts = this.simplifyDouglasPeucker(pathPts, Math.max(3, p.DP_TOL * 0.6));
    }

    // ─────────────────────────────────────────────────────────────
    // 2) Малюємо копії за трансформаціями/симетріями
    // ─────────────────────────────────────────────────────────────
    for (let i = 0; i < p.transforms.length; i += 1) {
      const tr = p.transforms[i];
      const angleZ = tr.angle + rotation;
      const cosZ = Math.cos(angleZ), sinZ = Math.sin(angleZ);

      if (pathPts.length < 2) continue;
      ctx.beginPath();
      // перша точка
      let prj0 = this.transformPoint(pathPts[0], tr, cosZ, sinZ, cosTiltX, sinTiltX, cosTiltY, sinTiltY, p.perspective, is3d);
      ctx.moveTo(p.centerX + prj0.x, p.centerY + prj0.y);

      // інші точки
      for (let j = 1; j < pathPts.length; j += 1) {
        const prj = this.transformPoint(pathPts[j], tr, cosZ, sinZ, cosTiltX, sinTiltX, cosTiltY, sinTiltY, p.perspective, is3d);
        ctx.lineTo(p.centerX + prj.x, p.centerY + prj.y);
      }
      ctx.stroke();
    }

    // Декор та «насічки» вимкнено у рунічному режимі
    if (!p.RUNIC) {
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";

      if (p.useDecorations && progress > 0.35) {
        this.drawDecorations(
          ctx, p.decorationData, p.basePoints, p.transforms, rotation,
          { cosTiltX, sinTiltX, cosTiltY, sinTiltY, perspective: p.perspective, is3d },
          {
            ampX: p.ampX, ampY: p.ampY, depthScale: p.depthScale,
            centerX: p.centerX, centerY: p.centerY,
            strokeColor: p.strokeColor, glowColor: p.glowColor, pulse, progress
          }
        );
      }

      if (p.useTicks && progress > 0.5) {
        this.drawTickMarks(
          ctx, p.tickData, p.basePoints, p.transforms, rotation,
          { cosTiltX, sinTiltX, cosTiltY, sinTiltY, perspective: p.perspective, is3d },
          {
            ampX: p.ampX, ampY: p.ampY, depthScale: p.depthScale,
            centerX: p.centerX, centerY: p.centerY,
            strokeColor: p.strokeColor, pulse
          }
        );
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Побудова "точок" (з урахуванням амплітуд)
  // ─────────────────────────────────────────────────────────────
  buildPoint(basePoint, ampX, ampY, depthScale) {
    return {
      x: basePoint.x * ampX,
      y: basePoint.y * ampY,
      z: basePoint.z * depthScale,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Трансформації 3D → 2D (обертання, нахили, перспектива)
  // ─────────────────────────────────────────────────────────────
  transformPoint(point, transform, cosZ, sinZ, cosTiltX, sinTiltX, cosTiltY, sinTiltY, perspective, is3d) {
    let x = point.x, y = point.y, z = point.z;

    if (transform.mirrorX) { y = -y; z = -z; }
    if (transform.mirrorY) { x = -x; z = -z; }

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

  // ─────────────────────────────────────────────────────────────
  // РУНІЧНИЙ КОНТУР: спрощення + октагональний снап + ґрід-снепінг
  // ─────────────────────────────────────────────────────────────
  buildRunicPolyline(points, dpTol, minSeg, snapGrid, grid, angleStepRad) {
    // 1) Спрощення Дугласа–Пейкера, щоб прибрати надлишкові точки
    let pts = this.simplifyDouglasPeucker(points, dpTol);

    if (pts.length < 2) return pts;

    // 2) Перетворюємо у ламану з напрямами 0°, 45°, 90°… (октагонально)
    const out = [];
    const first = snapGrid ? this.snapToGrid(pts[0], grid) : { ...pts[0] };
    out.push(first);

    for (let i = 1; i < pts.length; i += 1) {
      const prev = out[out.length - 1];
      const raw = snapGrid ? this.snapToGrid(pts[i], grid) : pts[i];

      const dx = raw.x - prev.x;
      const dy = raw.y - prev.y;
      const len = Math.hypot(dx, dy);
      if (len < minSeg) continue;

      const ang = Math.atan2(dy, dx);
      const snappedAng = Math.round(ang / angleStepRad) * angleStepRad;

      // Зберігаємо «довжину», але напрям фіксуємо до октагонального
      const nx = prev.x + Math.cos(snappedAng) * len;
      const ny = prev.y + Math.sin(snappedAng) * len;

      const next = snapGrid ? this.snapToGrid({ x: nx, y: ny, z: raw.z }, grid) : { x: nx, y: ny, z: raw.z };
      out.push(next);
    }

    // 3) Фінальне злиття надкоротких сегментів
    const merged = [out[0]];
    for (let i = 1; i < out.length; i += 1) {
      const a = merged[merged.length - 1], b = out[i];
      if (Math.hypot(b.x - a.x, b.y - a.y) >= Math.max(6, minSeg * 0.6)) merged.push(b);
    }
    return merged;
  }

  // Ґрід-снепінг з урахуванням можливого некоректного кроку ґріда
  snapToGrid(p, grid) {
    const safeGrid = grid && Number.isFinite(grid) && Math.abs(grid) > 0 ? Math.abs(grid) : 1;
    return {
      x: Math.round(p.x / safeGrid) * safeGrid,
      y: Math.round(p.y / safeGrid) * safeGrid,
      z: p.z,
    };
  }

  // Спрощення ламаної: алгоритм Дугласа–Пейкера
  simplifyDouglasPeucker(points, tolerance) {
    if (points.length <= 2) return points.slice();
    const sqTol = tolerance * tolerance;

    const getSqDist = (p1, p2) => {
      const dx = p1.x - p2.x, dy = p1.y - p2.y;
      return dx * dx + dy * dy;
    };

    const getSqSegDist = (p, a, b) => {
      let x = a.x, y = a.y;
      let dx = b.x - x, dy = b.y - y;
      if (dx !== 0 || dy !== 0) {
        const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
        if (t > 1) { x = b.x; y = b.y; }
        else if (t > 0) { x += dx * t; y += dy * t; }
      }
      dx = p.x - x; dy = p.y - y;
      return dx * dx + dy * dy;
    };

    const simplifyDP = (pts, first, last, out) => {
      let maxDist = sqTol;
      let index = -1;
      for (let i = first + 1; i < last; i++) {
        const dist = getSqSegDist(pts[i], pts[first], pts[last]);
        if (dist > maxDist) {
          index = i; maxDist = dist;
        }
      }
      if (index > -1) {
        if (index - first > 1) simplifyDP(pts, first, index, out);
        out.push(pts[index]);
        if (last - index > 1) simplifyDP(pts, index, last, out);
      }
    };

    const res = [points[0]];
    simplifyDP(points, 0, points.length - 1, res);
    res.push(points[points.length - 1]);
    return res;
    // (це класична реалізація, достатньо швидка для наших розмірів)
  }

  // ─────────────────────────────────────────────────────────────
  // Допоміжні генератори і трансформації
  // ─────────────────────────────────────────────────────────────
  getIntroProgress(now) {
    const elapsed = now - this.startedAt;
    return Math.min(Math.max(elapsed / this.introDurationMs, 0), 1);
  }

  applyAlpha(color, alpha) {
    // Розбираємо HEX-колір на складові та повертаємо коректну RGBA-стрічку.
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  }

  pickFrequency(prng, set, avoid) {
    let freq = set[Math.floor(prng.next() * set.length)];
    if (!avoid) return freq;
    for (let i = 0; i < set.length; i += 1) {
      const candidate = set[Math.floor(prng.next() * set.length)];
      if (this.gcd(candidate, avoid) === 1) { freq = candidate; break; }
    }
    return freq;
  }

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

  // Нижче — старі функції декору/насічок (залишені на випадок не-рунічного стилю)
  buildDecorations(basePoints, transforms, prng) {
    const candidates = [];
    for (let i = 1; i < basePoints.length - 1; i += 1) {
      const dx = basePoints[i].derivativeX;
      const dy = basePoints[i].derivativeY;
      if (Math.abs(dx) < 0.1 || Math.abs(dy) < 0.1) candidates.push(i);
    }
    if (candidates.length === 0) {
      for (let i = 0; i < basePoints.length; i += Math.floor(basePoints.length / 12)) candidates.push(i);
    }
    const target = Math.max(4, Math.round(candidates.length * (CONFIG.rune.DECORATION_DENSITY ?? 0.0)));
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

  buildTickMarks(basePoints, transforms, prng) {
    const tickData = [];
    const density = (CONFIG.rune.DECORATION_DENSITY ?? 0.0) * 0.4;
    const count = Math.max(3, Math.floor(basePoints.length * density));
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
        basePoint, transform, cosZ, sinZ, cosTiltX, sinTiltX, cosTiltY, sinTiltY, perspective, is3d
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

  drawTickMarks(ctx, tickData, basePoints, transforms, rotation, tiltConfig, frameConfig) {
    const { cosTiltX, sinTiltX, cosTiltY, sinTiltY, perspective, is3d } = tiltConfig;
    const { ampX, ampY, depthScale, centerX, centerY, strokeColor, pulse } = frameConfig;

    ctx.strokeStyle = this.applyAlpha(strokeColor, 0.6 * pulse);
    ctx.lineWidth = Math.max(1.5, 0.6 * this.params.lineWidth * pulse);

    for (let i = 0; i < tickData.length; i += 1) {
      const tick = tickData[i];
      const transform = transforms[tick.transformIndex % transforms.length];
      const angleZ = transform.angle + rotation;
      const cosZ = Math.cos(angleZ), sinZ = Math.sin(angleZ);

      const basePoint = this.buildPoint(basePoints[tick.baseIndex], ampX, ampY, depthScale);
      const startProjected = this.transformPoint(
        basePoint, transform, cosZ, sinZ, cosTiltX, sinTiltX, cosTiltY, sinTiltY, perspective, is3d
      );

      // Нормалі/стрілки залишені як було (використовуються лише коли RUNIC=false)
      const tangentX = (basePoints[tick.baseIndex].derivativeX ?? 0) * ampX;
      const tangentY = (basePoints[tick.baseIndex].derivativeY ?? 0) * ampY;
      const normalX = -tangentY, normalY = tangentX;
      const nLen = Math.hypot(normalX, normalY) || 1;
      const nn = { x: (normalX / nLen) * tick.length * tick.direction, y: (normalY / nLen) * tick.length * tick.direction };

      const endProjected = this.transformPoint(
        { x: basePoint.x + nn.x, y: basePoint.y + nn.y, z: basePoint.z },
        transform, cosZ, sinZ, cosTiltX, sinTiltX, cosTiltY, sinTiltY, perspective, is3d
      );

      const startX = centerX + startProjected.x, startY = centerY + startProjected.y;
      const endX = centerX + endProjected.x, endY = centerY + endProjected.y;

      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }
  }

  // Обчислюємо найбільший спільний дільник — так забезпечуємо взаємно прості частоти
  gcd(a, b) { let x = a, y = b; while (y !== 0) { const t = y; y = x % y; x = t; } return Math.abs(x); }

  // Сервісні методи для керування 3D-режимом: перемикаємося у 2D та відновлюємо налаштування за замовчуванням
  force2dMode() { this.mode = "2d"; this.modeLockedTo2d = true; }
  resetModeLock() {
    this.modeLockedTo2d = !CONFIG.global.ENABLE_3D_BY_DEFAULT;
    this.mode = CONFIG.global.ENABLE_3D_BY_DEFAULT ? "3d" : "2d";
  }
  getMode() { return this.mode; }
  isModeLockedTo2d() { return this.modeLockedTo2d; }
}

window.runeScene = new RuneScene();
