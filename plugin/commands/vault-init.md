---
description: Configure Obsidian vault settings for the productivity system
---

# Vault Init Command

Configure an Obsidian vault's settings to work with the productivity system. This command handles the `.obsidian/` configuration that Obsidian itself needs — things like enabling core plugins, pointing daily notes to the right folder, and setting up templates.

Run this **before** `/start` if setting up a new vault, or run it on an existing vault to align its settings with the productivity workflow.

## Instructions

### 1. Detect Vault State

Check the working directory for:
- `.obsidian/` folder — if it exists, this is already an Obsidian vault
- `CLAUDE.md` — if it exists, the productivity system was already initialized

Determine which scenario applies:

**Scenario A: Fresh install (no `.obsidian/` folder)**
The user hasn't opened this folder in Obsidian yet. Create the config from scratch.

**Scenario B: Existing vault (`.obsidian/` exists)**
The user already uses Obsidian. Preserve their settings and only add/modify what's needed.

### 2. Ask the User

For **Scenario A** (fresh install), confirm:
```
I'll set up this folder as an Obsidian vault with the productivity system.
This creates the .obsidian/ config folder that Obsidian needs.

After this, open the folder in Obsidian (File → Open Vault → Open folder as vault)
and everything will be configured.

Ready to proceed?
```

For **Scenario B** (existing vault), explain what will change:
```
I see you already have an Obsidian vault here. I'll configure it for the
productivity workflow. Here's what I'll do:

- Enable Daily Notes and Templates core plugins (if not already)
- Point Daily Notes to daily/ with YYYY-MM-DD format
- Point Templates to templates/
- Enable Tags, Backlinks, and Graph view (if not already)

Your existing notes, plugins, and themes won't be touched. Proceed?
```

Wait for confirmation before making changes.

### 3. Create/Update .obsidian Config Files

#### core-plugins-migration.json

This controls which core plugins are enabled. For **Scenario A**, create the full file. For **Scenario B**, read the existing file and only set the required plugins to `true` without changing others.

**Required plugins for the productivity workflow:**
```json
{
  "file-explorer": true,
  "global-search": true,
  "switcher": true,
  "graph": true,
  "backlink": true,
  "outgoing-link": true,
  "tag-pane": true,
  "page-preview": true,
  "daily-notes": true,
  "templates": true,
  "command-palette": true,
  "markdown-importer": true,
  "outline": true,
  "properties": true
}
```

For **Scenario A**, also include commonly useful defaults:
```json
{
  "file-explorer": true,
  "global-search": true,
  "switcher": true,
  "graph": true,
  "backlink": true,
  "outgoing-link": true,
  "tag-pane": true,
  "page-preview": true,
  "daily-notes": true,
  "templates": true,
  "command-palette": true,
  "markdown-importer": true,
  "outline": true,
  "properties": true,
  "note-composer": true,
  "word-count": true,
  "file-recovery": true,
  "canvas": true
}
```

#### core-plugins.json

This lists only the enabled plugins as an array. Generate it from the true values in core-plugins-migration.json:

```json
[
  "file-explorer",
  "global-search",
  "switcher",
  "graph",
  "backlink",
  "outgoing-link",
  "tag-pane",
  "page-preview",
  "daily-notes",
  "templates",
  "command-palette",
  "markdown-importer",
  "outline",
  "properties",
  "note-composer",
  "word-count",
  "file-recovery",
  "canvas"
]
```

For **Scenario B**, read the existing array and add any missing required plugins.

#### daily-notes.json

```json
{
  "folder": "daily",
  "format": "YYYY-MM-DD",
  "template": "templates/daily"
}
```

For **Scenario B**, if this file already exists, ask the user before overwriting:
```
You already have Daily Notes configured:
- Folder: [current value]
- Format: [current value]
- Template: [current value]

The productivity system expects daily/ folder and YYYY-MM-DD format.
Should I update these settings, or keep yours?
```

#### templates.json

```json
{
  "folder": "templates"
}
```

For **Scenario B**, same approach — check if it exists and ask before changing.

#### app.json

For **Scenario A**, create sensible defaults:
```json
{
  "alwaysUpdateLinks": true,
  "newFileLocation": "folder",
  "newFileFolderPath": "",
  "useMarkdownLinks": false,
  "showFrontmatter": true
}
```

Key settings:
- `alwaysUpdateLinks: true` — when you rename a note, all wikilinks to it update automatically
- `useMarkdownLinks: false` — use `[[wikilinks]]` style (not `[text](url)` style)
- `showFrontmatter: true` — show properties/frontmatter in editing view

For **Scenario B**, only update these specific keys if they differ, and explain why:
```
I'd recommend these settings for the productivity workflow:
- "Always update internal links" → ON (renames stay linked)
- "Use [[Wikilinks]]" → ON (not Markdown links)
- "Show frontmatter" → ON (see properties while editing)

Want me to update these?
```

#### appearance.json (Scenario A only)

```json
{
  "baseFontSize": 16,
  "interfaceFontSize": 14
}
```

Only create if it doesn't exist. Never modify an existing user's appearance.

### 4. Create Folder Structure

Create the vault folders if they don't exist:
```
daily/
projects/
references/
memory/
memory/people/
memory/projects/
memory/context/
templates/
bases/
canvas/
```

For **Scenario B**, only create folders that are missing. Never delete or rename existing folders.

### 5. Report

**Scenario A:**
```
Vault configured! Here's what was set up:

📁 .obsidian/ config created with:
  - Daily Notes → daily/ folder, YYYY-MM-DD format
  - Templates → templates/ folder
  - Wikilinks enabled, auto-link-updating ON
  - Core plugins: Graph, Backlinks, Tags, Daily Notes, Templates, Canvas

📁 Vault folders created:
  daily/, projects/, references/, memory/, templates/, bases/, canvas/

Next steps:
1. Open this folder in Obsidian: File → Open Vault → Open folder as vault
2. Run /start to initialize tasks, memory, and Bases views
```

**Scenario B:**
```
Vault updated for productivity workflow:

✅ Core plugins enabled: Daily Notes, Templates, Graph, Backlinks, Tags
✅ Daily Notes → daily/ folder, YYYY-MM-DD format
✅ Templates → templates/ folder
✅ New folders created: [list only what was new]
⏭️ Preserved: your existing notes, themes, community plugins, and custom settings

Next steps:
1. Restart Obsidian to pick up the config changes
2. Run /start to initialize tasks, memory, and Bases views
```

## Notes

- Never delete or rename existing user files or folders
- Never modify community plugin configs
- Never change themes or appearance on existing vaults
- If `.obsidian/workspace.json` exists, don't touch it (it stores layout state)
- The user must open/reopen the vault in Obsidian after config changes take effect
- If Obsidian is already running when we edit `.obsidian/`, remind the user to restart it
