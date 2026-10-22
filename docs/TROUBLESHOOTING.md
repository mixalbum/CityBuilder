# Troubleshooting

## The viewer

**A plain light-blue page, or "No cities built yet".** No city has been built. Run `npm run city -- "<place>"` and reload.

**"No city …" with a list of others.** The `?city=` in the address isn't built. Build it, or pick one from the list.

**"localhost refused to connect".**
- **Not running:** the dev server isn't running yet, or its window was closed. Start `npm run dev` and wait for `Local: http://localhost:5173/`.
- **Another port:** if 5173 was busy, Vite picked another port; use the address it prints.
- **Some Windows setups:** try `http://127.0.0.1:5173/`.

**"Could not start … WebGL".** The browser can't use the graphics card.
- Turn on hardware acceleration (Chrome/Edge: Settings → System → "Use graphics acceleration when available").
- Update your graphics drivers.
- Try another browser.

**Slow or jerky.** Plug the laptop in and make the browser use the dedicated GPU (Windows: Settings → System → Display → Graphics). Big cities take longer to load in full detail; distant areas stay coarse.

**Buildings look wrong in one area.** That's usually the map data; see [NEW_CITY.md §5](NEW_CITY.md#5-better-data). OSM fixes reach CityBuilder on the next `npm run city -- <name> --force`.

## Downloads

**`Every Overpass server failed` / repeated `504` / `429` / timeouts.** The free Overpass servers are busy; it's not your setup.
- Wait 10–30 minutes and run the same command again. Tiles that finished are kept, so it resumes where it stopped, and a finished download is cached.
- Build a smaller area first (`--size 1000`).
- Try a particular server: `--endpoint https://overpass.private.coffee/api/interpreter` (repeat `--endpoint` to give several). The list of public servers is on the [OSM wiki](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances).
- Avoid running several big downloads at once: the servers limit simultaneous queries per user.

**`Could not find "<place>"`.** Add the country ("Kingston, Jamaica"), or use `--center lat,lon --name "<name>"`.

**Terrain tiles fail.** Check that `s3.amazonaws.com` is reachable. Without them the city builds flat (the log says so).

### Behind a proxy

Node's `fetch` ignores `HTTPS_PROXY` unless told to. With Node 22.21 or newer, set `NODE_USE_ENV_PROXY=1`:

```bash
NODE_USE_ENV_PROXY=1 npm run city -- "Oslo"           # macOS/Linux
$env:NODE_USE_ENV_PROXY=1; npm.cmd run city -- "Oslo"  # Windows PowerShell
```

## Building

**`JavaScript heap out of memory` or the build is killed.** The area is too big for the machine's memory. Use a smaller extent, or give Node more memory: `NODE_OPTIONS=--max-old-space-size=8192 npm run city -- <name>`.

**`No map data at data/cache/<name>/osm.json`.** You ran `build:world` before downloading; run `npm run city -- <name>`.

**`cities/<name>/city.json: …`.** The profile has a mistake; the message says which field. [NEW_CITY.md](NEW_CITY.md#field-reference) documents every field.

## Windows

- **"running scripts is disabled on this system":** use `npm.cmd` instead of `npm`, or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.
- **`git` or `node` not found right after installing:** close and reopen PowerShell.
- **Long paths:** clone into a short path such as `C:\src\CityBuilder` if you see path-length errors.

## Still stuck?

Open an issue with:
- the command you ran and its full output;
- your OS and the output of `node --version`;
- for viewer problems, the browser's console (F12 → Console).
