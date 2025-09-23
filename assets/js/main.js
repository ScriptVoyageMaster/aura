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

  const topBar = document.querySelector(".top-bar");
  const dateInput = document.getElementById("birth-date");
  const timeInput = document.getElementById("birth-time");
  const launchButton = document.getElementById("launch");
  const infoButton = document.getElementById("info");
  const langToggle = document.getElementById("lang-toggle");
  const langButtons = langToggle
    ? Array.from(langToggle.querySelectorAll("[data-lang]"))
    : [];

  const modal = document.getElementById("info-modal");
  const modalOverlay = document.getElementById("modal-overlay");
  const modalClose = document.getElementById("modal-close");

  const nativeInputsContainer = document.getElementById("native-inputs");
  const fallbackInputsContainer = document.getElementById("fallback-inputs");
  const fallbackDay = document.getElementById("fallback-day");
  const fallbackMonth = document.getElementById("fallback-month");
  const fallbackYear = document.getElementById("fallback-year");
  const fallbackHour = document.getElementById("fallback-hour");
  const fallbackMinute = document.getElementById("fallback-minute");

  // --- 2. Єдина сцена MayaScene ---
  const mayaSceneInstance = window.mayaScene;
  if (!mayaSceneInstance) {
    console.error("MayaScene не знайдена. Переконайтесь, що MayaScene.js підключено перед main.js.");
    return;
  }

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
    sceneInstance: mayaSceneInstance,
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

  /** Повертає рядок сьогоднішньої дати у форматі YYYY-MM-DD. */
  function getTodayIso() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  /** Рахує кількість днів у конкретному місяці певного року. */
  function getDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  /** Додає провідний нуль до чисел (наприклад, 7 → "07"). */
  function pad(value) {
    return String(value).padStart(2, "0");
  }

  /** Перевіряє, чи підтримує браузер певний тип input (date/time). */
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

    updateLanguageButtons();
    updateCanvasSize();
    updateLaunchState();
  }

  function updateLanguageButtons() {
    langButtons.forEach((button) => {
      if (button.dataset.lang === state.lang) {
        button.classList.add("is-active");
      } else {
        button.classList.remove("is-active");
      }
    });
  }

  function setLanguage(lang) {
    if (!CONFIG.i18n.dict[lang]) {
      lang = CONFIG.i18n.default;
    }
    setStored("lang", lang);
    applyI18n(lang);
  }

  function getTodayParts() {
    const today = getTodayIso();
    const [year, month, day] = today.split("-");
    return { year, month, day };
  }

  // --- 5. Налаштування дат і часу ---
  const dateMax = getTodayIso();
  dateInput.min = CONFIG.global.DATE_MIN;
  dateInput.max = dateMax;

  if (!timeInput.value) {
    timeInput.value = CONFIG.global.DEFAULT_TIME;
  }

  const supportsNativeDate = isInputTypeSupported("date");
  const supportsNativeTime = isInputTypeSupported("time");
  state.usingFallback = !(supportsNativeDate && supportsNativeTime);

  nativeInputsContainer.hidden = state.usingFallback;
  fallbackInputsContainer.hidden = !state.usingFallback;

  function initFallbackInputs(dict) {
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

    fallbackHour.innerHTML = "";
    fallbackMinute.innerHTML = "";
    for (let h = 0; h < 24; h += 1) {
      const option = document.createElement("option");
      option.value = pad(h);
      option.textContent = pad(h);
      fallbackHour.append(option);
    }
    for (let m = 0; m < 60; m += 1) {
      const option = document.createElement("option");
      option.value = pad(m);
      option.textContent = pad(m);
      fallbackMinute.append(option);
    }

    fallbackYear.value = year;
    fallbackMonth.value = month;
    syncFallbackDayOptions();
    fallbackDay.value = day;

    const [defaultHour, defaultMinute] = CONFIG.global.DEFAULT_TIME.split(":");
    fallbackHour.value = defaultHour;
    fallbackMinute.value = defaultMinute;

    const fallbackElements = [
      fallbackYear,
      fallbackMonth,
      fallbackDay,
      fallbackHour,
      fallbackMinute,
    ];

    fallbackElements.forEach((el) => {
      el.addEventListener("focus", () => addPauseReason("fallback-input"));
      el.addEventListener("blur", () => removePauseReason("fallback-input"));
      el.addEventListener("change", () => {
        if (el === fallbackYear || el === fallbackMonth) {
          syncFallbackDayOptions();
        }
        updateLaunchState();
        if (state.isRunning) {
          restartActiveScene();
        }
      });
    });
  }

  function syncFallbackDayOptions() {
    if (!state.usingFallback) return;
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
  }

  if (!state.usingFallback) {
    dateInput.addEventListener("focus", () => addPauseReason("native-input"));
    dateInput.addEventListener("blur", () => removePauseReason("native-input"));
    timeInput.addEventListener("focus", () => addPauseReason("native-input"));
    timeInput.addEventListener("blur", () => removePauseReason("native-input"));
    dateInput.addEventListener("input", () => {
      updateLaunchState();
      if (state.isRunning) restartActiveScene();
    });
    timeInput.addEventListener("input", () => {
      updateLaunchState();
      if (state.isRunning) restartActiveScene();
    });
  }

  // --- 6. Мультимовність ---
  const initialLang = detectInitialLang();
  setLanguage(initialLang);

  langButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const { lang } = button.dataset;
      if (lang && lang !== state.lang) {
        setLanguage(lang);
      }
    });
  });

  // --- 7. Підготовка єдиної сцени ---
  if (state.sceneInstance && typeof state.sceneInstance.resize === "function") {
    state.sceneInstance.resize(scenesDesignWidth, scenesDesignHeight);
  }

  // --- 8. Робота з датами та запуском ---
  function getSelectedDate() {
    if (state.usingFallback) {
      const year = fallbackYear.value;
      const month = fallbackMonth.value;
      const day = fallbackDay.value;
      if (!year || !month || !day) {
        return "";
      }
      return `${year}-${month}-${day}`;
    }
    return dateInput.value;
  }

  function getSelectedTime() {
    if (state.usingFallback) {
      const hour = fallbackHour.value;
      const minute = fallbackMinute.value;
      if (!hour || !minute) {
        return "";
      }
      return `${hour}:${minute}`;
    }
    return timeInput.value || CONFIG.global.DEFAULT_TIME;
  }

  function isDateInRange(dateStr) {
    return dateStr >= CONFIG.global.DATE_MIN && dateStr <= dateMax;
  }

  function isTimeValid(timeStr) {
    return /^\d{2}:\d{2}$/.test(timeStr);
  }

  function updateLaunchState() {
    const dateValue = getSelectedDate();
    const timeValue = getSelectedTime();
    const isValid = Boolean(dateValue && timeValue && isDateInRange(dateValue) && isTimeValid(timeValue));
    launchButton.disabled = !isValid;
  }

  function buildSeed() {
    const dateValue = getSelectedDate();
    const timeValue = getSelectedTime();
    if (!dateValue || !timeValue) {
      return "";
    }
    return `${dateValue}T${timeValue}`;
  }

  updateLaunchState();

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
    const headerHeight = topBar.offsetHeight;
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
    const seedInt =
      typeof window.hashStringToInt32 === "function" ? window.hashStringToInt32(seed) : 0;
    const prng = typeof window.makePrng === "function" ? window.makePrng(seedInt) : null;
    if (typeof state.sceneInstance.resetModeLock === "function") {
      state.sceneInstance.resetModeLock();
    }
    if (typeof state.sceneInstance.init === "function") {
      // Передаємо seed та PRNG (якщо він створений), щоб сцена могла реагувати на вхідні дані.
      state.sceneInstance.init(seed, prng);
    } else {
      // Якщо сцена не підтримує init, м'яко скидаємо базові таймери вручну.
      if ("seed" in state.sceneInstance) {
        state.sceneInstance.seed = seed;
      }
      if ("phase" in state.sceneInstance) {
        state.sceneInstance.phase = "intro";
      }
      if ("time" in state.sceneInstance) {
        state.sceneInstance.time = 0;
      }
      if ("startedAt" in state.sceneInstance) {
        state.sceneInstance.startedAt = performance.now();
      }
    }
    if (typeof state.sceneInstance.resize === "function") {
      state.sceneInstance.resize(scenesDesignWidth, scenesDesignHeight);
    }
    resetPerformanceTracker();
    state.currentSeed = seed;
    state.runStartedAt = performance.now();
    state.lastFrameTime = state.runStartedAt;
  }

  function restartActiveScene({ force = false } = {}) {
    const seed = buildSeed();
    if (!seed) return;
    if (!force && seed === state.currentSeed) return;
    initializeScene(seed);
  }

  // --- 12. Обробник кнопки запуску ---
  launchButton.addEventListener("click", () => {
    const seed = buildSeed();
    if (!seed) return;
    initializeScene(seed);
    state.isRunning = true;
    startAnimation();
  });

  // --- 13. Керування модальним вікном ---
  infoButton.addEventListener("click", () => {
    modal.hidden = false;
    addPauseReason("modal");
  });

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
