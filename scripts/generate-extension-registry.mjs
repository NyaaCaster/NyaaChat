#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());
const extensionsDir = join(root, "public", "extensions");
const registryPath = join(extensionsDir, "registry.json");
const overridesPath = join(extensionsDir, "registry.overrides.json");
// Aggregated outbound allowlist consumed by the ext-host sidecar. The
// controlled voice proxy only forwards to endpoints that some installed
// extension has statically declared (via manifest network_endpoints, or
// operator-managed registry.overrides.json). This keeps install-and-use
// zero-config while preventing the proxy from relaying to undeclared URLs.
const networkAllowlistPath = join(root, "ext-host", "network-allowlist.generated.json");

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
  return manifest;
}

function toBool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

// Mirror the ext-host sidecar's URL normalization so declared endpoints
// match the runtime allowlist comparison exactly (hash stripped).
function normalizeEndpoint(value) {
  try {
    const url = new URL(String(value));
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function collectEndpoints(source, into) {
  if (!source || !Array.isArray(source.network_endpoints)) return;
  for (const raw of source.network_endpoints) {
    const normalized = normalizeEndpoint(raw);
    if (normalized) into.add(normalized);
  }
}

function buildRegistry() {
  const overrides = readOverrides();
  const ids = existsSync(extensionsDir)
    ? readdirSync(extensionsDir).filter(isExtensionDir).sort((a, b) => a.localeCompare(b))
    : [];

  const networkEndpoints = new Set();
  const extensions = ids.map((id) => {
    const manifest = validateManifest(id);
    const override = overrides[id] && typeof overrides[id] === "object" ? overrides[id] : {};
    // Union of author-declared (manifest) and operator-declared (overrides)
    // endpoints. Operator overrides let third-party extensions whose upstream
    // can't be edited still declare endpoints without touching their dir.
    collectEndpoints(manifest, networkEndpoints);
    collectEndpoints(override, networkEndpoints);
    return {
      id,
      rootEnabled: toBool(override.rootEnabled, true),
      defaultUserEnabled: toBool(override.defaultUserEnabled, false),
    };
  });

  return {
    registry: { version: 1, extensions },
    networkAllowlist: { version: 1, endpoints: [...networkEndpoints].sort() },
  };
}

const { registry, networkAllowlist } = buildRegistry();
writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
writeFileSync(networkAllowlistPath, `${JSON.stringify(networkAllowlist, null, 2)}\n`, "utf8");
console.log(`Generated ${registryPath} (${registry.extensions.length} extension${registry.extensions.length === 1 ? "" : "s"})`);
console.log(`Generated ${networkAllowlistPath} (${networkAllowlist.endpoints.length} endpoint${networkAllowlist.endpoints.length === 1 ? "" : "s"})`);
