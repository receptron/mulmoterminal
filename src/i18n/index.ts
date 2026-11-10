import { watch } from "vue";
import { createI18n } from "vue-i18n";
import { en } from "./en";
import { ja } from "./ja";
import { zhCN } from "./zh-CN";
import { zhTW } from "./zh-TW";
import { ko } from "./ko";
import { resolveUiLocale, uiLanguage } from "../composables/uiLanguage";
import { setRequestTimeoutText } from "../utils/requestTimeout";

// `legacy: false` — the app is Composition API throughout, and the legacy mode installs a global
// mixin that would put `$t` on every component in the tree, including the plugin roots.
//
// English is the fallback, so a key a translation has not caught up with renders the English words
// rather than the key. The type in ./messages makes that state a compile error, not a habit.
//
// The keys here are the codes in UI_LOCALES, hyphens and all: `resolveUiLocale` hands one straight
// to vue-i18n, so a key spelled differently would resolve to no messages rather than to English.
export const i18n = createI18n({
  legacy: false,
  locale: resolveUiLocale(uiLanguage.value),
  fallbackLocale: "en",
  messages: { en, ja, "zh-CN": zhCN, "zh-TW": zhTW, ko },
});

setRequestTimeoutText((seconds) => i18n.global.t("requestTimeout.message", { seconds }));

// The setting is the source of truth; this keeps the runtime following it. Watched here rather than
// written from the picker so any other writer of `uiLanguage` reaches the same place.
watch(uiLanguage, (language) => {
  i18n.global.locale.value = resolveUiLocale(language);
});
