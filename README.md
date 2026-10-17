# ObjectOS

> ## Build & ask online. Keep the data you own.
>
> **The ontology is the software.** ObjectOS is the **commercial runtime environment for
> [ObjectStack](https://github.com/objectstack-ai/objectstack) apps — built
> and operated entirely in the browser**: tell the built-in AI Builder what
> your business needs — a helpdesk, an approval flow, a CRM — and it's running
> immediately, with a generated admin Console, REST APIs, SSO, RBAC, and audit
> logs. No local toolchain, nothing to deploy. Run it as **ObjectOS Cloud**
> (we operate it) or **ObjectOS Enterprise** (self-managed: your servers, your
> database, your data — never ours).

[Website](https://www.objectos.ai) ·
[Documentation](https://docs.objectos.ai) ·
[License & Pricing](https://docs.objectos.ai/docs/resources/license) ·
[ObjectStack — the open-source framework](https://github.com/objectstack-ai/objectstack)

ObjectOS is a **commercial product**. This repository is its public home:

- 📚 **Documentation** — source for [docs.objectos.ai](https://docs.objectos.ai)
  (`content/docs/`, built by `apps/docs/`), in seven languages.
- 🐛 **Issue tracker** — bug reports and feature requests for ObjectOS Cloud
  and ObjectOS Enterprise.
- ™️ **Trademark policy** — [TRADEMARK.md](TRADEMARK.md). The "ObjectOS" name
  and logo are trademarks and are not covered by the code license.

The product source is developed privately and is not published in this
repository. There is no open-source edition of ObjectOS.

## Editions

One rate card, two deliveries — priced per **AI seat** in every edition:

| Delivery | Plans | For |
|:---|:---|:---|
| **ObjectOS Cloud** (managed service) | Free · Team · Business | Organizations that want the platform operated for them — orgs, environments, deploys, billing. |
| **ObjectOS Enterprise** (self-managed: your infrastructure) | Business Self-Managed (single-node entry option) · Enterprise (full private deployment) | Organizations that run the platform themselves. |

See [License & Pricing](https://docs.objectos.ai/docs/resources/license) for
plan details, and [docs.objectos.ai](https://docs.objectos.ai) for
capabilities, deployment, and operations documentation.

## Building and running your own apps? That's ObjectStack — and it's open source

Everything you need to **build, run, and self-host your own applications** is
the open-source (Apache-2.0) **[ObjectStack framework](https://github.com/objectstack-ai/objectstack)**:

```
ObjectStack  →  build & ask with Claude Code — in your repo, with your coding agent (Apache-2.0)
ObjectOS     →  build & ask online — in the browser, on a governed platform (Cloud & Enterprise)
```

`os start` — or the official Docker image
[`ghcr.io/objectstack-ai/objectstack`](https://github.com/objectstack-ai/objectstack/tree/main/docker) —
serves your compiled app in production with the Console, permissions, and
audit included. No commercial license required.

## What happened to the code that used to live here?

Until July 2026 this repository contained a free reference runtime
distribution (`@objectos/server`) and a desktop build (**ObjectOS One**).
As part of clarifying the ObjectStack / ObjectOS split:

- **`@objectos/server` is superseded** by the official ObjectStack runtime
  image (`ghcr.io/objectstack-ai/objectstack`) — the same capability,
  maintained where the runtime itself lives.
- **ObjectOS One is discontinued.** Demos and evaluations are served by the
  official Docker image and ObjectOS Cloud trials.
- **Everything already released stays licensed as released**: historical
  source remains available under Apache-2.0 in this repository's git history
  (archive branch: [`archive/apache-final`](https://github.com/objectstack-ai/objectos/tree/archive/apache-final)).
  Nothing is retroactively withdrawn.

## Working on the docs

```bash
pnpm install
pnpm docs:dev     # Fumadocs site at http://localhost:3000
```

Documentation is authored **English-first**; other locales are derived
translations (see [AGENTS.md](AGENTS.md)). Contributions are welcome —
see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

The contents of this repository (documentation and site code) are licensed
under the [Apache License 2.0](LICENSE).

"ObjectOS" and the ObjectOS logo are trademarks of the ObjectOS project and
are not covered by the Apache 2.0 grant. See [TRADEMARK.md](TRADEMARK.md).
