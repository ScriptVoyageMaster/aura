#!/usr/bin/env node

/**
 * Повний сценарій генерації: за один прохід створює/оновлює всі сторінки у діапазоні.
 * ВАЖЛИВО: цей файл не змінює progress.json і не обмежує кількість сторінок на запуск.
 * Детальні коментарі українською допоможуть навіть новачку розібратися в логіці.
 */

const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

// Абсолютний шлях до кореня репозиторію, щоби легше формувати шляхи до файлів.
const ROOT_DIR = path.resolve(__dirname, "..");

// Повний набір канонічних гліфів, який використовується в усьому проєкті.
const CANON_GLYPHS = [
  "imix",
  "ik",
  "akbal",
  "kan",
  "chicchan",
  "cimi",
  "manik",
  "lamat",
  "muluc",
  "oc",
  "chuen",
  "eb",
  "ben",
  "ix",
  "men",
  "cib",
  "caban",
  "etznab",
  "cauac",
  "ahau",
];

// Карта винятків для назв SVG-файлів гліфів, що історично зберегли альтернативні написання.
const GLYPH_FILE_OVERRIDES = {
  chicchan: "MAYA-g-log-cal-D05-Chikchan.svg",
  cimi: "MAYA-g-log-cal-D06-Kimi.svg",
  muluc: "MAYA-g-log-cal-D09-Muluk.svg",
  oc: "MAYA-g-log-cal-D10-Ok_b.svg",
  chuen: "MAYA-g-log-cal-D11-Chuwen.svg",
  cib: "MAYA-g-log-cal-D16-Kib.svg",
  caban: "MAYA-g-log-cal-D17-Kaban.svg",
  cauac: "MAYA-g-log-cal-D19-Kawak.svg",
  ahau: "MAYA-g-log-cal-D20-Ajaw.svg",
};

// Допоміжна константа: кількість мілісекунд у добі. Знадобиться для циклів дат.
const DAY_MS = 24 * 60 * 60 * 1000;

// Головна точка входу. Обгортаємо все в async-функцію для зручної роботи з await.
(async () => {
  try {
    await runGenerator();
  } catch (error) {
    console.error("[maya-static] Критична помилка генератора:", error);
    process.exitCode = 1;
  }
})();

/**
 * Основна функція керує всією послідовністю дій: читання конфіга, обробка пар, генерація HTML.
 */
