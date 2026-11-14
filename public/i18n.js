import { messages } from "./messages.js";

export const languages = {
  zh: "中文", en: "English", fr: "Français", es: "Español", de: "Deutsch",
  ru: "Русский", pt: "Português", ko: "한국어", ja: "日本語",
};

export function preference(key, value) {
  try {
    if (value !== undefined) localStorage.setItem("yuetime:" + key, value);
    return localStorage.getItem("yuetime:" + key);
  } catch {
    return null;
  }
}

const requested = [new URL(location.href).searchParams.get("lang"), preference("language"), ...navigator.languages]
  .map(value => value?.toLowerCase().split("-")[0]);
const language = requested.find(value => Object.hasOwn(languages, value)) || "en";
export const locale = ({ zh: "zh-CN", pt: "pt-BR" })[language] || language;
export const t = (key, values = {}) =>
  (messages[language][key] ?? messages.en[key] ?? messages[language].failed)
    .replace(/\{(\w+)\}/g, (_, name) => values[name]);

export function bindLanguages(container) {
  container.setAttribute("aria-label", t("language"));
  for (const [code, label] of Object.entries(languages)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.lang = code;
    button.setAttribute("aria-pressed", code === language);
    button.onclick = () => {
      if (code === language) return;
      preference("language", code);
      const url = new URL(location.href);
      url.searchParams.set("lang", code);
      location.assign(url);
    };
    container.append(button);
  }
}
