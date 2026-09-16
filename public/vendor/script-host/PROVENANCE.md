# script-host 自托管 vendor 溯源

> 本文件由 `dev-server/tools/update-script-host-vendor.py` **自动生成**，请勿手改（改动会被下一次运行覆盖）。
>
> 目标目录：`public/vendor/script-host/`。Vite 的 `publicDir` 会把 `public/**` 原样复制到构建产物根目录 ⇒ 运行期同源路径就是 `/vendor/script-host/**`。
>
> 设计依据：`.docs/plugin-system/插件开发_JS-Slash-Runner/开发计划-SSOT.md` §5.2（vendor 目录）、§5.3（importmap 重映射）、D7① / D15。

## 1. 文件清单与加载方式

| 文件 | 加载方式 | 注入的全局 | 说明 |
| --- | --- | --- | --- |
| `lodash.min.js` | classic `<script src>` | `_` | UMD 产物；版本与 SillyTavern 1.15.0 依赖 `lodash ^4.18.1` 对齐。 |
| `jquery.min.js` | classic `<script src>` | `$` / `jQuery` | jQuery 官方发行站产物（3.x 最后一个版本）。**刻意不用 4.0.0**（破坏性变更）；SillyTavern 1.15.0 自带的是 3.5.1，本文件是其同主版本内的最新修复版。MVU 用到的 `$(() => …)` / `.on()` / `.prop()` 在两者间语义一致。 |
| `toastr.min.js` | classic `<script src>` | `toastr` | 未附 CSS——仅影响提示外观，不影响 `toastr.warning/error` 的调用与逻辑。 |
| `yaml.min.js` | module `<script type="module" src>` | `YAML` | **`yaml` 官方不发布 UMD/全局产物**（npm 包内只有 ESM/CJS 模块），因此按 SSOT §5.2 的兜底做法提供最小 ESM 包装：import 同目录的官方 ESM 打包产物并把模块命名空间挂到 `globalThis.YAML`。⚠️ 它必须按 module 加载（不能用 classic `<script src>`）。 |
| `yaml/yaml.esm.js` | 间接（被 `yaml.min.js` 以模块方式 import） | —（命名导出 `parse`/`stringify`/`parseDocument` …） | jsDelivr `+esm` 是**动态生成**产物（同一 URL 在 jsDelivr 升级其打包器后理论上可能产出不同字节）；靠 `ASSETS.sha256` 的钉扎 + 本文件的 sha256 记录发现漂移。 |
| `zod.mjs` | module `<script type="module" src>` | `z` | zod v4 无 UMD/全局产物，按 SSOT §5.2 兜底做法提供最小 ESM 包装：import 同目录官方 ESM 产物并把模块命名空间挂到 `globalThis.z`（卡片脚本用裸全局 `z` 且依赖 v4 的 `.prefault`）。 |
| `zod/zod.esm.js` | 间接（被 `zod.mjs` 以模块方式 import） | —（命名导出 `z`/`object`/`string`/`prefault` 相关 API …） | jsDelivr `+esm` 动态生成产物，同 `yaml/yaml.esm.js` 的说明。 |
| `vue.global.js` | classic `<script src>` | `Vue` | **MVU 的 webpack external 之一**：`mvu/bundle.js` 内 `4061(e){e.exports=Vue}`，并用 `createApp(...).use(pinia)`；predefine 若不提供 `window.Vue`，MVU 会在模块求值阶段直接抛 `ReferenceError: Vue is not defined`、整链失败（vendor 黑洞实验实测）。pinia 则是 **bundle 内置**（bundle 内可见 `pinia 3.0.3` 的 MIT 许可横幅与 `$pinia` 内部实现），不是 external。取 **global prod（自带 runtime 编译器）**而非常 runtime-only：万一面板/卡片出现运行时 `template` 也不会崩。⚠️ 扩展名必须是 `.js`（`.mjs` 会被 nginx 以 octet-stream + nosniff 拒掉）。**不放进 importmap**：它是 classic 全局而非被 `import` 的远程说明符，在 manifest.json 里以 `kind: "global"` 登记路径供 P3 的 globals 装配使用。 |
| `mvu/bundle.js` | module（卡片脚本里 `import '…'`，由 importmap 重映射到本文件） | `Mvu`（由 predefine 镜像到 `window.parent.Mvu`，见 SSOT §2.4 步骤 6） | **上游 URL 不带版本号** ⇒ commit + sha256 是唯一可追溯手段（SSOT §5.3）。该产物**不是自包含**：文件开头有大量 `import … from 'https://testingcf.jsdelivr.net/…'`（见下方「依赖闭合性核验」自动扫描结果）。 |
| `mvu/mvu_zod.js` | module（卡片脚本里 `import '…'`，由 importmap 重映射到本文件） | `registerMvuSchema`（命名导出） | 同样不自包含：静态 import 5 个外部 ESM（`compare-versions`/`json5`/`jsonrepair`/`zod/v4/core`/`klona`），另有一处相对 `//# sourceMappingURL=mvu_zod.js.map`（上游存在该 .map，本目录未取回；仅影响 DevTools 源码映射，不影响执行）。 |

## 2. 上游溯源（sha256）

共 **98** 个自托管文件（顶层 10 + 传递闭包 88），合计 **4816465 bytes**。

