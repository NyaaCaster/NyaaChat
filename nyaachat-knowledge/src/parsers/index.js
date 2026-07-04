// Document parsers for the knowledge base backend.
//
// V1 supports txt / md / pdf only. docx / epub / xls are out of scope per the
// SSOT (§9 of the audit report) and will be added in later versions.
// Based on NyaaLibrary-MCP server/src/parsers/index.ts.

import { extname } from "node:path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

const SUPPORTED_EXTENSIONS = [".txt", ".md", ".pdf"];

export function extOf(filename) {
  return extname(filename).toLowerCase();
}

export function isSupported(filename) {
  return SUPPORTED_EXTENSIONS.includes(extOf(filename));
}

/** Collapse excessive whitespace while preserving paragraph breaks. */
function normalize(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function parsePdf(buffer) {
  const { text } = await pdfParse(buffer);
  return text;
}

/** Extract plain text from a supported document buffer. */
export async function extractText(filename, buffer) {
  const ext = extOf(filename);
  let text;
  switch (ext) {
    case ".txt":
    case ".md":
      text = buffer.toString("utf8");
      break;
    case ".pdf":
      text = await parsePdf(buffer);
      break;
    default:
      throw new Error(`不支持的文件格式：${ext || "(无扩展名)"}`);
  }
  return normalize(text);
}

export { SUPPORTED_EXTENSIONS };
