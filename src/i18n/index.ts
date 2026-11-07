import i18n, { type BackendModule } from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "pt", label: "Português" },
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "de", label: "Deutsch" },
  { code: "tr", label: "Türkçe" },
] as const;

/**
 * English is bundled (it is the fallback and the initial language). Every
 * other locale is its own chunk, fetched by i18next the first time the
 * language is selected; `changeLanguage` resolves once it has loaded.
 */
const lazyLocaleBackend: BackendModule = {
  type: "backend",
  init() {},
  read(language, _namespace, callback) {
    import(`./locales/${language}.json`)
      .then((module) => callback(null, module.default))
      // Region variants such as "en-US" have no file of their own: i18next
      // also asks for the base language, so an empty bundle is the answer.
      .catch(() => callback(null, {}));
  },
};

i18n
  .use(lazyLocaleBackend)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
    },
    partialBundledLanguages: true,
    lng: "en",
    fallbackLng: "en",
    interpolation: {
      escapeValue: false, // React already escapes
    },
  });

export default i18n;
