# Mailflow — Setup Guide
## GitHub + VS Code + Building the .exe

---

## STEP 1: Create GitHub repository

1. Go to https://github.com/new
2. Name it `mailflow`
3. Set to **Private** (recommended while in development)
4. Do NOT initialize with README (you already have one)
5. Click **Create repository**
6. Copy the repo URL — looks like `https://github.com/YOUR_USERNAME/mailflow.git`

---

## STEP 2: Push code to GitHub

Open **Git Bash** (or your VS Code terminal) inside the `mailflow` folder:

```bash
cd path/to/mailflow

# Initialize git (if not already done)
git init

# Add everything
git add .

# First commit
git commit -m "feat: initial Mailflow user panel"

# Connect to your GitHub repo
git remote add origin https://github.com/YOUR_USERNAME/mailflow.git

# Push to main branch
git branch -M main
git push -u origin main
```

Do the same for the admin panel:

```bash
cd path/to/mailflow-admin
git init
git add .
git commit -m "feat: initial Mailflow admin panel"
git remote add origin https://github.com/YOUR_USERNAME/mailflow-admin.git
git branch -M main
git push -u origin main
```

---

## STEP 3: Open in VS Code

```bash
# Open user panel
code path/to/mailflow

# Open admin panel in a separate window
code path/to/mailflow-admin
```

When VS Code opens, it will ask **"Install recommended extensions?"** — click **Yes**.
This installs Prettier, ESLint, GitLens, and the React snippets automatically.

---

## STEP 4: Run the app locally

In VS Code, press `Ctrl + Shift + B` (or `Cmd + Shift + B` on Mac) to open Build Tasks.
Select **"Dev: Start app"** — this starts both Vite (React) and Electron together.

Or in the terminal:
```bash
npm install
npm run dev
```

The Mailflow window will open on your screen.

---

## STEP 5: Update package.json with your name

Open `package.json` and replace:
```json
"owner": "YOUR_GITHUB_USERNAME"
```
with your actual GitHub username, e.g.:
```json
"owner": "rahulkumar"
```

Also update `author.name` and `author.email`.

---

## STEP 6: Add your GitHub token (for auto-releases)

This lets GitHub Actions publish the .exe as a release automatically.

1. Go to https://github.com/settings/tokens/new
2. Name it `MAILFLOW_BUILD`
3. Select scopes: `repo` (full repo access)
4. Click **Generate token** — copy it

Now go to your repo on GitHub:
1. **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `GH_TOKEN`
4. Value: paste your token
5. Click **Add secret**

---

## STEP 7: Build the .exe manually (on your machine)

Make sure you have Node.js 18+ installed. Then:

```bash
npm install
npm run build
```

This will:
1. Build the React app into `dist/`
2. Package Electron + your app into `dist-electron/`
3. Produce:
   - `Mailflow-Setup-1.0.0.exe` — Windows installer (NSIS)
   - `Mailflow-1.0.0.exe` — Portable (no install needed)

The files are in the `dist-electron/` folder. You can share these directly.

---

## STEP 8: Auto-build on GitHub (CI/CD)

Every time you push to the `main` branch, GitHub Actions will automatically:
- Build the `.exe` for Windows
- Build the `.dmg` for macOS  
- Build the `.AppImage` for Linux
- Upload them as downloadable artifacts

To see them:
1. Go to your repo on GitHub
2. Click **Actions** tab
3. Click the latest workflow run
4. Scroll down to **Artifacts** — download your `.exe`

---

## STEP 9: Create a versioned release

To publish a proper release with a download page:

```bash
# Bump version in package.json from 1.0.0 to 1.1.0
# Then:
git add .
git commit -m "chore: bump version to 1.1.0"
git tag v1.1.0
git push origin main --tags
```

GitHub Actions will detect the `v1.1.0` tag and:
1. Build all three platforms
2. Create a GitHub Release page at `github.com/YOUR_USERNAME/mailflow/releases`
3. Attach the `.exe`, `.dmg`, and `.AppImage` as download links

Your users can then go to that page and download the installer for their OS.

---

## Daily workflow

```bash
# Make changes to your code
# Then:
git add .
git commit -m "feat: add email scheduling feature"
git push origin main
```

GitHub Actions builds a new `.exe` automatically. Check the Actions tab in ~5 minutes.

---

## VS Code keyboard shortcuts you'll use constantly

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+B` | Run build task (start app) |
| `Ctrl+Shift+P` | Command palette |
| `Ctrl+`` ` | Open terminal |
| `Ctrl+Shift+G` | Git panel |
| `F5` | Start debugger |
| `Ctrl+P` | Quick file open |
| `Ctrl+Shift+F` | Search across all files |

---

## Folder structure reminder

```
mailflow/                    ← User Panel (open this in VS Code)
mailflow-admin/              ← Admin Panel (open separately in VS Code)
```

Both are separate Git repos, separate GitHub repos, separate `.exe` files.

---

## Troubleshooting

**"better-sqlite3 failed to build"**
```bash
npm install --build-from-source
# or
npm rebuild better-sqlite3
```

**"electron not found"**
```bash
npm install
```

**App opens but shows blank screen**
- Make sure `npm run dev:react` started first (Vite needs to be running on port 3000)
- Check VS Code terminal for errors

**Build fails on GitHub Actions**
- Check the Actions tab for the error log
- Most common issue: missing `GH_TOKEN` secret

---

## Assets needed for production build

Create an `assets/` folder with:
- `icons/icon.ico` — Windows icon (256×256 .ico file)
- `icons/icon.icns` — macOS icon (.icns file)
- `icons/icon.png` — Linux icon (512×512 .png)
- `installer.nsh` — (optional) custom NSIS installer script

You can create icons from a 1024×1024 PNG at https://www.electronjs.org/docs/latest/tutorial/application-distribution