| 文件 | 上游 URL | 版本 / commit | 取回日期 (UTC) | 大小 (bytes) | sha256 |
| --- | --- | --- | --- | --- | --- |
| `lodash.min.js` | https://cdn.jsdelivr.net/npm/lodash@4.18.1/lodash.min.js | lodash@4.18.1 | 2026-09-16 | 73234 | `a8d7e6291ad80256f976ace90824a71018d2f706992c9107b20bdced97bee27b` |
| `jquery.min.js` | https://code.jquery.com/jquery-3.7.1.min.js | jquery@3.7.1 | 2026-09-16 | 87533 | `fc9a93dd241f6b045cbff0481cf4e1901becd0e12fb45166a8f17f95823f0b1a` |
| `toastr.min.js` | https://cdn.jsdelivr.net/npm/toastr@2.1.4/build/toastr.min.js | toastr@2.1.4 | 2026-09-16 | 5251 | `1e0c2ad4e069276efa1d43fd1f7549912bfd64219119037e26574f27ca4d7143` |
| `yaml.min.js` | https://cdn.jsdelivr.net/npm/yaml@2.9.1/+esm | 生成文件（包装 `yaml/yaml.esm.js`） | 2026-09-16 | 536 | `1abfb97b289860321df0f33c611bfd7d9a0d5985dd4ffd039b369f6a420c04dc` |
| `yaml/yaml.esm.js` | https://cdn.jsdelivr.net/npm/yaml@2.9.1/+esm | yaml@2.9.1（jsDelivr 由原文件 `/npm/yaml@2.9.1/browser/index.js` 打包） | 2026-09-16 | 104951 | `033470c74f45cc58fceb67bdf6dda8a8f3c536c9c8dc2cf169539b0cc5e0c88d` |
| `zod.mjs` | https://cdn.jsdelivr.net/npm/zod@4.6.5/+esm | 生成文件（包装 `zod/zod.esm.js`） | 2026-09-16 | 519 | `1218c3c0cbfcd144326878916a8a4e96fab6adf35379f6f29552ee015b801ba2` |
| `zod/zod.esm.js` | https://cdn.jsdelivr.net/npm/zod@4.6.5/+esm | zod@4.6.5（jsDelivr 由原文件 `/npm/zod@4.6.5/index.js` 打包） | 2026-09-16 | 455863 | `40ce4491368fe33004a51d1af41fa3f45ed1921e73ea1fb0e8fe13f0a81c5600` |
| `vue.global.js` | https://cdn.jsdelivr.net/npm/vue@3.5.42/dist/vue.global.prod.js | vue@3.5.42（npm dist 的 global prod 构建，含 runtime 编译器） | 2026-09-16 | 167536 | `aae6339a0e744cc3503f2a3ae63f5ee0d99ce39f45517e7a51fcb9ecc290ca2c` |
| `mvu/bundle.js` | https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js | MagicalAstrogy/MagVarUpdate `artifact/bundle.js`；**取回时**最后一次改动该路径的 commit = `4a3645f19705`（2026-09-15 00:44:39 UTC，"[bot] Bundle"），其上游源码 commit 为 `42753fd5e103`（2026-09-15 00:43:24，SSOT/审计报告记录的就是它） | 2026-09-16 | 573165 | `b0f30a7d269ed5afa8455478c50a64e38c158311872f8c9aa2066b720d68cd2d` |
| `mvu/mvu_zod.js` | https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js | StageDog/tavern_resource `dist/util/mvu_zod.js`；最后一次改动该路径的 commit = `276040b5f264`（2026-08-18） | 2026-09-16 | 4705 | `78c40f52d81022d9d769a923a49e673b8babb562656051a7d0410b6b19f45184` |
| `closure/npm/@anthropic-ai/sdk@0.123.0/_esm.js` | /npm/@anthropic-ai/sdk@0.123.0/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@anthropic-ai/sdk@0.123.0/index.mjs` | 2026-09-16 | 176503 | `767db64e9772a1c5c7e72665b343058b594f1d7e95e9080d4ba375025f8f999f` |
| `closure/npm/@anthropic-ai/sdk@0.123.0/internal/node.browser.mjs/_esm.js` | /npm/@anthropic-ai/sdk@0.123.0/internal/node.browser.mjs/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@anthropic-ai/sdk@0.123.0/internal/node.browser.mjs` | 2026-09-16 | 752 | `f24e3ab98fd6d0ab0ade14c8f5e9d89401ead75b41a8348ac42f2ba4d4ea2aff` |
| `closure/npm/@anthropic-ai/sdk@0.123.0/tools/agent-toolset/node.browser.mjs/_esm.js` | /npm/@anthropic-ai/sdk@0.123.0/tools/agent-toolset/node.browser.mjs/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@anthropic-ai/sdk@0.123.0/tools/agent-toolset/node.browser.mjs` | 2026-09-16 | 2142 | `145a355d4c1a456097cf6b8c279e5a35e0a5d6ba8e1023d5dacece52558fa8d5` |
| `closure/npm/@babel/runtime@7.29.2/helpers/defineProperty/_esm.js` | /npm/@babel/runtime@7.29.2/helpers/defineProperty/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@babel/runtime@7.29.2/helpers/esm/defineProperty.js` | 2026-09-16 | 1075 | `e649731e0a92c66ba755fccfe9825af9209cbd06907e302a0d449433190f66b4` |
| `closure/npm/@babel/runtime@7.29.2/helpers/extends/_esm.js` | /npm/@babel/runtime@7.29.2/helpers/extends/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@babel/runtime@7.29.2/helpers/esm/extends.js` | 2026-09-16 | 599 | `ec0d3fce0e9fd17f25cea2126048308d34bc56cd8674f2d307cf2e59bb1cd303` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/dist_/api/anthropic-messages.js/_esm.js` | /npm/@earendil-works/pi-ai@0.85.1/dist/api/anthropic-messages.js/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/api/anthropic-messages.js` | 2026-09-16 | 33880 | `580f1ab83af23de57f4de6e8fdd06e0e963eb7d7b2bc8f8b15672102a101ba56` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/dist_/api/google-generative-ai.js/_esm.js` | /npm/@earendil-works/pi-ai@0.85.1/dist/api/google-generative-ai.js/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/api/google-generative-ai.js` | 2026-09-16 | 25142 | `cf65953625483839ebb5a2be790a0ab5b03923f0bbcc14f75875d5943b99bda2` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/dist_/api/mistral-conversations.js/_esm.js` | /npm/@earendil-works/pi-ai@0.85.1/dist/api/mistral-conversations.js/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/api/mistral-conversations.js` | 2026-09-16 | 25296 | `c2a399eb225db194929e4f8caba487080266af0795466675f5b9b8b77ecbc8de` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/dist_/api/openai-codex-responses.js/_esm.js` | /npm/@earendil-works/pi-ai@0.85.1/dist/api/openai-codex-responses.js/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/api/openai-codex-responses.js` | 2026-09-16 | 52715 | `3cfdf2e316d9647c040bf3d68e7263fec72d151f7aac42b8486c3169573a00b9` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/dist_/api/openai-completions.js/_esm.js` | /npm/@earendil-works/pi-ai@0.85.1/dist/api/openai-completions.js/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/api/openai-completions.js` | 2026-09-16 | 41707 | `6e4cae888ae6876dc2c23ace8ff235ff7b2f6c65c8c42f9f3585116ff7811e3a` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/dist_/api/openai-responses.js/_esm.js` | /npm/@earendil-works/pi-ai@0.85.1/dist/api/openai-responses.js/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/api/openai-responses.js` | 2026-09-16 | 36621 | `b069180fd90da30c57c45bb81e5922f876347495f6e6e1228c96b5e7cea581b0` |
| `closure/npm/@google/genai@1.52.0/_esm.js` | /npm/@google/genai@1.52.0/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@google/genai@1.52.0/dist/web/index.mjs` | 2026-09-16 | 285123 | `1b7465799d8af69154412e3f02b7e1167e8e71cb446ddd995cd757f9b2255bd7` |
| `closure/npm/@intlify/message-compiler@11.4.10/_esm.js` | /npm/@intlify/message-compiler@11.4.10/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@intlify/message-compiler@11.4.10/dist/message-compiler.mjs` | 2026-09-16 | 18635 | `7b5d7f5622122ee861623a8a212101e70fe9c52323b7ce0a20050c7ff553df62` |
| `closure/npm/@intlify/shared@11.4.10/_esm.js` | /npm/@intlify/shared@11.4.10/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@intlify/shared@11.4.10/dist/shared.mjs` | 2026-09-16 | 5255 | `b8f47f0e8f5595500aa98845f94b4f1081100b9f60e08a28f981434b3fce99de` |
| `closure/npm/@stablelib/base64@1.0.1/_esm.js` | /npm/@stablelib/base64@1.0.1/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@stablelib/base64@1.0.1/lib/base64.js` | 2026-09-16 | 4195 | `f73196ffc4a79754831b6f54d27f902257b2ac8eb280786bae6d8be6057e20dc` |
| `closure/npm/complex.js@2.4.3/_esm.js` | /npm/complex.js@2.4.3/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/complex.js@2.4.3/dist/complex.mjs` | 2026-09-16 | 9884 | `b8ff2754901e80d9fed82fdbb2e880da45c8df96152f2ac1c976190f31a7b865` |
| `closure/npm/decimal.js@10.6.0/_esm.js` | /npm/decimal.js@10.6.0/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/decimal.js@10.6.0/decimal.js` | 2026-09-16 | 32753 | `a969cf2e76c317b9daf06d5277bdbb0bda6a3c81003665ce50ae2a93dfbbdfaa` |
| `closure/npm/escape-latex@1.2.0/_esm.js` | /npm/escape-latex@1.2.0/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/escape-latex@1.2.0/dist/index.js` | 2026-09-16 | 1298 | `2f53a679867f4ab8eae49b93671bd7ef11e39027808a8ad4b2fea783d3064eda` |
| `closure/npm/fast-sha256@1.3.0/_esm.js` | /npm/fast-sha256@1.3.0/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/fast-sha256@1.3.0/sha256.js` | 2026-09-16 | 6698 | `9433f59580a920b8b3ebd603b4f2c2b39fe132b0f9dbab89367c85c5f65db376` |
| `closure/npm/fraction.js@5.3.4/_esm.js` | /npm/fraction.js@5.3.4/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/fraction.js@5.3.4/dist/fraction.mjs` | 2026-09-16 | 7185 | `8d8064193de7ee5c75b91a57f7afdecb3f14c2fd4d06f5381e865ef627dda9d8` |
| `closure/npm/javascript-natural-sort@0.7.1/_esm.js` | /npm/javascript-natural-sort@0.7.1/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v2.79.2 and Terser v5.39.0；原文件 `/npm/javascript-natural-sort@0.7.1/naturalSort.js` | 2026-09-16 | 1348 | `17563fe20a023dba96a92c40c757a1683ca18c4afe5b845d7eae77599bbb16e5` |
| `closure/npm/openai@6.40.0/_esm.js` | /npm/openai@6.40.0/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/openai@6.40.0/index.mjs` | 2026-09-16 | 156099 | `e6f4ca808d3c1f015bdd3118dd91983abe6835c31b4683d1b43577da469d584d` |
| `closure/npm/p-retry@4.6.2/_esm.js` | /npm/p-retry@4.6.2/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/p-retry@4.6.2/index.js` | 2026-09-16 | 1601 | `9164586d27d11bcd2328ad7303982fa9d621746599dcb8955c79cb32a9fea403` |
| `closure/npm/partial-json@0.1.7/_esm.js` | /npm/partial-json@0.1.7/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/partial-json@0.1.7/dist/index.js` | 2026-09-16 | 4690 | `f7d1dcbdc45780ff1c525bded427414e49604498ee9c509139e1fca873413aba` |
| `closure/npm/retry@0.13.1/_esm.js` | /npm/retry@0.13.1/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/retry@0.13.1/index.js` | 2026-09-16 | 4064 | `c08b7e43af5736b2be45918f688966fa38362e21d04f2f59276cd5f9359d4542` |
| `closure/npm/seedrandom@3.0.5/_esm.js` | /npm/seedrandom@3.0.5/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/seedrandom@3.0.5/index.js` | 2026-09-16 | 8267 | `bff06d8dbe428efed7c3f061399890de74b6afddab70344e4b68a95055744d48` |
| `closure/npm/standardwebhooks@1.1.1/_esm.js` | /npm/standardwebhooks@1.1.1/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/standardwebhooks@1.1.1/dist/index.js` | 2026-09-16 | 3167 | `8df7d63173e554a800b77fc99b9f6a11e1a82a7b35c58382367adeda1d084c25` |
| `closure/npm/tiny-emitter@2.1.0/_esm.js` | /npm/tiny-emitter@2.1.0/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/tiny-emitter@2.1.0/index.js` | 2026-09-16 | 1115 | `0a23e30943430ad037b6b144f01d6fcb6fb38c8eff8610dcfa1354e274f0c9ae` |
| `closure/npm/typebox@1.3.7/_esm.js` | /npm/typebox@1.3.7/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/typebox@1.3.7/build/index.mjs` | 2026-09-16 | 76581 | `68477e358c5dfe0279a8d160297259976715038bb65e66ada8dcb5328d0320aa` |
| `closure/npm/typebox@1.3.7/compile/_esm.js` | /npm/typebox@1.3.7/compile/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/typebox@1.3.7/build/compile/index.mjs` | 2026-09-16 | 116260 | `5466fd8853f6ff3bba904124011b743230ac841b7ce5af8e243eebfa0573bb0b` |
| `closure/npm/typebox@1.3.7/value/_esm.js` | /npm/typebox@1.3.7/value/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/typebox@1.3.7/build/value/index.mjs` | 2026-09-16 | 105760 | `8ec08c78bd8af06e882ac1b2f2b5016b9633c8b9761fd6b0ce8f8df3e22f4db5` |
| `closure/npm/typed-function@4.2.2/_esm.js` | /npm/typed-function@4.2.2/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/typed-function@4.2.2/lib/esm/typed-function.mjs` | 2026-09-16 | 17775 | `905f3c6ff45d4afe2ac5fa070f154de730f43bace994219624e167eab4030498` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/index.js` | 2026-09-16 | 48945 | `aaf106c29929927a9dcf8b05b5f5710d88d65c8af9c4b1d1e40f95189869605b` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/api/anthropic-messages.lazy/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/api/anthropic-messages.lazy/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/api/anthropic-messages.lazy.js` | 2026-09-16 | 2233 | `aafd5cea67ca69c2182089e53a62b7cded36eee3799ed59008de8703da9a739d` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/api/google-generative-ai.lazy/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/api/google-generative-ai.lazy/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/api/google-generative-ai.lazy.js` | 2026-09-16 | 2238 | `29d14c89b19822db1a122709baa26ead0f143b20c3f602d463db702567c108bc` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/api/google-shared/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/api/google-shared/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/api/google-shared.js` | 2026-09-16 | 10846 | `2949043669d824a62bb2cf6b85ae2c0d188a8c756f60a3e3805f91f1b8b1fcf4` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/api/mistral-conversations.lazy/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/api/mistral-conversations.lazy/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/api/mistral-conversations.lazy.js` | 2026-09-16 | 2242 | `39179f1220ead9bc70df60dfab9f8151639663281e0e37925ac8f7af89ae6851` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/api/openai-codex-responses.lazy/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/api/openai-codex-responses.lazy/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/api/openai-codex-responses.lazy.js` | 2026-09-16 | 2244 | `40325df653471306a3ecb8c765717be1166986a598fb345dbc0e8a17e43535d2` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/api/openai-completions.lazy/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/api/openai-completions.lazy/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/api/openai-completions.lazy.js` | 2026-09-16 | 2233 | `95e22a162c9ebb53d76c824274724fea877ca1b63477f15095e7e127562bfb48` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/api/openai-responses.lazy/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/api/openai-responses.lazy/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/api/openai-responses.lazy.js` | 2026-09-16 | 2227 | `762cba6d7bdbd1b66a76a379fd3a837ceca9b0dd7093418559b5931dcc1a915f` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/api/simple-options/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/api/simple-options/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/api/simple-options.js` | 2026-09-16 | 3510 | `032b14ee605ca3f4a0892fd0486f2a0161e0ab5e5326c81e07280a6250eb3063` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/ant-ling.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/ant-ling.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/ant-ling.models.js` | 2026-09-16 | 1867 | `85f9bd749253eb26b546bc3127c0c6c44c31af5729e14863329ea9e3b8fb404b` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/anthropic.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/anthropic.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/anthropic.models.js` | 2026-09-16 | 5736 | `a2e14751f67703f04abe9ac4ad233e16797503251b723bce2e8beb4882352fc9` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/baseten.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/baseten.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/baseten.models.js` | 2026-09-16 | 13011 | `37408d9116ff6379244728191bc844a0b531bae65602e77c1de2b867a4f1128b` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/cerebras.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/cerebras.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/cerebras.models.js` | 2026-09-16 | 1346 | `27b4058b1313ec7cf975d9ded1d0d5c5e067654f4f236be918c3d3d4544fd0ba` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/deepseek.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/deepseek.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/deepseek.models.js` | 2026-09-16 | 2053 | `33308c4ef75345d6f2807ff797fa718e6e2b31e7d729382d46844eacdeebc59e` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/fireworks.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/fireworks.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/fireworks.models.js` | 2026-09-16 | 10488 | `30c39de53b2ab1b43c28bbffe62eb928c884fbda816e4cd1e1ec274996f4be62` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/github-copilot.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/github-copilot.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/github-copilot.models.js` | 2026-09-16 | 16815 | `111b239658a681ec7d80c03bfd4a41825af69acdbded9c2b3fc93798a19e64b5` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/google.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/google.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/google.models.js` | 2026-09-16 | 8157 | `64a30b32c1b22e861cb6e41637a9a5012398f1120cfe828b0e02462056080153` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/groq.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/groq.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/groq.models.js` | 2026-09-16 | 2929 | `d28a3e140d28e9ca3c9a377198d31991a9d260e5e4eb0ee59ec77e8c1d93ef23` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/huggingface.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/huggingface.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/huggingface.models.js` | 2026-09-16 | 25417 | `8547bd86bf6db674a6d2374a49d408495c343298d3f55f3289ff7b5af6512d18` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/kimi-coding.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/kimi-coding.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/kimi-coding.models.js` | 2026-09-16 | 1983 | `ca8cc53e57cad0d758f6567245b38c4cbf6df55e5e6cf4f54329f1081e0e3824` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/minimax-cn.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/minimax-cn.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/minimax-cn.models.js` | 2026-09-16 | 1370 | `d38417a974d6437f024842354712774c7fe238e0b033f701559c09255dd16ba5` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/minimax.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/minimax.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/minimax.models.js` | 2026-09-16 | 1346 | `b0fbfa819b7042ece7a87bbd0fb8147bc25040df1d39f1631f15e2576b0c738e` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/mistral.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/mistral.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/mistral.models.js` | 2026-09-16 | 9232 | `859f8ef86ffda353308951c8cdf7f38250b70549225f56fd6a4145bf3d555b31` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/moonshotai-cn.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/moonshotai-cn.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/moonshotai-cn.models.js` | 2026-09-16 | 5054 | `6e767a53a5d94f6b59dd7d35a4782b205f654ccc4e0ff792f6e73ebd2ff9bc17` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/moonshotai.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/moonshotai.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/moonshotai.models.js` | 2026-09-16 | 5015 | `de448381afd928beb8bd39cc2a2f202f93cd7ce6dc8d87101dc75ec07177ad2b` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/nvidia.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/nvidia.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/nvidia.models.js` | 2026-09-16 | 10767 | `583e1946cebec0b212b5da2b2b0a04382d9c4b00702f67b7310ff2401ed50375` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/openai-codex.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/openai-codex.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/openai-codex.models.js` | 2026-09-16 | 4240 | `d86c3b16ec21896b459a145dfbbf2d5d717b46796092fecc29fd1454d46bc83d` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/openai.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/openai.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/openai.models.js` | 2026-09-16 | 16192 | `8eacfd16faac329c100e0876eb59f0e8d20314b3d8f048bf79d4359f3d9f5f9d` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/opencode-go.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/opencode-go.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/opencode-go.models.js` | 2026-09-16 | 11455 | `b31ec28bd63a96db13b75ba38871f8551f97d80de3953ec231d6a6fabe4456be` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/opencode.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/opencode.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/opencode.models.js` | 2026-09-16 | 26795 | `b4467f94b5964ba32301d4bba544828fa5518b6978c951aaafdfafe6e48be3ae` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/openrouter.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/openrouter.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/openrouter.models.js` | 2026-09-16 | 147332 | `cf79274dff5481a59ab2c484a5869f6f2513f0809c273decda8a1da2758213d1` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/qwen-token-plan-cn.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/qwen-token-plan-cn.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/qwen-token-plan-cn.models.js` | 2026-09-16 | 8675 | `7bc43d045d9f6f46909309fc24831fc1d1d2779ffae5709961a5f274fac8d574` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/qwen-token-plan-individual.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/qwen-token-plan-individual.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/qwen-token-plan-individual.models.js` | 2026-09-16 | 4933 | `4cfa7e9e5917388f01e1dc1513c29e7d908787d4c44beff139f2353b3e3e5145` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/qwen-token-plan.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/qwen-token-plan.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/qwen-token-plan.models.js` | 2026-09-16 | 8684 | `aa8accab18586d6d2ad8a54f27edafc4af05f1a59e8386c871c937d1432633ea` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/together.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/together.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/together.models.js` | 2026-09-16 | 11349 | `de7902074f624a66ab53a729811da18b1ca8c6400d8599612e64a5e4a8f9471f` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/vercel-ai-gateway.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/vercel-ai-gateway.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/vercel-ai-gateway.models.js` | 2026-09-16 | 71857 | `c18922df4d018923db455213a12616799722767c05e6956b154f42e649b98a6a` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/xai.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/xai.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/xai.models.js` | 2026-09-16 | 1619 | `9c140362d812492e5116c5addc65358029cb87dbfa8e6995d6f153261407d8bf` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/xiaomi-token-plan-ams.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/xiaomi-token-plan-ams.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/xiaomi-token-plan-ams.models.js` | 2026-09-16 | 1290 | `b2b80b8b91c383ea4ce28978c75aea6a271343223f85f9b8520580e2becbb464` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/xiaomi-token-plan-cn.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/xiaomi-token-plan-cn.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/xiaomi-token-plan-cn.models.js` | 2026-09-16 | 1283 | `e139f8f4e3ed62dc4cc89e37381a229efe38f601f0f4b333e71d79d1eef3ad40` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/xiaomi-token-plan-sgp.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/xiaomi-token-plan-sgp.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/xiaomi-token-plan-sgp.models.js` | 2026-09-16 | 1290 | `d74b21cac1346e4e136e0847dc944ad77cb59809e559413a38f6f112827d18ee` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/xiaomi.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/xiaomi.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/xiaomi.models.js` | 2026-09-16 | 1593 | `c96030047c7d949893a5cd48c618ad9a2b2e3ccfeaca7e8899ee4ad9a4a1d33f` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/zai-coding-cn.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/zai-coding-cn.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/zai-coding-cn.models.js` | 2026-09-16 | 5199 | `79c860adedbd5a843bf558023bdfee2547d2729037a162367f72f8fee4521b4a` |
| `closure/npm/@earendil-works/pi-ai@0.85.1/providers/zai.models/_esm.js` | https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/zai.models/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@earendil-works/pi-ai@0.85.1/dist/providers/zai.models.js` | 2026-09-16 | 3796 | `0fbc01b6f1762577742bb178191ec28a2188e82f917f270d51ac81c103a93540` |
| `closure/npm/@google/genai@2.21.0/_esm.js` | https://testingcf.jsdelivr.net/npm/@google/genai@2.21.0/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@google/genai@2.21.0/dist/web/index.mjs` | 2026-09-16 | 372930 | `4e391d23f2cacac47835ccc47758cb0ef63c9da7904d51ff12a6d21e626e54ef` |
| `closure/npm/@intlify/core-base/_esm.js` | https://testingcf.jsdelivr.net/npm/@intlify/core-base/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@intlify/core-base@11.4.10/dist/core-base.mjs` | 2026-09-16 | 19028 | `64d4e61c376d056ccf1e9983498cb6be923ac77aefa059c20acda3c5dddb53d4` |
| `closure/npm/@intlify/shared/_esm.js` | https://testingcf.jsdelivr.net/npm/@intlify/shared/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/@intlify/shared@11.4.10/dist/shared.mjs` | 2026-09-16 | 5255 | `b8f47f0e8f5595500aa98845f94b4f1081100b9f60e08a28f981434b3fce99de` |
| `closure/npm/compare-versions/_esm.js` | https://testingcf.jsdelivr.net/npm/compare-versions/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/compare-versions@6.1.1/lib/esm/index.js` | 2026-09-16 | 2470 | `72aca95e36fb70155e5f43546fe668c010fe82fd13e5a45d39427b26fed0a6f6` |
| `closure/npm/compare-versions@6.1.1/_esm.js` | https://testingcf.jsdelivr.net/npm/compare-versions@6.1.1/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/compare-versions@6.1.1/lib/esm/index.js` | 2026-09-16 | 2470 | `72aca95e36fb70155e5f43546fe668c010fe82fd13e5a45d39427b26fed0a6f6` |
| `closure/npm/json5/_esm.js` | https://testingcf.jsdelivr.net/npm/json5/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/json5@2.2.3/dist/index.mjs` | 2026-09-16 | 27420 | `39805a3d9701b8ed20e892ccf86223f928382aa17edfc2361e6c5c76a473d3b2` |
| `closure/npm/json5@2.2.3/_esm.js` | https://testingcf.jsdelivr.net/npm/json5@2.2.3/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/json5@2.2.3/dist/index.mjs` | 2026-09-16 | 27420 | `39805a3d9701b8ed20e892ccf86223f928382aa17edfc2361e6c5c76a473d3b2` |
| `closure/npm/jsonrepair/_esm.js` | https://testingcf.jsdelivr.net/npm/jsonrepair/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/jsonrepair@3.15.0/lib/esm/index.js` | 2026-09-16 | 8324 | `d74e6d2d78d2b12a8b32482657f5efa7691d09534551eb700a32ee741ffba362` |
| `closure/npm/jsonrepair@3.15.0/_esm.js` | https://testingcf.jsdelivr.net/npm/jsonrepair@3.15.0/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/jsonrepair@3.15.0/lib/esm/index.js` | 2026-09-16 | 8324 | `d74e6d2d78d2b12a8b32482657f5efa7691d09534551eb700a32ee741ffba362` |
| `closure/npm/klona/_esm.js` | https://testingcf.jsdelivr.net/npm/klona/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/klona@2.0.6/dist/index.mjs` | 2026-09-16 | 1246 | `e6bb95d703905b5d1eed18561ba26568159f383f4b1f7a351de864c26ce8366b` |
| `closure/npm/klona@2.0.6/_esm.js` | https://testingcf.jsdelivr.net/npm/klona@2.0.6/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/klona@2.0.6/dist/index.mjs` | 2026-09-16 | 1246 | `e6bb95d703905b5d1eed18561ba26568159f383f4b1f7a351de864c26ce8366b` |
| `closure/npm/mathjs/_esm.js` | https://testingcf.jsdelivr.net/npm/mathjs/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/mathjs@15.2.0/lib/esm/index.js` | 2026-09-16 | 666500 | `e4f96c41f285c679208828138f3d19a5a0bc364dac729078516029aa998c7dd7` |
| `closure/npm/zod/v4/core/_esm.js` | https://testingcf.jsdelivr.net/npm/zod/v4/core/+esm | jsDelivr `+esm` 打包产物；打包器 Rollup v4.62.2 and esbuild v0.28.1；原文件 `/npm/zod@4.6.5/v4/core/index.js` | 2026-09-16 | 409468 | `1bd3b454a789837ccbb8c37700042e466d3cb12dfa7549bfcc93b10f021519b9` |

