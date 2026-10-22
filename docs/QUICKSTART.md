# Quick start

Pick whichever way suits you. All of them end with a city you can fly around in your browser.

| Way | You need | Time to your first city |
|---|---|---|
| [A. In the cloud (Codespaces)](#a-in-the-cloud-github-codespaces) | A GitHub account | ~5 minutes, nothing to install |
| [B. GitHub Actions only](#b-github-actions-only-no-computer-setup-at-all) | A GitHub account | ~10 minutes, then download the result |
| [C. Windows 10/11](#c-windows-1011) | Node.js and Git (installed for you by the setup script) | ~10 minutes |
| [D. macOS](#d-macos) | Node.js and Git | ~10 minutes |
| [E. Linux](#e-linux) | Node.js and Git | ~10 minutes |

Most of the time goes on downloading map data, which depends on the public servers' load: usually one or two minutes per square kilometre.

---

## A. In the cloud (GitHub Codespaces)

1. On the repository page click **Code → Codespaces → Create codespace on main**. The container installs everything (`npm ci`) by itself.
2. In the terminal at the bottom:
   ```bash
   npm run city -- "Wellington, New Zealand"
   npm run dev
   ```
3. A **Viewer** tab or pop-up opens on port 5173. If it doesn't, open the **Ports** tab and click the globe icon next to 5173.

Codespaces' free monthly hours are plenty for building and viewing a few cities. Stop the codespace when you're done.

## B. GitHub Actions only (no computer setup at all)

1. Fork the repository (or use your own copy).
2. Go to **Actions → Build a city → Run workflow**, type a place (for example `Lisbon Baixa, Portugal`) and click **Run workflow**.
3. When the run finishes (about 5–15 minutes), open it and download the `city-<name>` artifact.
4. To view it you still need the viewer. Either use option A/C/D/E and unzip the artifact into `public/cities/`, or turn on GitHub Pages (see [GITHUB_ACTIONS.md](GITHUB_ACTIONS.md)). The workflow also opens a pull request adding the city's profile, so after you merge it the Pages site includes the city.

## C. Windows 10/11

1. Open **PowerShell** (Start menu → type "PowerShell").
2. If you don't have Git yet, install it, then close and reopen PowerShell:
   ```powershell
   winget install Git.Git
   ```
3. Download the project and run the setup script. It installs Node.js if needed, installs the packages and does an offline test build:
   ```powershell
   cd $HOME\Documents
   git clone https://github.com/mixalbum/CityBuilder.git
   cd CityBuilder
   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
   ```
   If the repository is private, a GitHub sign-in window pops up during `git clone`.
4. Build a city and start the viewer:
   ```powershell
   npm.cmd run city -- "Wellington, New Zealand"
   npm.cmd run dev
   ```
5. Open **http://localhost:5173** in Chrome or Edge.

Notes for Windows:
- `npm.cmd` works around PowerShell's "running scripts is disabled" error. To use plain `npm`, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.
- Keep the PowerShell window running `npm run dev` open: closing it stops the viewer. Use a second window for other commands.
- "localhost refused to connect" means the viewer isn't running yet, or it chose another port: use the address it prints after `Local:`.

## D. macOS

1. Install the tools. With [Homebrew](https://brew.sh): `brew install node git`. Or download Node.js LTS from [nodejs.org](https://nodejs.org); Git comes with the Xcode command line tools (`xcode-select --install`).
2. In Terminal:
   ```bash
   git clone https://github.com/mixalbum/CityBuilder.git
   cd CityBuilder
   bash scripts/setup.sh
   npm run city -- "Wellington, New Zealand"
   npm run dev
   ```
3. Open **http://localhost:5173**.

## E. Linux

1. Install Node.js 20 or newer and Git. Distribution packages are often old; [nvm](https://github.com/nvm-sh/nvm) is the easy way: `nvm install --lts`.
2. Then:
   ```bash
   git clone https://github.com/mixalbum/CityBuilder.git
   cd CityBuilder
   bash scripts/setup.sh
   npm run city -- "Wellington, New Zealand"
   npm run dev
   ```
3. Open **http://localhost:5173**.

---

## What next

- **Another city:** `npm run city -- "Kyoto Station, Japan"`. Each city you build appears in the viewer's **City** picker.
- **Choose the area yourself:** `npm run city -- "Manhattan" --center 40.7484,-73.9857 --size 2500 --name "Midtown Manhattan"`.
- **Learn the controls:** [USAGE.md](USAGE.md).
- **Make a city look right:** [NEW_CITY.md](NEW_CITY.md) covers tuning, local data sources and landmarks.
- **Something went wrong:** [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Requirements

- **Node.js 20.19 or newer** (22 LTS recommended) and **Git**.
- **A browser with WebGL 2:** current Chrome, Edge, Firefox or Safari, with hardware acceleration on.
- **Memory:** building a 2 × 2 km city uses about 1–2 GB of RAM; a 4 × 4 km one about 4–6 GB.
- **Disk:** a few hundred MB for packages, plus about 10–60 MB per built city.
- **Network:** the build downloads from OpenStreetMap's Overpass API, the AWS Terrain Tiles and Nominatim. Behind a corporate proxy, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md#behind-a-proxy).
