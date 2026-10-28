#!/usr/bin/env node
/**
 * Upstream pins — move one of `.objectstack-sha` / `.cloud-sha` and write the
 * pull-request body that lists what changed upstream since the previous pin.
 *
 * ## Why this exists
 *
 * This site documents two upstreams it does not contain: the open-source
 * framework (`objectstack-ai/objectstack`) and ObjectOS Cloud
 * (`objectstack-ai/cloud`). Aligning the site with them used to be a periodic
 * re-read of both corpora, an unbounded input that misses whatever that one
 * pass misses. A pin turns it into a bounded one: each file at the repository
 * root holds the one upstream commit the site was last aligned to, and every
 * alignment is a review of the upstream commits and changed paths since that
 * commit. This script computes that range; `bump-upstream-docs.yml` runs it
 * and opens the pull request whose body it writes.
 *
 * ## When a pin moves
 *
 *   objectstack  on a published `@objectstack/cli` release — the commit its
 *                release tag `@objectstack/cli@VERSION` names. With no `--sha`,
 *                the release is npm's `latest` dist-tag.
 *   cloud        after a successful cloud production deploy — the commit that
 *                deploy serves, never a merge to cloud's `main`. There is no
 *                default: the deploy supplies `--sha`, and the run refuses
 *                without one.
 *
 * ## The pin file
 *
 * Exactly one line: a full, lowercase, 40-character commit SHA. The one other
 * accepted value is the placeholder `unpinned`, for an upstream that has never
 * been pinned (`.cloud-sha` ships with it, because cloud is a private
 * repository this site's maintainers could not read when the pins were added).
 * A range cannot start at the placeholder, so the first bump of an unpinned
 * upstream only records the commit and says so; the next bump is the first
 * bounded diff. A missing file, an empty one, an abbreviated SHA or a branch
 * name is refused — a pin that cannot be resolved to one commit bounds nothing.
 *
 * ## Refusals, all loud
 *
 *   - the new commit is not a descendant of the current pin — the range
 *     `OLD..NEW` would silently drop whatever `OLD` has that `NEW` lacks, and
 *     the review would read a diff that is not the change;
 *   - the upstream cannot be read — cloud is private and needs `UPSTREAM_TOKEN`;
 *   - a cloud bump with no `--sha`.
 *
 * A bump to the commit already pinned is not an error: it writes nothing,
 * reports `changed=false`, and the workflow opens no pull request.
 *
 * ## The body is inert text
 *
 * Upstream commit subjects end in `(#NNNN)`, which in a pull request HERE would
 * link to this repository's issue of that number — a working link to the wrong
 * thing — and a subject carrying a closing keyword would close it on merge. So
 * both lists sit in fenced `text` blocks, where GitHub neither links a
 * reference nor reads a closing keyword, and any backtick run that could end
 * the fence early is shortened. A GitHub body holds at most 65536 characters;
 * the lists are cut to fit with the number of omitted lines stated, and the
 * body names the command that reproduces the full list.
 *
 * ## Usage
 *
 *   node .github/scripts/bump-upstream-pin.mjs --check
 *       Validate both pin files. Exit 1 naming each bad one.
 *   node .github/scripts/bump-upstream-pin.mjs --upstream objectstack|cloud \
 *       [--sha SHA] --body FILE [--git-dir DIR]
 *       Resolve, fetch (blobless) into DIR, write the new pin and the body.
 *       Writes `changed`, `old`, `new`, `short`, `label` and `title` to $GITHUB_OUTPUT
 *       when it is set. Reads `UPSTREAM_TOKEN` from the environment and passes
 *       it to git through `GIT_CONFIG_*` variables, never on a command line.
 *   node .github/scripts/bump-upstream-pin.mjs --self-test
 */

import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The two upstreams. `paths` is what the alignment review reads. */
const UPSTREAMS = {
  objectstack: {
    repo: 'objectstack-ai/objectstack',
    pinFile: '.objectstack-sha',
    paths: ['content/docs', 'docs/releases', 'CHANGELOG.md'],
    release: '@objectstack/cli',
  },
  cloud: {
    repo: 'objectstack-ai/cloud',
    pinFile: '.cloud-sha',
    paths: ['CHANGELOG.md', '.changeset'],
    release: null,
  },
};

