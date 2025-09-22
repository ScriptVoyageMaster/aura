// Основний файл, що керує всім життєвим циклом застосунку: від роботи інтерфейсу до анімації полотна.
// Коментарі максимально деталізовані українською мовою, щоб навіть недосвідчений користувач міг розібратися.

(() => {
  "use strict";

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
  const modal = document.getElementById("info-modal");
  const modalOverlay = document.getElementById("modal-overlay");
  const modalClose = document.getElementById("modal-close");
  const modalText = modal.querySelector(".modal__text");

  const nativeInputsContainer = document.getElementById("native-inputs");
  const fallbackInputsContainer = document.getElementById("fallback-inputs");
  const fallbackDay = document.getElementById("fallback-day");
  const fallbackMonth = document.getElementById("fallback-month");
  const fallbackYear = document.getElementById("fallback-year");
  const fallbackHour = document.getElementById("fallback-hour");
  const fallbackMinute = document.getElementById("fallback-minute");

  // Переконуємося, що текст модального вікна відповідає константі з config.js.
  modalText.innerHTML = MODAL_TEXT;

  // --- 2. Загальні допоміжні змінні та об'єкти стану ---
  const scene = window.lissajousScene;
  const frameInterval = 1000 / TARGET_FPS; // Інтервал між кадрами для фіксованих 30 FPS.
  const pauseReasons = new Set(); // Набір причин, які тимчасово ставлять анімацію на паузу.

  const state = {
    isRunning: false,
    isPaused: false,
    lastFrameTime: 0,
    animationScheduled: false,
    cssWidth: 0,
    cssHeight: 0,
    effectiveDpr: 1,
  };

  // --- 3. Корисні функції для дат, часу та форматування ---

  /**
   * Повертає сьогоднішню дату у форматі YYYY-MM-DD.
   * Використовуємо локальний час, щоб уникнути зміщень через часові пояси.
   */
  function getTodayIso() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  /**
   * Обчислює кількість днів у конкретному місяці певного року.
   * @param {number} year - Рік, наприклад 1995.
   * @param {number} month - Місяць від 1 до 12.
   */
  function getDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  /**
   * Додає провідний нуль до числових значень, щоб отримати рядок виду "05".
   * @param {number} value - Ціле число.
   */
  function pad(value) {
    return String(value).padStart(2, "0");
  }

  /**
   * Перевіряє, чи підтримує браузер певний тип інпуту (date або time).
   * @param {string} type - Ім'я типу.
   */
  function isInputTypeSupported(type) {
    const input = document.createElement("input");
    input.setAttribute("type", type);
    return input.type === type;
  }

  /**
   * Готує об'єкт з частинами сьогоднішньої дати.
   */
  function getTodayParts() {
    const today = getTodayIso();
    const [year, month, day] = today.split("-");
    return { year, month, day };
  }

  // --- 4. Налаштування полів дати та часу ---

  DATE_MAX = getTodayIso();
  dateInput.min = DATE_MIN;
  dateInput.max = DATE_MAX;

  if (!timeInput.value) {
    timeInput.value = DEFAULT_TIME;
  }

  const supportsNativeDate = isInputTypeSupported("date");
  const supportsNativeTime = isInputTypeSupported("time");
  const usingFallback = !(supportsNativeDate && supportsNativeTime);

  nativeInputsContainer.hidden = usingFallback;
  fallbackInputsContainer.hidden = !usingFallback;

  // --- 5. Налаштування фолбек-селекторів (якщо потрібні) ---
  if (usingFallback) {
    initFallbackInputs();
  }

  /**
   * Заповнює селектори фолбеку значеннями та встановлює дефолтні вибори.
   */
  function initFallbackInputs() {
    const { year, month, day } = getTodayParts();

    // 5.1. Список років (від поточного вниз до 1900).
    const currentYear = Number(year);
    for (let y = currentYear; y >= Number(DATE_MIN.slice(0, 4)); y -= 1) {
      const option = document.createElement("option");
      option.value = String(y);
      option.textContent = String(y);
      fallbackYear.append(option);
    }

    // 5.2. Список місяців із короткими українськими підписами.
    const monthLabels = [
      "Січ",
      "Лют",
      "Бер",
      "Кві",
      "Тра",
      "Чер",
      "Лип",
      "Сер",
      "Вер",
      "Жов",
      "Лис",
      "Гру",
    ];
    monthLabels.forEach((label, index) => {
      const option = document.createElement("option");
      option.value = pad(index + 1);
      option.textContent = label;
      fallbackMonth.append(option);
    });

    // 5.3. Список годин (0..23) і хвилин (0..59).
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

    // Встановлюємо дефолтні значення (сьогоднішня дата + час за замовчуванням).
    fallbackYear.value = year;
    fallbackMonth.value = month;
    syncFallbackDayOptions();
    fallbackDay.value = day.padStart(2, "0");

    const [defaultHour, defaultMinute] = DEFAULT_TIME.split(":");
    fallbackHour.value = defaultHour;
    fallbackMinute.value = defaultMinute;

    // Слухаємо зміни, щоб підтримувати валідність дати й оновлювати кнопку запуску.
    fallbackYear.addEventListener("change", () => {
      syncFallbackDayOptions();
      updateLaunchState();
    });
    fallbackMonth.addEventListener("change", () => {
      syncFallbackDayOptions();
      updateLaunchState();
    });
    fallbackDay.addEventListener("change", updateLaunchState);
    fallbackHour.addEventListener("change", updateLaunchState);
    fallbackMinute.addEventListener("change", updateLaunchState);

    // Для фокусів/блюрів додаємо паузу, щоб полегшити користувачу вибір.
    [fallbackYear, fallbackMonth, fallbackDay, fallbackHour, fallbackMinute].forEach((el) => {
      el.addEventListener("focus", () => addPauseReason("fallback-input"));
      el.addEventListener("blur", () => removePauseReason("fallback-input"));
    });
  }

  /**
   * Оновлює список доступних днів у фолбек-селекторі з урахуванням вибраного року та місяця.
   */
  function syncFallbackDayOptions() {
    const yearValue = Number(fallbackYear.value);
    const monthValue = Number(fallbackMonth.value);
    if (!yearValue || !monthValue) {
      return;
    }
    const days = getDaysInMonth(yearValue, monthValue);
    const currentDay = Number(fallbackDay.value) || 1;

    fallbackDay.innerHTML = "";
    for (let d = 1; d <= days; d += 1) {
      const option = document.createElement("option");
      option.value = pad(d);
      option.textContent = String(d);
      fallbackDay.append(option);
    }

    const safeDay = Math.min(currentDay, days);
    fallbackDay.value = pad(safeDay);
  }

  // --- 6. Події для нативних інпутів ---
  if (!usingFallback) {
    dateInput.addEventListener("focus", () => addPauseReason("native-input"));
    dateInput.addEventListener("blur", () => removePauseReason("native-input"));
    timeInput.addEventListener("focus", () => addPauseReason("native-input"));
    timeInput.addEventListener("blur", () => removePauseReason("native-input"));
    dateInput.addEventListener("input", updateLaunchState);
    timeInput.addEventListener("input", updateLaunchState);
  }

  // --- 7. Функції для керування паузою анімації ---
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

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      addPauseReason("tab-hidden");
    } else {
      removePauseReason("tab-hidden");
    }
  });

  // --- 8. Розрахунок та оновлення розмірів canvas ---
  window.addEventListener("resize", () => {
    updateCanvasSize();
  });

  function updateCanvasSize() {
    const headerHeight = topBar.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const availableHeight = Math.max(viewportHeight - headerHeight, 200);

    canvas.style.marginTop = `${headerHeight}px`;

    const effectiveDpr = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
    canvas.width = Math.floor(viewportWidth * effectiveDpr);
    canvas.height = Math.floor(availableHeight * effectiveDpr);
    canvas.style.width = `${viewportWidth}px`;
    canvas.style.height = `${availableHeight}px`;

    ctx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);

    state.cssWidth = viewportWidth;
    state.cssHeight = availableHeight;
    state.effectiveDpr = effectiveDpr;

    scene.resize(viewportWidth, availableHeight);
  }

  updateCanvasSize();

  // --- 9. Допоміжні функції для отримання значень дати та часу ---
  function getSelectedDate() {
    if (usingFallback) {
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
    if (usingFallback) {
      const hour = fallbackHour.value;
      const minute = fallbackMinute.value;
      if (!hour || !minute) {
        return "";
      }
      return `${hour}:${minute}`;
    }
    return timeInput.value || DEFAULT_TIME;
  }

  function isDateInRange(dateStr) {
    return dateStr >= DATE_MIN && dateStr <= DATE_MAX;
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

  updateLaunchState();

  // --- 10. Анімаційний цикл ---
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

    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, state.cssWidth, state.cssHeight);

    scene.update(dt);
    scene.draw(ctx);
  }

  function startAnimation() {
    if (!state.animationScheduled) {
      state.animationScheduled = true;
      state.lastFrameTime = performance.now();
      requestAnimationFrame(animationLoop);
    } else {
      state.lastFrameTime = performance.now();
    }
  }

  // --- 11. Обробник кнопки "Запустити" ---
  launchButton.addEventListener("click", () => {
    const dateValue = getSelectedDate();
    const timeValue = getSelectedTime() || DEFAULT_TIME;
    if (!dateValue || !timeValue) {
      return;
    }

    const seed = `${dateValue}T${timeValue}`;
    const seedInt = window.hashStringToInt32(seed);
    const prng = window.makePrng(seedInt);

    scene.init(seed, prng);
    updateCanvasSize();

    state.isRunning = true;
    state.lastFrameTime = performance.now();
    startAnimation();
  });

  // --- 12. Керування модальним вікном ---
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

  // --- 13. Початкові паузи та перевірки ---
  updatePauseState();
})();
