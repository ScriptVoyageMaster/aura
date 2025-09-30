/**
 * Генератор текстових описів для поєднань гліфа та тону Цолькін.
 * Весь модуль детально прокоментований українською мовою, щоби навіть новачок розібрався в алгоритмі.
 */

const DATA_URLS = {
  glyphs: "data/glyphs.json",
  tones: "data/tones.json",
  genderMods: "data/gender_mods.json",
  rules: "data/rules.json",
  overrides: "data/overrides.json",
};

// Кешуємо словники, аби не тягнути їх з мережі на кожен запит.
let dictionariesPromise = null;

// Кеш результатів генерації, щоб уникати повторних складань тексту для однакових параметрів.
const descriptionCache = new Map();

// Значення за замовчуванням для випадку, коли словники відсутні або неповні.
const FALLBACK_DESCRIPTION = {
  title: "Опис тимчасово недоступний",
  metaDescription: "Опис для цієї комбінації ще готується.",
  keywords: [],
  blocks: {
    intro: { paragraphs: ["Ми ще збираємо матеріали для цієї комбінації гліфа та тону."], list: [] },
    glyph_core: { paragraphs: [], list: [] },
    tone_core: { paragraphs: [], list: [] },
    synergy: { paragraphs: [], list: [] },
    advice: { paragraphs: [], list: [] },
    shadow: { paragraphs: [], list: [] },
    conclusion: { paragraphs: [], list: [] },
  },
};

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
        const [glyphs, tones, genderMods, rules, overrides] = await Promise.all([
          fetchJson(DATA_URLS.glyphs),
          fetchJson(DATA_URLS.tones),
          fetchJson(DATA_URLS.genderMods),
          fetchJson(DATA_URLS.rules),
          fetchJson(DATA_URLS.overrides, { optional: true }),
        ]);

        return {
          glyphs: glyphs || {},
          tones: tones || {},
          genderMods: genderMods || {},
          rules: rules || { limits: { title: 70, meta: 160 }, avoid_repeats: [], synonyms: {} },
          overrides: overrides || {},
        };
      } catch (error) {
        console.error("Не вдалося завантажити словники описів Цолькін:", error);
        return {
          glyphs: {},
          tones: {},
          genderMods: {},
          rules: { limits: { title: 70, meta: 160 }, avoid_repeats: [], synonyms: {} },
          overrides: {},
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
 * Нормалізуємо мову. Поки підтримується українська (ua) та англійська (en). Будь-що інше згортаємо до ua.
 */
function normalizeLang(lang) {
  return lang === "en" ? "en" : "ua";
}

/**
 * Робимо першу літеру великою, щоб акуратно показувати ID гліфа у fallback-фразах.
 */
function capitalizeWord(word) {
  if (!word) return "";
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Повертаємо масив значень поля або порожній масив, якщо значення відсутнє.
 */
function arrayField(entry, field) {
  if (!entry || typeof entry !== "object") {
    return [];
  }
  const value = entry[field];
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value.filter(Boolean) : [value].filter(Boolean);
}

/**
 * Збираємо значення кількох полів в один масив.
 */
function gatherFields(entry, fields) {
  const result = [];
  fields.forEach((field) => {
    result.push(...arrayField(entry, field));
  });
  return result;
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
  return text.replace(/\s+/g, " ").replace(/\s([.,!?:;])/g, "$1").trim();
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
function buildTitle({ glyphName, toneName, toneId, toneEssence, limits }) {
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
  const rawTitle = parts.join(" • ");
  return truncate(rawTitle || "Опис", limits.title || 70);
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
function buildMetaDescription({ intro, synergy, limits }) {
  const base = [intro?.[0], synergy?.[0]].filter(Boolean).join(" ");
  const normalized = normalizeSpacing(base || "Опис комбінації гліфа та тону Цолькін.");
  return truncate(normalized, limits.meta || 160);
}

/**
 * Утиліта для формування списку ключових слів без повторів.
 */
function buildKeywords(glyphKeywords = [], toneKeywords = []) {
  const seen = new Set();
  const unique = [];
  [...glyphKeywords, ...toneKeywords].forEach((word) => {
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
  lang,
}) {
  const limits = rules?.limits || { title: 70, meta: 160 };
  const avoidRepeats = Array.isArray(rules?.avoid_repeats) ? rules.avoid_repeats : [];
  const synonyms = rules?.synonyms || {};

  const glyphName = lang === "en" ? glyphEntry.name_en || capitalizeWord(glyphId) : glyphEntry.name_ua || capitalizeWord(glyphId);
  const toneName = lang === "en" ? toneEntry.name_en || toneEntry.name_ua : toneEntry.name_ua;
  const toneEssence = toneEntry.essence || "";

  const title = buildTitle({ glyphName, toneName, toneId, toneEssence, limits });

  const introSentences = [];
  if (glyphEntry.archetype) {
    introSentences.push(`${glyphName} — ${glyphEntry.archetype}.`);
  }
  if (toneEssence) {
    introSentences.push(`Тон ${toneId} задає ритм: ${toneEssence}.`);
  }
  if (introSentences.length === 0) {
    introSentences.push(`Комбінація ${capitalizeWord(glyphId)} та тону ${toneId} ще очікує на детальний опис.`);
  }

  const glyphCoreSentences = [];
  const strengths = arrayField(glyphEntry, "strengths");
  const domains = arrayField(glyphEntry, "domains");
  if (strengths.length > 0) {
    glyphCoreSentences.push(`Сильні сторони: ${formatList(strengths)}.`);
  }
  if (domains.length > 0) {
    glyphCoreSentences.push(`Сфери впливу: ${formatList(domains)}.`);
  }
  const glyphImagery = arrayField(glyphEntry, "imagery");
  if (glyphImagery.length > 0) {
    glyphCoreSentences.push(`Образи гліфа: ${formatList(glyphImagery)}.`);
  }

  const toneCoreSentences = [];
  const gifts = arrayField(toneEntry, "gifts");
  const challenges = arrayField(toneEntry, "challenges");
  if (toneEssence) {
    toneCoreSentences.push(`Суть тону: ${toneEssence}.`);
  }
  if (gifts.length > 0) {
    toneCoreSentences.push(`Подарунки тону: ${formatList(gifts)}.`);
  }
  if (challenges.length > 0) {
    toneCoreSentences.push(`Виклики: ${formatList(challenges)}.`);
  }
  const toneImagery = arrayField(toneEntry, "imagery");
  if (toneImagery.length > 0) {
    toneCoreSentences.push(`Образи тону: ${formatList(toneImagery)}.`);
  }

  const synergyPlan = rules?.composition?.synergy || { glyph_fields: [], tone_fields: [] };
  const synergyGlyphValues = gatherFields(glyphEntry, synergyPlan.glyph_fields || []);
  const synergyToneValues = gatherFields(toneEntry, synergyPlan.tone_fields || []);
  const synergySentences = [];
  if (synergyGlyphValues.length > 0 || synergyToneValues.length > 0) {
    const glyphPhrase = synergyGlyphValues.length > 0 ? formatList(synergyGlyphValues) : null;
    const tonePhrase = synergyToneValues.length > 0 ? formatList(synergyToneValues) : null;
    if (glyphPhrase && tonePhrase) {
      synergySentences.push(`У дії цей союз проявляється через ${glyphPhrase}, доповнені тоном як ${tonePhrase}.`);
    } else if (glyphPhrase) {
      synergySentences.push(`Гліф підказує зосередитися на ${glyphPhrase}.`);
    } else if (tonePhrase) {
      synergySentences.push(`Ритм тону веде до ${tonePhrase}.`);
    }
  }

  const advicePlan = rules?.composition?.advice || { glyph_fields: [], tone_fields: [] };
  const adviceGlyph = gatherFields(glyphEntry, advicePlan.glyph_fields || []);
  const adviceTone = gatherFields(toneEntry, advicePlan.tone_fields || []);
  const adviceItems = [...adviceGlyph, ...adviceTone];
  if (adviceItems.length === 0) {
    adviceItems.push("Зачекайте на заповнення порад для цієї комбінації.");
  }
  const genderToneStyle = Array.isArray(genderEntry?.tone_style) ? genderEntry.tone_style : [];
  const tonePrefix = genderToneStyle[0] || "Рекомендації";
  const adviceList = adviceItems.map((item) => applyLexShifts(`${tonePrefix}: ${item}`, genderEntry?.lex_shift));

  const shadowPlan = rules?.composition?.shadow || { glyph_fields: [], tone_fields: [] };
  const shadowGlyph = gatherFields(glyphEntry, shadowPlan.glyph_fields || []);
  const shadowTone = gatherFields(toneEntry, shadowPlan.tone_fields || []);
  const shadowSentences = [];
  if (shadowGlyph.length > 0) {
    shadowSentences.push(`Тінь гліфа: ${formatList(shadowGlyph)}.`);
  }
  if (shadowTone.length > 0) {
    const neutralizer = adviceGlyph[0] || adviceTone[0];
    if (neutralizer) {
      shadowSentences.push(`Баланс підтримує порада: ${neutralizer}.`);
    } else {
      shadowSentences.push(`Виклики тону: ${formatList(shadowTone)}.`);
    }
  }

  const conclusionPlan = rules?.composition?.conclusion || { glyph_fields: [], tone_fields: [] };
  const conclusionGlyph = gatherFields(glyphEntry, conclusionPlan.glyph_fields || []);
  const conclusionTone = gatherFields(toneEntry, conclusionPlan.tone_fields || []);
  const conclusionSentences = [];
  const address = Array.isArray(genderEntry?.address) && genderEntry.address.length > 0 ? `${genderEntry.address[0]}, ` : "";
  if (conclusionGlyph.length > 0 || conclusionTone.length > 0) {
    const glyphSummary = formatList(conclusionGlyph);
    const toneSummary = formatList(conclusionTone);
    const sentence = `${address}${glyphSummary || "Цей шлях"} веде до символу тону ${toneSummary || toneId}.`;
    conclusionSentences.push(applyLexShifts(sentence, genderEntry?.lex_shift));
  }
  if (conclusionSentences.length === 0) {
    conclusionSentences.push(`${address}Опис для цієї комбінації буде доповнено найближчим часом.`.trim());
  }

  const intro = finalizeSection(introSentences, avoidRepeats, synonyms);
  const glyphCore = finalizeSection(glyphCoreSentences, avoidRepeats, synonyms);
  const toneCore = finalizeSection(toneCoreSentences, avoidRepeats, synonyms);
  const synergy = finalizeSection(synergySentences, avoidRepeats, synonyms);
  const advice = adviceList.filter(Boolean).map((item) => sanitizeRepeats(normalizeSpacing(item), avoidRepeats, synonyms));
  const shadow = finalizeSection(shadowSentences, avoidRepeats, synonyms);
  const conclusion = finalizeSection(conclusionSentences, avoidRepeats, synonyms);

  const metaDescription = buildMetaDescription({ intro, synergy, limits });
  const keywords = buildKeywords(arrayField(glyphEntry, "keywords"), arrayField(toneEntry, "keywords"));

  return {
    title,
    metaDescription,
    keywords,
    blocks: {
      intro: { paragraphs: intro, list: [] },
      glyph_core: { paragraphs: glyphCore, list: [] },
      tone_core: { paragraphs: toneCore, list: [] },
      synergy: { paragraphs: synergy, list: [] },
      advice: { paragraphs: [], list: advice },
      shadow: { paragraphs: shadow, list: [] },
      conclusion: { paragraphs: conclusion, list: [] },
    },
  };
}

/**
 * Основна точка входу: генеруємо опис або повертаємо кешоване значення.
 */
export async function generateDescription({ glyphId, toneId, gender = "female", lang = "ua" } = {}) {
  const normalizedGender = normalizeGender(gender);
  const normalizedLang = normalizeLang(lang);
  const cacheKey = `${glyphId || ""}-${toneId || ""}-${normalizedGender}-${normalizedLang}`;

  if (descriptionCache.has(cacheKey)) {
    return cloneResult(descriptionCache.get(cacheKey));
  }

  const dictionaries = await loadDictionaries();
  if (!glyphId || !toneId) {
    descriptionCache.set(cacheKey, FALLBACK_DESCRIPTION);
    return cloneResult(FALLBACK_DESCRIPTION);
  }

  const overridesKey = `${glyphId}-${toneId}-${normalizedGender}`;
  const override = dictionaries.overrides?.[overridesKey];
  if (override) {
    descriptionCache.set(cacheKey, override);
    return cloneResult(override);
  }

  const glyphEntry = dictionaries.glyphs?.[glyphId];
  const toneEntry = dictionaries.tones?.[String(toneId)];

  if (!glyphEntry || !toneEntry) {
    descriptionCache.set(cacheKey, FALLBACK_DESCRIPTION);
    return cloneResult(FALLBACK_DESCRIPTION);
  }

  const genderEntry = dictionaries.genderMods?.[normalizedGender] || {};
  const description = composeDescription({
    glyphEntry,
    toneEntry,
    genderEntry,
    rules: dictionaries.rules,
    glyphId,
    toneId: String(toneId),
    lang: normalizedLang,
  });

  descriptionCache.set(cacheKey, description);
  return cloneResult(description);
}

/**
 * Додаткова утиліта: дозволяє проактивно прогріти кеш словників ще до першого запиту.
 */
export async function preloadDictionaries() {
  await loadDictionaries();
}
