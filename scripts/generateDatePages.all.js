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

// Допоміжна константа: кількість мілісекунд у добі. Знадобиться для циклів дат.
const DAY_MS = 24 * 60 * 60 * 1000;

// Скільки посилань показувати на одній сторінці річного архіву.
const ARCHIVE_PAGE_SIZE = 150;

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
  // Опція CLI дозволяє примусово перебудувати sitemap-и навіть без нових сторінок.
  const forceSitemap = Boolean(cliOptions.forceSitemap);
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

  if (forceSitemap) {
    console.log(
      "[maya-static] Увімкнено примусове оновлення sitemap-ів: буде виконано навіть без нових HTML-сторінок."
    );
  }

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

      const navigation = buildNavigationLinks({
        date,
        startDate,
        endDate,
        canonicalPrefix,
        siteOrigin,
      });

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

      // Ця змінна згодом зберігатиме значення lastmod для sitemap,
      // незалежно від того, чи ми реально згенерували HTML, чи просто додали сторінку.
      let sitemapLastmod = null;

      if (!shouldRegenerate) {
        if (forceSitemap) {
          try {
            // Якщо примусова опція ввімкнена, але HTML і так актуальний, ми все одно
            // додаємо сторінку до sitemap, використавши час останньої модифікації файлу.
            const stats = await fs.stat(targetFile);
            sitemapLastmod = stats.mtime.toISOString();
            generatedPages.push({
              canonicalUrl,
              canonicalPath,
              isoDate: iso,
              year,
              lastmod: sitemapLastmod,
              changefreq: navigation.changefreq,
              priority: navigation.priority,
            });
          } catch (statError) {
            // Якщо файл не існує або недоступний, просто попередимо та поведемося як раніше.
            console.warn(
              `[maya-static] Не вдалося зчитати mtime для ${iso}: ${statError.message}. Сторінку пропущено.`
            );
          }
        }

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
          previousLinkHtml: navigation.previousLinkHtml,
          nextLinkHtml: navigation.nextLinkHtml,
          archiveLinkHtml: navigation.archiveLinkHtml,
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

      const generatedAt = new Date().toISOString();
      sitemapLastmod = generatedAt;

      if (existed) {
        updatedCount += 1;
      } else {
        createdCount += 1;
      }

      // Після збереження HTML додаємо інформацію для sitemap.
      // Окрема змінна sitemapLastmod гарантує, що і нові, і оновлені сторінки
      // потрапляють у список з актуальним timestamp.
      generatedPages.push({
        canonicalUrl,
        canonicalPath,
        isoDate: iso,
        year,
        lastmod: sitemapLastmod,
        changefreq: navigation.changefreq,
        priority: navigation.priority,
      });
    }
  }

  // Формуємо payload для генератора sitemap-ів, щоб одразу використати його у виклику.
  const allUrls = {
    pages: generatedPages,
    siteOrigin,
    indexPath: path.resolve(
      ROOT_DIR,
      config.sitemaps?.index || config.sitemaps?.index_path || "public/sitemap.xml"
    ),
    yearlyDir: path.resolve(ROOT_DIR, config.sitemaps?.yearly_dir || "public/sitemaps"),
    publicRoot,
    canonicalPrefix,
  };

  // Узагальнена статистика допомагає вирішити, чи варто оновлювати sitemap-и.
  const stats = {
    created: createdCount,
    updated: updatedCount,
  };

  if (forceSitemap || stats.created > 0 || stats.updated > 0) {
    await updateSitemaps(allUrls);
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
    // Прапорець для примусового оновлення sitemap-ів без огляду на статистику.
    forceSitemap: false,
  };

  for (const arg of args) {
    if (arg.startsWith("--range=")) {
      const raw = arg.slice("--range=".length);
      options.range = parseRangeArgument(raw);
    } else if (arg === "--force-sitemap") {
      options.forceSitemap = true;
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
  console.log(
    "\nВикористання: node scripts/generateDatePages.all.js [--range=YYYY-MM-DD:YYYY-MM-DD] [--force-sitemap]\n"
  );
  console.log("--range  — разово перекриває start_date та end_date з конфіга.");
  console.log("--force-sitemap — примусово перебудовує sitemap-и навіть без змін сторінок.");
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
  previousLinkHtml,
  nextLinkHtml,
  archiveLinkHtml,
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
    NAV_PREVIOUS: previousLinkHtml || "",
    NAV_NEXT: nextLinkHtml || "",
    NAV_ARCHIVE: archiveLinkHtml || "",
  };
}

