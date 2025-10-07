/**
 * Генератор текстових описів для поєднань гліфа та тону Цолькін.
 * Весь модуль детально прокоментований українською мовою, щоби навіть новачок розібрався в алгоритмі.
 */

const DATA_URLS = {
  glyphs: "data/glyphs.json",
  tones: "data/tones.json",
  genderMods: "data/gender_mods.json",
  rules: "data/rules.json",
  synergy: "data/synergy.json",
  overrides: "data/overrides.json",
};

// Кешуємо словники, аби не тягнути їх з мережі на кожен запит.
let dictionariesPromise = null;

// Окремий кеш для overrides, що підтягується лише за потреби.
let overridesState = { loaded: false, data: null };
let overridesPromise = null;

// Запам'ятовуємо версію overrides, щоб контролювати очищення кешу описів під час змін.
let overridesVersion = null;

// Збираємо просту статистику використаних override, щоб у dev-режимі бачити загальну картину.
const overrideUsageStats = new Map();

// Кеш результатів генерації, щоб уникати повторних складань тексту для однакових параметрів.
const descriptionCache = new Map();

// Значення за замовчуванням для випадку, коли словники відсутні або неповні.
const DEFAULT_BLOCK_ORDER = [
  "title",
  "intro",
  "glyph_core",
  "tone_core",
  "synergy",
  "advice",
  "shadow",
  "conclusion",
];

const VALID_BLOCK_KEYS = new Set([...DEFAULT_BLOCK_ORDER, "meta"]);

// Утиліта перевіряє, чи значення є простим об'єктом без масиву, щоби не натрапити на небажані типи.
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Перевіряємо, що назва блоку з overrides входить до дозволеного переліку.
function isValidBlockName(name) {
  return VALID_BLOCK_KEYS.has(name);
}

// Валідуємо ключ статі: приймаємо лише male/female/any.
function isValidGender(gender) {
  return gender === "male" || gender === "female" || gender === "any";
}

// Перевіряємо підтримувані локалі для overrides.
function isValidLang(lang) {
  return lang === "ua" || lang === "en";
}

// Акуратно формуємо шлях для логування, щоби легше шукати проблемне місце в overrides.json.
function buildOverridePath(parts) {
  return parts.filter(Boolean).join(".");
}

// Службовий логгер для валідатора: один стиснений рядок на відхилений вузол.
function logInvalidOverrideNode(path, reason) {
  logDev(`overrides: invalid node skipped ${path || "<root>"}: ${reason}`);
}

// Перетворюємо довільне значення в осмислений ключ (рядок без зайвих пробілів).
function normalizeKeyCandidate(value) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  return "";
}

// Санітуємо локалізований об'єкт { ua: "...", en: "..." } і відкидаємо сторонні ключі чи невалідні значення.
function sanitizeLangObject(raw, pathParts) {
  if (!isPlainObject(raw)) {
    logInvalidOverrideNode(buildOverridePath(pathParts), "очікувався об'єкт локалізацій");
    return null;
  }
  const sanitized = {};
  for (const [langKeyRaw, value] of Object.entries(raw)) {
    const langKey = normalizeKeyCandidate(langKeyRaw);
    if (!isValidLang(langKey)) {
      logInvalidOverrideNode(
        buildOverridePath([...pathParts, langKeyRaw]),
        "непідтримувана мова"
      );
      continue;
    }
    const normalizedValue = normalizeOverrideStringCandidate(value);
    if (normalizedValue === null) {
      logInvalidOverrideNode(
        buildOverridePath([...pathParts, langKey]),
        "порожнє або некоректне значення перекладу"
      );
      continue;
    }
    sanitized[langKey] = normalizedValue;
  }
  if (Object.keys(sanitized).length === 0) {
    logInvalidOverrideNode(buildOverridePath(pathParts), "відсутні валідні локалізовані значення");
    return null;
  }
  return sanitized;
}

// Готуємо один елемент масиву advice: приймаємо рядок або локалізований об'єкт.
function sanitizeAdviceItem(item, pathParts) {
  if (item === null || typeof item === "undefined") {
    logInvalidOverrideNode(buildOverridePath(pathParts), "порожній елемент списку");
    return null;
  }
  if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
    const normalized = normalizeOverrideStringCandidate(item);
    if (normalized === null || normalized.length === 0) {
      logInvalidOverrideNode(buildOverridePath(pathParts), "порожній рядок у списку");
      return null;
    }
    return normalized;
  }
  if (isPlainObject(item)) {
    const sanitized = sanitizeLangObject(item, pathParts);
    if (!sanitized) {
      return null;
    }
    return sanitized;
  }
  logInvalidOverrideNode(buildOverridePath(pathParts), "очікувався рядок або об'єкт локалізацій");
  return null;
}

// Повертаємо валідне значення блоку або null, якщо щось пішло не так.
function sanitizeBlockValue(blockName, rawValue, pathParts) {
  if (blockName === "advice") {
    if (Array.isArray(rawValue)) {
      const sanitizedList = [];
      rawValue.forEach((item, index) => {
        const sanitizedItem = sanitizeAdviceItem(item, [...pathParts, `[${index}]`]);
        if (sanitizedItem !== null) {
          sanitizedList.push(sanitizedItem);
        }
      });
      if (sanitizedList.length === 0) {
        logInvalidOverrideNode(buildOverridePath(pathParts), "список advice спорожнів після валідації");
        return null;
      }
      return sanitizedList;
    }
    if (typeof rawValue === "string" || typeof rawValue === "number" || typeof rawValue === "boolean") {
      const normalized = normalizeOverrideStringCandidate(rawValue);
      if (normalized === null || normalized.length === 0) {
        logInvalidOverrideNode(buildOverridePath(pathParts), "порожнє рядкове значення advice");
        return null;
      }
      return normalized;
    }
    if (isPlainObject(rawValue)) {
      const sanitized = sanitizeLangObject(rawValue, pathParts);
      return sanitized;
    }
    logInvalidOverrideNode(buildOverridePath(pathParts), "невідомий тип даних для advice");
    return null;
  }

  if (Array.isArray(rawValue)) {
    logInvalidOverrideNode(buildOverridePath(pathParts), "масив не підтримується для цього блоку");
    return null;
  }

  if (typeof rawValue === "string" || typeof rawValue === "number" || typeof rawValue === "boolean") {
    const normalized = normalizeOverrideStringCandidate(rawValue);
    if (normalized === null) {
      logInvalidOverrideNode(buildOverridePath(pathParts), "порожнє рядкове значення");
      return null;
    }
    return normalized;
  }

  if (isPlainObject(rawValue)) {
    const sanitized = sanitizeLangObject(rawValue, pathParts);
    return sanitized;
  }

  logInvalidOverrideNode(buildOverridePath(pathParts), "невідомий тип значення блоку");
  return null;
}

// Повна валідація дерева overrides: фільтруємо все зайве та повертаємо лише коректні вузли.
function validateOverridesStructure(rawOverrides) {
  if (!isPlainObject(rawOverrides)) {
    logInvalidOverrideNode("<root>", "очікувався об'єкт із календарями");
    return { sanitized: {}, hasEntries: false };
  }

  const sanitizedCalendars = {};
  let hasEntries = false;

  for (const [calendarKeyRaw, glyphCollection] of Object.entries(rawOverrides)) {
    const calendarKey = normalizeKeyCandidate(calendarKeyRaw);
    const calendarPath = [calendarKey || calendarKeyRaw];
    if (!calendarKey) {
      logInvalidOverrideNode(calendarKeyRaw || "<empty_calendar>", "порожній ключ календаря");
      continue;
    }
    if (!isPlainObject(glyphCollection)) {
      logInvalidOverrideNode(buildOverridePath(calendarPath), "очікувався об'єкт із гліфами");
      continue;
    }

    const sanitizedGlyphs = {};

    for (const [glyphKeyRaw, toneCollection] of Object.entries(glyphCollection)) {
      const glyphKey = normalizeKeyCandidate(glyphKeyRaw);
      const glyphPath = [...calendarPath, glyphKey || glyphKeyRaw];
      if (!glyphKey) {
        logInvalidOverrideNode(buildOverridePath(glyphPath), "порожній ключ гліфа");
        continue;
      }
      if (!isPlainObject(toneCollection)) {
        logInvalidOverrideNode(buildOverridePath(glyphPath), "очікувався об'єкт із тонами");
        continue;
      }

      const sanitizedTones = {};

      for (const [toneKeyRaw, genderCollection] of Object.entries(toneCollection)) {
        const toneKey = normalizeKeyCandidate(toneKeyRaw);
        const tonePath = [...glyphPath, toneKey || toneKeyRaw];
        if (!toneKey) {
          logInvalidOverrideNode(buildOverridePath(tonePath), "порожній ключ тону");
          continue;
        }
        if (!isPlainObject(genderCollection)) {
          logInvalidOverrideNode(buildOverridePath(tonePath), "очікувався об'єкт зі статями");
          continue;
        }

        const sanitizedGenders = {};

        for (const [genderKeyRaw, blockCollection] of Object.entries(genderCollection)) {
          const genderKey = normalizeKeyCandidate(genderKeyRaw);
          const genderPath = [...tonePath, genderKey || genderKeyRaw];
          if (!genderKey || !isValidGender(genderKey)) {
            logInvalidOverrideNode(buildOverridePath(genderPath), "неприпустима стать");
            continue;
          }
          if (!isPlainObject(blockCollection)) {
            logInvalidOverrideNode(buildOverridePath(genderPath), "очікувався об'єкт із блоками");
            continue;
          }

          const sanitizedBlocks = {};

          for (const [blockKeyRaw, blockValue] of Object.entries(blockCollection)) {
            const blockKey = normalizeKeyCandidate(blockKeyRaw);
            const blockPath = [...genderPath, blockKey || blockKeyRaw];
            if (!blockKey || !isValidBlockName(blockKey)) {
              logInvalidOverrideNode(buildOverridePath(blockPath), "непідтримуваний блок");
              continue;
            }
            const sanitizedValue = sanitizeBlockValue(blockKey, blockValue, blockPath);
            if (sanitizedValue === null) {
              continue;
            }
            sanitizedBlocks[blockKey] = sanitizedValue;
          }

          if (Object.keys(sanitizedBlocks).length === 0) {
            logInvalidOverrideNode(buildOverridePath(genderPath), "усі блоки були відкинуті валідатором");
            continue;
          }

          sanitizedGenders[genderKey] = sanitizedBlocks;
        }

        if (Object.keys(sanitizedGenders).length === 0) {
          logInvalidOverrideNode(buildOverridePath(tonePath), "для тону не залишилося валідних статей");
          continue;
        }

        sanitizedTones[toneKey] = sanitizedGenders;
      }

      if (Object.keys(sanitizedTones).length === 0) {
        logInvalidOverrideNode(buildOverridePath(glyphPath), "для гліфа не залишилося валідних тонів");
        continue;
      }

      sanitizedGlyphs[glyphKey] = sanitizedTones;
    }

    if (Object.keys(sanitizedGlyphs).length === 0) {
      logInvalidOverrideNode(buildOverridePath(calendarPath), "для календаря не залишилося валідних гліфів");
      continue;
    }

    sanitizedCalendars[calendarKey] = sanitizedGlyphs;
    hasEntries = true;
  }

  return { sanitized: sanitizedCalendars, hasEntries };
}

