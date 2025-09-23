// Пояснення (UA):
// Це модуль гліфа Цолькін. Тут описуємо метадані (ідентифікатор, назви)
// та функцію draw(ctx, options), яка відповідає лише за МАЛЮВАННЯ цього гліфа.
// ЖОДНОЇ зовнішньої залежності: беремо лише CanvasRenderingContext2D (ctx) і options.
//
// Рекомендація: options = { x, y, size, palette, strokeWidth, ... }.
// size — базовий масштаб (наприклад, діаметр умовного кола гліфа).
// x,y — центр гліфа. Ніяких side-effects, усе локально.

export const glyph = {
  id: 'BEN',            // Сталий ID (верхній регістр), зручно для мапінгу
  nameUa: 'Бен',        // Українська назва для інтерфейсу
  nameEn: 'B’en',       // Англійська транслітерація
  order: 13,            // Порядковий номер у Цолькін (1–20)

  /**
   * Малювання гліфа на Canvas 2D.
   * @param {CanvasRenderingContext2D} ctx - контекст для малювання
   * @param {Object} options - параметри відображення
   */
  draw(ctx, options = {}) {
    const {
      x = 0,             // центр X
      y = 0,             // центр Y
      size = 100,        // базовий масштаб
      strokeWidth = 2,   // товщина ліній
      palette = {        // базова палітра (пізніше можна зробити глобально)
        stroke: '#111',
        fill: 'transparent'
      }
    } = options;

    // Приклад базової рамки (заглушка) — акуратно намалюй коло-контейнер:
    ctx.save();
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = palette.stroke;
    ctx.fillStyle = palette.fill;

    // Коло-контейнер як місце гліфа (заглушка):
    ctx.beginPath();
    ctx.arc(x, y, size * 0.45, 0, Math.PI * 2);
    ctx.stroke();

    // TODO: Нижче — ВІЗУАЛЬНА ЛОГІКА КОНКРЕТНОГО ГЛІФА.
    //      Для старту лишаємо порожнім. Будемо заповнювати по черзі.

    ctx.restore();
  }
};