const PLACEHOLDER = 'unpinned';
const FULL_SHA = /^[0-9a-f]{40}$/;
/** GitHub refuses a body over 65536 characters; leave room for the frame. */
const BODY_LIMIT = 60000;

class Refusal extends Error {}

/** Parse a pin file's text. Returns `{ sha }` or `{ placeholder: true }`; throws a Refusal. */
function parsePin(text, name) {
  if (text === null) throw new Refusal(`${name} is missing — every upstream has a pin file`);
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  if (body === PLACEHOLDER) return { placeholder: true };
  if (body === '') throw new Refusal(`${name} is empty — expected a full commit SHA or \`${PLACEHOLDER}\``);
  if (body.includes('\n')) throw new Refusal(`${name} has more than one line — expected exactly one SHA`);
  if (!FULL_SHA.test(body)) {
    throw new Refusal(
      `${name} holds ${JSON.stringify(body.slice(0, 60))} — expected a full 40-character lowercase SHA or \`${PLACEHOLDER}\``,
    );
  }
  return { sha: body };
}

function parseUpstream(name) {
  if (!Object.hasOwn(UPSTREAMS, name ?? '')) {
    throw new Refusal(`unknown upstream ${JSON.stringify(name ?? '')} — expected one of ${Object.keys(UPSTREAMS).join(', ')}`);
  }
  return UPSTREAMS[name];
}

/** A `--sha` / dispatch-payload value: absent, or a full SHA. Never a ref name. */
function parseShaInput(value) {
  const v = (value ?? '').trim();
  if (v === '') return null;
  if (!FULL_SHA.test(v)) {
    throw new Refusal(`sha ${JSON.stringify(v.slice(0, 60))} is not a full 40-character lowercase commit SHA`);
  }
  return v;
}

/** From `git ls-remote` output, the commit a tag names: the peeled `^{}` line wins over the tag object. */
function tagCommit(lsRemote, tag) {
  let direct = null;
  for (const line of lsRemote.split('\n')) {
    const [sha, ref] = line.split('\t');
    if (ref === `refs/tags/${tag}^{}`) return sha;
    if (ref === `refs/tags/${tag}`) direct = sha;
  }
  return direct;
}

/** What a bump does, before any git is read. */
function plan(oldPin, newSha) {
  if (oldPin.placeholder) return 'initial';
  if (oldPin.sha === newSha) return 'unchanged';
  return 'range';
}

/** Make a line safe inside a ``` fence: no run of three or more backticks survives. */
function fenceSafe(line) {
  return line.replace(/`{3,}/g, (run) => "'".repeat(run.length));
}

/** Render a list into a fenced block within `budget` characters; reports how many lines were left out. */
function fencedList(lines, budget) {
  const out = [];
  let used = 0;
  for (const raw of lines) {
    const line = fenceSafe(raw);
    if (used + line.length + 1 > budget) break;
    out.push(line);
    used += line.length + 1;
  }
  const omitted = lines.length - out.length;
  const block = ['```text', ...(out.length ? out : ['(none)']), '```'];
  if (omitted) block.push(`_${omitted} more line(s) not shown — the body is capped at ${BODY_LIMIT} characters; run the command below for the full list._`);
  return block.join('\n');
}

/** Pure: the pull-request body. */
function renderBody(r) {
  const head = [
    `Moves \`${r.pinFile}\` — the commit of [\`${r.repo}\`](https://github.com/${r.repo}) this site is aligned to.`,
    '',
    `- **Upstream:** \`${r.repo}\``,
    `- **Previous pin:** ${r.old ? `\`${r.old}\`` : `\`${PLACEHOLDER}\` (never pinned)`}`,
    `- **New pin:** \`${r.new}\` — ${r.source}`,
  ];
  if (r.kind === 'initial') {
    return [
      ...head,
      '',
      '## Upstream changes since the previous pin',
      '',
      'None listed: this is the first pin of this upstream, so there is no previous commit to diff against. The next bump of this upstream is the first bounded diff.',
      '',
    ].join('\n');
  }
  const command = `git log --oneline ${r.old.slice(0, 12)}..${r.new.slice(0, 12)} -- ${r.present.join(' ')}`;
  const intro = [
    ...head,
    `- **Compare:** https://github.com/${r.repo}/compare/${r.old}...${r.new}`,
    `- **Paths read:** ${r.present.map((p) => `\`${p}\``).join(', ') || '(none present)'}` +
      (r.absent.length ? ` · absent at both pins, so not read: ${r.absent.map((p) => `\`${p}\``).join(', ')}` : ''),
    '',
    'This body is the input of the alignment review: read the changes below, and update the English pages they affect before this pin lands.',
    '',
  ].join('\n');
  const frame = intro.length + command.length + 600;
  const budget = Math.max(0, BODY_LIMIT - frame);
  // Paths first: they are the bounded, review-shaped half. Commits get the rest.
  const pathsBlock = fencedList(r.files, Math.floor(budget / 2));
  const commitsBlock = fencedList(r.commits, budget - pathsBlock.length);
  return [
    intro,
    `## Changed paths (${r.files.length})`,
    '',
    pathsBlock,
    '',
    `## Upstream commits touching those paths (${r.commits.length}, newest first)`,
    '',
    commitsBlock,
    '',
    'Full list, in a clone of the upstream:',
    '',
    '```sh',
    command,
    '```',
    '',
  ].join('\n');
}

