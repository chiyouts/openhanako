# Windows Packaging

This file records the verified Windows packaging flow for this repository.
Use it as the default reference next time instead of re-trying old failed paths.

## Verified Environment

- OS: Windows
- Node: `v24.14.0`
- npm: `11.10.1`
- Electron dependency present at `node_modules/electron/dist`
- Output version verified in this run: `0.117.2`

## Recommended Command Sequence

Run from the repo root:

```powershell
cd D:\Campany\ThirdProject\openhanako
$env:NODE_OPTIONS='--max-old-space-size=8192'
npm run build:server
npm run build:client
npx electron-builder --win nsis --publish never --config.electronDist=node_modules/electron/dist
```

Why this exact sequence:

- `NODE_OPTIONS=--max-old-space-size=8192` avoids avoidable memory pressure during Windows builds.
- `build:server` and `build:client` are easier to diagnose separately than `npm run dist:win`.
- `--config.electronDist=node_modules/electron/dist` forces electron-builder to use the local Electron bundle instead of trying alternate resolution paths.
- `--publish never` keeps packaging local and avoids accidental release/publish behavior.

## Known Good Output

For version `0.117.2`, the successful installer output was:

- `dist\Hanako-0.117.2-Windows-x64.exe`
- `dist\Hanako-0.117.2-Windows-x64.exe.blockmap`
- `dist\latest.yml`

Successful artifact metadata from the verified run:

- Installer size: `254758887` bytes
- SHA256: `0333BCFBC4312F23EF30BB7CC068DAB5CAA7B11A06510E2C969178483CEBFB23`

## Important Behavior Notes

### 1. `build:server` may hang after output is already complete

Observed behavior on Windows:

- `npm run build:server` can finish writing output but keep the `node` process alive.
- This is not the same as a failed build.

Check these files first:

```powershell
Get-Item `
  dist-server-bundle\index.js,`
  dist-server\win-x64\bundle\index.js,`
  dist-server\win-x64\package.json,`
  dist-server\win-x64\hana-server.cmd `
| Select-Object FullName,Length,LastWriteTime
```

If these files are updated, especially:

- `dist-server-bundle\index.js`
- `dist-server\win-x64\bundle\index.js`
- `dist-server\win-x64\package.json`
- `dist-server\win-x64\hana-server.cmd`

then the server build is usually usable even if the process never exits.

At that point, identify and stop only the stuck build processes:

```powershell
Get-CimInstance Win32_Process -Filter "name = 'node.exe'" |
  Where-Object { $_.CommandLine -match 'openhanako|build-server|npm-cli.js run build:server' } |
  Select-Object ProcessId,CommandLine
```

Then stop the specific `build:server` processes:

```powershell
Stop-Process -Id <build-server-pid>,<npm-wrapper-pid> -Force
```

Do not kill unrelated long-running Node processes unless you have confirmed they are stale test/build leftovers.

### 2. `build:client` warnings seen in successful builds

The following warnings were observed and were non-fatal:

- HTML `<script src="...">` entries without `type="module"` cannot be bundled
- Vite reporter warnings about dynamic import also being statically imported
- Chunk-size warnings for large renderer bundles

If `npm run build:client` exits with code `0`, these warnings alone do not block packaging.

### 3. `electron-builder` warning about missing `vendor\git-portable`

Observed warning:

```text
file source doesn't exist  from=...\vendor\git-portable
```

Packaging still succeeded without this directory.

Implication:

- If bundled portable Git is required for your release behavior, make sure `vendor\git-portable` exists before packaging.
- If not required, this warning is non-fatal.

### 4. If `dist\win-unpacked` is locked

If electron-builder fails with `EBUSY` on `dist\win-unpacked`, remove only that rebuildable directory and rerun packaging:

```powershell
Remove-Item -LiteralPath D:\Campany\ThirdProject\openhanako\dist\win-unpacked -Recurse -Force
```

Only remove `dist\win-unpacked`, not broader build directories, unless there is a confirmed reason.

## Verification After Packaging

Check final artifacts:

```powershell
Get-Item `
  dist\Hanako-*-Windows-x64.exe,`
  dist\Hanako-*-Windows-x64.exe.blockmap,`
  dist\latest.yml `
| Select-Object FullName,Length,LastWriteTime
```

Check installer hash:

```powershell
Get-FileHash dist\Hanako-0.117.2-Windows-x64.exe -Algorithm SHA256
```

Check that packaged server files include recent changes:

```powershell
Get-Item `
  dist\win-unpacked\resources\server\bundle\index.js,`
  dist\win-unpacked\resources\server\plugins\image-gen\lib\generated-dir.js `
| Select-Object FullName,Length,LastWriteTime
```

## Recommended Next-Time Default

Prefer this exact flow:

1. `npm run typecheck`
2. `npm run build:server`
3. If it hangs, verify outputs and stop only the stuck build processes
4. `npm run build:client`
5. `npx electron-builder --win nsis --publish never --config.electronDist=node_modules/electron/dist`
6. Verify `dist\*.exe`, `dist\latest.yml`, and installer hash

This is the current known-good Windows packaging path for `openhanako`.
