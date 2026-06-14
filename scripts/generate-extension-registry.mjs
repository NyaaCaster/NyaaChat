#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());
const extensionsDir = join(root, "public", "extensions");
const registryPath = join(extensionsDir, "registry.json");
const overridesPath = join(extensionsDir, "registry.overrides.json");

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`${path}: ${err.message}`);
  }
}

function readOverrides() {
  if (!existsSync(overridesPath)) return {};
  const parsed = readJson(overridesPath);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${overridesPath}: expected an object keyed by extension id`);
  }
  return parsed;
}

function isExtensionDir(name) {
  if (!name || name.startsWith(".")) return false;
  const fullPath = join(extensionsDir, name);
  return statSync(fullPath).isDirectory() && existsSync(join(fullPath, "manifest.json"));
}

function validateManifest(id) {
  const manifestPath = join(extensionsDir, id, "manifest.json");
  const manifest = readJson(manifestPath);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`${manifestPath}: expected a JSON object`);
  }
  if (typeof manifest.display_name !== "string" || !manifest.display_name.trim()) {
    throw new Error(`${manifestPath}: missing required display_name`);
  }
}

function toBool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function buildRegistry() {
  const overrides = readOverrides();
  const ids = existsSync(extensionsDir)
    ? readdirSync(extensionsDir).filter(isExtensionDir).sort((a, b) => a.localeCompare(b))
    : [];

  const extensions = ids.map((id) => {
    validateManifest(id);
    const override = overrides[id] && typeof overrides[id] === "object" ? overrides[id] : {};
    return {
      id,
      rootEnabled: toBool(override.rootEnabled, true),
      defaultUserEnabled: toBool(override.defaultUserEnabled, false),
    };
  });

  return { version: 1, extensions };
}

const registry = buildRegistry();
writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
console.log(`Generated ${registryPath} (${registry.extensions.length} extension${registry.extensions.length === 1 ? "" : "s"})`);
