import * as en from "./locales/en.json";
import * as zhCN from "./locales/zh-cn.json";
import * as zhTW from "./locales/zh-tw.json";

export const resources = {
  en: { translation: en },
  "zh-CN": { translation: zhCN },
  "zh-TW": { translation: zhTW },
} as const;