// Обчислюємо просту сигнатуру версії overrides, використовуючи довжину та контрольну суму.
function computeOverridesVersionSignature(text) {
  const source = `${text ?? ""}`;
  let checksum = 0;
  for (let index = 0; index < source.length; index += 1) {
    checksum = (checksum + source.charCodeAt(index) * (index + 1)) % 1_000_000_007;
  }
  return `${source.length}:${checksum}`;
}

// Оновлюємо версію overrides і очищуємо кеш описів, якщо дані змінилися.
function updateOverridesVersion(newVersion) {
  if (overridesVersion === newVersion) {
    return;
  }
  overridesVersion = newVersion;
  descriptionCache.clear();
  logDev("overrides: version updated", { version: newVersion });
}

const FALLBACK_DESCRIPTION = {
  title: "Опис тимчасово недоступний",
  metaDescription: "Опис для цієї комбінації ще готується.",
  keywords: [],
  order: DEFAULT_BLOCK_ORDER,
  blocks: {
    intro: {
      paragraphs: ["Ми ще збираємо матеріали для цієї комбінації гліфа та тону."],
      list: [],
    },
    glyph_core: { paragraphs: [], list: [] },
    tone_core: { paragraphs: [], list: [] },
    synergy: { paragraphs: [], list: [] },
    advice: { paragraphs: [], list: [] },
    shadow: { paragraphs: [], list: [] },
    conclusion: { paragraphs: [], list: [] },
  },
};

/**
 * Швидко формуємо службовий опис для критичних випадків (відсутні дані).
 */
function buildServiceFallback(message) {
  const fallback = cloneResult(FALLBACK_DESCRIPTION);
  if (message) {
    fallback.blocks.intro.paragraphs = [normalizeSpacing(message)];
  }
  return fallback;
}

/**
 * Безпечне глибоке клонування результату перед поверненням користувачу.
 * Це дозволяє уникнути небажаних мутацій кешу зовні.
 */
