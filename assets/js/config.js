// У цьому файлі зберігаємо всі константи застосунку у структурі CONFIG.
// Такий підхід дозволяє централізовано керувати налаштуваннями та легко
// розширювати проєкт новими сценами або мовами без хаосу в коді.

const CONFIG = {
  global: {
    // Геометрія віртуальної дизайн-рамки 9:16, у якій малюються сцени.
    DESIGN_WIDTH: 1080,
    DESIGN_HEIGHT: 1920,
    FIT_MODE: "contain",

    // Продуктивність і відтворення: обмежуємо частоту кадрів і DPR.
    TARGET_FPS: 30,
    MAX_DEVICE_PIXEL_RATIO: 1.5,

    // Тривалість вступної анімації в мілісекундах для всіх сцен.
    INTRO_DURATION_MS: 20000,

    // Початкові умови для генератора орнаментів.
    DEFAULT_TIME: "12:00",
    DATE_MIN: "1900-01-01",

    // Колір фону канви (дизайн-одиниці перетворюються в CSS під час рендеру).
    CANVAS_BG: "#0b0b0f",

    // Параметри автоматичного переходу з 3D у 2D при просіданні FPS.
    ENABLE_3D_BY_DEFAULT: true,
    FPS_FALLBACK_THRESHOLD: 20,
    FPS_FALLBACK_WINDOW_MS: 2000,
    MIN_SECONDS_BEFORE_CHECK: 3,
    FPS_RECOVER_THRESHOLD: 26, // На майбутнє, якщо знадобиться гістерезис.
  },

  // Плейсхолдер для сценоспецифічних налаштувань Ліссажу.
  lissajous: {
    // Наразі додаткових параметрів не маємо, але об'єкт залишаємо для розширення.
  },

  // Налаштування нової "рунної" сцени: кванти частот, симетрії та декоративні акценти.
  rune: {
    FREQ_SET: [1, 2, 3, 5, 7],
    PHASE_DEG_STEP: 30,
    RADIAL_SYMMETRY_OPTIONS: [2, 3, 4, 6],
    DECORATION_DENSITY: 0.2,
    LINE_WIDTH: [2, 4],
  },

  // Усі текстові ресурси для інтерфейсу.
  i18n: {
    default: "ua",
    dict: {
      ua: {
        title: "Aura — генеративна графіка",
        description: "Генеруйте унікальні візерунки на основі дати та часу народження.",
        topBarLabel: "Твоя дата народження",
        dateLabel: "Дата народження",
        timeLabel: "Час народження",
        fallbackDayLabel: "День",
        fallbackMonthLabel: "Місяць",
        fallbackYearLabel: "Рік",
        fallbackHourLabel: "Година",
        fallbackMinuteLabel: "Хвилина",
        monthsShort: [
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
        ],
        start: "Запустити",
        help: "Довідка",
        aboutTitle: "Про проєкт",
        modalText:
          "Цей сайт відкриває приховану геометрію вашого життя.<br>" +
          "На основі дати й часу народження народжується унікальний візерунок — " +
          "візуальний відбиток вашої присутності у Всесвіті.<br>" +
          "Це не просто анімація, а символ початку й таємниці, який завжди буде лише вашим.",
        modalClose: "Добре",
        langUA: "UA",
        langEN: "EN",
        sceneLissajous: "Ліссажу",
        sceneRune: "Руни",
        infoAriaLabel: "Показати інформацію",
        sceneToggleAria: "Вибір сцени",
        langToggleAria: "Вибір мови",
      },
      en: {
        title: "Aura — generative graphics",
        description: "Generate unique patterns based on your date and time of birth.",
        topBarLabel: "Your date of birth",
        dateLabel: "Date of birth",
        timeLabel: "Time of birth",
        fallbackDayLabel: "Day",
        fallbackMonthLabel: "Month",
        fallbackYearLabel: "Year",
        fallbackHourLabel: "Hour",
        fallbackMinuteLabel: "Minute",
        monthsShort: [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ],
        start: "Start",
        help: "Help",
        aboutTitle: "About the project",
        modalText:
          "This experience reveals the hidden geometry of your life.<br>" +
          "A unique pattern is born from your date and time of birth — a visual fingerprint of your presence in the Universe.<br>" +
          "It is not just an animation, but a symbol of origin and mystery that will always remain yours.",
        modalClose: "Close",
        langUA: "UA",
        langEN: "EN",
        sceneLissajous: "Lissajous",
        sceneRune: "Runes",
        infoAriaLabel: "Show information",
        sceneToggleAria: "Scene selection",
        langToggleAria: "Language selection",
      },
    },
  },

  // Набір даних для SEO та прев'ю у соцмережах.
  seo: {
    BASE_URL: "https://ТВІЙ-ДОМЕН/",
    OG_IMAGE: "https://ТВІЙ-ДОМЕН/preview.png",
    TITLE_UA: "Aura — генеративна графіка",
    DESCRIPTION_UA: "Генеруйте унікальні візерунки на основі дати та часу народження.",
  },
};

// Робимо CONFIG доступним у глобальному просторі, щоб інші модулі могли його використовувати.
window.CONFIG = CONFIG;
