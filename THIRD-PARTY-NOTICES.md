# Third-Party Notices

Beadbox is distributed under the MIT License (see `LICENSE`). It also
redistributes the third-party components listed below, whose licenses require
that their notices travel with the distribution.

Components whose licenses (MIT, Apache-2.0, BSD, ISC, Zlib and similar) are
satisfied by their own bundled license text are not repeated here. The full
dependency license inventory is reproducible at any time:

```
# JavaScript, per shipped package
cd packages/client && bunx license-checker --production
cd packages/server && bunx license-checker --production

# Rust
cd src-tauri && cargo deny check licenses      # config: src-tauri/deny.toml
```

## Fonts — SIL Open Font License 1.1

The OFL requires that its copyright notice and license accompany the font
software wherever it is redistributed. These fonts are bundled into the
application UI.

**Geist** — Copyright 2024 The Geist Project Authors
(https://github.com/vercel/geist-font.git)

**Geist Mono** — Copyright 2024 The Geist Project Authors
(https://github.com/vercel/geist-font.git)

**Inter** — Copyright 2016 The Inter Project Authors
(https://github.com/rsms/inter)

Each is licensed under the SIL Open Font License, Version 1.1. The full
license text ships inside each package (`LICENSE`) and is available with an
FAQ at http://scripts.sil.org/OFL

## elkjs — Eclipse Public License 2.0

**elkjs** (https://github.com/kieler/elkjs) is used for graph layout and is
bundled into the application. It is licensed under the Eclipse Public License
2.0, whose full text is available at https://www.eclipse.org/legal/epl-2.0/

elkjs is redistributed **unmodified**. Its source is available from the
upstream repository above and from the npm registry.

## Bun runtime — MIT

The application ships a sidecar binary produced by `bun build --compile`
(see `src-tauri/scripts/copy-sidecar.sh`). That binary embeds the Bun runtime,
which is licensed under the MIT License, Copyright (c) Oven, LLC and
contributors — https://github.com/oven-sh/bun

Bun in turn embeds components under their own terms, including JavaScriptCore
(LGPL-2.1 / BSD). Those notices are carried by Bun's own distribution:
https://github.com/oven-sh/bun/blob/main/LICENSE.md

Note: Beadbox no longer bundles a Node.js runtime. The Node sidecar was
removed during the Bun migration; `src-tauri/scripts/copy-node.sh` no longer
exists and `tauri.conf.json` declares a single `externalBin`,
`binaries/beadbox-sidecar`.