## 3. 传递闭包（`closure/**`；机器可读清单 = `manifest.json`）

`mvu/bundle.js` 与 `mvu/mvu_zod.js` 里写死的远程 `import` 说明符**保持原样**（任务要求不得改写），由 importmap 在运行时重映射；因此本目录把它们的**传递闭包**整体自托管：

- 闭包文件数：**88**，合计 **3343172 bytes**。
- `manifest.json` 条目数：**91** = 闭包 88 + 顶层 2（两个 MVU 产物自身的上游 URL）+ `kind: "global"` 的 classic 全局 1 个（Vue；它不是被 `import` 的说明符，**不得**塞进 importmap 的 imports，只用于 globals 装配）。
- 展开规则：种子 = 顶层资产字节里扫描出的全部远程说明符（`https://…` 与 jsDelivr 根相对块 `/npm/…`）；对其逐层 BFS，直到没有任何文件再引用远程说明符 —— `--check` 会复跑这条断言。
- 落盘路径：`closure/npm/<pkg@version>/…/_esm.js`、`closure/gh/<owner>/<repo>/…`；无法归类者落 `closure/_other/<hash>.js`（`+esm` 不是可用文件名，故映射成 `_esm.js`）。
- **路径转义**：目录名若命中仓库忽略规则（`.gitignore` 的 `dist/`/`build/`/`node_modules/`，`.dockerignore` 同）会在末尾加 `_`（如 `…/pi-ai@0.85.1/dist/api/…` → `…/dist_/api/…`），否则这些文件既进不了 git 也进不了 Docker 构建上下文；`--check` 会用 `git check-ignore` 复跑该断言。
- `manifest.json` 由本脚本生成（勿手改）：条目按 `url` 排序，字段 `url`/`path`/`sha256`/`bytes`/`kind`；`path` 为**站点绝对路径**，P3 直接以 `key=url`、`value=path` 生成 `<script type="importmap">`。
- 闭包文件的 sha256 **就是钉扎值**（存放在 `manifest.json`）：上游字节变化会被下载步骤拒绝，需人工复核后 `--accept-closure-change` 重新钉扎。