/**
 * Формуємо блоки внутрішньої навігації й паралельно розраховуємо метадані для sitemap.
 */
function buildNavigationLinks({ date, startDate, endDate, canonicalPrefix, siteOrigin }) {
  const previousDate = new Date(date.getTime() - DAY_MS);
  const nextDate = new Date(date.getTime() + DAY_MS);
  const currentParts = buildDateParts(date);
  const archiveUrl = buildArchiveUrl({
    canonicalPrefix,
    siteOrigin,
    year: currentParts.year,
  });

  const archiveLinkHtml = createNavLink({
    href: archiveUrl,
    label: `Повернутися до архіву ${currentParts.year}`,
    rel: "up",
  });

  let previousLinkHtml = "";
  if (!startDate || previousDate >= startDate) {
    const prevParts = buildDateParts(previousDate);
    const prevPath = buildCanonicalPath({
      canonicalPrefix,
      year: prevParts.year,
      month: prevParts.month,
      day: prevParts.day,
    });
    const prevUrl = buildCanonicalUrl(siteOrigin, prevPath);
    previousLinkHtml = createNavLink({
      href: prevUrl,
      label: `Попередній день — ${prevParts.day}.${prevParts.month}.${prevParts.year}`,
      rel: "prev",
    });
  }

  let nextLinkHtml = "";
  if (!endDate || nextDate <= endDate) {
    const nextParts = buildDateParts(nextDate);
    const nextPath = buildCanonicalPath({
      canonicalPrefix,
      year: nextParts.year,
      month: nextParts.month,
      day: nextParts.day,
    });
    const nextUrl = buildCanonicalUrl(siteOrigin, nextPath);
    nextLinkHtml = createNavLink({
      href: nextUrl,
      label: `Наступний день — ${nextParts.day}.${nextParts.month}.${nextParts.year}`,
      rel: "next",
    });
  }

  const sitemapMeta = computeSitemapMeta(currentParts.iso);

  return {
    previousLinkHtml,
    nextLinkHtml,
    archiveLinkHtml,
    changefreq: sitemapMeta.changefreq,
    priority: sitemapMeta.priority,
  };
}

/**
 * Створюємо готовий HTML-рядок для пункту навігації з урахуванням безпеки.
 */
function createNavLink({ href, label, rel }) {
  if (!href || !label) {
    return "";
  }
  const safeHref = escapeHtml(href);
  const safeLabel = escapeHtml(label);
  const relAttribute = rel ? ` rel="${escapeHtml(rel)}"` : "";
  return `<li class="nav-links__item"><a href="${safeHref}"${relAttribute}>${safeLabel}</a></li>`;
}

/**
 * Рахуємо пріоритети для sitemap, надаючи трохи вищу вагу найближчим датам.
 */
function computeSitemapMeta(isoDate) {
  if (!isoDate) {
    return { changefreq: "weekly", priority: "0.6" };
  }
  const now = new Date();
  const target = new Date(`${isoDate}T00:00:00Z`);
  const diffMs = target - now;
  const diffDays = Math.round(diffMs / DAY_MS);
  const priority = Math.abs(diffDays) <= 7 ? "0.8" : "0.6";
  return { changefreq: "weekly", priority };
}

/**
 * Формуємо абсолютну URL-адресу архіву конкретного року.
 */
