// У цьому файлі зберігаємо всі константи застосунку у структурі CONFIG.
// Коментарі докладні українською мовою, аби навіть новачок легко розібрався.

// Окремо описуємо словник локалізації, щоб UI не містив згадок про час.
const I18N = {
  ua: {
    title: "Aura — генеративна графіка",
    description: "Генеруйте унікальні візерунки на основі дати народження.",
    subtitle: "Генеративна магія твоєї дати",
    topBarLabel: "Твоя дата народження",
    date_label: "Дата",
    date_help: "Обери дату народження (без часу).",
    run_btn: "Запустити",
    lang_label: "Мова",
    gender_label: "Стать",
    gender_unspecified: "Не вказувати",
    gender_female: "Жіноча",
    gender_male: "Чоловіча",
    fallbackDayLabel: "День",
    fallbackMonthLabel: "Місяць",
    fallbackYearLabel: "Рік",
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
    aboutTitle: "Про проєкт",
    modalText:
      "Цей сайт відкриває приховану геометрію вашого життя.<br>" +
      "На основі дати народження народжується унікальний візерунок — " +
      "візуальний відбиток вашої присутності у Всесвіті.<br>" +
      "Це не просто анімація, а символ початку й таємниці, який завжди буде лише вашим.",
    modalClose: "Добре",
    sceneLissajous: "Ліссажу",
    sceneRune: "Руни",
    infoAriaLabel: "Показати інформацію",
    sceneToggleAria: "Вибір сцени",
    footerDescription: "Поєднання стародавніх календарів із сучасною графікою",
    placeholderText: "Введи дату народження, щоб побачити свою унікальну ауру",
  },
  en: {
    title: "Aura — generative graphics",
    description: "Generate unique patterns based on your birth date.",
    subtitle: "Generative magic of your date",
    topBarLabel: "Your birth date",
    date_label: "Date",
    date_help: "Pick the birth date (no time).",
    run_btn: "Run",
    lang_label: "Language",
    gender_label: "Gender",
    gender_unspecified: "Prefer not to say",
    gender_female: "Female",
    gender_male: "Male",
    fallbackDayLabel: "Day",
    fallbackMonthLabel: "Month",
    fallbackYearLabel: "Year",
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
    aboutTitle: "About the project",
    modalText:
      "This experience reveals the hidden geometry of your life.<br>" +
      "A unique pattern is born from your birth date — a visual fingerprint of your presence in the Universe.<br>" +
      "It is not just an animation, but a symbol of origin and mystery that will always remain yours.",
    modalClose: "Close",
    sceneLissajous: "Lissajous",
    sceneRune: "Runes",
    infoAriaLabel: "Show information",
    sceneToggleAria: "Scene selection",
    footerDescription: "Combining ancient calendars with modern graphics",
    placeholderText: "Enter your birth date to generate your unique aura pattern",
  },
};

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

    // Дата відліку для генератора орнаментів (час більше не використовується).
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

  // Налаштування "рунної" сцени: кванти частот, симетрії та декоративні акценти.
  rune: {
    // Базові значення для побудови кривих Ліссажу
    FREQ_SET: [1, 2, 3, 5, 7],
    PHASE_DEG_STEP: 30,
    RADIAL_SYMMETRY_OPTIONS: [2, 3, 4, 6],
    LINE_WIDTH: [2, 4],

    // Контроль щільності старих декорацій (використовується лише коли RUNIC_MODE = false)
    DECORATION_DENSITY: 0.2,

    // Нові прапорці та числові параметри для "рунічного" стилю
    RUNIC_MODE: true, // головний перемикач — якщо true, активується строгий геометричний режим
    SNAP_TO_GRID: true, // примусово прилипати до ґріда, щоб уникати дрібних люфтів координат
    GRID_SIZE: 16, // крок ґріда у пікселях (після масштабування сцени)
    SNAP_ANGLE_STEP_DEG: 45, // дозволені напрями сегментів у градусах (0°, 45°, 90° ...)
    SIMPLIFY_TOLERANCE_PX: 6, // толеранс алгоритму Дугласа–Пейкера, що прибирає зайві точки
    MIN_SEGMENT_PX: 18, // мінімальна довжина відрізка після спрощення, щоб не було "мікро-штрихів"
    USE_DECORATIONS: false, // у рунічному режимі тримаємо вимкненими додаткові кружальця
    USE_TICKS: false, // у рунічному режимі вимикаємо насічки
    MAX_RADIAL_FOR_RUNIC: 4, // верхнє обмеження кількості повторів по колу для читабельності символів
  },

  // Усі текстові ресурси для інтерфейсу.
  i18n: {
    default: "ua",
    dict: I18N,
  },

  // Набір даних для SEO та прев'ю у соцмережах.
  seo: {
    BASE_URL: "https://ТВІЙ-ДОМЕН/",
    OG_IMAGE: "https://ТВІЙ-ДОМЕН/preview.png",
    TITLE_UA: "Aura — генеративна графіка",
    DESCRIPTION_UA: "Генеруйте унікальні візерунки на основі дати народження.",
  },
};

// Робимо конфігурацію та словник доступними глобально.
window.CONFIG = CONFIG;
window.I18N = I18N;
