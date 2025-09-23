import { TZOLKIN_GLYPHS, TZOLKIN_ORDER } from "./glyphs/index.js";

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
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    console.error("Canvas 2D не підтримується в цьому браузері.");
    return;
  }

  const topBar = document.querySelector(".topbar");
  const dateInput = document.getElementById("dateInput");
  const genderSelect = document.getElementById("gender");
  const btnRun = document.getElementById("btnRun");
  const btnHelp = document.getElementById("btnHelp");
  const langSelect = document.getElementById("langSelect");
  const sceneToggle = document.getElementById("scene-toggle");
  const sceneButtons = Array.from(sceneToggle.querySelectorAll("[data-scene]"));

  const modal = document.getElementById("info-modal");
  const modalOverlay = document.getElementById("modal-overlay");
  const modalClose = document.getElementById("modal-close");

  const fallbackInputsContainer = document.getElementById("fallback-inputs");
  const fallbackDay = document.getElementById("daySelect");
  const fallbackMonth = document.getElementById("monthSelect");
  const fallbackYear = document.getElementById("yearSelect");

  // --- 2. Дані сцен ---
  const scenes = {
    lissajous: window.lissajousScene,
    rune: window.runeScene,
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
  };

  const performanceTracker = { samples: [] };
  const pauseReasons = new Set();

  const frameInterval = 1000 / CONFIG.global.TARGET_FPS;
  const scenesDesignWidth = CONFIG.global.DESIGN_WIDTH;
  const scenesDesignHeight = CONFIG.global.DESIGN_HEIGHT;

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

  function getSelectedGender() {
    // Акуратно читаємо значення вибору статі. Якщо елемента немає або значення невідоме, повертаємо "unspecified".
    if (!genderSelect) {
      return "unspecified";
    }
    const value = genderSelect.value;
    if (value === "female" || value === "male") {
      return value;
    }
    return "unspecified";
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
    if (!genderSelect) {
      return;
    }
    const stored = readStoredUserInput();
    if (!stored || typeof stored.gender !== "string") {
      return;
    }
    const allowedValues = ["unspecified", "female", "male"];
    if (!allowedValues.includes(stored.gender)) {
      return;
    }
    genderSelect.value = stored.gender;
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

    updateLanguageControl();
    updateSceneButtons();
    updateCanvasSize();
    updateLaunchState();
  }

  function updateSceneButtons() {
    // Оновлюємо aria-pressed для кожної кнопки, щоб екранні читачі бачили активний стан.
    sceneButtons.forEach((button) => {
      const isActive = button.dataset.scene === state.activeSceneKey;
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
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
    updateSceneButtons();

    if (state.sceneInstance && typeof state.sceneInstance.resize === "function") {
      state.sceneInstance.resize(scenesDesignWidth, scenesDesignHeight);
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
  if (fallbackInputsContainer) {
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

  sceneButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const { scene: sceneKey } = button.dataset;
      if (sceneKey && sceneKey !== state.activeSceneKey) {
        setActiveScene(sceneKey, { forceRestart: state.isRunning });
      }
    });
  });

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

  function runWithCurrentDate() {
    const dateStr = readDateFromUI();
    if (!dateStr) return;
    const gender = getSelectedGender();
    // Записуємо введені користувачем дані, щоб легко повернутися до них у майбутньому.
    persistUserInput(dateStr, gender);
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
  }

  hydrateUIFromUrlOrToday();
  hydrateGenderFromStorage();
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
    ctx.fillStyle = CONFIG.global.CANVAS_BG;
    ctx.fillRect(0, 0, state.cssWidth, state.cssHeight);

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

  // --- 10. Робота з розмірами канви ---
  function updateCanvasSize() {
    // Якщо елемент шапки з якоїсь причини не знайдеться, вважаємо її висоту нульовою.
    const headerHeight = topBar ? topBar.offsetHeight : 0;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const availableHeight = Math.max(viewportHeight - headerHeight, 200);

    canvas.style.marginTop = `${headerHeight}px`;

    const effectiveDpr = Math.min(window.devicePixelRatio || 1, CONFIG.global.MAX_DEVICE_PIXEL_RATIO);
    canvas.width = Math.floor(viewportWidth * effectiveDpr);
    canvas.height = Math.floor(availableHeight * effectiveDpr);
    canvas.style.width = `${viewportWidth}px`;
    canvas.style.height = `${availableHeight}px`;

    state.cssWidth = viewportWidth;
    state.cssHeight = availableHeight;
    state.effectiveDpr = effectiveDpr;

    const scale = Math.min(viewportWidth / scenesDesignWidth, availableHeight / scenesDesignHeight);
    const offsetX = (viewportWidth - scenesDesignWidth * scale) / 2;
    const offsetY = (availableHeight - scenesDesignHeight * scale) / 2;

    state.designScale = scale;
    state.designOffsetX = offsetX;
    state.designOffsetY = offsetY;

    ctx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);

    if (state.sceneInstance && typeof state.sceneInstance.resize === "function") {
      state.sceneInstance.resize(scenesDesignWidth, scenesDesignHeight);
    }
  }

  window.addEventListener("resize", updateCanvasSize);
  updateCanvasSize();

  // --- 11. Перезапуск сцени ---
  function initializeScene(seed) {
    if (!state.sceneInstance) return;
    const seedInt = window.hashStringToInt32(seed);
    const prng = window.makePrng(seedInt);
    if (typeof state.sceneInstance.resetModeLock === "function") {
      state.sceneInstance.resetModeLock();
    }
    state.sceneInstance.init(seed, prng);
    state.sceneInstance.resize(scenesDesignWidth, scenesDesignHeight);
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
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      addPauseReason("tab-hidden");
    } else {
      removePauseReason("tab-hidden");
    }
  });

  updatePauseState();
})();
