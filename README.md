# ObjectOS

> ## Build & ask online. Keep the data you own.
>
> **The ontology is the software.** ObjectOS is the **runtime environment for
> [ObjectStack](https://github.com/objectstack-ai/objectstack) apps**: tell
> the built-in AI Builder what your business needs — a helpdesk, an approval
> flow, a CRM — and it's running immediately, with a generated admin Console,
> REST APIs, SSO, RBAC, and audit logs. One product, three editions: run it
> yourself for free as **ObjectOS Community** (open source), let us operate it
> as **ObjectOS Cloud**, or license it self-managed as **ObjectOS Enterprise**
> (your servers, your database, your data — never ours).

[Website](https://www.objectos.ai) ·
[Documentation](https://docs.objectos.ai) ·
[License & Pricing](https://docs.objectos.ai/docs/editions/license) ·
[ObjectStack — the open-source protocol, SDK and framework](https://github.com/objectstack-ai/objectstack)

This repository is the source of the ObjectOS product documentation,
[docs.objectos.ai](https://docs.objectos.ai) — a sub-site of
[www.objectos.ai](https://www.objectos.ai), the ObjectOS home (the cloud
service included). It holds:

- 📚 **Documentation** — `content/docs/`, built by `apps/docs/`, in seven
  languages.
- ™️ **Trademark policy** — [TRADEMARK.md](TRADEMARK.md). The "ObjectOS" name
  and logo are trademarks and are not covered by the code license.

Product issues — for ObjectOS Community, Cloud or Enterprise — go to the one
public issue tracker,
[objectstack-ai/objectstack](https://github.com/objectstack-ai/objectstack/issues).
This repository takes issues about the documentation itself.

## One product, three editions

| Thing | Name | Terms |
|:---|:---|:---|
| The protocol, SDK, CLI and framework code — the `@objectstack/*` packages, the [objectstack repository](https://github.com/objectstack-ai/objectstack) and the objectstack.ai docs | **ObjectStack** | Apache-2.0 |
| The open-source runtime and Console that run an app — the `ghcr.io/objectstack-ai/objectstack` image and `os start`; its code stays in the objectstack repository | **ObjectOS Community** | Free, Apache-2.0 |
| The hosted service, [cloud.objectos.ai](https://cloud.objectos.ai) — we operate it | **ObjectOS Cloud** | Free · Team |
| The self-managed edition on your own infrastructure, under a commercial license | **ObjectOS Enterprise** | Licensed |

Community has everything needed to run an app: the runtime, the Console,
permissions and sharing, audit, MCP, and every protocol capability. Cloud and
Enterprise add hosting and multi-environment operations, Build & Ask (the AI
Builder), SSO, and commercial support.

## Editions

- **ObjectOS Community** — open source, self-hosted, free (Apache-2.0).
- **ObjectOS Cloud** — the managed service: Free · Team.
- **ObjectOS Enterprise** — licensed, self-managed. Business and Business
  Self-Managed (the single-node entry option) are contract options under it.

See [License & Pricing](https://docs.objectos.ai/docs/editions/license) for
plan details, and [docs.objectos.ai](https://docs.objectos.ai) for
capabilities, deployment, and operations documentation.

## Run it yourself: ObjectOS Community

Everything you need to **build, run, and self-host your own applications** is
open source (Apache-2.0): the **[ObjectStack](https://github.com/objectstack-ai/objectstack)**
protocol, SDK, CLI and framework, and the ObjectOS Community runtime built
from them:

```
ObjectStack          →  build & ask with Claude Code — in your repo, with your coding agent (Apache-2.0)
ObjectOS Community   →  the open-source runtime + Console, self-hosted, free (Apache-2.0)
ObjectOS Cloud       →  build & ask online — in the browser, on a governed platform we operate
ObjectOS Enterprise  →  the same platform, licensed and self-managed on your infrastructure
```

`os start` — or the official Docker image
[`ghcr.io/objectstack-ai/objectstack`](https://github.com/objectstack-ai/objectstack/tree/main/docker) —
serves your compiled app in production with the Console, permissions, and
audit included. No commercial license required.

## What happened to the code that used to live here?

Until July 2026 this repository shipped a free reference runtime distribution
(`@objectos/server`) and a desktop build (ObjectOS One); `@objectos/server`
was superseded by the official ObjectStack runtime image — today's ObjectOS
Community — and ObjectOS One was discontinued. Everything already released
stays licensed as released: the historical source remains available under
Apache-2.0 in this repository's git history (archive branch:
[`archive/apache-final`](https://github.com/objectstack-ai/docs.objectos.ai/tree/archive/apache-final)).

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
