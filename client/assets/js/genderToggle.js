/**
 * Простий модуль для керування темою статі.
 * Весь код детально прокоментовано українською мовою, щоб його легко було підтримувати навіть новачкам.
 */

const GENDER_STORAGE_KEY = "aura.gender";
const VALID_GENDERS = ["male", "female", "unspecified"];

/**
 * Перевіряємо, чи значення належить до дозволеного списку, інакше повертаємо "unspecified".
 */
function normalizeGender(value) {
  return VALID_GENDERS.includes(value) ? value : "unspecified";
}

/**
 * Обережно читаємо збережене значення з localStorage.
 */
export function readStoredGender() {
  try {
    const stored = window.localStorage.getItem(GENDER_STORAGE_KEY);
    return stored ? normalizeGender(stored) : null;
  } catch (error) {
    // Якщо браузер блокує доступ до localStorage (наприклад, приватний режим) — повертаємо null.
    return null;
  }
}

/**
 * Зберігаємо поточний вибір статі у localStorage.
 */
function persistGender(value) {
  try {
    window.localStorage.setItem(GENDER_STORAGE_KEY, normalizeGender(value));
  } catch (error) {
    // Мовчазно ігноруємо помилки, щоб не зупиняти роботу застосунку.
  }
}

/**
 * Повертаємо кореневий контейнер гліфа AURA.
 */
function getAuraRoot() {
  return document.getElementById("aura");
}

/**
 * Ініціалізуємо тему: беремо збережене значення або застосовуємо передане за замовчуванням.
 * @param {string} defaultGender - значення, яке використовуємо, якщо сховище порожнє або недоступне.
 * @returns {string} - підсумкове значення, яке застосували.
 */
export function initGenderTheme(defaultGender = "unspecified") {
  const root = getAuraRoot();
  const stored = readStoredGender();
  const normalizedDefault = normalizeGender(defaultGender);
  const applied = stored ?? normalizedDefault;
  if (root) {
    root.setAttribute("data-gender", applied);
  }
  if (!stored) {
    persistGender(applied);
  }
  return applied;
}

/**
 * Оновлюємо тему, записуючи її у data-атрибут і localStorage.
 * @param {string} gender - нове значення (male/female/unspecified).
 * @returns {string} - нормалізоване значення, яке було застосовано.
 */
export function setGenderTheme(gender) {
  const root = getAuraRoot();
  const normalized = normalizeGender(gender);
  if (root) {
    root.setAttribute("data-gender", normalized);
  }
  persistGender(normalized);
  return normalized;
}
