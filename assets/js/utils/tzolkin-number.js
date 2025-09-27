// Утиліта малювання чисел Цолькін у вигляді рисок і крапок на Canvas.
// Функція додає максимально наочні коментарі українською мовою.
(() => {
  /**
   * Малюємо число 1..13 у вигляді традиційних майянських позначок.
   * @param {CanvasRenderingContext2D} ctx - контекст цільового canvas.
   * @param {number} tone - число від 1 до 13.
   * @param {{x:number, y:number, w:number, h:number}} toneBox - прямокутник розміщення у дизайн-координатах.
   * @param {object} [options] - додаткові налаштування стилю (кольори та коефіцієнти масштабу).
   * @returns {number} - фактична висота намальованої композиції (щоб сцені легше було центрувати).
   */
  const BASE_SIZE = 40;
  const DOT_SLOTS = {
    0: [],
    1: [20],
    2: [16, 24],
    3: [12, 20, 28],
    4: [8, 16, 24, 32],
  };
  const DOT_Y = 14;
  const BASE_DOT_RADIUS = 3.5;
  const BASE_LINE_WIDTH = 4;
  const BAR_BASE = { top: 24.5, bottom: 26.5 };
  const BAR_GEOMETRY = [
    { offset: 0 },
    { offset: 6 },
  ];

  /**
   * Обчислюємо межі композиції у нормалізованій системі координат (0..40).
   * Це потрібно, щоб правильно центрувати число у прямокутнику toneBox.
   */
  function computeNormalizedBounds(barsCount, dotsCount, lineWidthBase, dotRadiusBase) {
    let minY = Infinity;
    let maxY = -Infinity;

    if (dotsCount > 0) {
      minY = Math.min(minY, DOT_Y - dotRadiusBase);
      maxY = Math.max(maxY, DOT_Y + dotRadiusBase);
    }

    for (let i = 0; i < Math.min(barsCount, BAR_GEOMETRY.length); i += 1) {
      const bar = BAR_GEOMETRY[i];
      minY = Math.min(minY, BAR_BASE.top + bar.offset - lineWidthBase / 2);
      maxY = Math.max(maxY, BAR_BASE.bottom + bar.offset + lineWidthBase / 2);
    }

    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
      // На випадок непередбаченої ситуації повертаємо межі крапок.
      minY = DOT_Y - dotRadiusBase;
      maxY = DOT_Y + dotRadiusBase;
    }

    return { min: minY, max: maxY };
  }

  /**
   * Малюємо окрему риску (бар) за заданим зміщенням.
   */
  function renderBar(ctx, mapX, mapY, offset) {
    ctx.beginPath();
    ctx.moveTo(mapX(8), mapY(26 + offset));
    ctx.quadraticCurveTo(mapX(14), mapY(24.5 + offset), mapX(20), mapY(25.5 + offset));
    ctx.quadraticCurveTo(mapX(26), mapY(26.5 + offset), mapX(32), mapY(25 + offset));
    ctx.stroke();
  }

  /**
   * Малюємо набір крапок залежно від кількості.
   */
  function renderDots(ctx, mapX, mapY, dotsCount, radius) {
    const slots = DOT_SLOTS[dotsCount] || DOT_SLOTS[0];
    const cy = mapY(DOT_Y);
    for (let i = 0; i < slots.length; i += 1) {
      const cx = mapX(slots[i]);
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawTzolkinNumber(ctx, tone, toneBox, options = {}) {
    if (!ctx) {
      throw new Error("drawTzolkinNumber очікує коректний 2D-контекст");
    }
    if (typeof tone !== "number" || tone < 1 || tone > 13) {
      throw new Error("drawTzolkinNumber працює лише з тоном у діапазоні 1..13");
    }
    if (!toneBox || typeof toneBox !== "object") {
      throw new Error("drawTzolkinNumber очікує об'єкт toneBox з координатами x, y, w, h");
    }

    const x = Number(toneBox.x) || 0;
    const y = Number(toneBox.y) || 0;
    const w = Number(toneBox.w) || 0;
    const h = Number(toneBox.h) || 0;
    if (w <= 0 || h <= 0) {
      return 0;
    }

    // Розкладаємо число на риски (кожна дорівнює п'ятірці) та крапки (решта від ділення).
    const barsCount = Math.floor(tone / 5);
    const dotsCount = tone % 5;

    const lineWidthFactor = typeof options.lineWidthFactor === "number" && options.lineWidthFactor > 0 ? options.lineWidthFactor : 1;
    const dotRadiusFactor = typeof options.dotRadiusFactor === "number" && options.dotRadiusFactor > 0 ? options.dotRadiusFactor : 1;

    const lineWidthBase = BASE_LINE_WIDTH * lineWidthFactor;
    const dotRadiusBase = BASE_DOT_RADIUS * dotRadiusFactor;

    const bounds = computeNormalizedBounds(barsCount, dotsCount, lineWidthBase, dotRadiusBase);
    const usedHeight = bounds.max - bounds.min;

    let scale = w / BASE_SIZE;
    if (usedHeight > 0) {
      scale = Math.min(scale, h / usedHeight);
    } else {
      scale = Math.min(scale, h / BASE_SIZE);
    }
    if (!Number.isFinite(scale) || scale <= 0) {
      return 0;
    }

    const horizontalOffset = x + (w - BASE_SIZE * scale) / 2;
    const verticalOffset = y + (h - usedHeight * scale) / 2 - bounds.min * scale;

    const mapX = (nx) => horizontalOffset + nx * scale;
    const mapY = (ny) => verticalOffset + ny * scale;

    const strokeColor = options.strokeColor || "#f6eddc";
    const accentColor = options.accentColor || strokeColor;
    const lineWidth = lineWidthBase * scale;
    const dotRadius = dotRadiusBase * scale;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = accentColor;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    if (dotsCount > 0) {
      renderDots(ctx, mapX, mapY, dotsCount, dotRadius);
    }

    for (let i = 0; i < Math.min(barsCount, BAR_GEOMETRY.length); i += 1) {
      const bar = BAR_GEOMETRY[i];
      renderBar(ctx, mapX, mapY, bar.offset);
    }

    ctx.restore();

    return usedHeight * scale;
  }

  window.drawTzolkinNumber = drawTzolkinNumber;
})();