async function runGenerator() {
  const config = await readConfig();
  const cliOptions = parseCliArguments();
  const siteOrigin = normalizeSiteOrigin(config.site_origin || config.site_base_url);
  const canonicalPrefix = normalizeCanonicalPrefix(config.canonical_prefix);
  const canonicalPrefixForTemplate = canonicalPrefix === "/" ? "" : canonicalPrefix;
  const pairs = await readPairs(config.pairs_list_path);
  const overrides = await readOverrides(config.overrides_path);
  const glyphMetadata = await readGlyphMetadata();
  const template = await loadTemplate();

  const startDate = cliOptions.range
    ? cliOptions.range.start
    : parseConfigDate(config.start_date, "start_date");
  const endDate = cliOptions.range
    ? cliOptions.range.end
    : parseConfigDate(config.end_date, "end_date");

  if (startDate > endDate) {
    throw new Error("Дата початку пізніше за кінцеву дату. Перевірте конфігурацію або CLI-параметр.");
  }

  console.log(
    `[maya-static] Повний прохід по діапазону ${formatIsoDate(startDate)} – ${formatIsoDate(endDate)}.`
  );

  const publicRoot = path.resolve(ROOT_DIR, config.public_root || "public");
  await fs.mkdir(publicRoot, { recursive: true });

  const generatedPages = [];
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let skippedMissingOverrides = 0;

  for (const pair of pairs) {
    if (!pair || !pair.glyph_slug) {
      console.warn("[maya-static] Пропущено некоректну пару без гліфа.");
      continue;
    }

    console.log(`[maya-static] Обробляємо повну пару ${pair.glyph_slug}-${pair.tone}.`);

    const dates = collectDatesForPair(startDate, endDate, pair);

    if (dates.length === 0) {
      console.warn(
        `[maya-static] Діапазон не містить дат для пари ${pair.glyph_slug}-${pair.tone}.`
      );
      continue;
    }

    for (const date of dates) {
      const { year, month, day, iso, human } = buildDateParts(date);
      const canonicalPath = buildCanonicalPath({
        canonicalPrefix,
        year,
        month,
        day,
      });
      const canonicalUrl = buildCanonicalUrl(siteOrigin, canonicalPath);
      const targetDir = path.join(publicRoot, "maya", year, month, day);
      const targetFile = path.join(targetDir, "index.html");

      const overrideBlock = getOverrideBlock(overrides, pair.glyph_slug, pair.tone);
      if (!overrideBlock) {
        console.error(
          `[maya-static] Пропущено ${iso}: відсутній блок overrides для ${pair.glyph_slug}-${pair.tone}`
        );
        skippedCount += 1;
        skippedMissingOverrides += 1;
        continue;
      }

      const extracted = extractContentFromOverride(overrideBlock, pair);
      if (!extracted) {
        console.error(
          `[maya-static] Пропущено ${iso}: не вистачає полів title.ua/meta.ua в overrides`
        );
        skippedCount += 1;
        continue;
      }

      const { titleUa, metaUa, adviceUa, hash } = extracted;

      // Додаткові запобіжники: контролюємо довжину основних SEO-полів.
      if (titleUa.length > 80) {
        console.warn(
          `[maya-static] Попередження для ${iso}: довжина <title> перевищує рекомендації (80+ символів).`
        );
      }
      if (metaUa.length > 180) {
        console.warn(
          `[maya-static] Попередження для ${iso}: description довший за 180 символів.`
        );
      }

      const glyphName = glyphMetadata[pair.glyph_slug]?.nameUa || prettifySlug(pair.glyph_slug);

      const { shouldRegenerate, reason, existed } = await checkNeedToRegenerate({
        targetFile,
        expectedTemplateVersion: config.template_version,
        expectedHash: hash,
        pair,
        isoDate: iso,
      });

      if (!shouldRegenerate) {
        skippedCount += 1;
        continue;
      }

      if (reason) {
        console.log(`[maya-static] Перегенерація ${iso}: ${reason}`);
      }

      await fs.mkdir(targetDir, { recursive: true });

      let html;
      try {
        const replacements = buildPlaceholderReplacements({
          titleUa,
          metaUa,
          adviceUa,
          glyphName,
          toneValue: String(pair.tone),
          isoDate: iso,
          humanDate: human,
          canonicalUrl,
          glyphSlug: pair.glyph_slug,
          templateVersion: config.template_version,
          overrideHash: hash,
          siteOrigin,
          canonicalPrefix: canonicalPrefixForTemplate,
          year,
          month,
          day,
        });
        html = buildHtml({ template, replacements });
      } catch (error) {
        if (error?.code === "PLACEHOLDER_MISSING") {
          console.error(
            `[maya-static] Пропущено ${iso}: не всі плейсхолдери замінені (${error.missingPlaceholders.join(", ")})`
          );
          skippedCount += 1;
          continue;
        }
        throw error;
      }

      const tmpFile = `${targetFile}.tmp`;
      await fs.writeFile(tmpFile, html, "utf8");
      await fs.rename(tmpFile, targetFile);

      if (existed) {
        updatedCount += 1;
      } else {
        createdCount += 1;
      }

      generatedPages.push({
        canonicalUrl,
        canonicalPath,
        isoDate: iso,
        year,
      });
    }
  }

  if (generatedPages.length > 0) {
    await updateSitemaps({
      pages: generatedPages,
      siteOrigin,
      indexPath: path.resolve(
        ROOT_DIR,
        config.sitemaps?.index || config.sitemaps?.index_path || "public/sitemap.xml"
      ),
      yearlyDir: path.resolve(
        ROOT_DIR,
        config.sitemaps?.yearly_dir || "public/sitemaps"
      ),
    });
  }

  console.log(
    `[maya-static] Завершено повний прогін: створено ${createdCount}, оновлено ${updatedCount}, пропущено ${skippedCount}.`
  );
  console.log(
    `[maya-static] З них пропущено через відсутні overrides: ${skippedMissingOverrides}.`
  );
}

