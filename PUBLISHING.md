# Publishing Ciper Agent to VS Code Marketplace

## Prerequisites

1. **Microsoft account** at https://marketplace.visualstudio.com/
2. **Publisher created** on the Marketplace portal
3. **Personal Access Token (PAT)** from https://dev.azure.com/
4. **vsce** CLI tool: `npm install -g @vscode/vsce`

---

## Step 1: Generate the Icon

```bash
# Install librsvg (macOS)
brew install librsvg

# Convert SVG → PNG
cd extension/images
bash convert-icon.sh
# Produces: extension/images/icon.png
```

---

## Step 2: Update publisher in package.json

Edit `extension/package.json`:
```json
"publisher": "YOUR-PUBLISHER-NAME"
```

Also update:
- `"repository"` → your real GitHub URL
- `"version"` → e.g. `"1.0.0"` for first public release

---

## Step 3: Package locally

```bash
cd extension
npm install
npm run compile
vsce package
# Produces: ciper-agent-0.2.0.vsix
```

---

## Step 4: Test locally before publishing

```bash
code --install-extension ciper-agent-0.2.0.vsix
```

Verify:
- Extension loads (`$(hubot)` appears in status bar)
- Backend URL configurable in settings
- Chat works with backend running

---

## Step 5: Publish

```bash
# Login (one-time)
vsce login YOUR-PUBLISHER-NAME

# Publish
vsce publish

# Or publish with specific version bump
vsce publish patch   # 0.2.0 → 0.2.1
vsce publish minor   # 0.2.0 → 0.3.0
vsce publish major   # 0.2.0 → 1.0.0
```

---

## Marketplace Listing Checklist

Before publishing, verify `extension/package.json` has:
- [ ] `"displayName"` — clear, searchable name
- [ ] `"description"` — one-line summary (shown in search)
- [ ] `"icon"` → `"images/icon.png"` (128x128 PNG)
- [ ] `"categories"` — `["AI", "Programming Languages"]`
- [ ] `"keywords"` — search terms
- [ ] `"repository"` — GitHub URL
- [ ] `"license"` — `"MIT"`
- [ ] `"galleryBanner"` — dark background color

Also needed in the repo root:
- [ ] `README.md` — shown as the marketplace page body
- [ ] `CHANGELOG.md` — shown in "What's New"
- [ ] `LICENSE`

---

## Updating After Release

```bash
# Bump version + publish in one step
vsce publish patch

# Or manually bump in package.json, then:
vsce publish
```

Monitor feedback at:
- https://marketplace.visualstudio.com/manage/publishers/YOUR-PUBLISHER-NAME
