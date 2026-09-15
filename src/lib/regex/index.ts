// 正则模块 barrel —— 双通道正则引擎 + 它的存储。
export {
  getRegexedString,
  runRegexScript,
  regex_placement,
  substitute_find_regex,
} from "./engine";
export type { RegexParams } from "./engine";
export {
  loadGlobalRegexScripts,
  saveGlobalRegexScripts,
  getEffectiveRegexScripts,
  subscribeRegexScripts,
} from "./store";
export {
  regexExportFileName,
  serializeRegexScript,
  parseImportedRegexScripts,
} from "./io";
