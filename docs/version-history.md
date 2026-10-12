# Version history

The crate restarted its version scheme at `0.1.0` when the TypeScript/Bun
implementation was replaced by Rust. The npm-era `v1.x` tags were removed on
2026-10-12 to leave a single, coherent version story: a repo showing `v1.6.1`
as its newest release while the crate published `0.1.1` was misleading.

No code was lost. Every removed tag pointed at a commit that is an ancestor of
`main`, so all of those commits are still in the repository's history and any
tag can be recreated from the table below. The npm-era releases are also
summarised in `CHANGELOG.md`.

## Removed tags

| Tag | Commit | Date |
|---|---|---|
| `v1.0.1` | `8172a4a35438c9e7ed4950bd554da0b2c1722ca3` | 2026-02-12 |
| `v1.0.2` | `dff6dac08059143231cfe49818894b859cdf733e` | 2026-02-12 |
| `v1.0.3` | `5ac3d10c768e4946c5b7edd6d27cf3d50823c641` | 2026-02-12 |
| `v1.0.4` | `dc024d00a3a7e74d1d071e9f6340b61c4cbd3048` | 2026-02-12 |
| `v1.0.5` | `1e1e0edc05e2d8de29c8a657da5d9fe9751b215d` | 2026-02-12 |
| `v1.1.1` | `a0b1691aaf1f9db439a06bcca405fa2bd5f9e97b` | 2026-02-12 |
| `v1.2.0` | `3b2e777121fe81069d73730bc9c0892c9c00817a` | 2026-02-12 |
| `v1.2.1` | `4309bbddf2f36b877e159b07ee33490d4e0df47b` | 2026-02-12 |
| `v1.2.2` | `5d56802e30df61e13074cd840ce06d8d1f928e8a` | 2026-02-12 |
| `v1.2.4` | `4ce424bef0ed61fbf686131529335754dc1bd6c2` | 2026-02-12 |
| `v1.2.5` | `35cca86c1379252ae4a224b5ccf9cbfac78f27dd` | 2026-02-12 |
| `v1.2.7` | `8ab31ab82a6fcbb10bb02bb2905a9e0c16967f62` | 2026-02-12 |
| `v1.2.8` | `85b59f13dc2ef23054a89ca3b984a1aec70bf969` | 2026-02-12 |
| `v1.2.9` | `29e35e29133bd25aba654d1a1bfbb3bbc9f2e6a4` | 2026-02-13 |
| `v1.3.0` | `4a2ea1c44c2b3c16e989b9ee2f444741d7818e9e` | 2026-02-13 |
| `v1.3.2` | `fab1abb8b3aa06a3366a6c84fda249c4ce8af1e2` | 2026-02-13 |
| `v1.3.3` | `1d97d45ba9e48411507da5f980d7dbbf8f6e6371` | 2026-02-13 |
| `v1.4.0` | `05a2d6f98e26a94fa19e7a18d9e32d4ae8898496` | 2026-02-15 |
| `v1.4.1` | `81cdba942f9fb8bfbf1334819d858035f89c171d` | 2026-02-15 |
| `v1.4.2` | `83ab918edefb26acd4533e3d5c5d445afdcc9c3c` | 2026-02-15 |
| `v1.5.0` | `f1242bf7e3040274a73b995cec573f3c331179b8` | 2026-02-15 |
| `v1.6.0` | `b1a0fa2a53a8a3c25bd3a3e552674be094534650` | 2026-02-15 |
| `v1.6.1` | `a03a29f59c6379d5f2b368d57c94cb61b2ac795b` | 2026-02-15 |

## Restoring a tag

```bash
git tag -a v1.6.1 <commit> -m "oh-my-node-modules v1.6.1"
git push origin v1.6.1
```

The pre-Rust source itself is reachable without any tag, for example:

```bash
git show <commit>:package.json
git log --oneline --all -- src/index.ts
```
