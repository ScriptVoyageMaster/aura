// Утиліти для розрахунку майянського календаря Цолькін і пошуку потрібного SVG-гліфа.
// Коментарі максимально детальні українською, щоб навіть новачок розібрався у формулі.
(() => {
  const TZ_SIGNS = [
    "Imix",
    "Ik",
    "Akbal",
    "Kan",
    "Chicchan",
    "Cimi",
    "Manik",
    "Lamat",
    "Muluc",
    "Oc",
    "Chuen",
    "Eb",
    "Ben",
    "Ix",
    "Men",
    "Cib",
    "Caban",
    "Etznab",
    "Cauac",
    "Ahau",
  ];

  // Формуємо єдиний канонічний список ідентифікаторів гліфів у нижньому регістрі.
  // Це головне джерело правди для всіх обчислень у браузері.
  const CANON_GLYPHS = TZ_SIGNS.map((sign) => sign.toLowerCase());

  // Деякі SVG досі мають історичні назви файлів, тому зберігаємо словник винятків.
  const FILE_NAME_OVERRIDES = {
    // Пропускаємо "Ok" через альтернативне позначення у назві файлу.
    10: "MAYA-g-log-cal-D10-Ok_b.svg",
    // Старі назви з літерою «k» у середині.
    5: "MAYA-g-log-cal-D05-Chikchan.svg",
    6: "MAYA-g-log-cal-D06-Kimi.svg",
    9: "MAYA-g-log-cal-D09-Muluk.svg",
    11: "MAYA-g-log-cal-D11-Chuwen.svg",
    16: "MAYA-g-log-cal-D16-Kib.svg",
    17: "MAYA-g-log-cal-D17-Kaban.svg",
    19: "MAYA-g-log-cal-D19-Kawak.svg",
    20: "MAYA-g-log-cal-D20-Ajaw.svg",
  };

  /**
   * Перетворюємо дату григоріанського календаря на юліанський день (JDN).
   * Формула працює для всіх років, навіть до початку нашої ери (proleptic Gregorian).
   */
  function toJDN(year, month, day) {
    const a = Math.floor((14 - month) / 12);
    const yy = year + 4800 - a;
    const mm = month + 12 * a - 3;
    return (
      day +
      Math.floor((153 * mm + 2) / 5) +
      365 * yy +
      Math.floor(yy / 4) -
      Math.floor(yy / 100) +
      Math.floor(yy / 400) -
      32045
    );
  }

  /**
   * Обчислюємо тон і знак Цолькін для заданої дати.
   * @param {Date} dateObj - Обов'язково "чиста" дата без часу (краще створювати через Date.UTC).
   * @returns {{ tone: number, signIndex: number, signName: string }}
   */
  function tzolkinFromDate(dateObj) {
    if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) {
      throw new Error("tzolkinFromDate очікує коректний об'єкт Date");
    }

    // Використовуємо кореляцію GMT 584283: 2012-12-21 відповідає 4 Ajaw.
    const baseJdn = toJDN(2012, 12, 21);
    const jdn = toJDN(dateObj.getUTCFullYear(), dateObj.getUTCMonth() + 1, dateObj.getUTCDate());
    const delta = jdn - baseJdn;

    // Розрахунок тону: циклічне число 1..13.
    const tone = ((4 - 1 + delta) % 13 + 13) % 13 + 1;

    // Розрахунок знаку: циклічне число 1..20.
    const signIndex = ((20 - 1 + delta) % 20 + 20) % 20 + 1;
    const signName = TZ_SIGNS[signIndex - 1];

    return { tone, signIndex, signName };
  }

  /**
   * Повертаємо шлях до SVG-файлу із зображенням відповідного знаку.
   * @param {number} signIndex - Номер знаку (1..20).
   * @returns {string}
   */
  function mayaSvgPathFor(signIndex) {
    if (typeof signIndex !== "number" || signIndex < 1 || signIndex > 20) {
      throw new Error("mayaSvgPathFor очікує signIndex у діапазоні 1..20");
    }

    if (FILE_NAME_OVERRIDES[signIndex]) {
      return `assets/img/maya/${FILE_NAME_OVERRIDES[signIndex]}`;
    }

    const n = String(signIndex).padStart(2, "0");
    const name = TZ_SIGNS[signIndex - 1];
    return `assets/img/maya/MAYA-g-log-cal-D${n}-${name}.svg`;
  }

  // Робимо утиліти доступними глобально, щоб ними міг скористатися будь-який скрипт.
  window.toJDN = toJDN;
  window.tzolkinFromDate = tzolkinFromDate;
  window.mayaSvgPathFor = mayaSvgPathFor;
  window.TZ_SIGNS = TZ_SIGNS;
  window.CANON_GLYPHS = CANON_GLYPHS;
})();
