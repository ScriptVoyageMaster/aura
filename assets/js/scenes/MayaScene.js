// MayaScene відповідає за відображення календарної символіки майя.
// Усі пояснення подані українською мовою, щоб навіть новачок міг простежити логіку.

(() => {
  "use strict";

  if (!window.CONFIG) {
    console.error(
      "CONFIG не знайдено. Переконайтесь, що config.js завантажений перед MayaScene.js."
    );
    return;
  }

  const CONFIG = window.CONFIG;

  class MayaScene {
    constructor() {
      // Зберігаємо розміри "дизайн-рамки" сцени. Спочатку беремо значення з конфігурації.
      this.width = CONFIG.global.DESIGN_WIDTH;
      this.height = CONFIG.global.DESIGN_HEIGHT;

      // Локальні параметри часу, потрібні для етапів анімації.
      this.time = 0;
      this.phase = "intro";
      this.startedAt = performance.now();
      this.introDurationMs = CONFIG.global.INTRO_DURATION_MS;

      // Додаємо поле для збереження поточного seed, якщо знадобиться у майбутньому.
      this.seed = "";
    }

    /**
     * Метод init викликається головним циклом при старті або перезапуску сцени.
     * Тут ми скидаємо таймер та запам'ятовуємо seed для можливих майбутніх розрахунків.
     */
    init(seedStr) {
      this.seed = seedStr || "";
      this.time = 0;
      this.phase = "intro";
      this.startedAt = performance.now();
    }

    /**
     * Під час зміни розміру канви ми пристосовуємо габарити сцени.
     * Мінімальні обмеження у 200 пікселів гарантують, що ескіз не стиснеться до нуля.
     */
    resize(width, height) {
      this.width = Math.max(width, 200);
      this.height = Math.max(height, 200);
    }

    /**
     * Оновлюємо внутрішній час сцени. Під час вступу відслідковуємо завершення
     * вступної анімації, далі накопичуємо час для циклічних ефектів (на майбутнє).
     */
    update(dt, now) {
      if (this.phase === "intro" && now - this.startedAt > this.introDurationMs) {
        this.phase = "main";
      } else if (this.phase === "main") {
        this.time += dt;
      }
    }

    /**
     * Функція draw викликається щоразу, коли потрібно перемалювати сцену.
     * Параметр progress показує, наскільки далеко просунулась вступна анімація.
     */
    draw(ctx, now) {
      ctx.clearRect(0, 0, this.width, this.height);

      const progress = Math.min(1, (now - this.startedAt) / this.introDurationMs);

      // Малюємо гліф Cauac ("Буря"), що складається з хмари та блискавки.
      this.drawCauac(ctx, progress);
    }

    /**
     * Малювання гліфа майя "Cauac" (буря). Параметр progress (0..1)
     * визначає, яка частина елементів уже з'явилась на полотні.
     */
    drawCauac(ctx, progress) {
      ctx.save();
      ctx.translate(this.width / 2, this.height / 2);
      ctx.strokeStyle = "#0077cc";
      ctx.lineWidth = 4;
      ctx.lineCap = "round";

      // Етап 1: плавно "виростає" силует хмари.
      ctx.beginPath();
      ctx.arc(0, -20, 40, Math.PI, Math.PI * (1 + progress));
      ctx.stroke();

      // Етап 2: після половини прогресу з'являється блискавка, що символізує бурю.
      if (progress > 0.5) {
        ctx.beginPath();
        ctx.moveTo(0, 20);
        ctx.lineTo(-15, 50);
        ctx.lineTo(5, 70);
        ctx.lineTo(-10, 100);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  window.mayaScene = new MayaScene();
})();
