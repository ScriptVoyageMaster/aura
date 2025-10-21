#!/usr/bin/env node

/**
 * Скрипт покроково генерує статичні майянські сторінки згідно з конфігурацією.
 * Докладні коментарі українською допоможуть навіть новачку зрозуміти логіку.
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
  const pairs = await readPairs(config.pairs_list_path);
  const overrides = await readOverrides(config.overrides_path);
  const glyphMetadata = await readGlyphMetadata();
  const template = await loadTemplate();
  const progress = await readProgress();

  const previousPairIndex = Number.isFinite(Number(progress.last_pair_index))
    ? Number(progress.last_pair_index)
    : -1;

  // Визначаємо наступну пару в колі: після 259-ї повертаємося до 0-ї.
  const nextPairIndex = (previousPairIndex + 1) % pairs.length;
  const pair = pairs[nextPairIndex];

  if (!pair || !pair.glyph_slug) {
    throw new Error("Неможливо визначити наступну пару для генерації");
  }

  console.log(
    `[maya-static] Обробляємо пару ${pair.glyph_slug}-${pair.tone} (індекс ${nextPairIndex})`
  );

  const startDate = parseConfigDate(config.start_date, "start_date");
  const endDate = parseConfigDate(config.end_date, "end_date");

  if (startDate > endDate) {
    throw new Error("Дата початку пізніше за кінцеву дату. Перевірте конфігурацію.");
  }

  const dates = collectDatesForPair(startDate, endDate, pair);

  if (dates.length === 0) {
    console.warn(
      `[maya-static] У діапазоні ${formatIsoDate(startDate)} – ${formatIsoDate(
        endDate
      )} немає збігів для пари ${pair.glyph_slug}-${pair.tone}.`
    );
  }

  const publicRoot = path.resolve(ROOT_DIR, config.public_root || "public");
  await fs.mkdir(publicRoot, { recursive: true });

  const generatedPages = [];
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let limitReached = false;

  const maxPagesPerRun = Number(config.cron_window?.max_pages_per_run);
  const effectiveLimit = Number.isFinite(maxPagesPerRun) && maxPagesPerRun > 0 ? maxPagesPerRun : Infinity;

  for (const date of dates) {
    if (generatedPages.length >= effectiveLimit) {
      limitReached = true;
      console.log(
        `[maya-static] Досягли ліміту ${effectiveLimit} сторінок на запуск; залишок буде догенеровано пізніше.`
      );
      break;
    }
    const { year, month, day, iso, human } = buildDateParts(date);
    const canonicalPath = `/maya/${year}/${month}/${day}/`;
    const canonicalUrl = buildCanonicalUrl(config.site_base_url, canonicalPath);
    const targetDir = path.join(publicRoot, "maya", year, month, day);
    const targetFile = path.join(targetDir, "index.html");

    const overrideBlock = getOverrideBlock(overrides, pair.glyph_slug, pair.tone);
    if (!overrideBlock) {
      console.error(
        `[maya-static] Пропущено ${iso}: відсутній блок overrides для ${pair.glyph_slug}-${pair.tone}`
      );
      skippedCount += 1;
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

    const html = buildHtml({
      template,
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
      siteBaseUrl: config.site_base_url,
    });

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

  await updateProgress({
    pairIndexToPersist: limitReached ? previousPairIndex : nextPairIndex,
    templateVersion: config.template_version,
    createdCount,
    updatedCount,
    skippedCount,
  });

  if (generatedPages.length > 0) {
    await updateSitemaps({
      pages: generatedPages,
      siteBaseUrl: config.site_base_url,
      indexPath: path.resolve(ROOT_DIR, config.sitemaps?.index_path || "public/sitemap.xml"),
      yearlyDir: path.resolve(ROOT_DIR, config.sitemaps?.yearly_dir || "public/sitemaps"),
    });
  }

  console.log(
    `[maya-static] Завершено: створено ${createdCount}, оновлено ${updatedCount}, пропущено ${skippedCount}.`
  );
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
 * Зчитуємо файл прогресу; якщо його немає, створюємо стандартну заготовку.
 */
async function readProgress() {
  const progressPath = path.join(ROOT_DIR, "data", "progress.json");
  try {
    const raw = await fs.readFile(progressPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      const initial = {
        last_pair_index: -1,
        template_version_applied: null,
        last_run_at: null,
        stats: {
          generated: 0,
          updated: 0,
          skipped: 0,
        },
      };
      await fs.writeFile(progressPath, JSON.stringify(initial, null, 2), "utf8");
      return initial;
    }
    throw error;
  }
}

/**
 * Зберігаємо оновлені дані про прогрес після успішного запуску.
 */
