// Заглушка сцени "Druids": м'який статичний фон без складної графіки.
// Коментарі детально пояснюють кожен крок українською мовою, щоб новачок не загубився.
(() => {
  /**
   * Легка функція для приведення вхідного значення до допустимого числа.
   * Навіть якщо в параметри прилетить щось дивне, ми повернемо адекватний результат.
   */
  function toNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  class DruidsScene {
    constructor() {
      // Зберігаємо поточні габарити канви та обраний гендер, аби при перемиканні тем не виникало артефактів.
      this.width = 0;
      this.height = 0;
      this.gender = "unspecified";
      this.seed = "";
      this.prng = null;
      this.isInitialized = false;
    }

    /**
     * Ініціалізація сцени: просто фіксуємо seed та зберігаємо PRNG для потенційних майбутніх оновлень.
     * Жодних важких обчислень, тож заглушка не впливає на продуктивність.
     */
    init(seed, prng, context = {}) {
      this.seed = `${seed || ""}`;
      this.prng = prng || null;
      if (context && typeof context.gender === "string") {
        this.gender = context.gender;
      }
      this.isInitialized = true;
    }

    /**
     * Підлаштовуємося під нові габарити сценової рамки.
     * Метод викликається і при первинному завантаженні, і при ресайзі.
     */
    relayout(width, height) {
      this.width = toNumber(width, this.width);
      this.height = toNumber(height, this.height);
    }

    /**
     * На випадок, якщо головний двигун викличе resize замість relayout — просто делегуємо.
     */
    resize(width, height) {
      this.relayout(width, height);
    }

    /**
     * Оновлення стану кадру. Заглушка нічого не анімує, тому метод порожній, але залишаємо його для сумісності.
     */
    update() {
      // Тут могли б змінюватися параметри анімації, але заглушка тримає сцену статичною.
    }

    /**
     * Малюємо акуратний фон: легка прозора вуаль, щоб користувач розумів, що сцена активна.
     * Не використовуємо складні ефекти, аби не перезапускати анімації інших сцен.
     */
    draw(ctx) {
      if (!ctx) {
        return;
      }
      const canvas = ctx.canvas;
      const { width, height } = canvas;
      if (!width || !height) {
        return;
      }
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.fillStyle = this.gender === "male" ? "rgba(40, 70, 45, 0.25)" : "rgba(60, 100, 75, 0.25)";
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    /**
     * Оновлення теми за зміною статі. Достатньо запам'ятати значення, яке використаємо під час малювання.
     */
    updateTheme({ gender } = {}) {
      if (typeof gender === "string" && gender) {
        this.gender = gender;
      }
    }

    /**
     * Сумісність зі старим API: якщо головний код викликає setGender напряму.
     */
    setGender(gender) {
      this.updateTheme({ gender });
    }

    /**
     * Заглушка не має 3D-режиму, тому примусовий перехід у 2D просто нічого не робить.
     */
    force2dMode() {}

    /**
     * Ми ніколи не блокуємо режим 2D, тому завжди повертаємо false.
     */
    isModeLockedTo2d() {
      return false;
    }

    /**
     * Скидання блокувань режиму — для повної сумісності з API сцен у проєкті.
     */
    resetModeLock() {}

    /**
     * Очистка ресурсів. Заглушка не створює об'єктів, але метод залишаємо на майбутнє.
     */
    destroy() {
      this.isInitialized = false;
    }
  }

  // Робимо сцену доступною глобально, щоб main.js міг її підхопити так само, як і "maya".
  window.druidsScene = new DruidsScene();
})();
