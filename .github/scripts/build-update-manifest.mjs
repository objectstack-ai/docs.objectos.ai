#!/usr/bin/env node
/**
 * Build a Tauri updater manifest (latest.json) from CI artifacts.
 *
 * Walks the artifacts/ directory produced by `actions/download-artifact`,
 * finds the platform-specific updater bundles + their `.sig` siblings,
 * and emits a JSON manifest to stdout.
 *
 * Mapping (Tauri v2 default formats with createUpdaterArtifacts=true):
 *   macOS   → *.app.tar.gz                     (+ .sig)
 *   Linux   → *.AppImage.tar.gz | *.AppImage   (+ .sig)
 *   Windows → *.nsis.zip  | *-setup.exe        (+ .sig)
 *
 * Usage:
 *   node build-update-manifest.mjs <artifacts-dir> <tag>
 *
 * <tag> is the git tag (e.g. `one-v6.0.0`). The leading `one-v` (or any
 * leading non-digit) is stripped to derive the semver.
 *
 * Public download URLs are built from the repo's GitHub Releases.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const [, , artifactsDir, tag] = process.argv;
if (!artifactsDir || !tag) {
  console.error('usage: build-update-manifest.mjs <artifacts-dir> <tag>');
  process.exit(2);
}

const REPO = process.env.GITHUB_REPOSITORY ?? 'objectstack-ai/docs.objectos.ai';
const version = tag.replace(/^[^0-9]*/, '');

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const files = Array.from(walk(artifactsDir));
const pick = (predicate) => files.find(predicate);

function platformEntry(bundle) {
  if (!bundle) return null;
  const sig = pick((f) => f === `${bundle}.sig`);
  if (!sig) {
    console.error(`! no .sig for ${bundle} — skipping`);
    return null;
  }
  return {
    signature: readFileSync(sig, 'utf8').trim(),
    url: `https://github.com/${REPO}/releases/download/${tag}/${basename(bundle)}`,
  };
}

// macOS: aarch64 only matches arm64; do NOT fall back to x64. Vice versa.
const macArm = pick((f) => /aarch64.*\.app\.tar\.gz$/.test(f) || /arm64.*\.app\.tar\.gz$/.test(f));
const macX64 = pick((f) => /x86_64.*\.app\.tar\.gz$/.test(f) || /x64.*\.app\.tar\.gz$/.test(f));
const winX64 =
  pick((f) => /\.nsis\.zip$/.test(f)) ??
  pick((f) => /-setup\.exe$/.test(f) && !!pick((g) => g === `${f}.sig`));
const linX64 =
  pick((f) => /\.AppImage\.tar\.gz$/.test(f)) ??
  pick((f) => /\.AppImage$/.test(f) && !!pick((g) => g === `${f}.sig`));

const platforms = {};
const addIfFound = (key, bundle) => {
  const entry = platformEntry(bundle);
  if (entry) platforms[key] = entry;
};
addIfFound('darwin-aarch64', macArm);
addIfFound('darwin-x86_64', macX64);
addIfFound('windows-x86_64', winX64);
addIfFound('linux-x86_64', linX64);

if (Object.keys(platforms).length === 0) {
  console.error('! no platform bundles detected — aborting');
  process.exit(1);
}

const manifest = {
  version,
  notes: `See https://github.com/${REPO}/releases/tag/${tag}`,
  pub_date: new Date().toISOString(),
  platforms,
};

process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
console.error(`✓ manifest for v${version} with ${Object.keys(platforms).length} platforms`);