## 4. 依赖闭合性核验（自动扫描下载到的字节）

扫描规则：`import … from '<x>'` / `export … from '<x>'` / `import '<x>'` / `import('<x>')`，再按 `https://`（绝对 URL）、`/npm|/gh`（CDN 根相对块）、`./`（同目录相对）、裸说明符分类；另扫 `//# sourceMappingURL=<路径>`。**标为「自包含」者即不含任何外部/缺失引用。**

- `lodash.min.js` — **自包含**：无外部 ESM 说明符、无缺失引用。
- `jquery.min.js` — **非自包含**：远程说明符 0 个（须全部出现在 `manifest.json` 中 —— `--check` 断言）；同目录相对/裸说明符 1 个；sourceMappingURL 0 个（其中 0 个是 CDN 根路径，只有 DevTools 会请求）。
  - 其它说明符：`+u+`

- `toastr.min.js` — **非自包含**：远程说明符 0 个（须全部出现在 `manifest.json` 中 —— `--check` 断言）；同目录相对/裸说明符 0 个；sourceMappingURL 1 个（其中 0 个是 CDN 根路径，只有 DevTools 会请求）。
  - 未随目录取回的引用：`toastr.js.map`

- `yaml.min.js` — **自包含**：无外部 ESM 说明符、无缺失引用（其中的 `import` 只指向本目录内已取回的 `yaml/yaml.esm.js`）。
- `yaml/yaml.esm.js` — **非自包含**：远程说明符 0 个（须全部出现在 `manifest.json` 中 —— `--check` 断言）；同目录相对/裸说明符 0 个；sourceMappingURL 1 个（其中 1 个是 CDN 根路径，只有 DevTools 会请求）。
  - 未随目录取回的引用：`/sm/6ae2ee2eebf588a9edcb67150e8d03a7e497fa6961647f99b01926077ffc0ac0.map`