/**
 * Розбираємо CLI-параметри, щоб дозволити перекривати діапазон дат без змін конфігурації.
 */
function parseCliArguments() {
  const args = process.argv.slice(2);
  const options = {
    range: null,
  };

  for (const arg of args) {
    if (arg.startsWith("--range=")) {
      const raw = arg.slice("--range=".length);
      options.range = parseRangeArgument(raw);
    } else if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    } else {
      console.warn(`[maya-static] Невідомий параметр ${arg} буде проігноровано.`);
    }
  }

  return options;
}

/**
 * Перевіряємо формат аргументу --range та повертаємо обʼєкти Date для початку й кінця.
 */
function parseRangeArgument(value) {
  if (!value) {
    throw new Error("Аргумент --range не може бути порожнім. Використайте формат YYYY-MM-DD:YYYY-MM-DD.");
  }
  const parts = value.split(":");
  if (parts.length !== 2) {
    throw new Error(
      `Аргумент --range="${value}" має містити рівно одну двокрапку. Наприклад: 2025-01-01:2025-12-31.`
    );
  }
  const [startRaw, endRaw] = parts;
  const start = parseConfigDate(startRaw, "CLI range start");
  const end = parseConfigDate(endRaw, "CLI range end");
  return { start, end };
}

/**
 * Виводимо підказку щодо доступних параметрів та перериваємо виконання без помилки.
 */
function printHelpAndExit() {
  console.log(`\nВикористання: node scripts/generateDatePages.all.js [--range=YYYY-MM-DD:YYYY-MM-DD]\n`);
  console.log("--range  — разово перекриває start_date та end_date з конфіга.");
  process.exit(0);
}

/**
 * Зчитуємо конфігурацію генератора, який адміністратор може редагувати без правок коду.
 */
async function readConfig() {
  const configPath = path.join(ROOT_DIR, "config", "horoscope-static.json");
  const raw = await fs.readFile(configPath, "utf8");
  const data = JSON.parse(raw);
  return data;
}

/**
 * Завантажуємо список 260 пар гліфів і тонів у фіксованому порядку.
 */
async function readPairs(relativePath) {
  const fullPath = path.resolve(ROOT_DIR, relativePath);
  const raw = await fs.readFile(fullPath, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("pairs.json повинен містити непорожній масив пар");
  }
  return data.map((item, index) => {
    const glyph = String(item.glyph_slug || "").toLowerCase();
    if (!CANON_GLYPHS.includes(glyph)) {
      throw new Error(`Пара №${index} має невідомий гліф ${item.glyph_slug}`);
    }
    return {
      glyph_slug: glyph,
      tone: Number(item.tone),
      display_ua: item.display_ua ? String(item.display_ua) : null,
      display_en: item.display_en ? String(item.display_en) : null,
    };
  });
}

/**
 * Завантажуємо overrides.json, щоб підтягнути мінімальний набір текстів для сторінок.
 */
async function readOverrides(relativePath) {
  const fullPath = path.resolve(ROOT_DIR, relativePath);
  const raw = await fs.readFile(fullPath, "utf8");
  return JSON.parse(raw);
}

/**
 * Читаємо базову інформацію про гліфи, щоб показати красиві назви у статичних сторінках.
 */
