/**
 * 播放协调器（v1.1.0）── quote-tts 内全部朗读按钮的**全局单一音频源**。
 *
 * 需求（2026-10-03 定稿）：播放中点击**另一个**播放按钮 ⇒ 先停止当前语音、再开始
 * 新目标语音；播放中点击**同一个**按钮 ⇒ 停止（toggle）。二者叠加的效果是：任一
 * 时刻本插件最多只有一段音频在合成/播放 —— 对白朗读（QuoteTtsButton）与消息朗读
 * （QuoteTtsBubbleButton）之间、以及任意两个实例之间一律互斥。
 *
 * 实现：模块级**席位**（single active owner）。每个会话开始时 `claimPlayback(stop)`
 * 认领席位；若席位被占，先调用旧会话的 stop（同步、软取消 —— 旧会话把
 * `session.active` 闸门置 false、暂停并回收音频、复位自己的 UI），再换自己上座。
 * 会话结束/停止/出错时 `releasePlayback(stop)` 退席（只在自己仍占席时生效）。
 *
 * ⚠️ 零依赖叶子：本文件不 import 任何东西，两个按钮组件各自只依赖它与
 * `./voices` —— 不触碰宿主模块，不触碰彼此（t10 模块环纪律）。
 * ⚠️ 范围边界（诚实记录）：互斥只覆盖 quote-tts 自家按钮；其它插件/浏览器里
 * 的音频不在此列（浏览器无跨源音频所有权，无从谈起）。
 */

/** 一个"停止本会话"回调：必须同步生效（置闸门、pause 音频、复位 UI），且幂等
 *  —— 同一会话的 stop 可能被协调器、toggle、播放自然结束、卸载清理多条路径调用。 */
export type StopPlaybackFn = () => void;

/** 当前占席会话的 stop 回调；null = 无人朗读。 */
let activeStop: StopPlaybackFn | null = null;

/**
 * 认领朗读席位：若已有别的会话在席，先停止它，再让自己上座。
 * @param stop 本会话的停止回调（同步生效、幂等）。
 */
export function claimPlayback(stop: StopPlaybackFn): void {
  if (activeStop && activeStop !== stop) {
    try {
      activeStop();
    } catch {
      /* 旧会话的停止失败不能阻止新会话开始 */
    }
  }
  activeStop = stop;
}

/**
 * 退席：仅当**本会话**仍在席时清空（防止误清后来者的席位）。
 * @param stop 本会话的停止回调。
 */
export function releasePlayback(stop: StopPlaybackFn): void {
  if (activeStop === stop) activeStop = null;
}

/** 仅供单测/探针：读取当前席位是否有会话（生产代码不使用）。 */
export function hasActivePlaybackOwner(): boolean {
  return activeStop !== null;
}
