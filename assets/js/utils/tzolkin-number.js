// Утиліта малювання чисел Цолькін у вигляді рисок і крапок на Canvas.
// Функція додає максимально наочні коментарі українською мовою.
(() => {
  /**
   * Малюємо число 1..13 у вигляді традиційних майянських позначок.
   * @param {CanvasRenderingContext2D} ctx - контекст цільового canvas.
   * @param {number} tone - число від 1 до 13.
   * @param {number} x - координата лівого верхнього кута області відрисовки.
   * @param {number} y - координата лівого верхнього кута області відрисовки.
   * @param {number} width - доступна ширина.
   * @param {object} [options] - додаткові налаштування стилю.
   * @returns {number} - фактична висота намальованої композиції (щоб сцені легше було центрувати).
   */
  function drawTzolkinNumber(ctx, tone, x, y, width, options = {}) {
    if (!ctx) {
      throw new Error("drawTzolkinNumber очікує коректний 2D-контекст");
    }
    if (typeof tone !== "number" || tone < 1 || tone > 13) {
      throw new Error("drawTzolkinNumber працює лише з тоном у діапазоні 1..13");
    }

    // Акуратно дістаємо кольори та розміри з опцій (або задаємо вдалі значення за замовчуванням).
    const strokeColor = options.strokeColor || "#f6f1e6";
    const accentColor = options.accentColor || strokeColor;
    const lineWidth = options.lineWidth || width * 0.08;
    const dotRadius = options.dotRadius || width * 0.1;
    const spacing = options.spacing || width * 0.12;
    const barLength = options.barLength || width * 0.82;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = accentColor;

    // Розкладаємо число на кількість рисок (кожна означає 5) та крапок (1..4).
    const barsCount = Math.floor(tone / 5);
    const dotsCount = tone % 5;

    const barsHeight = barsCount > 0 ? barsCount * lineWidth + (barsCount - 1) * spacing : 0;
    const dotsHeight = dotsCount > 0 ? dotRadius * 2 : 0;
    const gapBetweenGroups = barsCount > 0 && dotsCount > 0 ? spacing : 0;
    const totalHeight = barsHeight + dotsHeight + gapBetweenGroups;

    let cursorY = y;

    // Спершу малюємо крапки (вони завжди розташовані над рисками).
    if (dotsCount > 0) {
      const dotSpacing = options.dotSpacing || dotRadius * 2.1;
      const totalDotsWidth = dotsCount === 1 ? dotRadius * 2 : dotRadius * 2 + dotSpacing * (dotsCount - 1);
      const startX = x + (width - totalDotsWidth) / 2;
      const centerY = cursorY + dotRadius;

      for (let i = 0; i < dotsCount; i += 1) {
        const cx = startX + i * dotSpacing;
        ctx.beginPath();
        ctx.arc(cx + dotRadius, centerY, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }

      cursorY += dotsHeight + gapBetweenGroups;
    }

    // Тепер малюємо риски — горизонтальні смуги з закругленими краями.
    if (barsCount > 0) {
      const barStartX = x + (width - barLength) / 2;
      for (let i = 0; i < barsCount; i += 1) {
        const barY = cursorY + i * (lineWidth + spacing) + lineWidth / 2;
        ctx.beginPath();
        ctx.moveTo(barStartX, barY);
        ctx.lineTo(barStartX + barLength, barY);
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      }
    }

    ctx.restore();
    return totalHeight;
  }

  window.drawTzolkinNumber = drawTzolkinNumber;
})();
