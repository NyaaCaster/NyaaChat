import OpenAI from "@lobehub/icons/es/OpenAI";
import Anthropic from "@lobehub/icons/es/Anthropic";
import Gemini from "@lobehub/icons/es/Gemini";
import DeepSeek from "@lobehub/icons/es/DeepSeek";
import Ollama from "@lobehub/icons/es/Ollama";
import OpenCode from "@lobehub/icons/es/OpenCode";
import ComfyUI from "@lobehub/icons/es/ComfyUI";
import { Palette } from "lucide-react";
import { ImageProviderKind, LlmProviderKind } from "../../types";
import { QinyIcon } from "./QinyIcon";
import { CustomProviderIcon } from "./CustomProviderIcon";

interface IconProps {
  size?: number;
}

/**
 * Render the brand mark for any LLM provider kind. The set of @lobehub/icons
 * doesn't ship a QinyAPI logo so we substitute the in-house QinyIcon, and
 * `custom` (user-defined endpoints) gets a chat-bubble glyph in the project
 * blue — distinct from the toolbar's MCP plug and the model-capability
 * wrench so they don't visually collide.
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
    case "opencode-go":
      return <OpenCode size={size} />;
    case "ollama":
      return <Ollama size={size} />;
    case "custom":
      return <CustomProviderIcon size={size} />;
  }
}

export function ImageProviderIcon({ kind, size = 18 }: IconProps & { kind: ImageProviderKind }) {
  switch (kind) {
    case "qiny":
      return <QinyIcon size={size} />;
    case "openai-custom":
      // Palette glyph in the project blue — marks a user-defined OpenAI-
      // compatible image endpoint, distinct from the built-in QinyAPI mark.
      return <Palette size={size} color="#3B82F6" />;
    case "comfyui-fixed":
    case "comfyui-custom":
      return <ComfyUI.Color size={size} />;
  }
}