function cloneResult(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

/**
 * Визначаємо, чи варто вмикати докладне логування для розробки.
 * Якщо середовище явно продакшн — мовчимо, інакше показуємо службові повідомлення.
 */
function isDevLoggingEnabled() {
  if (typeof process !== "undefined" && process && process.env && typeof process.env.NODE_ENV === "string") {
    return process.env.NODE_ENV !== "production";
  }
  if (typeof window !== "undefined" && window && typeof window.__AURA_ENV__ === "string") {
    return window.__AURA_ENV__ !== "production";
  }
  return true;
}

/**
 * Акуратне виведення dev-логів, щоб не засмічувати консоль у продакшні.
 */
function logDev(message, payload) {
  if (!isDevLoggingEnabled()) {
    return;
  }
  if (typeof payload === "undefined") {
    console.info(message);
  } else {
    console.info(message, payload);
  }
}

/**
 * Ледаче завантаження overrides.json з кешуванням і м’яким поводженням з помилками.
 * Якщо файл порожній або недоступний — запам’ятовуємо, що overrides відсутні.
 */
async function loadOverrides() {
  if (overridesState.loaded) {
    return overridesState.data;
  }
  if (!overridesPromise) {
    overridesPromise = (async () => {
      try {
        const response = await fetch(DATA_URLS.overrides, { cache: "no-store" });
        if (!response || !response.ok) {
          logDev("overrides: empty/disabled", { reason: response ? response.status : "no-response" });
          overridesState = { loaded: true, data: null };
          return null;
        }
        const text = await response.text();
        const versionSignature = computeOverridesVersionSignature(text);
        updateOverridesVersion(versionSignature);

        if (!text || !text.trim()) {
          logDev("overrides: empty/disabled", { reason: "empty-file" });
          overridesState = { loaded: true, data: null };
          return null;
        }

        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch (parseError) {
          logDev("overrides: empty/disabled", { reason: "invalid-json", message: parseError?.message });
          overridesState = { loaded: true, data: null };
          return null;
        }

        const { sanitized, hasEntries } = validateOverridesStructure(parsed);
        if (!hasEntries) {
          logDev("overrides: empty/disabled", { reason: "no-valid-entries" });
          overridesState = { loaded: true, data: null };
          return null;
        }

        overridesState = { loaded: true, data: sanitized };
        logDev("overrides: loaded", {
          calendars: Object.keys(sanitized).length,
          version: versionSignature,
        });
        return sanitized;
      } catch (error) {
        logDev("overrides: empty/disabled", { reason: "fetch-error", message: error?.message });
        overridesState = { loaded: true, data: null };
        return null;
      } finally {
        overridesPromise = null;
      }
    })();
  }
  return overridesPromise;
}

/**
 * Акуратно завантажуємо JSON. Для опціональних файлів (overrides) 404 не вважаємо помилкою.
 */
async function fetchJson(path, { optional = false } = {}) {
  try {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) {
      if (optional && response.status === 404) {
        return null;
      }
      throw new Error(`Помилка завантаження ${path}: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (!optional) {
      console.error("Не вдалося отримати", path, error);
    }
    if (optional) {
      return null;
    }
    throw error;
  }
}

/**
 * Повертаємо об'єкт зі словниками. Якщо вже завантажували — повертаємо той самий проміс.
 */
async function loadDictionaries() {
  if (!dictionariesPromise) {
    dictionariesPromise = (async () => {
      try {
        const [glyphs, tones, genderMods, rules, synergy] = await Promise.all([
          fetchJson(DATA_URLS.glyphs),
          fetchJson(DATA_URLS.tones),
          fetchJson(DATA_URLS.genderMods),
          fetchJson(DATA_URLS.rules),
          fetchJson(DATA_URLS.synergy),
        ]);

        return {
          glyphs: glyphs || {},
          tones: tones || {},
          genderMods: genderMods || {},
          rules: rules || { limits: { title: 70, meta: 160 }, avoid_repeats: [], synonyms: {} },
          synergy: synergy || {},
        };
      } catch (error) {
        console.error("Не вдалося завантажити словники описів Цолькін:", error);
        return {
          glyphs: {},
          tones: {},
          genderMods: {},
          rules: { limits: { title: 70, meta: 160 }, avoid_repeats: [], synonyms: {} },
          synergy: {},
        };
      }
    })();
  }
  return dictionariesPromise;
}

/**
 * Нормалізуємо стать до двох допустимих значень (female/male). Якщо передано щось інше — використовуємо female як безпечний дефолт.
 */
function normalizeGender(gender) {
  return gender === "male" ? "male" : "female";
}

/**
 * Нормалізуємо календар, аби ключ у overrides був послідовним.
 */
function normalizeCalendarId(calendar) {
  const cleaned = `${calendar || ""}`.trim().toLowerCase();
  return cleaned || "maya";
}

/**
 * Нормалізуємо мову. Поки підтримується українська (ua) та англійська (en). Будь-що інше згортаємо до ua.
 */
function normalizeLang(lang) {
  return lang === "en" ? "en" : "ua";
}

/**
 * Визначаємо запасну мову: якщо користувач просить українську — підстрахуємо англійською і навпаки.
 */
function getFallbackLang(lang) {
  return lang === "en" ? "ua" : "en";
}

/**
 * Нормалізуємо будь-яке значення до рядка або null, якщо перетворення некоректне.
 */
function normalizeOverrideStringCandidate(value) {
  if (value === null || typeof value === "undefined") {
    return null;
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  return null;
}

/**
 * Витягуємо рядкове значення override з урахуванням бажаної мови та fallback.
 */
function pickOverrideString(rawValue, { lang, fallbackLang }) {
  if (rawValue === null || typeof rawValue === "undefined") {
    return null;
  }
  if (Array.isArray(rawValue)) {
    return null;
  }
  if (typeof rawValue === "object") {
    const direct = normalizeOverrideStringCandidate(rawValue[lang]);
    if (direct !== null) {
      return direct;
    }
    const fallback = normalizeOverrideStringCandidate(rawValue[fallbackLang]);
    if (fallback !== null) {
      return fallback;
    }
    for (const candidate of Object.values(rawValue)) {
      const normalized = normalizeOverrideStringCandidate(candidate);
      if (normalized !== null) {
        return normalized;
      }
    }
    return "";
  }
  return normalizeOverrideStringCandidate(rawValue);
}

/**
 * Перетворюємо масив override-пунктів (для advice) у чистий масив рядків.
 */
function normalizeOverrideArrayValue(items, { lang, fallbackLang }) {
  if (!Array.isArray(items)) {
    return [];
  }
  const normalizedItems = [];
  for (const item of items) {
    const normalized = pickOverrideString(item, { lang, fallbackLang });
    if (normalized !== null && normalized.length > 0) {
      normalizedItems.push(normalized);
    }
  }
  return normalizedItems;
}

/**
 * Шукаємо override для конкретного блоку. Якщо нічого не знайдено — повертаємо null.
 */
function getOverrideBlock(calendar, glyphId, toneId, gender, blockName, lang) {
  if (!overridesState.loaded || !overridesState.data) {
    return null;
  }
  if (!calendar || !glyphId || !toneId || !gender || !blockName || !lang) {
    return null;
  }
  const calendarBucket = overridesState.data?.[calendar];
  if (!calendarBucket || typeof calendarBucket !== "object") {
    return null;
  }
  const glyphBucket = calendarBucket?.[glyphId];
  if (!glyphBucket || typeof glyphBucket !== "object") {
    return null;
  }
  const toneBucket = glyphBucket?.[String(toneId)];
  if (!toneBucket || typeof toneBucket !== "object") {
    return null;
  }
  const normalizedGender = normalizeGender(gender);
  let genderBucket = toneBucket?.[normalizedGender];
  let genderSource = normalizedGender;

  if (!genderBucket || typeof genderBucket !== "object") {
    const anyBucket = toneBucket?.any;
    if (!anyBucket || typeof anyBucket !== "object") {
      return null;
    }
    genderBucket = anyBucket;
    genderSource = "any";
  }

  if (!Object.prototype.hasOwnProperty.call(genderBucket, blockName)) {
    return null;
  }
  const rawValue = genderBucket[blockName];
  const fallbackLang = getFallbackLang(lang);
  if (blockName === "advice" && Array.isArray(rawValue)) {
    const normalizedArray = normalizeOverrideArrayValue(rawValue, { lang, fallbackLang });
    if (normalizedArray.length === 0) {
      return null;
    }
    return { value: normalizedArray, genderSource };
  }
  const normalized = pickOverrideString(rawValue, { lang, fallbackLang });
  if (normalized === null) {
    return null;
  }
  return { value: normalized, genderSource };
}

/**
 * Фіксуємо у dev-консолі, чи було застосовано override для конкретного блоку.
 */
function logBlockOverrideUsage(blockName, overrideUsed) {
  if (!isDevLoggingEnabled()) {
    return;
  }
  console.info({ block: blockName, override: Boolean(overrideUsed) });
}

// Фіксуємо факт використання override у пам'яті, щоб зібрати агреговану статистику.
function recordOverrideUsage({
  calendar,
  glyphId,
  toneId,
  requestedGender,
  actualGender,
  blockName,
}) {
  const calendarKey = normalizeKeyCandidate(calendar);
  const glyphKey = normalizeKeyCandidate(glyphId);
  const toneKey = normalizeKeyCandidate(toneId);
  const blockKey = normalizeKeyCandidate(blockName);
  const genderKey = normalizeKeyCandidate(actualGender || requestedGender);
  if (!calendarKey || !glyphKey || !toneKey || !blockKey || !genderKey) {
    return;
  }
  const statsKey = `${calendarKey}.${glyphKey}.${toneKey}.${genderKey}.${blockKey}`;
  const current = overrideUsageStats.get(statsKey) || 0;
  overrideUsageStats.set(statsKey, current + 1);
}

// Виводимо агреговану статистику в консоль, щоб швидко переглянути застосовані overrides.
function printOverrideUsageStats() {
  if (overrideUsageStats.size === 0) {
    console.info("overrides: статистика поки порожня");
    return;
  }
  const entries = [...overrideUsageStats.entries()]
    .map(([key, count]) => {
      const [calendar, glyph, tone, gender, block] = key.split(".");
      return { calendar, glyph, tone, gender, block, count };
    })
    .sort((a, b) => b.count - a.count);
  if (typeof console.table === "function") {
    console.table(entries);
  } else {
    console.info("overrides usage", entries);
  }
}

// Прокидаємо утиліту в глобальний простір у dev-режимі, щоб її можна було викликати вручну.
function exposeOverrideStatsPrinter() {
  if (!isDevLoggingEnabled()) {
    return;
  }
  const globalTarget =
    typeof window !== "undefined"
      ? window
      : typeof globalThis !== "undefined"
      ? globalThis
      : null;
  if (!globalTarget) {
    return;
  }
  globalTarget.__auraPrintOverrideStats = () => {
    printOverrideUsageStats();
  };
}

exposeOverrideStatsPrinter();

/**
 * Робимо першу літеру великою, щоб акуратно показувати ID гліфа у fallback-фразах.
 */
function capitalizeWord(word) {
  if (!word) return "";
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Акуратно читаємо локалізоване значення зі словника та фіксуємо fallback у журналі.
 * type = 'string' або 'array' вказує, який тип даних очікуємо отримати.
 */
function readLocalized(entry, field, { lang, fallbackLang, type = "string", logContext, source }) {
  const emptyValue = type === "array" ? [] : "";
  if (!entry || typeof entry !== "object") {
    return emptyValue;
  }
  const raw = entry[field];
  if (!raw || typeof raw !== "object") {
    return emptyValue;
  }

  const directValue = raw[lang];
  const fallbackValue = raw[fallbackLang];

  const normalize = (value) => {
    if (type === "array") {
      if (!value) return [];
      if (Array.isArray(value)) {
        return value.filter(Boolean).map((item) => `${item}`.trim()).filter(Boolean);
      }
      if (typeof value === "string") {
        return value.trim() ? [value.trim()] : [];
      }
      return [];
    }
    if (!value || typeof value !== "string") {
      return "";
    }
    return value.trim();
  };

  const normalizedDirect = normalize(directValue);
  const hasDirectData = type === "array" ? normalizedDirect.length > 0 : normalizedDirect.length > 0;
  if (hasDirectData) {
    return type === "array" ? [...normalizedDirect] : normalizedDirect;
  }

  const normalizedFallback = normalize(fallbackValue);
  const hasFallbackData = type === "array" ? normalizedFallback.length > 0 : normalizedFallback.length > 0;
  if (hasFallbackData) {
    if (logContext && source) {
      logContext.fallbacks.push(`fallback used: ${source}.${fallbackLang}`);
    }
    return type === "array" ? [...normalizedFallback] : normalizedFallback;
  }

  return emptyValue;
}

/**
 * Спеціалізований зчитувач масивів зі словників гліфа та тону.
 */
function readLocalizedList(entry, field, options) {
  return readLocalized(entry, field, { ...options, type: "array" });
}

/**
 * Отримуємо масиви модифікаторів статі з урахуванням fallback і логування.
 */
function readGenderList(genderEntry, key, { lang, fallbackLang, logContext }) {
  if (!genderEntry || typeof genderEntry !== "object") {
    return [];
  }
  const raw = genderEntry[key];
  if (!raw || typeof raw !== "object") {
    return [];
  }
  const direct = Array.isArray(raw[lang]) ? raw[lang].filter(Boolean) : [];
  if (direct.length > 0) {
    return [...direct];
  }
  const fallback = Array.isArray(raw[fallbackLang]) ? raw[fallbackLang].filter(Boolean) : [];
  if (fallback.length > 0) {
    if (logContext) {
      logContext.fallbacks.push(`fallback used: gender.${key}.${fallbackLang}`);
    }
    return [...fallback];
  }
  return [];
}

/**
 * Додаємо до звертання коротку тональну фразу, щоби уникнути буквального повтору.
 */
function decorateAddressWithToneStyle(address, toneStyleFragment) {
  if (!address) {
    return "";
  }
  if (!toneStyleFragment) {
    return address;
  }
  if (address.includes(toneStyleFragment)) {
    return address;
  }
  return `${address} — ${toneStyleFragment}`;
}

/**
 * Рахуємо стабільну «сіль» із пари гліф-тон та статі, щоб обирати звертання детерміновано.
 */
function calculateAddressSalt(glyphId, toneId, gender) {
  const source = `${glyphId || ""}|${toneId || ""}|${gender || ""}`;
  let salt = 0;
  for (let index = 0; index < source.length; index += 1) {
    salt += source.charCodeAt(index) * (index + 1);
  }
  return Math.abs(salt);
}

/**
 * Формуємо сигнатуру тижня у форматі YYYY-Wxx для режимів легкої ротації звертань.
 */
function getWeekSignature(date) {
  const utcDate = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const startOfYear = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const diffInMs = utcDate.getTime() - startOfYear.getTime();
  const dayOfYear = Math.floor(diffInMs / (24 * 60 * 60 * 1000));
  const weekNumber = Math.floor(dayOfYear / 7) + 1;
  return `${utcDate.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

/**
 * Центральний помічник: визначаємо, які звертання використати у вступі, висновку та (опційно) у пораді.
 */
function selectAddressVariants({
  addresses,
  toneStyle,
  rules,
  glyphId,
  toneId,
  gender,
  lang,
  fallbackLang,
  logContext,
}) {
  const selectionSettings = rules?.address_selection;
  const hasAdvancedSelection = Boolean(selectionSettings);
  const cleanedAddresses = Array.isArray(addresses)
    ? addresses.map((item) => `${item}`.trim()).filter(Boolean)
    : [];

  if (!hasAdvancedSelection) {
    // Якщо правила не задані — поводимось, як раніше: використовуємо перше доступне звертання тільки для вступу.
    return {
      enabled: false,
      poolSize: cleanedAddresses.length,
      intro: cleanedAddresses[0] || "",
      conclusion: "",
      advice: "",
    };
  }

  const fallbackConfig = selectionSettings?.fallback || {};
  const defaultFallbacks = { ua: "Твій шлях", en: "Your path" };
  const fallbackFromRules = `${fallbackConfig[lang] || ""}`.trim();
  const fallbackFromRulesAlt = `${fallbackConfig[fallbackLang] || ""}`.trim();
  const effectiveFallback =
    fallbackFromRules || fallbackFromRulesAlt || defaultFallbacks[lang] || defaultFallbacks.ua;

  const pool = cleanedAddresses.length > 0 ? [...new Set(cleanedAddresses)] : [effectiveFallback];
  if (pool.length === 0) {
    pool.push(defaultFallbacks[lang] || defaultFallbacks.ua);
  }
  const poolSize = pool.length;

  let baseIndex = 0;
  if (poolSize > 0) {
    baseIndex = calculateAddressSalt(glyphId, toneId, gender) % poolSize;
  }

  let usedToneMap = false;
  const tonePriorities = Array.isArray(rules?.address_tone_map?.[lang]?.[toneId])
    ? rules.address_tone_map[lang][toneId].filter(Boolean)
    : [];
  if (tonePriorities.length > 0) {
    const matchingIndices = tonePriorities
      .map((candidate) => pool.findIndex((item) => item === candidate))
      .filter((index) => index >= 0);
    if (matchingIndices.length > 0) {
      const nearest = matchingIndices.reduce((closest, current) => {
        if (closest === null) {
          return current;
        }
        const currentDiff = Math.abs(current - baseIndex);
        const closestDiff = Math.abs(closest - baseIndex);
        if (currentDiff < closestDiff) {
          return current;
        }
        if (currentDiff === closestDiff) {
          return current < closest ? current : closest;
        }
        return closest;
      }, null);
      if (typeof nearest === "number") {
        baseIndex = nearest;
        usedToneMap = true;
      }
    }
  }

  const mode = selectionSettings.mode || "deterministic";
  let introIndex = poolSize > 0 ? baseIndex : 0;

  if (mode === "static") {
    introIndex = 0;
  } else if (mode === "mixed" && poolSize > 0) {
    const rotationScope = selectionSettings.rotation_scope || "none";
    const storageKey = `aura.addressIndex.${glyphId}-${toneId}-${gender}`;
    const storage =
      (typeof globalThis !== "undefined" && globalThis.localStorage)
        ? globalThis.localStorage
        : typeof window !== "undefined" && window.localStorage
        ? window.localStorage
        : null;
    if (storage && (rotationScope === "day" || rotationScope === "week")) {
      try {
        const now = new Date();
        const scopeSignature =
          rotationScope === "day"
            ? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`
            : getWeekSignature(now);
        const storedRaw = storage.getItem(storageKey);
        if (storedRaw) {
          const parsed = JSON.parse(storedRaw);
          if (parsed && typeof parsed.index === "number" && parsed.scope === scopeSignature) {
            introIndex = parsed.index % poolSize;
          } else {
            introIndex = (baseIndex + 1) % poolSize;
            storage.setItem(storageKey, JSON.stringify({ index: introIndex, scope: scopeSignature }));
          }
        } else {
          introIndex = (baseIndex + 1) % poolSize;
          storage.setItem(storageKey, JSON.stringify({ index: introIndex, scope: scopeSignature }));
        }
      } catch (error) {
        introIndex = baseIndex;
      }
    } else {
      introIndex = baseIndex;
    }
  }

  const conclusionIndex = poolSize > 0 ? (introIndex + 1) % poolSize : 0;
  const adviceIndex = poolSize > 0 ? (introIndex + 2) % poolSize : 0;

  const introAddress = poolSize > 0 ? pool[introIndex] : "";
  let conclusionAddress = poolSize > 0 ? pool[conclusionIndex] : "";
  let adviceAddress = poolSize > 0 ? pool[adviceIndex] : "";

  if (poolSize < 3) {
    const normalizedToneStyle = Array.isArray(toneStyle)
      ? toneStyle.map((item) => `${item}`.trim()).filter(Boolean)
      : [];
    const toneStyleForConclusion = normalizedToneStyle[0] || normalizedToneStyle[1] || "";
    const toneStyleForAdvice = normalizedToneStyle[1] || normalizedToneStyle[0] || "";
    conclusionAddress = decorateAddressWithToneStyle(conclusionAddress || introAddress, toneStyleForConclusion);
    adviceAddress = decorateAddressWithToneStyle(adviceAddress || introAddress, toneStyleForAdvice);
  }

  if (logContext) {
    logContext.address = {
      baseIndex,
      usedToneMap,
      finalIndexIntro: introIndex,
      finalIndexConclusion: conclusionIndex,
      finalIndexAdvice: adviceIndex,
      mode,
    };
  }

  return {
    enabled: true,
    poolSize,
    intro: introAddress,
    conclusion: conclusionAddress,
    advice: adviceAddress,
  };
}

/**
 * Збираємо усі значення зазначених полів для конкретної мови (з урахуванням fallback).
 */
function collectLocalizedFields(entry, fields, options) {
  const result = [];
  fields.forEach((field) => {
    result.push(...readLocalizedList(entry, field, { ...options, source: `${options.source}.${field}` }));
  });
  return result.filter(Boolean);
}

/**
 * Формуємо мапу полів -> списків значень для подальшої гнучкої композиції.
 */
function collectFieldMap(entry, fields, options) {
  const map = new Map();
  fields.forEach((field) => {
    const values = readLocalizedList(entry, field, { ...options, source: `${options.source}.${field}` });
    if (values.length > 0) {
      map.set(field, values);
    }
  });
  return map;
}

/**
 * Оцінюємо, чи достатньо у блоці словникових фраз (квоту фіксуємо у порушеннях).
 */
function evaluateDictionaryDensity(sentences, dictionaryPieces, threshold, label, logContext) {
  if (!sentences || sentences.length === 0) {
    return;
  }
  const plainText = normalizeSpacing(sentences.join(" "));
  if (!plainText) {
    return;
  }
  const totalLength = plainText.length;
  const dictionaryText = normalizeSpacing(dictionaryPieces.join(" "));
  const dictionaryLength = dictionaryText.length;
  if (totalLength === 0) {
    return;
  }
  const ratio = dictionaryLength / totalLength;
  if (ratio < threshold) {
    logContext.violations.push(`${label}:dictionary_ratio:${Math.round(ratio * 100)}%<${Math.round(threshold * 100)}%`);
  }
}

/**
 * Формуємо людинозрозумілий список із масиву (з комами та «та» перед останнім елементом).
 */
function formatList(values) {
  const items = values.filter(Boolean);
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} та ${items[1]}`;
  const head = items.slice(0, -1).join(", ");
  return `${head} та ${items[items.length - 1]}`;
}

/**
 * Забезпечуємо коректне завершення речення розділовим знаком.
 * Якщо крапки немає — додаємо її самостійно.
 */
function ensureSentenceEnding(text) {
  const normalized = normalizeSpacing(text || "");
  if (!normalized) {
    return "";
  }
  if (/[.!?…]$/.test(normalized)) {
    return normalized;
  }
  return `${normalized}.`;
}

/**
 * Переплітаємо архетип із образами, щоб вступ звучав образно, а не як сухий перелік.
 */
function buildArchetypeNarrative(archetypeText, imageryList = []) {
  const base = normalizeSpacing(archetypeText || "");
  if (!base) {
    return "";
  }
  let transformed = base.replace(/\//g, ", ").replace(/;\s*/g, " — ");
  if (imageryList.length > 0) {
    const imagery = imageryList.find(Boolean);
    if (imagery && !transformed.includes(imagery)) {
      transformed = `${transformed}; образ ${imagery}`;
    }
  }
  return transformed;
}

/**
 * Обираємо ключові слова для короткого фокусу (1–2 значущих елементи).
 */
function pickKeywordSnippet(keywords = [], limit = 2) {
  if (!Array.isArray(keywords)) {
    return [];
  }
  return keywords.filter(Boolean).slice(0, limit);
}

/**
 * Обрізаємо рядок до зазначеної довжини, не обрізаючи слово посередині, якщо це можливо.
 */
function truncate(text, limit) {
  if (!text) return "";
  if (text.length <= limit) {
    return text;
  }
  const shortened = text.slice(0, limit - 1);
  const lastSpace = shortened.lastIndexOf(" ");
  if (lastSpace > 30) {
    return `${shortened.slice(0, lastSpace)}…`;
  }
  return `${shortened.trim()}…`;
}

/**
 * Прибираємо надмірні пробіли та пробіли перед розділовими знаками.
 */
function normalizeSpacing(text) {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s([.,!?:;])/g, "$1")
    .replace(/([.!?]){2,}/g, "$1")
    .trim();
}

/**
 * Універсальна функція обробки повторів: якщо слово з avoidList зустрічається більше одного разу,
 * намагаємося замінити наступні входження синонімом або видаляємо їх.
 */
function sanitizeRepeats(text, avoidList, synonymsMap) {
  if (!text || !Array.isArray(avoidList) || avoidList.length === 0) {
    return text;
  }
  let processed = text;
  avoidList.forEach((rawWord) => {
    if (!rawWord) return;
    const escaped = rawWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`, "gi");
    let matchCount = 0;
    processed = processed.replace(regex, (match) => {
      matchCount += 1;
      if (matchCount === 1) {
        return match;
      }
      const synonyms = synonymsMap?.[rawWord];
      if (Array.isArray(synonyms) && synonyms.length > 0) {
        return synonyms[0];
      }
      return "";
    });
    processed = processed.replace(/\s{2,}/g, " ").trim();
  });
  return processed;
}

/**
 * Витягуємо перші N слів з опису, щоб компактно використовувати його у короткій фразі.
 */
function takeWords(text, limit = 12) {
  if (!text) return "";
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= limit) {
    return text;
  }
  return `${words.slice(0, limit).join(" ")}…`;
}

/**
 * Застосовуємо лексичні модифікатори статі (коли будуть додані у словники).
 */
function applyLexShifts(text, lexShift = []) {
  if (!text || !Array.isArray(lexShift) || lexShift.length === 0) {
    return text;
  }
  return lexShift.reduce((acc, rule) => {
    if (!rule) return acc;
    if (typeof rule === "string") {
      return acc.replace(new RegExp(rule, "g"), rule);
    }
    const { from, to } = rule;
    if (!from) return acc;
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "g");
    return acc.replace(regex, to || "");
  }, text);
}

/**
 * Будуємо заголовок з імен гліфа і тону, дотримуючись обмежень довжини.
 */
function buildTitle({ glyphName, toneName, toneId, toneEssence, genderLabel, limits, logContext }) {
  const parts = [];
  if (glyphName) {
    parts.push(glyphName);
  }
  if (toneId) {
    const toneLabel = toneName ? `Тон ${toneId} — ${toneName}` : `Тон ${toneId}`;
    parts.push(toneLabel);
  }
  if (toneEssence) {
    parts.push(takeWords(toneEssence, 6));
  }
  if (genderLabel) {
    parts.push(genderLabel);
  }
  const rawTitle = parts.filter(Boolean).join(" • ") || "Опис";
  const limited = truncate(rawTitle, limits.title || 70);
  if (logContext && limited !== rawTitle) {
    logContext.violations.push(`title:truncated>${limits.title || 70}`);
  }
  return limited;
}

/**
 * Готуємо текстову секцію: об'єднуємо речення, прибираємо повтори та нормалізуємо пробіли.
 */
function finalizeSection(sentences, avoidRepeats, synonyms) {
  const filtered = sentences.filter(Boolean).map((sentence) => normalizeSpacing(sentence));
  return filtered
    .map((sentence) => sanitizeRepeats(sentence, avoidRepeats, synonyms))
    .filter(Boolean);
}

/**
 * Формуємо коротку мета-опис, комбінуючи перші речення з intro та synergy.
 */
function buildMetaDescription({ intro, synergy, limits, logContext }) {
  const base = [intro?.[0], synergy?.[0]].filter(Boolean).join(" ");
  const normalized = normalizeSpacing(base || "Опис комбінації гліфа та тону Цолькін.");
  const limited = truncate(normalized, limits.meta || 160);
  if (logContext && limited !== normalized) {
    logContext.violations.push(`meta:truncated>${limits.meta || 160}`);
  }
  return limited;
}

/**
 * Утиліта для формування списку ключових слів без повторів.
 */
function buildKeywords(glyphKeywords = [], toneKeywords = [], synergyKeywords = []) {
  const seen = new Set();
  const unique = [];
  [...glyphKeywords, ...toneKeywords, ...synergyKeywords].forEach((word) => {
    if (!word) return;
    const lowered = word.toLowerCase();
    if (!seen.has(lowered)) {
      seen.add(lowered);
      unique.push(word);
    }
  });
  return unique.slice(0, 6);
}

/**
 * Формуємо опис, покладаючись на словникові дані та правила композиції.
 */
function composeDescription({
  glyphEntry,
  toneEntry,
  genderEntry,
  rules,
  glyphId,
  toneId,
  gender,
  lang,
  calendar,
  logContext,
  synergyEntry = {},
}) {
  const fallbackLang = getFallbackLang(lang);
  const limits = rules?.limits || { title: 70, meta: 160 };
  const avoidRepeats = Array.isArray(rules?.avoid_repeats?.[lang]) ? rules.avoid_repeats[lang] : [];
  const synonyms = rules?.synonyms?.[lang] || {};
  let overrideUsed = false;

  const orderCandidate = Array.isArray(rules?.order) ? rules.order.filter((key) => typeof key === "string") : [];
  const filteredOrder = orderCandidate.filter((key) => {
    if (!VALID_BLOCK_KEYS.has(key)) {
      logContext.violations.push(`order:invalid:${key}`);
      return false;
    }
    return true;
  });
  const uniqueOrder = Array.from(new Set(filteredOrder));
  if (uniqueOrder.length > 0 && !uniqueOrder.includes("title")) {
    uniqueOrder.unshift("title");
    logContext.violations.push("order:missing:title");
  }
  const order = uniqueOrder.length > 0 ? uniqueOrder : DEFAULT_BLOCK_ORDER;

  const glyphName =
    readLocalized(glyphEntry, "name", {
      lang,
      fallbackLang,
      logContext,
      source: `glyph.${glyphId}.name`,
    }) || capitalizeWord(glyphId);
  const toneName = readLocalized(toneEntry, "name", {
    lang,
    fallbackLang,
    logContext,
    source: `tone.${toneId}.name`,
  });
  const toneEssence = readLocalized(toneEntry, "essence", {
    lang,
    fallbackLang,
    logContext,
    source: `tone.${toneId}.essence`,
  });
  const toneSymbol = readLocalized(toneEntry, "symbol", {
    lang,
    fallbackLang,
    logContext,
    source: `tone.${toneId}.symbol`,
  });
  const glyphArchetype = readLocalized(glyphEntry, "archetype", {
    lang,
    fallbackLang,
    logContext,
    source: `glyph.${glyphId}.archetype`,
  });

  const genderLexShift = readGenderList(genderEntry, "lex_shift", { lang, fallbackLang, logContext });
  const genderAddresses = readGenderList(genderEntry, "address", { lang, fallbackLang, logContext });
  const genderToneStyle = readGenderList(genderEntry, "tone_style", { lang, fallbackLang, logContext });
  const genderAdvicePrefixes = readGenderList(genderEntry, "advice_prefixes", { lang, fallbackLang, logContext });
  const genderConclusionClosers = readGenderList(genderEntry, "conclusion_closers", { lang, fallbackLang, logContext });
  const genderAcknowledgements = readGenderList(genderEntry, "acknowledgements", { lang, fallbackLang, logContext });

  // Визначаємо, які звертання доречно підставити для цієї комбінації параметрів.
  const addressPlan = selectAddressVariants({
    addresses: genderAddresses,
    toneStyle: genderToneStyle,
    rules,
    glyphId,
    toneId,
    gender,
    lang,
    fallbackLang,
    logContext,
  });

  const genderLabel =
    lang === "en"
      ? gender === "male"
        ? "Male focus"
        : "Female focus"
      : gender === "male"
      ? "Чоловічий фокус"
      : "Жіночий фокус";

  let title = buildTitle({
    glyphName,
    toneName,
    toneId,
    toneEssence,
    genderLabel,
    limits,
    logContext,
  });

  // Перевіряємо, чи є прямий override для заголовка сторінки.
  const titleOverrideResult = getOverrideBlock(calendar, glyphId, toneId, gender, "title", lang);
  const hasTitleOverride = titleOverrideResult !== null;
  logBlockOverrideUsage("title", hasTitleOverride);
  if (hasTitleOverride) {
    overrideUsed = true;
    const normalizedTitle = normalizeOverrideStringCandidate(titleOverrideResult?.value);
    if (normalizedTitle !== null) {
      title = normalizedTitle;
      recordOverrideUsage({
        calendar,
        glyphId,
        toneId: String(toneId),
        requestedGender: gender,
        actualGender: titleOverrideResult?.genderSource,
        blockName: "title",
      });
    } else if (typeof titleOverrideResult?.value !== "undefined") {
      title = `${titleOverrideResult.value}`.trim();
      recordOverrideUsage({
        calendar,
        glyphId,
        toneId: String(toneId),
        requestedGender: gender,
        actualGender: titleOverrideResult?.genderSource,
        blockName: "title",
      });
    }
  }

  // --- Підготовка словникових даних для нового шаблону ---
  const glyphKeywords = readLocalizedList(glyphEntry, "keywords", {
    lang,
    fallbackLang,
    logContext,
    source: `glyph.${glyphId}.keywords`,
  });
  const glyphKeywordSnippet = pickKeywordSnippet(glyphKeywords, 2);
  const glyphStrengths = readLocalizedList(glyphEntry, "strengths", {
    lang,
    fallbackLang,
    logContext,
    source: `glyph.${glyphId}.strengths`,
  });
  const glyphDomains = readLocalizedList(glyphEntry, "domains", {
    lang,
    fallbackLang,
    logContext,
    source: `glyph.${glyphId}.domains`,
  });
  const glyphImagery = readLocalizedList(glyphEntry, "imagery", {
    lang,
    fallbackLang,
    logContext,
    source: `glyph.${glyphId}.imagery`,
  });
  const glyphImagerySnippet = pickKeywordSnippet(glyphImagery, 2);
  const glyphSynergyVerbs = readLocalizedList(glyphEntry, "synergy_verbs", {
    lang,
    fallbackLang,
    logContext,
    source: `glyph.${glyphId}.synergy_verbs`,
  });

  const toneKeywords = readLocalizedList(toneEntry, "keywords", {
    lang,
    fallbackLang,
    logContext,
    source: `tone.${toneId}.keywords`,
  });
  const toneKeywordFocus = toneKeywords.find(Boolean);
  const toneQualities = readLocalizedList(toneEntry, "qualities", {
    lang,
    fallbackLang,
    logContext,
    source: `tone.${toneId}.qualities`,
  });
  const toneChallenges = readLocalizedList(toneEntry, "challenges", {
    lang,
    fallbackLang,
    logContext,
    source: `tone.${toneId}.challenges`,
  });
  const toneImagery = readLocalizedList(toneEntry, "imagery", {
    lang,
    fallbackLang,
    logContext,
    source: `tone.${toneId}.imagery`,
  });
  const toneAdvice = readLocalizedList(toneEntry, "advice", {
    lang,
    fallbackLang,
    logContext,
    source: `tone.${toneId}.advice`,
  });

  const pairSource = `pair.${glyphId}-${toneId}`;
  const manualSynergySentences = readLocalizedList(synergyEntry, "synergy", {
    lang,
    fallbackLang,
    logContext,
    source: `${pairSource}.synergy`,
  });
  const manualWhereUnfolds = readLocalizedList(synergyEntry, "where_unfolds", {
    lang,
    fallbackLang,
    logContext,
    source: `${pairSource}.where_unfolds`,
  });
  const manualPractice = readLocalizedList(synergyEntry, "practice", {
    lang,
    fallbackLang,
    logContext,
    source: `${pairSource}.practice`,
  });
  const manualSummary = readLocalizedList(synergyEntry, "summary", {
    lang,
    fallbackLang,
    logContext,
    source: `${pairSource}.summary`,
  });
  const manualTags = readLocalizedList(synergyEntry, "tags", {
    lang,
    fallbackLang,
    logContext,
    source: `${pairSource}.tags`,
  });

  const synergyPlan = rules?.composition?.synergy || { glyph_fields: [], tone_fields: [] };
  const synergyGlyphMap = collectFieldMap(glyphEntry, synergyPlan.glyph_fields || [], {
    lang,
    fallbackLang,
    logContext,
    source: `glyph.${glyphId}`,
  });
  const synergyToneMap = collectFieldMap(toneEntry, synergyPlan.tone_fields || [], {
    lang,
    fallbackLang,
    logContext,
    source: `tone.${toneId}`,
  });

  const advicePlan = rules?.composition?.advice || { glyph_fields: [], tone_fields: [] };
  const adviceGlyphItems = collectLocalizedFields(glyphEntry, advicePlan.glyph_fields || [], {
    lang,
    fallbackLang,
    logContext,
    source: `glyph.${glyphId}`,
  });
  const adviceToneItems = collectLocalizedFields(toneEntry, advicePlan.tone_fields || [], {
    lang,
    fallbackLang,
    logContext,
    source: `tone.${toneId}`,
  });
  const adviceItems = [
    ...adviceGlyphItems,
    ...adviceToneItems,
    ...toneAdvice,
    ...manualPractice,
  ].filter(Boolean);

  // --- Вступ ---
  const introSentences = [];
  if (addressPlan.intro) {
    introSentences.push(
      applyLexShifts(ensureSentenceEnding(addressPlan.intro), genderLexShift)
    );
  }
  const archetypeNarrative = buildArchetypeNarrative(glyphArchetype, glyphImagerySnippet);
  let glyphIntroSentence = "";
  if (glyphName && archetypeNarrative) {
    glyphIntroSentence = `${glyphName} — ${archetypeNarrative}`;
  } else if (glyphName) {
    glyphIntroSentence = `${glyphName} розкриває свій архетип`;
  } else if (archetypeNarrative) {
    glyphIntroSentence = `Гліф розкриває архетип як ${archetypeNarrative}`;
  }
  if (glyphIntroSentence) {
    introSentences.push(
      applyLexShifts(ensureSentenceEnding(glyphIntroSentence), genderLexShift)
    );
  }
  if (glyphKeywordSnippet.length > 0) {
    const keywordSentence = ensureSentenceEnding(glyphKeywordSnippet.join(", "));
    introSentences.push(applyLexShifts(keywordSentence, genderLexShift));
  }
  if (introSentences.length === 0) {
    const fallbackIntro = ensureSentenceEnding(
      `Комбінація ${capitalizeWord(glyphId)} з тоном ${toneId} ще очікує на опис`
    );
    introSentences.push(applyLexShifts(fallbackIntro, genderLexShift));
    logContext.violations.push("intro:fallback");
  }

  // --- Блок гліфа ---
  const glyphCoreSentences = [];
  if (archetypeNarrative) {
    glyphCoreSentences.push(
      applyLexShifts(
        ensureSentenceEnding(`Архетип розкривається як ${archetypeNarrative}`),
        genderLexShift
      )
    );
  }
  if (glyphStrengths.length > 0) {
    glyphCoreSentences.push(
      applyLexShifts(
        ensureSentenceEnding(`Сильні сторони ведуть до ${formatList(glyphStrengths)}`),
        genderLexShift
      )
    );
  }
  if (glyphDomains.length > 0) {
    glyphCoreSentences.push(
      applyLexShifts(
        ensureSentenceEnding(`Ці здібності оживають у сферах ${formatList(glyphDomains)}`),
        genderLexShift
      )
    );
  }
  if (glyphImagerySnippet.length > 0) {
    glyphCoreSentences.push(
      applyLexShifts(
        ensureSentenceEnding(
          `Уяви ${formatList(glyphImagerySnippet)} — ці образи підтримують твій шлях`
        ),
        genderLexShift
      )
    );
  }
  if (glyphCoreSentences.length === 0) {
    glyphCoreSentences.push(
      applyLexShifts("Гліф запрошує дослідити власний ритм і поступ.", genderLexShift)
    );
    logContext.violations.push("glyph_core:fallback");
  }

  // --- Блок тону ---
  const toneCoreSentences = [];
  const toneLabel = toneName || `Тон ${toneId}`;
  const toneDescriptor = toneEssence || toneKeywordFocus || formatList(pickKeywordSnippet(toneQualities, 2));
  if (toneDescriptor) {
    toneCoreSentences.push(
      applyLexShifts(
        ensureSentenceEnding(`${toneLabel} звучить як ${toneDescriptor}`),
        genderLexShift
      )
    );
  }
  const toneQualitiesSnippet = pickKeywordSnippet(toneQualities, 2);
  if (toneQualitiesSnippet.length > 0) {
    toneCoreSentences.push(
      applyLexShifts(
        ensureSentenceEnding(`Він підтримує ${formatList(toneQualitiesSnippet)}`),
        genderLexShift
      )
    );
  }
  const toneChallenge = toneChallenges.find(Boolean);
  if (toneChallenge) {
    const importance = toneKeywordFocus || toneEssence || toneQualitiesSnippet[0] || toneQualities[0] || "баланс";
    toneCoreSentences.push(
      applyLexShifts(
        ensureSentenceEnding(`Виклик — ${toneChallenge}. Це важливо, бо саме так тримається ${importance}`),
        genderLexShift
      )
    );
  }
  const toneImagerySnippet = pickKeywordSnippet(toneImagery, 2);
  if (toneImagerySnippet.length > 0) {
    toneCoreSentences.push(
      applyLexShifts(
        ensureSentenceEnding(`Образи тону нагадують ${formatList(toneImagerySnippet)}`),
        genderLexShift
      )
    );
  }
  if (toneCoreSentences.length === 0) {
    toneCoreSentences.push(
      applyLexShifts(`Тон ${toneId} потребує додаткових матеріалів для розгорнутого опису.`, genderLexShift)
    );
    logContext.violations.push("tone_core:fallback");
  }

  // --- Синергія ---
  const synergySentences = [];
  const synergyFragments = [];
  const synergyVerbs = pickKeywordSnippet(
    synergyGlyphMap.get("synergy_verbs") || glyphSynergyVerbs,
    3
  );
  const synergyDomains = synergyGlyphMap.get("domains") || glyphDomains;
  const synergyTonePatterns = synergyToneMap.get("synergy_patterns") || [];
  const synergyGlyphImagery = synergyGlyphMap.get("imagery") || glyphImagery;
  const synergyToneImagery = synergyToneMap.get("imagery") || toneImagery;

  if (synergyVerbs.length > 0 || toneKeywordFocus) {
    const verbPart = synergyVerbs.length > 0 ? `спонукає ${formatList(synergyVerbs)}` : "розкриває потенціал";
    const tonePart = toneKeywordFocus ? ` і тримає курс на ${toneKeywordFocus}` : "";
    synergySentences.push(
      applyLexShifts(ensureSentenceEnding(`Поєднання гліфа й тону ${verbPart}${tonePart}`), genderLexShift)
    );
    synergyFragments.push(...synergyVerbs);
    if (toneKeywordFocus) {
      synergyFragments.push(toneKeywordFocus);
    }
  }
  if (synergyDomains.length > 0 || synergyTonePatterns.length > 0) {
    const domainPart = synergyDomains.length > 0 ? `у сферах ${formatList(synergyDomains)}` : "";
    const patternPart = synergyTonePatterns.length > 0 ? `через ${formatList(synergyTonePatterns)}` : "";
    const combined = [domainPart, patternPart].filter(Boolean).join(" ");
    if (combined) {
      synergySentences.push(
        applyLexShifts(ensureSentenceEnding(`Енергія розгортається ${combined}`), genderLexShift)
      );
      synergyFragments.push(...synergyDomains, ...synergyTonePatterns);
    }
  }
  const imageryFocus = (synergyGlyphImagery.length > 0 ? synergyGlyphImagery : glyphImagery).find(Boolean);
  if (imageryFocus) {
    const toneImage = (synergyToneImagery.length > 0 ? synergyToneImagery : toneImagery).find(Boolean);
    const imagerySentence = toneImage
      ? `Уяви ${imageryFocus} поруч із ${toneImage} — так проявляється їхня спільна дія`
      : `Уяви ${imageryFocus} — цей образ проводить через взаємодію`;
    synergySentences.push(
      applyLexShifts(ensureSentenceEnding(imagerySentence), genderLexShift)
    );
    synergyFragments.push(imageryFocus);
    if (toneImage) {
      synergyFragments.push(toneImage);
    }
  }
  if (manualSynergySentences.length > 0) {
    manualSynergySentences.forEach((sentence) => {
      synergySentences.push(
        applyLexShifts(ensureSentenceEnding(sentence), genderLexShift)
      );
    });
    synergyFragments.push(...manualSynergySentences);
  }
  if (manualWhereUnfolds.length > 0) {
    manualWhereUnfolds.forEach((area) => {
      const sentence = lang === "en"
        ? `It unfolds where ${area}`
        : `Проявляється там, де ${area}`;
      synergySentences.push(
        applyLexShifts(ensureSentenceEnding(sentence), genderLexShift)
      );
    });
    synergyFragments.push(...manualWhereUnfolds);
  }
  if (synergySentences.length === 0) {
    synergySentences.push(
      applyLexShifts(
        "Союз гліфа та тону поступово наповнюється новими сенсами — дочекайтеся оновлення опису.",
        genderLexShift
      )
    );
    logContext.violations.push("synergy:fallback");
  }

  // --- Поради ---
  const enrichedAdvice = [...new Set(adviceItems)];
  if (enrichedAdvice.length === 0) {
    const fallbackAdvice =
      lang === "en"
        ? "Pause and observe while the team refines the guidance."
        : "Зроби паузу й поспостерігай, поки команда допрацьовує рекомендації.";
    enrichedAdvice.push(fallbackAdvice);
    logContext.violations.push("advice:fallback");
  }
  if (enrichedAdvice.length < 3 && glyphStrengths.length > 0) {
    enrichedAdvice.push(`розкривати ${glyphStrengths[0]}`);
  }
  if (enrichedAdvice.length < 3 && toneQualities.length > 0) {
    enrichedAdvice.push(`плекати ${toneQualities[0]}`);
  }
  while (enrichedAdvice.length < 3) {
    enrichedAdvice.push(
      lang === "en"
        ? "Notice how your breath gently steadies the rhythm."
        : "Відчуй дихання і дозволь йому вирівняти ритм."
    );
    logContext.violations.push("advice:synthetic_support");
  }
  const adviceParagraphs = [];
  const adviceFragments = [...enrichedAdvice];
  const advicePrefixFallback = lang === "en" ? "Focus on" : "Зверни увагу на";
  const toneStyleFallback = lang === "en" ? "gently and with self-respect" : "лагідно й з повагою до себе";
  if (addressPlan.enabled && addressPlan.advice) {
    adviceParagraphs.push(
      applyLexShifts(ensureSentenceEnding(addressPlan.advice), genderLexShift)
    );
  }
  const maxAdviceSentences = Math.min(4, enrichedAdvice.length);
  for (let index = 0; index < maxAdviceSentences; index += 1) {
    const idea = enrichedAdvice[index];
    const prefix =
      genderAdvicePrefixes[index % Math.max(genderAdvicePrefixes.length, 1)] || advicePrefixFallback;
    const toneStyle =
      genderToneStyle[index % Math.max(genderToneStyle.length, 1)] || toneStyleFallback;
    const sentence = `${prefix} ${idea}, ${toneStyle}`;
    adviceParagraphs.push(
      applyLexShifts(ensureSentenceEnding(sentence), genderLexShift)
    );
  }

  // --- Тінь ---
  const shadowPlan = rules?.composition?.shadow || { glyph_fields: [], tone_fields: [] };
  const shadowGlyphRaw = collectLocalizedFields(glyphEntry, shadowPlan.glyph_fields || [], {
    lang,
    fallbackLang,
    logContext,
    source: `glyph.${glyphId}`,
  });
  const shadowToneRaw = collectLocalizedFields(toneEntry, shadowPlan.tone_fields || [], {
    lang,
    fallbackLang,
    logContext,
    source: `tone.${toneId}`,
  });
  const shadowGlyphSnippet = pickKeywordSnippet(shadowGlyphRaw, 2);
  const toneShadowChallenge = shadowToneRaw.find(Boolean) || toneChallenges.find(Boolean);
  const neutralizer =
    (genderToneStyle && genderToneStyle[0]) ||
    (enrichedAdvice && enrichedAdvice[0]) ||
    toneKeywordFocus;
  const shadowSentences = [];
  if (shadowGlyphSnippet.length > 0 || toneShadowChallenge) {
    const parts = [];
    if (shadowGlyphSnippet.length > 0) {
      parts.push(`тіні ${formatList(shadowGlyphSnippet)}`);
    }
    if (toneShadowChallenge) {
      parts.push(`виклик ${toneShadowChallenge}`);
    }
    shadowSentences.push(
      applyLexShifts(
        ensureSentenceEnding(`Тінь проявляється через ${parts.join(" і ")}`),
        genderLexShift
      )
    );
  }
  if (neutralizer) {
    shadowSentences.push(
      applyLexShifts(
        ensureSentenceEnding(`Збалансуй це через ${neutralizer}`),
        genderLexShift
      )
    );
  }
  if (shadowSentences.length === 0) {
    shadowSentences.push(
      applyLexShifts("Тіньові аспекти ще уточнюються командою авторів.", genderLexShift)
    );
    logContext.violations.push("shadow:fallback");
  }
  const shadowFragments = [...shadowGlyphSnippet];
  if (toneShadowChallenge) {
    shadowFragments.push(toneShadowChallenge);
  }
  if (neutralizer) {
    shadowFragments.push(neutralizer);
  }

  // --- Висновок ---
  const conclusionSentences = [];
  if (addressPlan.conclusion) {
    conclusionSentences.push(
      applyLexShifts(ensureSentenceEnding(addressPlan.conclusion), genderLexShift)
    );
  }
  const glyphKeywordSummary = pickKeywordSnippet(glyphKeywords, 2);
  const toneKeywordSummary =
    toneKeywordFocus ||
    toneKeywords.find((item) => item && item !== toneKeywordFocus) ||
    toneSymbol;
  if (glyphKeywordSummary.length > 0 || toneKeywordSummary) {
    const glyphPart = glyphKeywordSummary.length > 0 ? formatList(glyphKeywordSummary) : "";
    let summarySentence = "";
    if (glyphPart && toneKeywordSummary) {
      summarySentence = `Пам’ятай про ${glyphPart} разом із ${toneKeywordSummary}.`;
    } else if (glyphPart) {
      summarySentence = `Пам’ятай про ${glyphPart}.`;
    } else if (toneKeywordSummary) {
      summarySentence = `Пам’ятай про ${toneKeywordSummary}.`;
    }
    if (summarySentence) {
      conclusionSentences.push(applyLexShifts(summarySentence, genderLexShift));
    }
  }
  if (manualSummary.length > 0) {
    manualSummary.forEach((sentence) => {
      conclusionSentences.push(
        applyLexShifts(ensureSentenceEnding(sentence), genderLexShift)
      );
    });
  }
  const conclusionCloser = genderConclusionClosers.find(Boolean);
  const acknowledgement = genderAcknowledgements.find(Boolean);
  if (conclusionCloser) {
    conclusionSentences.push(
      applyLexShifts(ensureSentenceEnding(conclusionCloser), genderLexShift)
    );
  }
  if (acknowledgement) {
    conclusionSentences.push(
      applyLexShifts(ensureSentenceEnding(acknowledgement), genderLexShift)
    );
  }
  if (conclusionSentences.length === 0) {
    conclusionSentences.push(
      applyLexShifts("Завершальний абзац доповнимо, щойно з’являться дані.", genderLexShift)
    );
    logContext.violations.push("conclusion:fallback");
  }
  const conclusionFragments = [
    ...glyphKeywordSummary,
    toneKeywordSummary,
    conclusionCloser,
    acknowledgement,
    ...manualSummary,
  ].filter(Boolean);

  // Щоби блоки читалися щільно й не розтікалися на довгі абзаци, обрізаємо масиви
  // речень до заданих лімітів ще до фіналізації тексту.
  const introLimited = introSentences.slice(0, 2);
  const glyphCoreLimited = glyphCoreSentences.slice(0, 3);
  const toneCoreLimited = toneCoreSentences.slice(0, 3);
  const synergyLimited = synergySentences.slice(0, 3);

  const intro = finalizeSection(introLimited, avoidRepeats, synonyms);
  const glyphCore = finalizeSection(glyphCoreLimited, avoidRepeats, synonyms);
  const toneCore = finalizeSection(toneCoreLimited, avoidRepeats, synonyms);
  const synergy = finalizeSection(synergyLimited, avoidRepeats, synonyms);
  const adviceListNormalized = [...new Set(manualPractice)];
  const shadow = finalizeSection(shadowSentences, avoidRepeats, synonyms);
  const conclusion = finalizeSection(conclusionSentences, avoidRepeats, synonyms);

  evaluateDictionaryDensity(synergy, synergyFragments, 0.7, "synergy", logContext);
  evaluateDictionaryDensity(adviceParagraphs.concat(adviceListNormalized), adviceFragments, 0.6, "advice", logContext);
  evaluateDictionaryDensity(shadow, shadowFragments, 0.8, "shadow", logContext);
  evaluateDictionaryDensity(conclusion, conclusionFragments, 0.6, "conclusion", logContext);

  let metaDescription = buildMetaDescription({ intro, synergy, limits, logContext });

  // Аналогічно даємо змогу вручну підмінити meta description.
  const metaOverrideResult = getOverrideBlock(calendar, glyphId, toneId, gender, "meta", lang);
  const hasMetaOverride = metaOverrideResult !== null;
  logBlockOverrideUsage("meta", hasMetaOverride);
  if (hasMetaOverride) {
    overrideUsed = true;
    const normalizedMeta = normalizeOverrideStringCandidate(metaOverrideResult?.value);
    if (normalizedMeta !== null) {
      metaDescription = truncate(normalizedMeta, limits.meta);
      recordOverrideUsage({
        calendar,
        glyphId,
        toneId: String(toneId),
        requestedGender: gender,
        actualGender: metaOverrideResult?.genderSource,
        blockName: "meta",
      });
    } else if (typeof metaOverrideResult?.value !== "undefined") {
      metaDescription = truncate(`${metaOverrideResult.value}`.trim(), limits.meta);
      recordOverrideUsage({
        calendar,
        glyphId,
        toneId: String(toneId),
        requestedGender: gender,
        actualGender: metaOverrideResult?.genderSource,
        blockName: "meta",
      });
    }
  }

  const keywords = buildKeywords(glyphKeywords, toneKeywords, manualTags);

  if (metaDescription) {
    const lowerMeta = metaDescription.slice(0, limits.meta || 160).toLowerCase();
    avoidRepeats.forEach((word) => {
      if (!word) return;
      const escaped = word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const matches = lowerMeta.match(new RegExp(`\\b${escaped}\\b`, "g"));
      if (matches && matches.length > 1) {
        logContext.violations.push(`meta:repeat:${word}`);
      }
    });
  }

  const baseBlocks = {
    intro: { paragraphs: intro, list: [] },
    glyph_core: { paragraphs: glyphCore, list: [] },
    tone_core: { paragraphs: toneCore, list: [] },
    synergy: { paragraphs: synergy, list: [] },
    advice: { paragraphs: adviceParagraphs, list: adviceListNormalized },
    shadow: { paragraphs: shadow, list: [] },
    conclusion: { paragraphs: conclusion, list: [] },
  };

  // Формуємо фінальні блоки: якщо для них існують overrides — підставляємо їх без генерації.
  const blocks = {};
  for (const [blockName, baseBlock] of Object.entries(baseBlocks)) {
    const overrideResult = getOverrideBlock(calendar, glyphId, toneId, gender, blockName, lang);
    const hasOverride = overrideResult !== null;
    logBlockOverrideUsage(blockName, hasOverride);
    if (!hasOverride) {
      blocks[blockName] = baseBlock;
      continue;
    }
    overrideUsed = true;
    const overrideValue = overrideResult?.value;
    if (blockName === "advice") {
      if (Array.isArray(overrideValue)) {
        const sanitizedList = overrideValue
          .map((item) => normalizeOverrideStringCandidate(item))
          .filter((item) => item !== null && item.length > 0);
        blocks[blockName] = { paragraphs: [], list: sanitizedList };
      } else {
        const normalizedAdvice = normalizeOverrideStringCandidate(overrideValue);
        const adviceParagraph = normalizedAdvice ? [normalizedAdvice] : [];
        blocks[blockName] = { paragraphs: adviceParagraph, list: [] };
      }
    } else {
      const normalizedBlock = normalizeOverrideStringCandidate(overrideValue);
      const blockParagraph = normalizedBlock ? [normalizedBlock] : [];
      blocks[blockName] = { paragraphs: blockParagraph, list: [] };
    }
    recordOverrideUsage({
      calendar,
      glyphId,
      toneId: String(toneId),
      requestedGender: gender,
      actualGender: overrideResult?.genderSource,
      blockName,
    });
  }

  if (overrideUsed) {
    logContext.usedOverride = true;
  }

  return {
    title,
    metaDescription,
    keywords,
    order,
    blocks,
  };
}

/**
 * Основна точка входу: генеруємо опис або повертаємо кешоване значення.
 */
export async function generateDescription({
  glyphId,
  toneId,
  gender = "female",
  lang = "ua",
  calendar = "maya",
} = {}) {
  const normalizedGender = normalizeGender(gender);
  const normalizedLang = normalizeLang(lang);
  const normalizedCalendar = normalizeCalendarId(calendar);

  // Готуємо контекст для логування, щоб легко відстежувати звідки з’являються фрази та fallback-и.
  const logContext = {
    glyphId: glyphId || "",
    toneId: toneId ? String(toneId) : "",
    gender: normalizedGender,
    lang: normalizedLang,
    calendar: normalizedCalendar,
    usedOverride: false,
    fallbacks: [],
    violations: [],
  };

  await loadOverrides();
  const versionSegment = overridesVersion || "no-overrides";
  const cacheKey = `${normalizedCalendar}-${glyphId || ""}-${toneId || ""}-${normalizedGender}-${normalizedLang}-${versionSegment}`;

  if (descriptionCache.has(cacheKey)) {
    const cached = cloneResult(descriptionCache.get(cacheKey));
    const cacheLog = { ...logContext, cacheHit: true };
    console.info("Aura description cache hit", cacheLog);
    return cached;
  }

  const dictionaries = await loadDictionaries();
  if (!glyphId || !toneId) {
    logContext.violations.push("missing:ids");
    const message =
      normalizedLang === "en"
        ? "Description temporarily unavailable: missing identifiers."
        : "Опис недоступний: бракує ідентифікаторів гліфа або тону.";
    const fallback = buildServiceFallback(message);
    descriptionCache.set(cacheKey, fallback);
    console.error("Aura description service fallback", logContext);
    return cloneResult(fallback);
  }

  const glyphEntry = dictionaries.glyphs?.[glyphId];
  const toneEntry = dictionaries.tones?.[String(toneId)];

  if (!glyphEntry || !toneEntry) {
    logContext.violations.push("missing:dictionary_entry");
    const message =
      normalizedLang === "en"
        ? `We are still preparing the description for ${glyphId} + tone ${toneId}.`
        : `Ми ще готуємо опис для ${glyphId} та тону ${toneId}.`;
    const fallback = buildServiceFallback(message);
    descriptionCache.set(cacheKey, fallback);
    console.error("Aura description dictionary fallback", logContext);
    return cloneResult(fallback);
  }

  const genderEntry = dictionaries.genderMods?.[normalizedGender] || {};
  const description = composeDescription({
    glyphEntry,
    toneEntry,
    genderEntry,
    rules: dictionaries.rules,
    glyphId,
    toneId: String(toneId),
    gender: normalizedGender,
    lang: normalizedLang,
    calendar: normalizedCalendar,
    logContext,
    synergyEntry:
      dictionaries.synergy?.[`${String(glyphId).toUpperCase()}-${String(toneId).toUpperCase()}`] ||
      dictionaries.synergy?.[`${String(glyphId).toUpperCase()}-${String(toneId)}`] ||
      null,
  });

  descriptionCache.set(cacheKey, description);
  console.info("Aura description generated", logContext);
  return cloneResult(description);
}

/**
 * Додаткова утиліта: дозволяє проактивно прогріти кеш словників ще до першого запиту.
 * Одночасно підтягуємо overrides, аби уникнути затримки при першому зверненні.
 */
export async function preloadDictionaries() {
  await Promise.all([loadDictionaries(), loadOverrides()]);
}
