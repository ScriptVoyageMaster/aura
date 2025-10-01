import { TZOLKIN_GLYPHS, TZOLKIN_ORDER } from "./glyphs/index.js";
import { initGenderTheme, setGenderTheme } from "../../client/assets/js/genderToggle.js";
import { generateDescription, preloadDictionaries } from "../../utils/generator.js";

// Робимо мапу та впорядкований список гліфів доступними глобально для майбутніх сценаріїв.
// Так інші скрипти можуть звернутися до даних без додаткових імпортів.
window.TZOLKIN_GLYPHS = TZOLKIN_GLYPHS;
window.TZOLKIN_ORDER = TZOLKIN_ORDER;

// Основний модуль, що керує інтерфейсом, багатомовністю та життєвим циклом сцен.
// Коментарі максимально детальні українською мовою, аби навіть новачок зрозумів кожен крок.

(() => {
  "use strict";

  if (!window.CONFIG) {
    console.error("CONFIG не знайдено. Переконайтесь, що config.js підключено перед main.js.");
    return;
  }

  const CONFIG = window.CONFIG;

  // --- 1. Збір посилань на DOM-елементи ---
  const canvas = document.getElementById("scene");
  // Просимо контекст одразу з підтримкою прозорості, аби фон задавався лише через CSS.
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) {
    console.error("Canvas 2D не підтримується в цьому браузері.");
    return;
  }

  const controlsSection = document.querySelector(".controls");
  const pageHeader = document.querySelector(".header");
  const dateInput = document.getElementById("dateInput");
  const genderSelect = document.getElementById("gender");
  const initialGenderTheme = initGenderTheme(genderSelect ? genderSelect.value : "unspecified");
  const btnRun = document.getElementById("btnRun");
  const btnHelp = document.getElementById("btnHelp");
  const langSelect = document.getElementById("langSelect");
  const sceneSelect = document.getElementById("sceneSelect");

  const canvasWrapper = document.getElementById("canvas-wrapper");
  const canvasPlaceholder = document.getElementById("canvas-placeholder");
  const footer = document.querySelector(".footer");
  const patternArea = document.querySelector(".pattern-area");
  const canvasToggle = document.getElementById("canvas-toggle");
  const canvasToggleLabel = document.getElementById("canvas-toggle-label");
  const canvasOverlay = document.getElementById("canvas-overlay");
  // Зберігаємо посилання на секцію з канвою, щоб точніше вимірювати доступну ширину в макеті.
  const auraVisualSection = document.getElementById("aura-visual");

  const descRoot = document.getElementById("aura-desc");
  const descSummary = descRoot?.querySelector('[data-role="desc-summary"]');
  const descMeta = descRoot?.querySelector('[data-role="desc-meta"]');
  const descBody = descRoot?.querySelector('[data-role="desc-body"]');

  const modal = document.getElementById("info-modal");
  const modalOverlay = document.getElementById("modal-overlay");
  const modalClose = document.getElementById("modal-close");

  // Зберігаємо посилання на обгортку навколо фолбек-селектів, щоб можна було повністю прибрати її з потоку верстки.
  const nativeDateControls = document.getElementById("native-date-controls");
  const fallbackInputsContainer = document.getElementById("fallback-inputs");
  const fallbackDay = document.getElementById("daySelect");
  const fallbackMonth = document.getElementById("monthSelect");
  const fallbackYear = document.getElementById("yearSelect");

  // --- 2. Дані сцен ---
  const scenes = {
    lissajous: window.lissajousScene,
    rune: window.runeScene,
    maya: window.mayaScene,
  };

  const USER_INPUT_STORAGE_KEY = "aura_user_input";

  // --- 3. Глобальний стан ---
  const state = {
    isRunning: false,
    isPaused: false,
    lastFrameTime: 0,
    animationScheduled: false,
    cssWidth: 0,
    cssHeight: 0,
    effectiveDpr: 1,
    designScale: 1,
    designOffsetX: 0,
    designOffsetY: 0,
    activeSceneKey: "",
    sceneInstance: null,
    runStartedAt: 0,
    lang: CONFIG.i18n.default,
    usingFallback: false,
    currentSeed: "",
    isCanvasExpanded: false,
    originalBodyOverflow: undefined,
    currentDob: null,
    currentGlyphId: null,
    currentToneId: null,
    descriptionRequestId: 0,
    descriptionSectionsState: Object.create(null),
    currentDescription: null,
  };

  const performanceTracker = { samples: [] };
  const pauseReasons = new Set();

  const frameInterval = 1000 / CONFIG.global.TARGET_FPS;
  const scenesDesignWidth = CONFIG.global.DESIGN_WIDTH;
  const scenesDesignHeight = CONFIG.global.DESIGN_HEIGHT;

  preloadDictionaries().catch((error) => {
    console.warn("Не вдалося попередньо завантажити словники опису:", error);
  });

  const DEFAULT_DESCRIPTION_BLOCK_ORDER = [
    "intro",
    "glyph_core",
    "tone_core",
    "synergy",
    "advice",
    "shadow",
    "conclusion",
  ];

  const DESCRIPTION_LABELS = {
    intro: { ua: "Вступ", en: "Intro" },
    glyph_core: { ua: "Сутність гліфа", en: "Glyph core" },
    tone_core: { ua: "Сутність тону", en: "Tone core" },
    synergy: { ua: "Синергія", en: "Synergy" },
    advice: { ua: "Поради", en: "Advice" },
    shadow: { ua: "Тінь", en: "Shadow" },
    conclusion: { ua: "Заключне", en: "Conclusion" },
  };

  const SIGN_ID_MAP = [
    "imix",
    "ik",
    "akbal",
    "kan",
    "chikchan",
    "kimi",
    "manik",
    "lamat",
    "muluk",
    "ok",
    "chuwen",
    "eb",
    "ben",
    "ix",
    "men",
    "kib",
    "kaban",
    "etznab",
    "kawak",
    "ahau",
  ];

  // --- 4. Допоміжні функції ---

  /** Форматуємо об'єкт Date у рядок YYYY-MM-DD без згадки про час. */
  function formatDateYYYYMMDD(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  /** Повертає рядок сьогоднішньої дати у форматі YYYY-MM-DD. */
  function getTodayIso() {
    return formatDateYYYYMMDD(new Date());
  }

  /** Рахує кількість днів у конкретному місяці певного року. */
  function getDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  /** Додає провідний нуль до чисел (наприклад, 7 → "07"). */
  function pad(value) {
    return String(value).padStart(2, "0");
  }

  /** Перевіряє, чи підтримує браузер певний тип input (наприклад, date). */
  function isInputTypeSupported(type) {
    const input = document.createElement("input");
    input.setAttribute("type", type);
    return input.type === type;
  }

  function getStored(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function setStored(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      // Ігноруємо помилки localStorage (наприклад, у приватному режимі).
    }
  }

  /** Показуємо підказку над канвою, коли генерація ще не запускалась. */
  function showCanvasPlaceholder() {
    if (!canvasPlaceholder) {
      return;
    }
    canvasPlaceholder.classList.remove("hidden");
  }

  /** Ховаємо плейсхолдер, щойно користувач запускає побудову орнаменту. */
  function hideCanvasPlaceholder() {
    if (!canvasPlaceholder) {
      return;
    }
    canvasPlaceholder.classList.add("hidden");
  }

  function getSelectedGender() {
    // Акуратно читаємо значення вибору статі. Якщо елемента немає або значення невідоме, повертаємо "unspecified".
    if (!genderSelect) {
      const auraRoot = document.getElementById("aura");
      const rootGender = auraRoot?.getAttribute("data-gender");
      return rootGender === "male" || rootGender === "female" ? rootGender : "unspecified";
    }
    const value = genderSelect.value;
    if (value === "female" || value === "male") {
      return value;
    }
    if (value === "unspecified") {
      return "unspecified";
    }
    const auraRoot = document.getElementById("aura");
    const rootGender = auraRoot?.getAttribute("data-gender");
    if (rootGender === "female" || rootGender === "male") {
      return rootGender;
    }
    return "unspecified";
  }

  /**
   * Для текстового опису потрібне чітке двійкове значення статі. Якщо користувач не вибрав стать, беремо жіночу як базову.
   */
  function getAppliedGenderForDescription() {
    const auraRoot = document.getElementById("aura");
    const attr = auraRoot?.getAttribute("data-gender");
    if (attr === "male") {
      return "male";
    }
    if (attr === "female") {
      return "female";
    }
    return "female";
  }

  /**
   * Перетворюємо номер знаку (1..20) на snake_case ідентифікатор для словника описів.
   */
  function glyphIdFromSignIndex(signIndex) {
    const numeric = Number(signIndex);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    const normalized = Math.trunc(numeric) - 1;
    if (normalized < 0 || normalized >= SIGN_ID_MAP.length) {
      return null;
    }
    return SIGN_ID_MAP[normalized];
  }

  /**
   * Обчислюємо ідентифікатори гліфа та тону на основі чистої дати народження.
   */
  function computeTzolkinFromDob(dob) {
    if (!(dob instanceof Date) || Number.isNaN(dob.getTime())) {
      return null;
    }
    if (typeof window.tzolkinFromDate !== "function") {
      return null;
    }
    try {
      const data = window.tzolkinFromDate(dob);
      if (!data) {
        return null;
      }
      const glyphId = glyphIdFromSignIndex(data.signIndex);
      if (!glyphId) {
        return null;
      }
      return {
        glyphId,
        toneId: String(data.tone || ""),
      };
    } catch (error) {
      console.error("Не вдалося обчислити показники Цолькін для текстового опису:", error);
      return null;
    }
  }

  /**
   * Відмалювуємо базове повідомлення, коли опис ще недоступний.
   */
  function renderDescriptionPlaceholder() {
    if (!descRoot || !descBody || !descSummary || !descMeta) {
      return;
    }
    descSummary.textContent = "Оберіть дату народження, щоб побачити інтерпретацію.";
    descMeta.innerHTML = "";
    const chip = document.createElement("span");
    chip.className = "aura-desc__tag";
    chip.textContent = "Очікування даних";
    descMeta.append(chip);
    descBody.innerHTML = "";
    const paragraph = document.createElement("p");
    paragraph.className = "aura-desc__placeholder";
    paragraph.textContent = "Після запуску генерації тут з'явиться докладний опис комбінації гліфа та тону.";
    descBody.append(paragraph);
    state.currentDescription = null;
  }

  /**
   * Показуємо коротке повідомлення про те, що зараз складаємо текст.
   */
  function renderDescriptionLoading() {
    if (!descRoot || !descBody || !descSummary || !descMeta) {
      return;
    }
    descSummary.textContent = "Готуємо опис…";
    descMeta.innerHTML = "";
    const chip = document.createElement("span");
    chip.className = "aura-desc__tag";
    chip.textContent = "Завантаження";
    descMeta.append(chip);
    descBody.innerHTML = "";
    const paragraph = document.createElement("p");
    paragraph.className = "aura-desc__placeholder";
    paragraph.textContent = "Завантажуємо словники та вибудовуємо фрази зі словникових блоків.";
    descBody.append(paragraph);
  }

  /**
   * Формуємо та вставляємо структуровані секції опису відповідно до правил.
   */
  function renderDescription(description) {
    if (!descRoot || !descBody || !descSummary || !descMeta) {
      return;
    }
    if (!description) {
      renderDescriptionPlaceholder();
      return;
    }

    descSummary.textContent = description.metaDescription || "Опис комбінації готується.";
    descMeta.innerHTML = "";

    const titleChip = document.createElement("span");
    titleChip.className = "aura-desc__tag";
    titleChip.textContent = description.title || "Опис";
    descMeta.append(titleChip);

    if (Array.isArray(description.keywords)) {
      description.keywords.forEach((keyword) => {
        if (!keyword) return;
        const keywordChip = document.createElement("span");
        keywordChip.className = "aura-desc__tag";
        keywordChip.textContent = keyword;
        descMeta.append(keywordChip);
      });
    }

    descBody.innerHTML = "";
    const isDesktopView = window.matchMedia("(min-width: 1024px)").matches;

    // Формуємо робочий порядок блоків: спочатку беремо послідовність із бекенду, а потім додаємо дефолт, щоб нічого не пропустити.
    const combinedOrder = Array.isArray(description.order)
      ? [...description.order]
      : [];
    const blockOrder = [];
    const fallbackOrder = DEFAULT_DESCRIPTION_BLOCK_ORDER;
    [...combinedOrder, ...fallbackOrder].forEach((key) => {
      if (key === "title") {
        return;
      }
      if (!DESCRIPTION_LABELS[key]) {
        console.warn("Невідомий блок опису пропущено:", key);
        return;
      }
      if (!blockOrder.includes(key)) {
        blockOrder.push(key);
      }
    });

    blockOrder.forEach((blockKey) => {
      const block = description.blocks?.[blockKey];
      const section = document.createElement("details");
      section.className = "aura-desc__section";
      section.dataset.block = blockKey;

      const previousState = state.descriptionSectionsState?.[blockKey];
      const shouldOpen = typeof previousState === "boolean" ? previousState : isDesktopView || blockKey === "intro";
      section.open = shouldOpen;
      section.addEventListener("toggle", () => {
        state.descriptionSectionsState[blockKey] = section.open;
      });

      const summary = document.createElement("summary");
      const labels = DESCRIPTION_LABELS[blockKey] || { ua: blockKey, en: blockKey };
      const labelsWrapper = document.createElement("span");
      labelsWrapper.className = "aura-desc__summary-labels";
      const labelUa = document.createElement("span");
      labelUa.textContent = labels.ua;
      const labelEn = document.createElement("span");
      labelEn.className = "aura-desc__label-en";
      labelEn.textContent = labels.en;
      labelsWrapper.append(labelUa, labelEn);
      summary.append(labelsWrapper);
      section.append(summary);

      const content = document.createElement("div");
      content.className = "aura-desc__content";
      const paragraphs = Array.isArray(block?.paragraphs) ? block.paragraphs : [];
      const listItems = Array.isArray(block?.list) ? block.list : [];

      if (paragraphs.length === 0 && listItems.length === 0) {
        const placeholder = document.createElement("p");
        placeholder.className = "aura-desc__placeholder";
        placeholder.textContent = "Матеріали для цього розділу ще готуються.";
        content.append(placeholder);
      } else {
        paragraphs.forEach((text) => {
          if (!text) return;
          const p = document.createElement("p");
          p.textContent = text;
          content.append(p);
        });
        if (listItems.length > 0) {
          const list = document.createElement("ul");
          listItems.forEach((item) => {
            if (!item) return;
            const li = document.createElement("li");
            li.textContent = item;
            list.append(li);
          });
          content.append(list);
        }
      }

      section.append(content);
      descBody.append(section);
    });

    state.currentDescription = description;
  }

  /**
   * Відправляємо запит до генератора опису та враховуємо асинхронність, щоб не затирати оновлення користувача.
   */
  async function requestDescriptionUpdate({ glyphId, toneId } = {}) {
    if (!descRoot) {
      return;
    }

    const effectiveGlyphId = glyphId || state.currentGlyphId;
    const effectiveToneId = toneId || state.currentToneId;

    if (!effectiveGlyphId || !effectiveToneId) {
      renderDescriptionPlaceholder();
      return;
    }

    state.descriptionRequestId += 1;
    const requestId = state.descriptionRequestId;
    renderDescriptionLoading();

    try {
      const description = await generateDescription({
        glyphId: effectiveGlyphId,
        toneId: effectiveToneId,
        gender: getAppliedGenderForDescription(),
        lang: state.lang || CONFIG.i18n.default,
      });
      if (requestId !== state.descriptionRequestId) {
        return;
      }
      renderDescription(description);
    } catch (error) {
      console.error("Не вдалося згенерувати текстовий опис Цолькін:", error);
      if (requestId === state.descriptionRequestId) {
        renderDescriptionPlaceholder();
      }
    }
  }

  /**
   * Оновлюємо опис, коли змінилися мова, стать або обрана дата.
   */
  function refreshDescriptionPanel({ forceRegenerate = false } = {}) {
    if (!descRoot) {
      return;
    }
    if (!state.currentGlyphId || !state.currentToneId) {
      if (forceRegenerate) {
        renderDescriptionPlaceholder();
      }
      return;
    }
    if (forceRegenerate) {
      state.descriptionRequestId += 1;
    }
    requestDescriptionUpdate({});
  }

  function readStoredUserInput() {
    // Прагнемо безпечно розпарсити попередньо збережені дані користувача.
    const raw = getStored(USER_INPUT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch (error) {
      // Якщо JSON зіпсований, просто ігноруємо його, аби не ламати застосунок.
    }
    return null;
  }

  function persistUserInput(dob, gender) {
    // Зберігаємо дату народження та стать у localStorage, щоб їх можна було відновити під час наступного візиту.
    const userInput = { dob, gender };
    try {
      window.localStorage.setItem(USER_INPUT_STORAGE_KEY, JSON.stringify(userInput));
    } catch (error) {
      // У деяких браузерах (режим інкогніто) може не бути доступу до localStorage — у такому разі мовчки пропускаємо запис.
    }
  }

  function hydrateGenderFromStorage() {
    // Під час завантаження сторінки намагаємося відновити попередньо обрану стать.
    const allowedValues = ["unspecified", "female", "male"];
    const stored = readStoredUserInput();
    let genderToApply = initialGenderTheme;
    if (stored && typeof stored.gender === "string" && allowedValues.includes(stored.gender)) {
      genderToApply = stored.gender;
    }
    const applied = setGenderTheme(genderToApply);
    if (genderSelect) {
      genderSelect.value = applied;
    }
  }

  function detectInitialLang() {
    const saved = getStored("lang");
    if (saved && CONFIG.i18n.dict[saved]) {
      return saved;
    }
    const navigatorLangs = Array.isArray(navigator.languages) ? navigator.languages : [];
    for (let i = 0; i < navigatorLangs.length; i += 1) {
      const code = navigatorLangs[i].slice(0, 2).toLowerCase();
      if (CONFIG.i18n.dict[code]) {
        return code;
      }
      if (code === "uk" && CONFIG.i18n.dict.ua) {
        return "ua";
      }
    }
    return CONFIG.i18n.default;
  }

  function detectInitialScene() {
    const saved = getStored("scene");
    if (saved && scenes[saved]) {
      return saved;
    }
    return "lissajous";
  }

  function resetPerformanceTracker() {
    performanceTracker.samples = [];
  }

  function addPauseReason(reason) {
    pauseReasons.add(reason);
    updatePauseState();
  }

  function removePauseReason(reason) {
    if (pauseReasons.delete(reason)) {
      updatePauseState();
    }
  }

  function updatePauseState() {
    const shouldPause = pauseReasons.size > 0;
    if (shouldPause && !state.isPaused) {
      state.isPaused = true;
    } else if (!shouldPause && state.isPaused) {
      state.isPaused = false;
      state.lastFrameTime = performance.now();
    }
  }

  function renderFallbackMonths(dict) {
    if (!state.usingFallback) return;
    if (!fallbackMonth || !fallbackYear || !fallbackDay) return;
    const currentValue = fallbackMonth.value;
    fallbackMonth.innerHTML = "";
    dict.monthsShort.forEach((label, index) => {
      const option = document.createElement("option");
      option.value = pad(index + 1);
      option.textContent = label;
      fallbackMonth.append(option);
    });
    if (currentValue) {
      fallbackMonth.value = currentValue;
    }
    syncFallbackDayOptions();
  }

  function applyI18n(lang) {
    const dict = CONFIG.i18n.dict[lang] || CONFIG.i18n.dict[CONFIG.i18n.default];
    state.lang = lang;

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n;
      if (!key || !(key in dict)) return;
      const attr = el.dataset.i18nAttr;
      if (attr) {
        el.setAttribute(attr, dict[key]);
        return;
      }
      el.textContent = dict[key];
    });

    document.querySelectorAll("[data-i18n-html]").forEach((el) => {
      const key = el.dataset.i18nHtml;
      if (!key || !(key in dict)) return;
      el.innerHTML = dict[key];
    });

    const htmlLang = lang === "ua" ? "uk" : lang;
    document.documentElement.lang = htmlLang;
    document.title = dict.title;
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute("content", dict.description);
    }

    if (state.usingFallback) {
      renderFallbackMonths(dict);
    }

    updateCanvasToggleLabel();
    updateLanguageControl();
    updateSceneControl();
    updateCanvasSize();
    updateLaunchState();
    refreshDescriptionPanel({ forceRegenerate: true });
  }

  function updateCanvasToggleLabel() {
    // Підтримуємо текст кнопки розгортання у відповідності до мови та стану.
    if (!canvasToggleLabel && !canvasToggle) {
      return;
    }
    const dict = CONFIG.i18n.dict[state.lang] || CONFIG.i18n.dict[CONFIG.i18n.default];
    const labelKey = state.isCanvasExpanded ? "canvasCollapse" : "canvasExpand";
    if (canvasToggleLabel) {
      canvasToggleLabel.textContent = dict[labelKey] || "";
    }
    if (canvasToggle) {
      canvasToggle.setAttribute("title", dict[labelKey] || "");
    }
  }

  function updateSceneControl() {
    // Підтримуємо випадаючий список типу сцени в актуальному стані.
    if (sceneSelect) {
      sceneSelect.value = state.activeSceneKey;
    }
  }

  function updateLanguageControl() {
    if (langSelect) {
      langSelect.value = state.lang;
    }
  }

  function setLanguage(lang) {
    if (!CONFIG.i18n.dict[lang]) {
      lang = CONFIG.i18n.default;
    }
    setStored("lang", lang);
    applyI18n(lang);
  }

  function setActiveScene(sceneKey, { forceRestart = false } = {}) {
    if (!scenes[sceneKey]) return;
    state.activeSceneKey = sceneKey;
    state.sceneInstance = scenes[sceneKey];
    window.activeScene = state.sceneInstance;
    setStored("scene", sceneKey);
    updateSceneControl();

    if (state.sceneInstance) {
      if (typeof state.sceneInstance.relayout === "function") {
        state.sceneInstance.relayout(scenesDesignWidth, scenesDesignHeight);
      } else if (typeof state.sceneInstance.resize === "function") {
        state.sceneInstance.resize(scenesDesignWidth, scenesDesignHeight);
      }
    }

    if (state.isRunning || forceRestart) {
      restartActiveScene({ force: true });
    } else if (state.sceneInstance && typeof state.sceneInstance.resetModeLock === "function") {
      state.sceneInstance.resetModeLock();
    }
  }

  function getTodayParts() {
    const today = getTodayIso();
    const [year, month, day] = today.split("-");
    return { year, month, day };
  }

  // --- 5. Налаштування дати ---
  const dateMax = getTodayIso();
  if (dateInput) {
    dateInput.min = CONFIG.global.DATE_MIN;
    dateInput.max = dateMax;
  }

  const supportsNativeDate = isInputTypeSupported("date");
  state.usingFallback = !supportsNativeDate;

  if (dateInput) {
    dateInput.hidden = state.usingFallback;
    dateInput.disabled = state.usingFallback;
  }
  if (nativeDateControls) {
    nativeDateControls.hidden = !state.usingFallback;
  }
  if (fallbackInputsContainer) {
    // Ховаємо або показуємо обгортку з альтернативними селектами, щоб вона не впливала на висоту сітки.
    fallbackInputsContainer.hidden = !state.usingFallback;
  }

  function initFallbackInputs(dict) {
    if (!fallbackYear || !fallbackMonth || !fallbackDay) return;
    const { year, month, day } = getTodayParts();
    const minYear = Number(CONFIG.global.DATE_MIN.slice(0, 4));
    const currentYear = Number(year);

    fallbackYear.innerHTML = "";
    for (let y = currentYear; y >= minYear; y -= 1) {
      const option = document.createElement("option");
      option.value = String(y);
      option.textContent = String(y);
      fallbackYear.append(option);
    }

    renderFallbackMonths(dict);

    fallbackYear.value = year;
    fallbackMonth.value = month;
    syncFallbackDayOptions();
    fallbackDay.value = day;

    const fallbackElements = [
      fallbackYear,
      fallbackMonth,
      fallbackDay,
    ];

    fallbackElements.forEach((el) => {
      el.addEventListener("focus", () => addPauseReason("fallback-input"));
      el.addEventListener("blur", () => removePauseReason("fallback-input"));
      el.addEventListener("change", () => {
        if (el === fallbackYear || el === fallbackMonth) {
          syncFallbackDayOptions();
        }
        updateLaunchState();
        writeStateToUrl(readDateFromUI());
        if (state.isRunning) {
          restartActiveScene();
        }
      });
    });
  }

  function syncFallbackDayOptions() {
    if (!state.usingFallback) return;
    if (!fallbackYear || !fallbackMonth || !fallbackDay) return;
    const yearValue = Number(fallbackYear.value);
    const monthValue = Number(fallbackMonth.value);
    if (!yearValue || !monthValue) return;

    const daysInMonth = getDaysInMonth(yearValue, monthValue);
    const currentDay = Number(fallbackDay.value) || 1;

    fallbackDay.innerHTML = "";
    for (let d = 1; d <= daysInMonth; d += 1) {
      const option = document.createElement("option");
      option.value = pad(d);
      option.textContent = String(d);
      fallbackDay.append(option);
    }

    fallbackDay.value = pad(Math.min(currentDay, daysInMonth));
  }

  if (state.usingFallback) {
    initFallbackInputs(CONFIG.i18n.dict[state.lang]);
  } else if (dateInput) {
    dateInput.addEventListener("focus", () => addPauseReason("native-input"));
    dateInput.addEventListener("blur", () => removePauseReason("native-input"));
    dateInput.addEventListener("input", () => {
      updateLaunchState();
      writeStateToUrl(readDateFromUI());
      if (state.isRunning) restartActiveScene();
    });
  }

  // --- 6. Мультимовність ---
  const initialLang = detectInitialLang();
  setLanguage(initialLang);

  if (langSelect) {
    langSelect.addEventListener("change", () => {
      const newLang = langSelect.value;
      if (newLang && newLang !== state.lang) {
        setLanguage(newLang);
      }
    });
  }

  // --- 7. Вибір сцени ---
  const initialSceneKey = detectInitialScene();
  setActiveScene(initialSceneKey);

  if (sceneSelect) {
    sceneSelect.addEventListener("change", () => {
      const selectedScene = sceneSelect.value;
      if (selectedScene && selectedScene !== state.activeSceneKey) {
        setActiveScene(selectedScene, { forceRestart: state.isRunning });
      }
    });
  }

  // --- 7a. Кнопка розгортання канви ---
  if (canvasToggle) {
    canvasToggle.addEventListener("click", () => {
      setCanvasExpanded(!state.isCanvasExpanded);
    });
  }

  if (canvasOverlay) {
    canvasOverlay.addEventListener("click", () => {
      setCanvasExpanded(false);
    });
  }

  // --- 8. Робота з датами та запуском ---
  function readDateFromUI() {
    if (!state.usingFallback && dateInput && dateInput.value) {
      return dateInput.value;
    }

    if (state.usingFallback && fallbackYear && fallbackMonth && fallbackDay) {
      const year = fallbackYear.value;
      const monthRaw = fallbackMonth.value;
      const dayRaw = fallbackDay.value;
      if (year && monthRaw && dayRaw) {
        const normalizedYear = year.padStart(4, "0");
        const normalizedMonth = String(parseInt(monthRaw, 10)).padStart(2, "0");
        const normalizedDay = String(parseInt(dayRaw, 10)).padStart(2, "0");
        return `${normalizedYear}-${normalizedMonth}-${normalizedDay}`;
      }
    }

    return formatDateYYYYMMDD(new Date());
  }

  function isDateInRange(dateStr) {
    return dateStr >= CONFIG.global.DATE_MIN && dateStr <= dateMax;
  }

  function buildSeedFromDateStr(dateStr) {
    return dateStr;
  }

  /**
   * Формуємо контекст для сцени: нормалізовану дату народження (UTC) та вибрану стать.
   * @param {string} seedStr - рядок виду YYYY-MM-DD.
   * @returns {{ dob: Date | null, gender: string }}
   */
  function buildSceneContext(seedStr) {
    const gender = getSelectedGender();
    if (!seedStr || typeof seedStr !== "string") {
      return { dob: null, gender };
    }

    const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(seedStr);
    if (!match) {
      return { dob: null, gender };
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const dob = new Date(Date.UTC(year, month - 1, day));
    if (Number.isNaN(dob.getTime())) {
      return { dob: null, gender };
    }

    return { dob, gender };
  }

  function readStateFromUrl() {
    const params = new URLSearchParams(location.search);
    const date = params.get("date");
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { date };
    }
    return null;
  }

  function writeStateToUrl(dateStr) {
    const params = new URLSearchParams();
    params.set("date", dateStr);
    const newUrl = `${location.pathname}?${params.toString()}${location.hash}`;
    history.replaceState(null, "", newUrl);
  }

  function hydrateUIFromUrlOrToday() {
    const stateFromUrl = readStateFromUrl();
    let dateStr = stateFromUrl?.date ?? formatDateYYYYMMDD(new Date());
    if (!isDateInRange(dateStr)) {
      dateStr = formatDateYYYYMMDD(new Date());
    }

    if (!state.usingFallback && dateInput) {
      dateInput.value = dateStr;
    } else if (state.usingFallback && fallbackYear && fallbackMonth && fallbackDay) {
      const [year, month, day] = dateStr.split("-");
      if (year && month && day) {
        fallbackYear.value = year;
        fallbackMonth.value = month;
        syncFallbackDayOptions();
        fallbackDay.value = day;
      }
    }
  }

  function updateLaunchState() {
    let dateValue = "";
    if (state.usingFallback) {
      if (fallbackYear && fallbackMonth && fallbackDay) {
        const year = fallbackYear.value;
        const month = fallbackMonth.value;
        const day = fallbackDay.value;
        if (year && month && day) {
          dateValue = `${year}-${month}-${day}`;
        }
      }
    } else if (dateInput) {
      dateValue = dateInput.value;
    }

    if (btnRun) {
      btnRun.disabled = !(dateValue && isDateInRange(dateValue));
    }
  }

  /**
   * Плавно прокручуємо сторінку до початку секції з канвою після запуску генерації.
   * Робимо подвійний requestAnimationFrame, щоб дочекатися оновлення DOM і коректних розмірів.
   */
  function scrollCanvasIntoView() {
    const targetSection = auraVisualSection || canvasWrapper;
    if (!targetSection) {
      return;
    }

    const rect = targetSection.getBoundingClientRect();
    const offset = window.pageYOffset + rect.top;

    window.scrollTo({ top: offset, behavior: "smooth" });
  }

  function runWithCurrentDate() {
    const dateStr = readDateFromUI();
    if (!dateStr) return;
    const gender = getSelectedGender();
    const appliedGender = setGenderTheme(gender);
    // Записуємо введені користувачем дані, щоб легко повернутися до них у майбутньому.
    persistUserInput(dateStr, appliedGender);
    hideCanvasPlaceholder();
    const seed = buildSeedFromDateStr(dateStr);
    writeStateToUrl(dateStr);
    if (window.activeScene && typeof window.activeScene.setSeed === "function") {
      window.activeScene.setSeed(seed);
    }
    if (typeof window.startRender === "function") {
      window.startRender();
    }
    initializeScene(seed);
    state.isRunning = true;
    startAnimation();

    if (typeof window.requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        requestAnimationFrame(scrollCanvasIntoView);
      });
    } else {
      scrollCanvasIntoView();
    }
  }

  showCanvasPlaceholder();
  renderDescriptionPlaceholder();
  hydrateUIFromUrlOrToday();
  hydrateGenderFromStorage();
  if (genderSelect) {
    genderSelect.addEventListener("change", () => {
      const dateStr = readDateFromUI();
      const gender = getSelectedGender();
      const appliedGender = setGenderTheme(gender);
      persistUserInput(dateStr, appliedGender);
      if (state.sceneInstance && typeof state.sceneInstance.updateTheme === "function") {
        state.sceneInstance.updateTheme({ gender: appliedGender });
      } else if (state.sceneInstance && typeof state.sceneInstance.setGender === "function") {
        state.sceneInstance.setGender(appliedGender);
      }
      refreshDescriptionPanel({ forceRegenerate: true });
    });
  }
  updateLaunchState();
  writeStateToUrl(readDateFromUI());

  // --- 9. Анімаційний цикл ---
  function startAnimation() {
    if (!state.animationScheduled) {
      state.animationScheduled = true;
      state.lastFrameTime = performance.now();
      requestAnimationFrame(animationLoop);
    } else {
      state.lastFrameTime = performance.now();
    }
  }

  function animationLoop(now) {
    if (!state.isRunning) {
      state.animationScheduled = false;
      return;
    }

    requestAnimationFrame(animationLoop);

    if (state.isPaused) {
      state.lastFrameTime = now;
      return;
    }

    const elapsed = now - state.lastFrameTime;
    if (elapsed < frameInterval) {
      return;
    }

    const dt = elapsed / 1000;
    state.lastFrameTime = now - (elapsed % frameInterval);

    ctx.setTransform(state.effectiveDpr, 0, 0, state.effectiveDpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, state.cssWidth, state.cssHeight);

    ctx.save();
    ctx.setTransform(
      state.designScale * state.effectiveDpr,
      0,
      0,
      state.designScale * state.effectiveDpr,
      state.designOffsetX * state.effectiveDpr,
      state.designOffsetY * state.effectiveDpr,
    );

    if (state.sceneInstance) {
      state.sceneInstance.update(dt, now);
      state.sceneInstance.draw(ctx, now);
    }

    ctx.restore();

    recordFrame(now, dt);
    evaluatePerformance(now);
  }

  function recordFrame(now, dt) {
    if (dt <= 0) return;
    const fps = 1 / dt;
    performanceTracker.samples.push({ time: now, fps });
    const windowMs = CONFIG.global.FPS_FALLBACK_WINDOW_MS;
    while (performanceTracker.samples.length > 0 && now - performanceTracker.samples[0].time > windowMs) {
      performanceTracker.samples.shift();
    }
  }

  function evaluatePerformance(now) {
    if (!state.sceneInstance || typeof state.sceneInstance.force2dMode !== "function") return;
    if (state.sceneInstance.isModeLockedTo2d && state.sceneInstance.isModeLockedTo2d()) return;
    if (now - state.runStartedAt < CONFIG.global.MIN_SECONDS_BEFORE_CHECK * 1000) return;
    if (performanceTracker.samples.length === 0) return;

    let sum = 0;
    for (let i = 0; i < performanceTracker.samples.length; i += 1) {
      sum += performanceTracker.samples[i].fps;
    }
    const avgFps = sum / performanceTracker.samples.length;
    if (avgFps < CONFIG.global.FPS_FALLBACK_THRESHOLD) {
      state.sceneInstance.force2dMode();
    }
  }

  // --- 9a. Керування розгортанням області канви ---
  function setCanvasExpanded(expanded) {
    // Перемикаємо режим, не зупиняючи анімацію та не перериваючи цикли рендеру.
    if (!canvasWrapper) {
      return;
    }

    state.isCanvasExpanded = expanded;
    canvasWrapper.classList.toggle("canvas-container--expanded", expanded);

    if (canvasOverlay) {
      if (expanded) {
        canvasOverlay.hidden = false;
        canvasOverlay.classList.add("is-active");
        canvasOverlay.setAttribute("aria-hidden", "false");
      } else {
        canvasOverlay.classList.remove("is-active");
        canvasOverlay.hidden = true;
        canvasOverlay.setAttribute("aria-hidden", "true");
      }
    }

    if (canvasToggle) {
      canvasToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    }

    updateCanvasToggleLabel();

    if (document.body) {
      if (expanded) {
        state.originalBodyOverflow = document.body.style.overflow || "";
        document.body.style.overflow = "hidden";
      } else if (state.originalBodyOverflow !== undefined) {
        document.body.style.overflow = state.originalBodyOverflow;
        state.originalBodyOverflow = undefined;
      }
    }

    updateCanvasSize();
  }

  // --- 10. Робота з розмірами канви ---
  function updateCanvasSize() {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let containerWidth = viewportWidth;
    let availableHeight;

    if (state.isCanvasExpanded) {
      // Для розгорнутого режиму створюємо "вікно" з невеликими полями по краях.
      const marginX = Math.min(Math.max(viewportWidth * 0.05, 24), 72);
      const marginY = Math.min(Math.max(viewportHeight * 0.05, 24), 72);
      containerWidth = Math.max(viewportWidth - marginX * 2, 320);
      availableHeight = Math.max(viewportHeight - marginY * 2, 240);
    } else {
      // Обчислюємо сумарну висоту верхніх блоків (брендовий заголовок + панель керування).
      const headerHeight =
        (pageHeader ? pageHeader.offsetHeight : 0) + (controlsSection ? controlsSection.offsetHeight : 0);
      const footerHeight = footer ? footer.offsetHeight : 0;
      availableHeight = Math.max(viewportHeight - headerHeight - footerHeight, 200);

      // Вимірюємо ширину колонки з канвою, щоб опис завжди мав власне місце праворуч.
      let measuredWidth = 0;
      if (canvasWrapper) {
        const previousInlineWidth = canvasWrapper.style.width;
        canvasWrapper.style.width = "";
        const visualContainer = auraVisualSection || canvasWrapper.parentElement;
        if (visualContainer) {
          measuredWidth = visualContainer.clientWidth;
        }
        if (!measuredWidth && patternArea) {
          measuredWidth = patternArea.clientWidth;
        }
        canvasWrapper.style.width = previousInlineWidth;
      } else if (patternArea) {
        measuredWidth = patternArea.clientWidth;
      }

      if (!measuredWidth && patternArea) {
        const computed = window.getComputedStyle(patternArea);
        const paddingX = parseFloat(computed.paddingLeft || "0") + parseFloat(computed.paddingRight || "0");
        measuredWidth = viewportWidth - paddingX;
      }

      containerWidth = Math.max(measuredWidth || 0, 320);
    }

    if (canvasWrapper) {
      canvasWrapper.style.height = `${availableHeight}px`;
      if (state.isCanvasExpanded) {
        canvasWrapper.style.width = `${containerWidth}px`;
      } else {
        canvasWrapper.style.width = "100%";
      }
    }

    const effectiveDpr = Math.min(window.devicePixelRatio || 1, CONFIG.global.MAX_DEVICE_PIXEL_RATIO);
    canvas.width = Math.floor(containerWidth * effectiveDpr);
    canvas.height = Math.floor(availableHeight * effectiveDpr);
    canvas.style.width = `${containerWidth}px`;
    canvas.style.height = `${availableHeight}px`;
    canvas.style.marginTop = "0px";

    state.cssWidth = containerWidth;
    state.cssHeight = availableHeight;
    state.effectiveDpr = effectiveDpr;

    const scale = Math.min(containerWidth / scenesDesignWidth, availableHeight / scenesDesignHeight);
    const offsetX = (containerWidth - scenesDesignWidth * scale) / 2;
    const extraVerticalSpace = Math.max(availableHeight - scenesDesignHeight * scale, 0);
    // На мобільних екранах прибираємо надмірне центроване вирівнювання, щоб символ знаходився ближче до верхнього краю.
    const isNarrowViewport = viewportWidth <= 600;
    const mobileOffsetCap = 48; // У пікселях: обмеження на верхній відступ, щоби символ не «сповзав» надто низько.
    const centeredOffsetY = extraVerticalSpace / 2;
    const offsetY = isNarrowViewport ? Math.min(centeredOffsetY, mobileOffsetCap) : centeredOffsetY;

    state.designScale = scale;
    state.designOffsetX = offsetX;
    state.designOffsetY = offsetY;

    ctx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);

    if (state.sceneInstance) {
      if (typeof state.sceneInstance.relayout === "function") {
        state.sceneInstance.relayout(scenesDesignWidth, scenesDesignHeight);
      } else if (typeof state.sceneInstance.resize === "function") {
        state.sceneInstance.resize(scenesDesignWidth, scenesDesignHeight);
      }
    }
  }

  // Проста дросельна логіка, щоб не перераховувати розкладку сотні разів за секунду під час resize.
  const RESIZE_THROTTLE_MS = 130;
  let lastResizeCall = 0;
  let resizeTimeoutId = null;

  function handleThrottledResize() {
    // Чекаємо паузи між подіями resize, щоб не запускати перерахунок на кожний піксель руху вікна.
    const now = performance.now();
    const timeSinceLast = now - lastResizeCall;
    if (timeSinceLast >= RESIZE_THROTTLE_MS) {
      lastResizeCall = now;
      updateCanvasSize();
    } else {
      clearTimeout(resizeTimeoutId);
      resizeTimeoutId = setTimeout(() => {
        lastResizeCall = performance.now();
        updateCanvasSize();
      }, RESIZE_THROTTLE_MS - timeSinceLast);
    }
  }

  window.addEventListener("resize", handleThrottledResize);
  updateCanvasSize();

  // --- 11. Перезапуск сцени ---
  function initializeScene(seed) {
    if (!state.sceneInstance) return;
    hideCanvasPlaceholder();
    const seedInt = window.hashStringToInt32(seed);
    const prng = window.makePrng(seedInt);
    if (typeof state.sceneInstance.resetModeLock === "function") {
      state.sceneInstance.resetModeLock();
    }
    const context = buildSceneContext(seed);
    state.currentDob = context.dob instanceof Date && !Number.isNaN(context.dob?.getTime()) ? context.dob : null;
    const tzolkinData = computeTzolkinFromDob(state.currentDob);
    if (tzolkinData) {
      state.currentGlyphId = tzolkinData.glyphId;
      state.currentToneId = tzolkinData.toneId;
      requestDescriptionUpdate({ glyphId: tzolkinData.glyphId, toneId: tzolkinData.toneId });
    } else {
      state.currentGlyphId = null;
      state.currentToneId = null;
      renderDescriptionPlaceholder();
    }
    state.sceneInstance.init(seed, prng, context);
    if (typeof state.sceneInstance.relayout === "function") {
      state.sceneInstance.relayout(scenesDesignWidth, scenesDesignHeight);
    } else if (typeof state.sceneInstance.resize === "function") {
      state.sceneInstance.resize(scenesDesignWidth, scenesDesignHeight);
    }
    resetPerformanceTracker();
    state.currentSeed = seed;
    state.runStartedAt = performance.now();
    state.lastFrameTime = state.runStartedAt;
  }

  function restartActiveScene({ force = false } = {}) {
    const dateStr = readDateFromUI();
    const seed = buildSeedFromDateStr(dateStr);
    if (!force && seed === state.currentSeed) return;
    writeStateToUrl(dateStr);
    if (window.activeScene && typeof window.activeScene.setSeed === "function") {
      window.activeScene.setSeed(seed);
    }
    if (typeof window.startRender === "function") {
      window.startRender();
    }
    initializeScene(seed);
  }

  // --- 12. Обробник кнопки запуску ---
  if (btnRun) {
    btnRun.addEventListener("click", runWithCurrentDate);
  }

  // --- 13. Керування модальним вікном ---
  if (btnHelp) {
    btnHelp.addEventListener("click", () => {
      modal.hidden = false;
      addPauseReason("modal");
    });
  }

  modalClose.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", closeModal);

  function closeModal() {
    modal.hidden = true;
    removePauseReason("modal");
  }

  // --- 14. Системні події ---
  document.addEventListener("keydown", (event) => {
    // Додаємо гарячу клавішу Escape для швидкого згортання канви.
    if (event.key === "Escape" && state.isCanvasExpanded) {
      event.preventDefault();
      setCanvasExpanded(false);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      addPauseReason("tab-hidden");
    } else {
      removePauseReason("tab-hidden");
    }
  });

  updatePauseState();
})();