/* ------------------------------------------------------------------ git -- */

/** Environment for git: the token rides in GIT_CONFIG_* variables, never argv. */
function gitEnv(token) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (token) {
    const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${basic}`;
  }
  return env;
}

function git(args, { gitDir, env, allowFail = false } = {}) {
  const full = gitDir ? ['--git-dir', gitDir, ...args] : args;
  const run = spawnSync('git', full, { env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (run.error) throw new Refusal(`git ${args[0]} could not run: ${run.error.message}`);
  if (run.status !== 0 && !allowFail) {
    throw new Refusal(`git ${args[0]} exited ${run.status}: ${(run.stderr || '').trim().split('\n').slice(-3).join(' / ')}`);
  }
  return run;
}

async function latestRelease(pkg) {
  const res = await fetch(`https://registry.npmjs.org/${pkg.replace('/', '%2f')}`);
  if (!res.ok) throw new Refusal(`npm registry answered ${res.status} for ${pkg}`);
  const latest = (await res.json())?.['dist-tags']?.latest;
  if (!latest) throw new Refusal(`npm registry has no \`latest\` dist-tag for ${pkg}`);
  return latest;
}

function readPinFile(root, up) {
  const path = join(root, up.pinFile);
  return parsePin(existsSync(path) ? readFileSync(path, 'utf8') : null, up.pinFile);
}

async function bump(opts) {
  const name = opts.upstream;
  const up = parseUpstream(name);
  const oldPin = readPinFile(opts.root, up);
  const url = `https://github.com/${up.repo}.git`;
  const env = gitEnv(process.env.UPSTREAM_TOKEN);

  let newSha = parseShaInput(opts.sha);
  let source = 'supplied by the run that requested this bump';
  let target = null;
  if (!newSha) {
    if (!up.release) {
      throw new Refusal(`a ${name} bump needs --sha: the commit its production deploy serves (there is no default)`);
    }
    const version = await latestRelease(up.release);
    const tag = `${up.release}@${version}`;
    const ls = git(['ls-remote', url, `refs/tags/${tag}`, `refs/tags/${tag}^{}`], { env });
    newSha = tagCommit(ls.stdout, tag);
    if (!newSha) throw new Refusal(`npm's latest ${up.release} is ${version}, but ${up.repo} has no tag ${tag}`);
    source = `the commit tagged \`${tag}\`, npm's \`latest\` ${up.release} release`;
    target = `${tag} (${newSha.slice(0, 7)})`;
  }

  const kind = plan(oldPin, newSha);
  if (kind === 'unchanged') return { changed: false, name, up, old: oldPin.sha, new: newSha };

  const gitDir = opts.gitDir ?? mkdtempSync(join(tmpdir(), `upstream-${name}-`));
  if (!existsSync(join(gitDir, 'HEAD'))) git(['init', '--quiet', '--bare', gitDir]);
  const wants = kind === 'range' ? [newSha, oldPin.sha] : [newSha];
  const fetched = git(['fetch', '--quiet', '--filter=blob:none', url, ...wants], { gitDir, env, allowFail: true });
  if (fetched.status !== 0) {
    const hint = name === 'cloud' && !process.env.UPSTREAM_TOKEN ? ' — cloud is private: set UPSTREAM_TOKEN' : '';
    throw new Refusal(`could not fetch ${up.repo} at ${wants.join(', ')}${hint}: ${(fetched.stderr || '').trim().split('\n').pop()}`);
  }
  git(['cat-file', '-e', `${newSha}^{commit}`], { gitDir });

  const title = `chore(upstream): pin ${name} to ${target ?? newSha.slice(0, 7)}`;
  const result = { changed: true, kind, name, up, repo: up.repo, pinFile: up.pinFile, new: newSha, source, title };
  if (kind === 'range') {
    result.old = oldPin.sha;
    const anc = git(['merge-base', '--is-ancestor', oldPin.sha, newSha], { gitDir, allowFail: true });
    if (anc.status === 1) {
      throw new Refusal(`${newSha} is not a descendant of the current pin ${oldPin.sha} — the range would hide the commits only the old pin has`);
    }
    if (anc.status !== 0) throw new Refusal(`git merge-base exited ${anc.status}: ${anc.stderr.trim()}`);
    const exists = (sha, p) => git(['cat-file', '-e', `${sha}:${p}`], { gitDir, allowFail: true }).status === 0;
    result.present = up.paths.filter((p) => exists(oldPin.sha, p) || exists(newSha, p));
    result.absent = up.paths.filter((p) => !result.present.includes(p));
    const lines = (out) => out.split('\n').filter(Boolean);
    result.files = result.present.length
      ? lines(git(['diff', '--no-renames', '--name-status', oldPin.sha, newSha, '--', ...result.present], { gitDir }).stdout)
          .map((l) => l.replace('\t', '  '))
      : [];
    result.commits = result.present.length
      ? lines(git(['log', '--format=%h %ad %s', '--date=short', `${oldPin.sha}..${newSha}`, '--', ...result.present], { gitDir }).stdout)
      : [];
  }
  return result;
}

