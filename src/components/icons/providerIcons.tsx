import OpenAI from "@lobehub/icons/es/OpenAI";
import Anthropic from "@lobehub/icons/es/Anthropic";
import Gemini from "@lobehub/icons/es/Gemini";
import DeepSeek from "@lobehub/icons/es/DeepSeek";
import Ollama from "@lobehub/icons/es/Ollama";
import ComfyUI from "@lobehub/icons/es/ComfyUI";
import { Wrench } from "lucide-react";
import { ImageProviderKind, LlmProviderKind } from "../../types";
import { QinyIcon } from "./QinyIcon";

interface IconProps {
  size?: number;
}

/**
 * Render the brand mark for any LLM provider kind. The set of @lobehub/icons
 * doesn't ship a QinyAPI logo so we substitute the in-house QinyIcon, and
 * `custom` (user-defined endpoints) gets a generic wrench icon.
 */
export function LlmProviderIcon({ kind, size = 18 }: IconProps & { kind: LlmProviderKind }) {
  switch (kind) {
    case "qiny":
      return <QinyIcon size={size} />;
    case "gemini":
      return <Gemini.Color size={size} />;
    case "anthropic":
      return <Anthropic size={size} color="#D97757" />;
    case "openai":
      return <OpenAI size={size} />;
    case "deepseek":
      return <DeepSeek.Color size={size} />;
    case "ollama":
      return <Ollama size={size} />;
    case "custom":
      return <Wrench size={size} className="text-gray-500 dark:text-gray-400" />;
  }
}

export function ImageProviderIcon({ kind, size = 18 }: IconProps & { kind: ImageProviderKind }) {
  switch (kind) {
    case "qiny":
      return <QinyIcon size={size} />;
    case "comfyui":
      return <ComfyUI.Color size={size} />;
  }
}
