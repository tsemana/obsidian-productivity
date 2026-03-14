# Obsidian Productivity Plugin

An Obsidian-native productivity system for Cowork. Combines task management, workplace memory, and Obsidian-flavored markdown skills — everything lives in your vault as linked, searchable notes.

## What It Does

This plugin gives Claude a persistent understanding of your work, stored in your Obsidian vault:

- **Task management** — Every task is its own note in `tasks/` with frontmatter properties (status, priority, due, context). View and filter tasks through Obsidian Bases. Completed tasks archive to `tasks/done/`.
- **Workplace memory** — A two-tier memory system that teaches Claude your shorthand. People, projects, and terminology are stored as proper Obsidian notes with frontmatter, aliases, and wikilinks.
- **Dual-context support** — Use the same vault from separate work and personal Claude accounts. Tasks, memories, and notes are auto-tagged by context and filterable through Bases views.
- **Obsidian markdown** — Proper Obsidian Flavored Markdown with wikilinks, callouts, embeds, properties, and more.
- **Obsidian Bases** — Database-like views over your vault notes (tasks, projects, people directories).
- **JSON Canvas** — Visual canvases for brainstorming, project mapping, and flowcharts.
- **Obsidian CLI** — Interact with your vault from the command line.
- **Defuddle** — Clean web page extraction for saving research to your vault.
- **Vault workflow** — Templates, daily notes, and a linking philosophy that connects everything.

## Commands

| Command | What it does |
|---------|--------------|
| `/vault-init` | Configure Obsidian vault settings (core plugins, daily notes, templates, wikilinks) |
| `/start` | Initialize vault structure, tasks, memory, templates, and Bases views |
| `/update` | Triage stale items, check memory for gaps, sync from external tools |
| `/update --comprehensive` | Deep scan email, calendar, chat — flag missed todos and suggest new memories |

## Skills

| Skill | Description |
|-------|-------------|
| `memory-management` | Two-tier memory with Obsidian wikilinks and frontmatter aliases |
| `task-management` | Individual task notes with frontmatter, viewed through Bases |
| `vault-workflow` | Vault structure, daily notes, templates, and Bases views |
| `obsidian-markdown` | Obsidian Flavored Markdown syntax (wikilinks, callouts, embeds, properties) |
| `obsidian-bases` | Obsidian Bases files for database-like views |
| `json-canvas` | JSON Canvas files for visual canvases |
| `obsidian-cli` | Obsidian CLI for vault interaction |
| `consolidate-on` | Standardise wikilinks for a person to canonical `[[filename\|Display Name]]` format |
| `defuddle` | Clean markdown extraction from web pages |

## Getting Started

### Option A: Fresh Install (New to Obsidian)

If you don't have Obsidian yet:

1. **Download Obsidian** from [obsidian.md](https://obsidian.md) (free for personal use)
2. **Install this plugin** in Cowork
3. **Create a folder** on your computer where you want your vault to live (e.g., `~/Documents/MyVault`)
4. **Start a Cowork session** and select that folder
5. **Run `/vault-init`** — this creates the `.obsidian/` config folder with the right settings (daily notes, templates, wikilinks, core plugins all pre-configured)
6. **Run `/start`** — this creates the vault structure (folders, templates, Bases views, task folder, CLAUDE.md, and memory system)
7. **Open the folder in Obsidian** — go to File → Open Vault → "Open folder as vault" and select your folder. Everything will be configured and ready.
8. **Explore** — check the graph view to see how people, projects, and tasks connect. Open `bases/tasks.base` for your task board.

### Option B: Existing Obsidian Vault

If you already use Obsidian:

1. **Install this plugin** in Cowork
2. **Start a Cowork session** and select your existing vault folder
3. **Run `/vault-init`** — this will detect your existing settings and only add what's needed. It will ask before changing anything and never touch your existing notes, themes, or community plugins. It enables Daily Notes, Templates, Backlinks, and Graph core plugins if they aren't already on, and points Daily Notes to `daily/` and Templates to `templates/`.
4. **Run `/start`** — this creates the productivity folders and files alongside your existing vault content. Your current notes stay exactly where they are.
5. **Restart Obsidian** to pick up any config changes
6. **Check the graph view** — you'll see the new memory and task notes appear alongside your existing notes, connected by wikilinks

### After Setup

Once the vault is initialized, your workflow looks like this:

- **In Obsidian** — browse notes, explore the graph view, use Bases for task/project/people views, create daily notes, link ideas together
- **In Cowork** — ask Claude to manage tasks, decode shorthand, sync with email/calendar/chat, create project notes, update memory
- **Run `/update`** periodically to keep tasks and memory current
- **Run `/update --comprehensive`** for a deep scan of your communications to catch missed todos and discover new people/projects

Both tools work on the same files, so changes in one immediately show up in the other.

## Data Sources

Connect your communication and project management tools for the best experience. Without them, manage tasks and memory manually.

See [CONNECTORS.md](CONNECTORS.md) for details on supported tools and alternatives.

## Credits

- Obsidian skills (obsidian-markdown, obsidian-bases, json-canvas, obsidian-cli, defuddle) by [Steph Ango / kepano](https://github.com/kepano/obsidian-skills)
- Productivity system (task management, memory management) by Anthropic