async function readGlyphMetadata() {
  const glyphPath = path.join(ROOT_DIR, "data", "glyphs.json");
  try {
    const raw = await fs.readFile(glyphPath, "utf8");
    const data = JSON.parse(raw);
    const map = {};
    for (const slug of CANON_GLYPHS) {
      const node = data?.[slug];
      map[slug] = {
        nameUa: node?.name?.ua ? String(node.name.ua) : prettifySlug(slug),
      };
    }
    return map;
  } catch (error) {
    console.warn(
      "[maya-static] Не вдалося прочитати data/glyphs.json. Будемо використовувати трансформований slug.",
      error.message
    );
    const fallback = {};
    for (const slug of CANON_GLYPHS) {
      fallback[slug] = { nameUa: prettifySlug(slug) };
    }
    return fallback;
  }
}

/**
 * Завантажуємо HTML-шаблон, у який підставлятимемо дані для кожної дати.
 */
async function loadTemplate() {
  const templatePath = path.join(ROOT_DIR, "templates", "maya-date.min.html");
  return fs.readFile(templatePath, "utf8");
}

/**
 * Парсимо значення дати з конфігурації, підтримуючи ISO-формат або токен "today".
 */
function parseConfigDate(value, label) {
  if (!value || String(value).toLowerCase() === "today") {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  const str = String(value);
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Поле ${label} має бути у форматі YYYY-MM-DD або today`);
  }
  const [_, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Поле ${label} містить некоректну дату ${str}`);
  }
  return date;
}

/**
 * Ітеруємо всі дні в діапазоні та вибираємо лише ті, які відповідають потрібній парі гліф-тон.
 */
function collectDatesForPair(startDate, endDate, pair) {
  const matches = [];
  for (let time = startDate.getTime(); time <= endDate.getTime(); time += DAY_MS) {
    const date = new Date(time);
    const tzolkin = computeTzolkin(date);
    if (!tzolkin) {
      continue;
    }
    if (tzolkin.glyphSlug === pair.glyph_slug && tzolkin.tone === Number(pair.tone)) {
      matches.push(date);
    }
  }
  return matches;
}

/**
 * Розраховуємо показники Цолькін для конкретної дати (аналог браузерної реалізації).
 */
function computeTzolkin(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) {
    return null;
  }
  const jdn = toJDN(
    dateObj.getUTCFullYear(),
    dateObj.getUTCMonth() + 1,
    dateObj.getUTCDate()
  );
  const baseJdn = toJDN(2012, 12, 21);
  const delta = jdn - baseJdn;
  const tone = ((4 - 1 + delta) % 13 + 13) % 13 + 1;
  const signIndex = ((20 - 1 + delta) % 20 + 20) % 20 + 1;
  const glyphSlug = CANON_GLYPHS[signIndex - 1];
  return { tone, signIndex, glyphSlug };
}

/**
 * Перетворюємо дату григоріанського календаря на юліанський день (JDN).
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
 * Формуємо окремі частини дати для зручного форматування шляху і текстів.
 */
function buildDateParts(date) {
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const iso = `${year}-${month}-${day}`;
  const human = `${day}.${month}.${year}`;
  return { year, month, day, iso, human };
}

/**
 * Складаємо повний канонічний URL з урахуванням нормалізованого домену.
 */
function buildCanonicalUrl(siteOrigin, canonicalPath) {
  const cleanOrigin = normalizeSiteOrigin(siteOrigin);
  const normalizedPath = canonicalPath.startsWith("/")
    ? canonicalPath
    : `/${canonicalPath}`;
  return `${cleanOrigin}${normalizedPath}`;
}

/**
 * Конструюємо канонічний шлях з префіксом, роком, місяцем і днем.
 */
function buildCanonicalPath({ canonicalPrefix, year, month, day }) {
  const prefix = canonicalPrefix === "/" ? "" : canonicalPrefix;
  const parts = [prefix, year, month, day].filter((segment) => segment !== null && segment !== undefined);
  let path = parts.join("/");
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  if (!path.endsWith("/")) {
    path = `${path}/`;
  }
  return path.replace(/\/+/g, "/");
}