- `zod.mjs` — **自包含**：无外部 ESM 说明符、无缺失引用（其中的 `import` 只指向本目录内已取回的 `zod/zod.esm.js`）。
- `zod/zod.esm.js` — **非自包含**：远程说明符 0 个（须全部出现在 `manifest.json` 中 —— `--check` 断言）；同目录相对/裸说明符 0 个；sourceMappingURL 1 个（其中 1 个是 CDN 根路径，只有 DevTools 会请求）。
  - 未随目录取回的引用：`/sm/3a9ca88a7a24af386438ff6007fa80c64fe09c19cbee7eb27409dd5a4ccde71a.map`

- `vue.global.js` — **自包含**：无外部 ESM 说明符、无缺失引用。
- `mvu/bundle.js` — **非自包含**：远程说明符 51 个（须全部出现在 `manifest.json` 中 —— `--check` 断言）；同目录相对/裸说明符 6 个；sourceMappingURL 1 个（其中 0 个是 CDN 根路径，只有 DevTools 会请求）。

  | 上游包 | 引用数 |
  | --- | --- |
  | `@earendil-works/pi-ai@0.85.1` | 43 |
  | `@google/genai@2.21.0` | 1 |
  | `@intlify/core-base` | 1 |
  | `@intlify/shared` | 1 |
  | `compare-versions` | 1 |
  | `json5` | 1 |
  | `jsonrepair` | 1 |
  | `klona` | 1 |
  | `mathjs` | 1 |

  完整说明符列表：

  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/api/anthropic-messages.lazy/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/api/google-generative-ai.lazy/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/api/google-shared/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/api/mistral-conversations.lazy/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/api/openai-codex-responses.lazy/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/api/openai-completions.lazy/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/api/openai-responses.lazy/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/api/simple-options/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/ant-ling.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/anthropic.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/baseten.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/cerebras.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/deepseek.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/fireworks.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/github-copilot.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/google.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/groq.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/huggingface.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/kimi-coding.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/minimax-cn.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/minimax.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/mistral.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/moonshotai-cn.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/moonshotai.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/nvidia.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/openai-codex.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/openai.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/opencode-go.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/opencode.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/openrouter.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/qwen-token-plan-cn.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/qwen-token-plan-individual.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/qwen-token-plan.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/together.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/vercel-ai-gateway.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/xai.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/xiaomi-token-plan-ams.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/xiaomi-token-plan-cn.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/xiaomi-token-plan-sgp.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/xiaomi.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/zai-coding-cn.models/+esm
  - https://testingcf.jsdelivr.net/npm/@earendil-works/pi-ai@0.85.1/providers/zai.models/+esm
  - https://testingcf.jsdelivr.net/npm/@google/genai@2.21.0/+esm
  - https://testingcf.jsdelivr.net/npm/@intlify/core-base/+esm
  - https://testingcf.jsdelivr.net/npm/@intlify/shared/+esm
  - https://testingcf.jsdelivr.net/npm/compare-versions/+esm
  - https://testingcf.jsdelivr.net/npm/json5/+esm
  - https://testingcf.jsdelivr.net/npm/jsonrepair/+esm
  - https://testingcf.jsdelivr.net/npm/klona/+esm
  - https://testingcf.jsdelivr.net/npm/mathjs/+esm
  - 其它说明符：`${e}`
  - 其它说明符：`${n}`
  - 其它说明符：`${s}`
  - 其它说明符：`${u.toISOString()}`
  - 其它说明符：`,`
  - 其它说明符：`,provider:`
  - 未随目录取回的引用：`bundle.js.map`