async function updateProgress({
  pairIndexToPersist,
  templateVersion,
  createdCount,
  updatedCount,
  skippedCount,
}) {
  const progressPath = path.join(ROOT_DIR, "data", "progress.json");
  const payload = {
    last_pair_index: pairIndexToPersist,
    template_version_applied: templateVersion,
    last_run_at: new Date().toISOString(),
    stats: {
      generated: createdCount,
      updated: updatedCount,
      skipped: skippedCount,
    },
  };
  await fs.writeFile(progressPath, JSON.stringify(payload, null, 2), "utf8");
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
 * Складаємо повний канонічний URL з базового домену та відносного шляху.
 */
function buildCanonicalUrl(baseUrl, canonicalPath) {
  const cleanBase = String(baseUrl || "https://aura.bit.city").replace(/\/$/, "");
  return `${cleanBase}${canonicalPath}`;
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
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
 * Формуємо фінальний HTML, підставляючи значення у всі плейсхолдери шаблону.
 */
function buildHtml({
  template,
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
  siteBaseUrl,
}) {
  const ogImage = buildOgImageUrl(siteBaseUrl, glyphSlug);
  const jsonLd = buildJsonLd({
    titleUa,
    metaUa,
    canonicalUrl,
    ogImage,
    isoDate,
    siteBaseUrl,
  });
  const qualitiesBlock = adviceUa
    ? `<li><strong>Підказка дня:</strong> ${escapeHtml(adviceUa)}</li>`
    : "";
  const replacements = new Map([
    ["{{PAGE_TITLE}}", escapeHtml(`${titleUa} — ${humanDate}`)],
    ["{{META_DESCRIPTION}}", escapeHtml(metaUa)],
    ["{{OG_TITLE}}", escapeHtml(`${titleUa} — ${humanDate}`)],
    ["{{OG_DESCRIPTION}}", escapeHtml(metaUa)],
    ["{{OG_IMAGE}}", escapeHtml(ogImage)],
    ["{{CANONICAL_URL}}", escapeHtml(canonicalUrl)],
    ["{{JSON_LD}}", indentJson(jsonLd, 6)],
    ["{{H1_TEXT}}", escapeHtml(`Гороскоп Майя на ${humanDate} — ${titleUa}`)],
    ["{{LEAD_PARAGRAPH}}", escapeHtml(metaUa)],
    ["{{GLYPH_NAME}}", escapeHtml(glyphName)],
    ["{{TONE_VALUE}}", escapeHtml(toneValue)],
    ["{{QUALITIES_BLOCK}}", qualitiesBlock],
    ["{{CTA_URL}}", escapeHtml(`/?date=${isoDate}`)],
    ["{{SERVICE_COMMENT}}", buildServiceComment({
      templateVersion,
      overrideHash,
      glyphSlug,
      toneValue,
      isoDate,
    })],
  ]);

  let output = template;
  for (const [token, value] of replacements.entries()) {
    output = output.replace(new RegExp(escapeRegExp(token), "g"), value);
  }
  return output;
}

/**
 * Формуємо рядок JSON-LD з двома сутностями: стаття + хлібні крихти.
 */
function buildJsonLd({ titleUa, metaUa, canonicalUrl, ogImage, isoDate, siteBaseUrl }) {
  const [year, month, day] = isoDate.split("-");
  const cleanBase = String(siteBaseUrl || "").replace(/\/$/, "");
  const rootUrl = cleanBase || "https://aura.bit.city";
  const mayaRoot = `${rootUrl}/maya/`;
  const graph = [
    {
      "@type": "Article",
      name: titleUa,
      description: metaUa,
      datePublished: isoDate,
      url: canonicalUrl,
      image: ogImage,
      author: {
        "@type": "Organization",
        name: "Aura Bit City",
      },
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Головна",
          item: `${rootUrl}/`,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Майя",
          item: mayaRoot,
        },
        {
          "@type": "ListItem",
          position: 3,
          name: year,
          item: `${mayaRoot}${year}/`,
        },
        {
          "@type": "ListItem",
          position: 4,
          name: `${month}.${year}`,
          item: `${mayaRoot}${year}/${month}/`,
        },
        {
          "@type": "ListItem",
          position: 5,
          name: `День ${day}.${month}`,
          item: canonicalUrl,
        },
      ],
    },
  ];
  return JSON.stringify(
    {
      "@context": "https://schema.org",
      "@graph": graph,
    },
    null,
    2
  );
}

/**
 * Створюємо службовий коментар із ключовою інформацією для контролю версій.
 */
function buildServiceComment({ templateVersion, overrideHash, glyphSlug, toneValue, isoDate }) {
  return `    <!-- tpl:${templateVersion}; ov:${overrideHash}; pair:${glyphSlug}-${toneValue}; date:${isoDate} -->`;
}

/**
 * Формуємо шлях до ілюстрації гліфа, а за потреби підставляємо дефолтну картинку.
 */
function buildOgImageUrl(siteBaseUrl, glyphSlug) {
  const cleanBase = String(siteBaseUrl || "https://aura.bit.city").replace(/\/$/, "");
  const candidate = `${cleanBase}/img/maya/glyphs/${glyphSlug}.png`;
  return candidate;
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
 * Додаємо відступи до JSON-LD, щоб скрипт був красивим і читабельним у вихідному HTML.
 */
function indentJson(jsonString, indentLevel) {
  const indent = " ".repeat(indentLevel);
  return jsonString
    .split("\n")
    .map((line) => `${indent}${line}`)
    .join("\n");
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
async function updateSitemaps({ pages, siteBaseUrl, indexPath, yearlyDir }) {
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
  const sitemapBase = String(siteBaseUrl || "https://aura.bit.city").replace(/\/$/, "");

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