/**
 * Повертаємо потрібний вузол overrides для конкретної пари.
 */
function getOverrideBlock(overrides, glyphSlug, tone) {
  return overrides?.maya?.[glyphSlug]?.[String(tone)]?.any || null;
}

/**
 * Витягуємо обов'язкові текстові поля з overrides і рахуємо стабільний хеш.
 */
function extractContentFromOverride(block, pair) {
  if (!block) {
    return null;
  }
  const titleUa = sanitizeText(block?.title?.ua);
  const metaUa = sanitizeText(block?.meta?.ua);
  if (!titleUa || !metaUa) {
    return null;
  }
  const adviceUa = sanitizeText(block?.advice?.[0]?.ua);
  const hash = crypto.createHash("sha1").update(JSON.stringify(block)).digest("hex");
  return { titleUa, metaUa, adviceUa, hash };
}

/**
 * Просте санітування тексту: обрізаємо пробіли та гарантуємо рядок.
 */
function sanitizeText(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = normalizeWhitespace(value);
  return normalized.length > 0 ? normalized : null;
}

/**
 * Перевіряємо, чи потрібно перевипускати сторінку: аналізуємо службовий коментар у кінці HTML.
 */
async function checkNeedToRegenerate({
  targetFile,
  expectedTemplateVersion,
  expectedHash,
  pair,
  isoDate,
}) {
  try {
    const raw = await fs.readFile(targetFile, "utf8");
    const signatureMatch = raw.match(
      /<!--\s*tpl:([^;]+);\s*ov:([^;]+);\s*pair:([^;]+);\s*date:([^\s]+)\s*-->/
    );
    if (!signatureMatch) {
      return {
        shouldRegenerate: true,
        reason: "оновлення через відсутність службового підпису",
        existed: true,
      };
    }
    const [, tpl, ovHash, pairSignature, storedDate] = signatureMatch;
    if (tpl !== expectedTemplateVersion) {
      return {
        shouldRegenerate: true,
        reason: "оновлення через нову версію шаблону",
        existed: true,
      };
    }
    if (ovHash !== expectedHash) {
      return {
        shouldRegenerate: true,
        reason: "оновлення через новий контент",
        existed: true,
      };
    }
    const expectedPairSignature = `${pair.glyph_slug}-${pair.tone}`;
    if (pairSignature !== expectedPairSignature) {
      return {
        shouldRegenerate: true,
        reason: "оновлення через зміну пари",
        existed: true,
      };
    }
    if (storedDate !== isoDate) {
      return {
        shouldRegenerate: true,
        reason: "оновлення через зміну дати",
        existed: true,
      };
    }
    return { shouldRegenerate: false, reason: null, existed: true };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { shouldRegenerate: true, reason: "створення нової сторінки", existed: false };
    }
    throw error;
  }
}

/**
 * Формуємо фінальний HTML, гарантуючи заміну всіх плейсхолдерів.
 */
function buildHtml({ template, replacements }) {
  let output = template;
  for (const [key, value] of Object.entries(replacements)) {
    const token = `{{${key}}}`;
    output = output.replace(new RegExp(escapeRegExp(token), "g"), value);
  }

  const leftovers = output.match(/{{[^}]+}}/g);
  if (leftovers) {
    const error = new Error("У шаблоні залишилися незамінені плейсхолдери");
    error.code = "PLACEHOLDER_MISSING";
    error.missingPlaceholders = Array.from(new Set(leftovers));
    throw error;
  }

  return output;
}

/**
 * Готуємо словник замін для шаблону, одразу застосовуючи усі нормалізації.
 */
