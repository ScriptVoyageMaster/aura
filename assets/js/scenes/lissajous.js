// Сцена з побудовою лісажу-кривих. Вона відповідає за математичну частину анімації.
// Клас нижче має методи init, resize, update, draw, які викликає головний двигун.

class LissajousScene {
  constructor() {
    // Початкові значення стану сцени.
    this.width = 0;
    this.height = 0;
    this.time = 0; // Загальний час анімації у секундах.
    this.params = null; // Об'єкт із параметрами кривих (частоти, фази, кольори тощо).
    this.curves = []; // Масив кривих, які будемо промальовувати у draw().
  }

  /**
   * Ініціалізація сцени на базі seed та PRNG.
   * @param {string} seedStr - Рядок, що описує дату й час (для історії).
   * @param {{ next: () => number }} prng - Детермінований генератор випадкових чисел.
   */
  init(seedStr, prng) {
    // Зберігаємо seed для потенційного відлагодження або повторного використання.
    this.seed = seedStr;
    this.time = 0;

    // Визначаємо основні параметри кривої за допомогою PRNG.
    const freqX = 1 + Math.floor(prng.next() * 8); // Частота по осі X (1..9).
    const freqY = 1 + Math.floor(prng.next() * 8); // Частота по осі Y (1..9).
    const phaseBase = prng.next() * Math.PI * 2; // Початкова фаза у радіанах.
    const phaseSpeed = 0.2 + prng.next() * 0.4; // Швидкість зміни фази.
    const ampXRatio = 0.35 + prng.next() * 0.55; // Амплітуда по X відносно ширини полотна.
    const ampYRatio = 0.35 + prng.next() * 0.55; // Амплітуда по Y відносно висоти.
    const lineWidth = 0.6 + prng.next() * 1.2; // Товщина лінії.
    const alpha = 0.35 + prng.next() * 0.35; // Прозорість лінії.
    const iterationCount = 320 + Math.floor(prng.next() * 180); // Кількість точок на криву.

    // Генеруємо палітру кольорів. Вона може містити 1-3 відтінки.
    const paletteCandidates = [
      ["#e8efff"],
      ["#e8efff", "#7f8cff"],
      ["#e8efff", "#7f8cff", "#00f6ff"],
      ["#f6d365", "#fda085"],
      ["#f0f3ff", "#7de2d1", "#ff8ba7"],
    ];
    const palette = paletteCandidates[Math.floor(prng.next() * paletteCandidates.length)];

    // Кожна крива може мати додатковий зсув фази, щоб малюнок ставав складнішим.
    this.curves = palette.map((color) => ({
      color,
      offset: prng.next() * Math.PI * 2,
    }));

    this.params = {
      freqX,
      freqY,
      phaseBase,
      phaseSpeed,
      ampXRatio,
      ampYRatio,
      lineWidth,
      alpha,
      iterationCount,
    };
  }

  /**
   * Оновлюємо розміри полотна та масштаб амплітуд.
   * @param {number} width - Поточна ширина canvas у CSS-пікселях.
   * @param {number} height - Поточна висота canvas у CSS-пікселях.
   */
  resize(width, height) {
    this.width = Math.max(width, 200); // Переконуємося, що є мінімальна площа для малювання.
    this.height = Math.max(height, 200);

    if (this.params) {
      // Попередньо розраховуємо реальні амплітуди з урахуванням розмірів полотна.
      this.params.ampX = (this.width / 2) * this.params.ampXRatio;
      this.params.ampY = (this.height / 2) * this.params.ampYRatio;
    }
  }

  /**
   * Оновлюємо стан анімації відповідно до кроку часу.
   * @param {number} dt - Зміна часу у секундах між кадрами.
   */
  update(dt) {
    if (!this.params) return;
    // Збільшуємо загальний час, щоб плавно змінювати фазу.
    this.time += dt;
  }

  /**
   * Малюємо криву на полотні.
   * @param {CanvasRenderingContext2D} ctx - Контекст 2D для малювання.
   */
  draw(ctx) {
    if (!this.params) return;

    const {
      freqX,
      freqY,
      phaseBase,
      phaseSpeed,
      ampX,
      ampY,
      lineWidth,
      alpha,
      iterationCount,
    } = this.params;

    const centerX = this.width / 2;
    const centerY = this.height / 2;
    const phase = phaseBase + this.time * phaseSpeed;
    const totalCycles = Math.PI * 2 * (1 + Math.max(freqX, freqY));

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = lineWidth;

    for (let i = 0; i < this.curves.length; i += 1) {
      const curve = this.curves[i];
      ctx.strokeStyle = this.applyAlpha(curve.color, alpha);

      ctx.beginPath();
      for (let j = 0; j <= iterationCount; j += 1) {
        const t = (j / iterationCount) * totalCycles;
        // Формула лісажу: x = sin(freqX * t + фаза), y = sin(freqY * t).
        const x = centerX + Math.sin(freqX * t + phase + curve.offset) * ampX;
        const y = centerY + Math.sin(freqY * t + curve.offset) * ampY;

        if (j === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
  }

  /**
   * Допоміжна функція для додавання прозорості до кольору у форматі hex.
   * @param {string} color - Колір у форматі #RRGGBB.
   * @param {number} alpha - Значення прозорості (0..1).
   * @returns {string} Колір у форматі rgba().
   */
  applyAlpha(color, alpha) {
    // Розбираємо шестнадцятковий колір на компоненти R, G, B.
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  }
}

// Створюємо єдиний екземпляр сцени та додаємо його у глобальний простір імен.
window.lissajousScene = new LissajousScene();