function buildArchiveUrl({ canonicalPrefix, siteOrigin, year }) {
  const cleanOrigin = normalizeSiteOrigin(siteOrigin);
  const prefix = canonicalPrefix === "/" ? "" : canonicalPrefix;
  let path = `${prefix}/${year}/`;
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  path = path.replace(/\/+/g, "/");
  return `${cleanOrigin}${path}`;
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
 * Формуємо шлях до стандартного PNG-банера для Open Graph, щоби соцмережі гарантовано його підхопили.
 */
function buildOgImageUrl(siteOrigin, glyphSlug) {
  const cleanOrigin = normalizeSiteOrigin(siteOrigin);
  const slug = String(glyphSlug || "").toLowerCase();

  if (!CANON_GLYPHS.includes(slug)) {
    console.warn(
      "[maya-static] Отримано невідомий гліф для OG-зображення, повертаємо дефолтний банер.",
      glyphSlug
    );
  }

  // PNG 1200×630 додається вручну до /public/assets/img/og/ і використовується для всіх статичних сторінок.
  // Це усуває SVG, з якими соцмережі та деякі месенджери працюють нестабільно.
  return `${cleanOrigin}/assets/img/og/aura-maya.png`;
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
async function updateSitemaps({
  pages,
  siteOrigin,
  indexPath,
  yearlyDir,
  publicRoot,
  canonicalPrefix,
}) {
  await fs.mkdir(yearlyDir, { recursive: true });
  const grouped = new Map();
  for (const page of pages) {
    if (!grouped.has(page.year)) {
      grouped.set(page.year, []);
    }
    grouped.get(page.year).push(page);
  }

  for (const [year, yearPages] of grouped.entries()) {
    const existingEntries = await readYearlySitemapSet(yearlyDir, year);
    for (const page of yearPages) {
      const meta = computeSitemapMeta(page.isoDate);
      existingEntries.set(page.canonicalUrl, {
        loc: page.canonicalUrl,
        isoDate: page.isoDate,
        lastmod: page.lastmod || new Date().toISOString(),
        changefreq: page.changefreq || meta.changefreq,
        priority: page.priority || meta.priority,
      });
    }

    const { entries } = await writeYearlySitemaps({
      year,
      entries: existingEntries,
      yearlyDir,
    });

    await writeYearArchive({
      year,
      entries,
      canonicalPrefix,
      publicRoot,
      siteOrigin,
    });
  }

  // Після оновлення річних карт потрібно перебудувати індексну sitemap.xml.
  const sitemapBase = normalizeSiteOrigin(siteOrigin);
  const yearlyFiles = await safeReadDir(yearlyDir);
  const sitemapUrls = [];

  for (const fileName of yearlyFiles) {
    if (!fileName.startsWith("maya-") || !fileName.endsWith(".xml")) {
      continue;
    }
    const filePath = path.join(yearlyDir, fileName);
    const stats = await fs.stat(filePath);
    const loc = `${sitemapBase}/sitemaps/${fileName}`;
    sitemapUrls.push({ loc, lastmod: stats.mtime.toISOString() });
  }

  const indexXml = buildIndexSitemap(sitemapUrls);
  await fs.writeFile(indexPath, indexXml, "utf8");
}

/**
 * Зчитуємо наявну річну карту, щоб не губити попередні записи.
 */
async function readYearlySitemapSet(yearlyDir, year) {
  const entries = new Map();
  const files = await safeReadDir(yearlyDir);
  for (const fileName of files) {
    if (!isYearlySitemapFile(fileName, year)) {
      continue;
    }
    const filePath = path.join(yearlyDir, fileName);
    const fileEntries = await readYearlySitemap(filePath);
    for (const entry of fileEntries.values()) {
      entries.set(entry.loc, entry);
    }
  }
  return entries;
}

/**
 * Зчитуємо один sitemap-файл і повертаємо мапу записів.
 */
async function readYearlySitemap(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const entries = new Map();
    const regex = /<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>([\s\S]*?)<\/url>/g;
    let match;
    while ((match = regex.exec(raw))) {
      const loc = match[1];
      const lastmod = match[2];
      const tail = match[3] || "";
      const changefreqMatch = tail.match(/<changefreq>([^<]+)<\/changefreq>/);
      const priorityMatch = tail.match(/<priority>([^<]+)<\/priority>/);
      const isoDate = extractIsoFromUrl(loc);
      entries.set(loc, {
        loc,
        lastmod,
        changefreq: changefreqMatch ? changefreqMatch[1] : undefined,
        priority: priorityMatch ? priorityMatch[1] : undefined,
        isoDate,
      });
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
 * Перевіряємо, що файл належить конкретному року.
 */
function isYearlySitemapFile(fileName, year) {
  if (!fileName.startsWith(`maya-${year}`) || !fileName.endsWith(".xml")) {
    return false;
  }
  if (fileName === `maya-${year}.xml`) {
    return true;
  }
  return /^maya-\d{4}-[a-z]+\.xml$/.test(fileName);
}

/**
 * Записуємо одну або кілька sitemap-файлів для конкретного року.
 */
async function writeYearlySitemaps({ year, entries, yearlyDir }) {
  const urls = Array.from(entries.values()).map((entry) => ({
    ...entry,
    isoDate: entry.isoDate || extractIsoFromUrl(entry.loc),
  }));

  urls.sort((a, b) => a.isoDate.localeCompare(b.isoDate));

  const existingFiles = (await safeReadDir(yearlyDir)).filter((fileName) =>
    isYearlySitemapFile(fileName, year)
  );
  for (const fileName of existingFiles) {
    await fs.unlink(path.join(yearlyDir, fileName));
  }

  if (urls.length === 0) {
    return { entries: [], fileNames: [] };
  }

  const chunkSize = 50000;
  const chunks = chunkArray(urls, chunkSize);
  const fileNames = [];
  const pendingWrites = [];

  chunks.forEach((chunk, index) => {
    const suffix = chunks.length === 1 ? "" : `-${indexToSuffix(index)}`;
    const fileName = `maya-${year}${suffix}.xml`;
    const hydrated = chunk.map((item) => ({
      ...item,
      lastmod: item.lastmod || new Date().toISOString(),
      changefreq: item.changefreq || computeSitemapMeta(item.isoDate).changefreq,
      priority: item.priority || computeSitemapMeta(item.isoDate).priority,
    }));
    const xml = buildYearlySitemap(hydrated);
    fileNames.push(fileName);
    const targetPath = path.join(yearlyDir, fileName);
    pendingWrites.push(fs.writeFile(targetPath, xml, "utf8"));
    chunks[index] = hydrated;
  });

  await Promise.all(pendingWrites);

  const flattened = chunks.flat();
  return { entries: flattened, fileNames };
}

/**
 * Формуємо XML для річної sitemap із відсортованими URL.
 */
function buildYearlySitemap(entries) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const url of entries) {
    lines.push("  <url>");
    lines.push(`    <loc>${url.loc}</loc>`);
    lines.push(`    <lastmod>${url.lastmod}</lastmod>`);
    if (url.changefreq) {
      lines.push(`    <changefreq>${url.changefreq}</changefreq>`);
    }
    if (url.priority) {
      lines.push(`    <priority>${url.priority}</priority>`);
    }
    lines.push("  </url>");
  }
  lines.push("</urlset>");
  return `${lines.join("\n")}\n`;
}

/**
 * Перебудовуємо HTML-архів для року, додаючи пагінацію.
 */
async function writeYearArchive({ year, entries, canonicalPrefix, publicRoot, siteOrigin }) {
  const normalizedEntries = [...entries].sort((a, b) => b.isoDate.localeCompare(a.isoDate));
  const pages = chunkArray(normalizedEntries, ARCHIVE_PAGE_SIZE);
  const segments = canonicalPrefix === "/"
    ? []
    : canonicalPrefix.replace(/^\//, "").split("/").filter(Boolean);
  const archiveRoot = path.join(publicRoot, ...segments, year);
  await fs.mkdir(archiveRoot, { recursive: true });

  if (pages.length === 0) {
    const emptyHtml = buildArchiveHtml({
      year,
      entries: [],
      pageNumber: 1,
      totalPages: 1,
      canonicalPrefix,
      siteOrigin,
    });
    const emptyPath = path.join(archiveRoot, "index.html");
    await fs.writeFile(emptyPath, emptyHtml, "utf8");
    return;
  }

  for (let index = 0; index < pages.length; index += 1) {
    const pageNumber = index + 1;
    const slice = pages[index];
    const html = buildArchiveHtml({
      year,
      entries: slice,
      pageNumber,
      totalPages: pages.length,
      canonicalPrefix,
      siteOrigin,
    });

    if (pageNumber === 1) {
      await fs.writeFile(path.join(archiveRoot, "index.html"), html, "utf8");
    } else {
      const pageDir = path.join(archiveRoot, "page", String(pageNumber));
      await fs.mkdir(pageDir, { recursive: true });
      await fs.writeFile(path.join(pageDir, "index.html"), html, "utf8");
    }
  }
}

/**
 * Будуємо фінальний HTML для сторінки архіву з урахуванням пагінації.
 */
function buildArchiveHtml({ year, entries, pageNumber, totalPages, canonicalPrefix, siteOrigin }) {
  const title = `Архів гороскопу Майя ${year} — Aura`;
  const description = `Усі статичні сторінки гороскопу Майя за ${year} рік.`;
  const canonicalUrl = buildArchivePageUrl({
    canonicalPrefix,
    siteOrigin,
    year,
    pageNumber,
  });

  const prevLink = pageNumber > 1
    ? buildArchivePageUrl({ canonicalPrefix, siteOrigin, year, pageNumber: pageNumber - 1 })
    : null;
  const nextLink = pageNumber < totalPages
    ? buildArchivePageUrl({ canonicalPrefix, siteOrigin, year, pageNumber: pageNumber + 1 })
    : null;

  const listItems = entries
    .map((entry) => {
      const iso = entry.isoDate || extractIsoFromUrl(entry.loc) || "";
      const parts = iso.split("-");
      const [y, m, d] = parts.length === 3 ? parts : ["????", "??", "??"];
      const label = `Гороскоп Майя на ${d}.${m}.${y}`;
      return `        <li><a href="${escapeHtml(entry.loc)}">${escapeHtml(label)}</a></li>`;
    })
    .join("\n");

  const pagination = buildArchivePagination({ year, canonicalPrefix, siteOrigin, pageNumber, totalPages });

  return `<!DOCTYPE html>
<html lang="uk">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    ${prevLink ? `<link rel="prev" href="${escapeHtml(prevLink)}" />` : ""}
    ${nextLink ? `<link rel="next" href="${escapeHtml(nextLink)}" />` : ""}
    <style>
      body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 1.5rem; background: #f9fafb; color: #0f172a; }
      main { max-width: 960px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 2rem 2.5rem; box-shadow: 0 10px 35px rgba(15, 23, 42, 0.12); }
      h1 { margin-top: 0; font-size: clamp(1.6rem, 1.2rem + 1vw, 2rem); }
      p.lead { margin: 0.25rem 0 1.5rem; color: #475569; }
      ul.archive-list { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 0.75rem 1.5rem; }
      ul.archive-list li { background: #f1f5f9; border-radius: 12px; padding: 0.85rem 1.1rem; transition: background 0.2s ease, transform 0.2s ease; }
      ul.archive-list li:hover { background: #e2e8f0; transform: translateY(-1px); }
      ul.archive-list a { color: inherit; text-decoration: none; font-weight: 600; }
      nav.pagination { margin-top: 2rem; display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
      nav.pagination a { padding: 0.5rem 0.9rem; border-radius: 8px; background: #e0f2fe; color: #0f172a; text-decoration: none; font-weight: 600; }
      nav.pagination span.current { padding: 0.5rem 0.9rem; border-radius: 8px; background: #0ea5e9; color: #ffffff; font-weight: 700; }
      .cta { display: inline-flex; margin-top: 1.5rem; padding: 0.65rem 1rem; border-radius: 10px; background: #0ea5e9; color: #fff; font-weight: 600; text-decoration: none; }
      .cta:hover { background: #0284c7; }
    </style>
  </head>
  <body>
    <main>
      <h1>Архів гороскопу Майя за ${escapeHtml(year)}</h1>
      <p class="lead">Переглянь усі статичні сторінки на кожен день року та переходь до потрібної дати.</p>
      <ul class="archive-list">
${listItems || "        <li>Архів наразі порожній. Перевір, чи згенеровані сторінки для цього року.</li>"}
      </ul>
      ${pagination}
      <a class="cta" href="${escapeHtml(`${normalizeSiteOrigin(siteOrigin)}/`)}">На головну Aura</a>
    </main>
  </body>
</html>
`;
}

/**
 * Формуємо навігацію пагінації з посиланнями на всі сторінки архіву року.
 */
function buildArchivePagination({ year, canonicalPrefix, siteOrigin, pageNumber, totalPages }) {
  if (totalPages <= 1) {
    return "";
  }
  const parts = ['      <nav class="pagination" aria-label="Пагінація архіву">'];
  for (let page = 1; page <= totalPages; page += 1) {
    if (page === pageNumber) {
      parts.push(`        <span class="current">Сторінка ${page}</span>`);
      continue;
    }
    const href = buildArchivePageUrl({ canonicalPrefix, siteOrigin, year, pageNumber: page });
    parts.push(`        <a href="${escapeHtml(href)}">Сторінка ${page}</a>`);
  }
  parts.push("      </nav>");
  return parts.join("\n");
}

/**
 * Формуємо абсолютну адресу сторінки архіву конкретного року й сторінки.
 */
function buildArchivePageUrl({ canonicalPrefix, siteOrigin, year, pageNumber }) {
  const cleanOrigin = normalizeSiteOrigin(siteOrigin);
  const prefix = canonicalPrefix === "/" ? "" : canonicalPrefix;
  let path = `${prefix}/${year}/`;
  if (pageNumber && pageNumber > 1) {
    path += `page/${pageNumber}/`;
  }
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  path = path.replace(/\/+/g, "/");
  return `${cleanOrigin}${path}`;
}

/**
 * Повертаємо масив сторінок у форматі батчів для подальшого запису.
 */
function chunkArray(items, chunkSize) {
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

/**
 * Перетворюємо індекс частини на літеральний суфікс (a, b, ..., aa).
 */
function indexToSuffix(index) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  let value = index;
  let suffix = "";
  do {
    suffix = alphabet[value % alphabet.length] + suffix;
    value = Math.floor(value / alphabet.length) - 1;
  } while (value >= 0);
  return suffix;
}

/**
 * Безпечно читаємо директорію: повертаємо порожній масив, якщо її не існує.
 */
async function safeReadDir(dirPath) {
  try {
    return await fs.readdir(dirPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * Витягуємо ISO-дату з канонічної URL сторінки /maya/YYYY/MM/DD/.
 */
function extractIsoFromUrl(loc) {
  const match = String(loc).match(/\/(\d{4})\/(\d{2})\/(\d{2})\/?$/);
  if (!match) {
    return null;
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
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
    if (item.lastmod) {
      lines.push(`    <lastmod>${item.lastmod}</lastmod>`);
    }
    lines.push("  </sitemap>");
  }
  lines.push("</sitemapindex>");
  return `${lines.join("\n")}\n`;
}

