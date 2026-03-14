---
name: consolidate-on
description: >
  Consolidates all wikilink references to a specific note across an Obsidian vault,
  converting any alias-based or inconsistent links ([[First Name]], [[Project Name]], [[username123]])
  into the canonical [[filename|Display Name]] format that resolves directly by file path rather
  than relying on Obsidian's alias index.

  Use this skill whenever the user says things like: "consolidate links for [name]",
  "resolve all references to [person]", "fix broken links to [note]", "sync wikilinks for
  [project]", "clean up how [thing] is referenced", "search for [name] and resolve links",
  "consolidate links for [project]", or "resolve references to [thing]".
  Also trigger proactively after creating or renaming any note (person, project, reference, etc.),
  or when you notice wikilinks using short names, nicknames, or full names instead of the
  filename-based format.
---

# consolidate-on

Given a note's name, this skill finds the corresponding file in the vault, collects every alias
it goes by, and standardises every wikilink pointing at it across the vault to use the
reliable `[[filename|Display Name]]` format. This works for any note type — people, projects,
references, or anything else in the vault.

## Why this matters

Obsidian resolves `[[Project Alpha]]` by looking for either a file named
`Project Alpha.md` or a file with alias "Project Alpha" — but alias resolution
only works after the vault has been indexed. Before indexing (fresh open, sync, or rebuild),
`[[Project Alpha]]` silently creates a new empty `Project Alpha.md` instead of
linking to `memory/projects/project-alpha.md`. The reliable format
`[[project-alpha|Project Alpha]]` resolves directly by filename and always works.

## Vault location

The vault is the current working directory (the mounted vault folder). Notes live in several
locations depending on their type:

- `memory/people/` — person files
- `memory/projects/` — project files
- `references/` — reference notes
- Full vault (recursive) — fallback for any other note type

If operating in a different vault, check `CLAUDE.md` for the vault path.

## Steps

### 1. Find the target file

Search for the target note in the following order, stopping at the first match:

1. `memory/people/`
2. `memory/projects/`
3. `references/`
4. Full vault (recursive)

Match the input name against:
- The file's `title:` frontmatter field
- Any entry in the file's `aliases:` list
- The filename slug itself (e.g. `jane-smith`, `project-alpha`)

If no match is found, tell the user and ask if they'd like to create the note first.
If multiple files could match, ask the user to clarify.

### 2. Extract canonical identity

From the matched file, collect:
- **canonical_filename**: the basename without `.md` (e.g. `jane-smith`)
- **display_name**: the `title:` frontmatter value (e.g. `Jane Smith`)
- **aliases**: every entry in the `aliases:` list

### 3. Run the consolidation script

Call the bundled script, passing in all aliases so it knows what patterns to search for:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/skills/consolidate-on/scripts/consolidate.py \
  --vault <vault_root_path> \
  --filename "<canonical_filename>" \
  --display "<display_name>" \
  --aliases "<alias1>" "<alias2>" "<alias3>"
```

Pass every alias, including the full name, first name, nicknames, and Slack handles.
The script skips any links that are already canonical, so it is safe to run repeatedly.

### 4. Report results

After the script runs, tell the user:
- How many files were scanned
- How many links were updated, and in which files
- Whether any plain-text mentions were found that weren't auto-converted (report only, don't auto-fix prose)

### 5. Offer follow-up

Ask if there are stray empty files Obsidian may have created (e.g. `Jane.md` at the vault
root or elsewhere). If so, offer to delete them — they are artefacts of the broken links.

## Edge cases

- **Note not found**: stop and inform the user; offer to create the note
- **Multiple possible matches**: list them and ask the user to pick one
- **Already canonical links**: the script skips them silently — running twice is safe
- **Prose mentions** (not wikilinks): report them but don't auto-convert — the user may want
  them as plain text
- **Table-escaped links** (`[[alias\|text]]`): the script handles these correctly
- **Frontmatter wikilinks** (`assigned-to: "[[alias]]"`): handled the same as body links