function buildPlaceholderReplacements({
  titleUa,
  metaUa,
  adviceUa,
  glyphName,
  toneValue,
  isoDate,
  humanDate,
  canonicalUrl,
  glyphSlug,
  templateVersion,
  overrideHash,
  siteOrigin,
  canonicalPrefix,
  year,
  month,
  day,
}) {
  const normalizedMeta = truncateSmart(metaUa, 160);
  const normalizedAdvice = adviceUa ? truncateSmart(adviceUa, 120) : "";
  const pageTitle = buildPageTitle(titleUa, humanDate);
  const ogImage = buildOgImageUrl(siteOrigin, glyphSlug);

  return {
    PAGE_TITLE: escapeHtml(pageTitle),
    META_UA: escapeHtml(normalizedMeta),
    TITLE_UA: escapeHtml(titleUa),
    GLYPH_NAME_UA: escapeHtml(glyphName),
    GLYPH_SLUG: escapeHtml(glyphSlug),
    TONE: escapeHtml(toneValue),
    DATE_ISO: escapeHtml(isoDate),
    DATE_DDMMYYYY: escapeHtml(humanDate),
    DATE_YEAR: escapeHtml(year),
    DATE_MM: escapeHtml(month),
    DATE_DD: escapeHtml(day),
    SITE_ORIGIN: escapeHtml(siteOrigin),
    CANONICAL_URL: escapeHtml(canonicalUrl),
    CANONICAL_PREFIX: escapeHtml(canonicalPrefix),
    OG_IMAGE: escapeHtml(ogImage),
    TEMPLATE_VERSION: escapeHtml(templateVersion),
    OV_HASH: escapeHtml(overrideHash),
    ADVICE_SHORT: escapeHtml(normalizedAdvice),
  };
}

/**
 * Формуємо короткий <title>, щоб він поміщався у сніпети пошуку.
 */
function buildPageTitle(titleUa, humanDate) {
  const combined = `${titleUa} — ${humanDate}`;
  return truncateSmart(combined, 60);
}

/**
 * Обрізаємо рядки по словах і додаємо трикрапку, якщо довжина перевищує ліміт.
 */