- `mvu/mvu_zod.js` — **非自包含**：远程说明符 5 个（须全部出现在 `manifest.json` 中 —— `--check` 断言）；同目录相对/裸说明符 0 个；sourceMappingURL 1 个（其中 0 个是 CDN 根路径，只有 DevTools 会请求）。

  | 上游包 | 引用数 |
  | --- | --- |
  | `compare-versions@6.1.1` | 1 |
  | `json5@2.2.3` | 1 |
  | `jsonrepair@3.15.0` | 1 |
  | `klona@2.0.6` | 1 |
  | `zod` | 1 |

  完整说明符列表：

  - https://testingcf.jsdelivr.net/npm/compare-versions@6.1.1/+esm
  - https://testingcf.jsdelivr.net/npm/json5@2.2.3/+esm
  - https://testingcf.jsdelivr.net/npm/jsonrepair@3.15.0/+esm
  - https://testingcf.jsdelivr.net/npm/klona@2.0.6/+esm
  - https://testingcf.jsdelivr.net/npm/zod/v4/core/+esm
  - 未随目录取回的引用：`mvu_zod.js.map`

## 5. 校验方式

```
python dev-server/tools/update-script-host-vendor.py --check   # 离线复核 sha256
python dev-server/tools/update-script-host-vendor.py           # 重新下载并复核
```

- `--check` 逐文件重新计算 sha256，与上表第 2 节比对，并核对与脚本内 `ASSETS.sha256` 钉扎值、`manifest.json` 里的闭包 sha256 一致；任一处不符即以退出码 1 失败。
- `--check` 同时复跑两条闭合性断言：①`closure/**` 下不得再出现远程说明符；②全目录（顶层资产 + 闭包）出现的每个远程说明符都必须能在 `manifest.json` 里找到 —— 保证 P3 的 importmap 无遗漏。
- 上游字节变化（不带版本号的 `mvu/*`、`+esm` 动态产物、闭包 URL）会被下载步骤**拒绝写入**并报错：前者需在脚本里更新 `ASSETS.sha256`，后者需复核后 `--accept-closure-change` 重新钉扎 —— 这是 SSOT §10「vendor 版本漂移」的应对手段。