/* ----------------------------------------------------------------- modes -- */

function check(root) {
  let bad = 0;
  for (const up of Object.values(UPSTREAMS)) {
    try {
      const pin = readPinFile(root, up);
      console.log(`✓ ${up.pinFile}: ${pin.placeholder ? `\`${PLACEHOLDER}\` (never pinned)` : pin.sha}`);
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      console.error(`✗ ${e.message}`);
      bad += 1;
    }
  }
  if (bad) process.exitCode = 1;
}

function emit(outputs) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  appendFileSync(file, Object.entries(outputs).map(([k, v]) => `${k}=${v}\n`).join(''));
}

async function runBump(opts) {
  if (!opts.body) throw new Refusal('--body FILE is required');
  const r = await bump(opts);
  if (!r.changed) {
    console.log(`= ${r.up.pinFile} already pins ${r.new}; nothing to bump`);
    emit({ changed: 'false', old: r.old, new: r.new, short: r.new.slice(0, 7), label: r.name });
    return;
  }
  writeFileSync(join(opts.root, r.pinFile), `${r.new}\n`);
  writeFileSync(opts.body, renderBody(r));
  const counts = r.kind === 'range' ? `${r.commits.length} commit(s), ${r.files.length} path(s)` : 'first pin, no range';
  console.log(`✓ ${r.pinFile}: ${r.old ?? PLACEHOLDER} → ${r.new} (${counts}); body written to ${opts.body}`);
  emit({ changed: 'true', old: r.old ?? PLACEHOLDER, new: r.new, short: r.new.slice(0, 7), label: r.name, title: r.title });
}

/* ------------------------------------------------------------- self-test -- */

const S1 = 'a'.repeat(40);
const S2 = '0123456789abcdef0123456789abcdef01234567';

/** Each case declares the outcome it must produce; a refusal case names a fragment of its message. */
const PIN_CASES = [
  { name: 'full SHA', text: `${S1}\n`, want: { sha: S1 } },
  { name: 'full SHA, no trailing newline', text: S1, want: { sha: S1 } },
  { name: 'placeholder', text: `${PLACEHOLDER}\n`, want: { placeholder: true } },
  { name: 'missing file', text: null, refuse: 'is missing' },
  { name: 'empty file', text: '', refuse: 'is empty' },
  { name: 'newline only', text: '\n', refuse: 'is empty' },
  { name: 'abbreviated SHA', text: `${S1.slice(0, 7)}\n`, refuse: 'full 40-character' },
  { name: 'uppercase SHA', text: `${S1.toUpperCase()}\n`, refuse: 'full 40-character' },
  { name: 'branch name', text: 'main\n', refuse: 'full 40-character' },
  { name: 'two lines', text: `${S1}\n${S2}\n`, refuse: 'more than one line' },
  { name: 'comment beside the SHA', text: `${S1} # 17.7.0\n`, refuse: 'full 40-character' },
];

const INPUT_CASES = [
  { name: 'absent', value: undefined, want: null },
  { name: 'blank (an empty dispatch input)', value: '  ', want: null },
  { name: 'full SHA', value: S2, want: S2 },
  { name: 'branch name', value: 'main', refuse: 'not a full' },
  { name: 'short SHA', value: S2.slice(0, 12), refuse: 'not a full' },
  { name: 'tag name', value: '@objectstack/cli@18.2.0', refuse: 'not a full' },
];

/** Is `needle` on a line inside a ```text fence of `body`? References there are neither linked nor read as closing keywords. */
function insideTextFence(body, needle) {
  let inFence = false;
  for (const line of body.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence && line === '```text';
    else if (inFence && line.includes(needle)) return true;
  }
  return false;
}

function selfTest() {
  let failed = 0;
  const fail = (msg) => {
    console.error(`  ✗ ${msg}`);
    failed += 1;
  };
  const expectRefusal = (label, fn, fragment) => {
    try {
      const got = fn();
      fail(`${label}: expected a refusal containing "${fragment}", got ${JSON.stringify(got)}`);
    } catch (e) {
      if (!(e instanceof Refusal)) fail(`${label}: threw a non-refusal ${e}`);
      else if (!e.message.includes(fragment)) fail(`${label}: refusal "${e.message}" lacks "${fragment}"`);
    }
  };

  for (const c of PIN_CASES) {
    if (c.refuse) expectRefusal(`pin: ${c.name}`, () => parsePin(c.text, '.x-sha'), c.refuse);
    else {
      const got = parsePin(c.text, '.x-sha');
      if (JSON.stringify(got) !== JSON.stringify(c.want)) fail(`pin: ${c.name}: got ${JSON.stringify(got)}`);
    }
  }
  for (const c of INPUT_CASES) {
    if (c.refuse) expectRefusal(`sha input: ${c.name}`, () => parseShaInput(c.value), c.refuse);
    else if (parseShaInput(c.value) !== c.want) fail(`sha input: ${c.name}: got ${parseShaInput(c.value)}`);
  }

  // Upstream names: the two declared ones, and nothing that merely inherits from Object.
  for (const ok of ['objectstack', 'cloud']) if (parseUpstream(ok) !== UPSTREAMS[ok]) fail(`upstream: ${ok} not resolved`);
  for (const bad of ['', 'objectui', 'toString', '__proto__', undefined]) {
    expectRefusal(`upstream: ${JSON.stringify(bad)}`, () => parseUpstream(bad), 'unknown upstream');
  }

  // The pin a missing file refuses is the real reader, against a real (temporary) tree.
  const empty = mkdtempSync(join(tmpdir(), 'pin-selftest-'));
  try {
    expectRefusal('reader: missing .cloud-sha', () => readPinFile(empty, UPSTREAMS.cloud), '.cloud-sha is missing');
    writeFileSync(join(empty, '.objectstack-sha'), `${S2}\n`);
    if (readPinFile(empty, UPSTREAMS.objectstack).sha !== S2) fail('reader: a written pin did not read back');
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }

  // Tag resolution: an annotated tag's peeled line wins; a lightweight tag has only the direct line.
  const tag = '@objectstack/cli@17.7.0';
  const annotated = `${S1}\trefs/tags/${tag}\n${S2}\trefs/tags/${tag}^{}\n`;
  if (tagCommit(annotated, tag) !== S2) fail('tag: annotated tag did not resolve to its peeled commit');
  if (tagCommit(`${S1}\trefs/tags/${tag}\n`, tag) !== S1) fail('tag: lightweight tag did not resolve');
  if (tagCommit(`${S1}\trefs/tags/${tag}.1\n`, tag) !== null) fail('tag: a different tag was accepted');

  // Plan: the placeholder starts no range, the same commit bumps nothing.
  if (plan({ placeholder: true }, S1) !== 'initial') fail('plan: placeholder did not plan an initial pin');
  if (plan({ sha: S1 }, S1) !== 'unchanged') fail('plan: same commit did not plan unchanged');
  if (plan({ sha: S1 }, S2) !== 'range') fail('plan: two commits did not plan a range');

  // Body: inert, bounded, and honest about what it left out.
  const base = {
    kind: 'range', repo: 'objectstack-ai/objectstack', pinFile: '.objectstack-sha',
    old: S1, new: S2, source: 'test', present: ['content/docs', 'CHANGELOG.md'], absent: ['docs/releases'],
  };
  const small = renderBody({ ...base, files: ['M  content/docs/a.mdx'], commits: ['abc1234 2026-10-01 fix: closes #12 (#26313) ```x```'] });
  const fences = small.split('\n').filter((l) => l.startsWith('```')).length;
  if (fences % 2 !== 0) fail('body: a backtick run in a subject left a fence unbalanced');
  if (!insideTextFence(small, "fix: closes #12 (#26313) '''x'''")) fail('body: a commit subject is not carried inside a text fence');
  if (!insideTextFence(small, 'M  content/docs/a.mdx')) fail('body: a changed path is not carried inside a text fence');
  if (!small.includes('absent at both pins, so not read: `docs/releases`')) fail('body: absent path not named');
  if (/not shown/.test(small)) fail('body: a small list reported omitted lines');
  const many = Array.from({ length: 5000 }, (_, i) => `${String(i).padStart(7, '0')} 2026-10-01 ${'x'.repeat(60)} (#${i})`);
  const big = renderBody({ ...base, files: many.map((l) => `M  content/docs/${l}.mdx`), commits: many });
  if (big.length > 65536) fail(`body: ${big.length} characters is over GitHub's 65536 limit`);
  if (!/## Changed paths \(5000\)/.test(big) || !/## Upstream commits touching those paths \(5000, newest first\)/.test(big)) fail('body: totals not stated');
  if ((big.match(/more line\(s\) not shown/g) ?? []).length !== 2) fail('body: truncation not reported for both lists');
  const initial = renderBody({ kind: 'initial', repo: 'objectstack-ai/cloud', pinFile: '.cloud-sha', new: S2, source: 'test' });
  if (!initial.includes('`unpinned` (never pinned)') || !initial.includes('first pin')) fail('body: initial pin not stated');

  // The token never reaches argv: it rides in GIT_CONFIG_* only.
  const env = gitEnv('tok-123');
  if (env.GIT_CONFIG_KEY_0 !== 'http.https://github.com/.extraheader' || !env.GIT_CONFIG_VALUE_0.includes(Buffer.from('x-access-token:tok-123').toString('base64'))) {
    fail('token: not carried in GIT_CONFIG_*');
  }
  if (gitEnv('').GIT_CONFIG_VALUE_0 !== process.env.GIT_CONFIG_VALUE_0) fail('token: an empty token still set GIT_CONFIG_*');

  const total = PIN_CASES.length + INPUT_CASES.length;
  if (failed) {
    console.error(`\n✗ self-test: ${failed} check(s) did not behave as declared`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ self-test: ${total} pin/input case(s), upstream names, tag resolution, plan, body bounds and token carriage`);
}

/* ------------------------------------------------------------------ main -- */

function parseArgs(argv) {
  const opts = { root: ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Refusal(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--self-test') opts.mode = 'self-test';
    else if (a === '--check') opts.mode = 'check';
    else if (a === '--upstream') opts.upstream = value();
    else if (a === '--sha') opts.sha = value();
    else if (a === '--body') opts.body = resolve(value());
    else if (a === '--git-dir') opts.gitDir = resolve(value());
    else if (a === '--root') opts.root = resolve(value());
    else throw new Refusal(`unknown argument ${a}`);
  }
  opts.mode ??= opts.upstream !== undefined ? 'bump' : null;
  if (!opts.mode) throw new Refusal('nothing to do — pass --check, --self-test or --upstream NAME');
  return opts;
}

async function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.mode === 'self-test') return selfTest();
    if (opts.mode === 'check') return check(opts.root);
    return await runBump(opts);
  } catch (e) {
    if (!(e instanceof Refusal)) throw e;
    console.error(`✗ ${e.message}`);
    process.exitCode = 1;
  }
}

await main();
