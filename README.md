# Webflow CMS Manager

Desktop app (Tauri) for browsing and editing Webflow CMS content locally — no backend, single-user, token stored in the OS keyring.

## Development

```bash
npm install
npm run tauri dev
```

## Packaging

Local `tauri build` is not reliable on machines with Application Control /
Smart App Control policies (unsigned build-script binaries get blocked).
Installers are built by GitHub Actions instead — see
`.github/workflows/build.yml`. Every push to `main` or a `client-*` branch
produces a draft release with the Windows installer attached.

## Pre-locking collections for a client build

Before handing the app to a client, you can restrict which collections
they're allowed to create/edit in (they can still view everything —
locked collections just show a lock icon and block the edit form).

The lock list lives in `src/access-policy.json`:

```json
{ "lockedCollectionNames": ["Team", "Pricing"] }
```

Names are matched case-insensitively against a collection's display name
or slug — no need to connect through the app first, just use the exact
name shown in Webflow's own Collections list.

To build a locked installer for a client:

1. `git checkout main && git pull`
2. `git checkout -b client-<name>`
3. Edit `src/access-policy.json` with that client's locked collection names.
4. Bump the `version` field in `src-tauri/tauri.conf.json` (so the release
   tag doesn't collide with a previous build).
5. `git add -A && git commit -m "Lock collections for <name>"`
6. `git push -u origin client-<name>`
7. GitHub Actions builds and creates a draft release tagged for that
   branch — download the installer from there and send it to the client.
8. To change a client's locks later, repeat steps 3-6 on their branch.

`main` should always keep `lockedCollectionNames` empty (fully
unrestricted) — only client branches carry a non-empty list.