function truncateSmart(value, maxLength) {
  const text = normalizeWhitespace(value);
  if (text.length <= maxLength) {
    return text;
  }
  const slice = text.slice(0, maxLength - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const safe = lastSpace > maxLength * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${safe.trim()}…`;
}

/**
 * Замінюємо послідовності пробілів на один пробіл і прибираємо зайві переноси рядків.
 */
function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Нормалізуємо базовий домен: прибираємо хвіст зі слешів і підставляємо дефолт.
 */
function normalizeSiteOrigin(value) {
  const fallback = "https://aura.bit.city";
  if (!value) {
    return fallback;
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.replace(/\/+$/, "");
}

/**
 * Гарантуємо, що канонічний префікс починається зі слеша й не має його у кінці.
 */
function normalizeCanonicalPrefix(value) {
  const fallback = "/maya";
  if (!value) {
    return fallback;
  }
  let normalized = String(value).trim();
  if (!normalized) {
    return fallback;
  }
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }
  if (normalized !== "/") {
    normalized = normalized.replace(/\/+$/, "");
  }
  return normalized || fallback;
}

/**
 * Формуємо абсолютний шлях до SVG-гліфа або повертаємо запасне превʼю.
 */
function buildOgImageUrl(siteOrigin, glyphSlug) {
  const cleanOrigin = normalizeSiteOrigin(siteOrigin);
  const slug = String(glyphSlug || "").toLowerCase();
  const override = GLYPH_FILE_OVERRIDES[slug];
  const index = CANON_GLYPHS.indexOf(slug);

  if (override) {
    return `${cleanOrigin}/assets/img/maya/${override}`;
  }

  if (index >= 0) {
    const number = String(index + 1).padStart(2, "0");
    const display = prettifySlug(slug).replace(/\s+/g, "");
    return `${cleanOrigin}/assets/img/maya/MAYA-g-log-cal-D${number}-${display}.svg`;
  }

  return `${cleanOrigin}/preview.png`;
}

/**
 * Акуратно екранізуємо спецсимволи HTML, щоб уникнути поламаного DOM.
 */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Регулярний вираз для пошуку плейсхолдерів потрібно екранізувати, щоб спецсимволи не сприймались буквально.
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Для відсутності довідника гліфів перетворюємо slug на акуратний заголовок.
 */
function prettifySlug(slug) {
  return String(slug)
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Форматуємо дату у вигляді ISO (YYYY-MM-DD) для логів.
 */
function formatIsoDate(date) {
  const { iso } = buildDateParts(date);
  return iso;
}

/**
 * Оновлюємо річні sitemap-и та головний індекс, щоби пошукові системи бачили свіжі сторінки.
 */
async function updateSitemaps({ pages, siteOrigin, indexPath, yearlyDir }) {
  await fs.mkdir(yearlyDir, { recursive: true });
  const grouped = new Map();
  for (const page of pages) {
    if (!grouped.has(page.year)) {
      grouped.set(page.year, []);
    }
    grouped.get(page.year).push(page);
  }

  for (const [year, yearPages] of grouped.entries()) {
    const filePath = path.join(yearlyDir, `maya-${year}.xml`);
    const existingEntries = await readYearlySitemap(filePath);
    for (const page of yearPages) {
      existingEntries.set(page.canonicalUrl, {
        loc: page.canonicalUrl,
        lastmod: new Date().toISOString(),
      });
    }
    const xml = buildYearlySitemap(existingEntries);
    await fs.writeFile(filePath, xml, "utf8");
  }

  // Після оновлення річних карт потрібно перебудувати індексну sitemap.xml.
  const sitemapUrls = [];
  const yearlyFiles = await fs.readdir(yearlyDir);
  const sitemapBase = normalizeSiteOrigin(siteOrigin);

  for (const fileName of yearlyFiles) {
    if (!fileName.startsWith("maya-") || !fileName.endsWith(".xml")) {
      continue;
    }
    const year = fileName.replace("maya-", "").replace(".xml", "");
    const loc = `${sitemapBase}/sitemaps/${fileName}`;
    sitemapUrls.push({ loc, year });
  }
  const indexXml = buildIndexSitemap(sitemapUrls);
  await fs.writeFile(indexPath, indexXml, "utf8");
}

/**
 * Зчитуємо наявну річну карту, щоб не губити попередні записи.
 */
async function readYearlySitemap(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const entries = new Map();
    const regex = /<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>[\s\S]*?<\/url>/g;
    let match;
    while ((match = regex.exec(raw))) {
      entries.set(match[1], { loc: match[1], lastmod: match[2] });
    }
    return entries;
  } catch (error) {
    if (error.code === "ENOENT") {
      return new Map();
    }
    throw error;
  }
}

/**
 * Будуємо XML для річної sitemap із відсортованими URL.
 */
function buildYearlySitemap(entries) {
  const urls = Array.from(entries.values()).sort((a, b) => a.loc.localeCompare(b.loc));
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const url of urls) {
    lines.push("  <url>");
    lines.push(`    <loc>${url.loc}</loc>`);
    lines.push(`    <lastmod>${url.lastmod}</lastmod>`);
    lines.push("  </url>");
  }
  lines.push("</urlset>");
  return `${lines.join("\n")}\n`;
}

/**
 * Формуємо індексну sitemap, яка посилається на всі річні карти.
 */
function buildIndexSitemap(sitemaps) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  const sorted = [...sitemaps].sort((a, b) => a.loc.localeCompare(b.loc));
  for (const item of sorted) {
    lines.push("  <sitemap>");
    lines.push(`    <loc>${item.loc}</loc>`);
    lines.push(`    <lastmod>${new Date().toISOString()}</lastmod>`);
    lines.push("  </sitemap>");
  }
  lines.push("</sitemapindex>");
  return `${lines.join("\n")}\n`;
}

