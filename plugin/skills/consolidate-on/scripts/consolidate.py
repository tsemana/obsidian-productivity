#!/usr/bin/env python3
"""
consolidate.py — Standardise all vault wikilinks for a person to [[filename|Display Name]].

Finds every [[alias]], [[alias|text]], or [[alias\|text]] that points at the given person
(matched by any of their aliases) and rewrites the link target to the canonical filename.
Display text is preserved if already present; the display_name is used if there is none.

Links that already use the canonical filename as their target are left untouched.

Usage:
    python3 consolidate.py \\
        --vault /path/to/vault \\
        --filename "maya-tanaka" \\
        --display "Maya Tanaka" \\
        --aliases "Maya" "Maya Tanaka" "MT"
"""

import re
import sys
import argparse
from pathlib import Path


def vault_files(vault_path: Path):
    """Yield all .md files in the vault, skipping .obsidian config."""
    for f in vault_path.rglob("*.md"):
        if ".obsidian" not in f.parts:
            yield f


def build_pattern(aliases: list[str]) -> re.Pattern:
    """
    Build a regex that matches any wikilink whose TARGET is one of the aliases.

    Wikilink forms handled:
      [[alias]]
      [[alias|display text]]
      [[alias\|display text]]   (Obsidian table-escaped pipe)

    The target is everything up to the first | or \| or ]].
    Aliases are sorted longest-first to avoid partial matches.
    """
    sorted_aliases = sorted(aliases, key=len, reverse=True)
    escaped = [re.escape(a) for a in sorted_aliases]
    alias_group = "|".join(escaped)

    # Capture groups:
    #   1 — the matched alias (link target)
    #   2 — everything after the target: either empty, |\|display, or |display
    pattern = rf'\[\[({alias_group})((?:\\?\|[^\]\n]+)?)\]\]'
    return re.compile(pattern)


def make_replacement(canonical_filename: str, display_name: str):
    """Return a replacement function for re.sub that rewrites the link target."""

    def replace(m: re.Match) -> str:
        alias = m.group(1)
        suffix = m.group(2)  # '', '|display', or r'\|display'

        # Already canonical — leave it alone.
        if alias == canonical_filename:
            return m.group(0)

        if suffix:
            # Keep existing display text, just fix the filename.
            return f"[[{canonical_filename}{suffix}]]"
        else:
            # No display text — use the canonical display name.
            return f"[[{canonical_filename}|{display_name}]]"

    return replace


def process_file(
    filepath: Path,
    pattern: re.Pattern,
    canonical_filename: str,
    display_name: str,
    dry_run: bool = False,
) -> tuple[int, str | None]:
    """
    Process one file. Returns (change_count, error_message_or_None).
    Writes the file in-place unless dry_run is True.
    """
    try:
        original = filepath.read_text(encoding="utf-8")
    except Exception as e:
        return 0, str(e)

    replacer = make_replacement(canonical_filename, display_name)
    modified = pattern.sub(replacer, original)

    changes = sum(
        1
        for orig, mod in zip(
            pattern.findall(original), pattern.findall(modified)
        )
        if orig != mod
    )

    # Simpler: just count how many substitutions happened by diffing
    if modified == original:
        return 0, None

    # Count actual changes by re-scanning (findall counts overlapping; sub is cleaner)
    change_count = len(pattern.findall(original)) - len(
        re.findall(re.escape(f"[[{canonical_filename}"), original)
    )
    # Fallback: at least one change occurred
    change_count = max(change_count, 1)

    if not dry_run:
        try:
            filepath.write_text(modified, encoding="utf-8")
        except Exception as e:
            return 0, f"Write failed: {e}"

    return change_count, None


def count_substitutions(original: str, modified: str, pattern: re.Pattern) -> int:
    """Count how many wikilinks were actually rewritten."""
    orig_matches = pattern.findall(original)
    # A match is a change if the reconstructed original link differs from the
    # reconstructed new link (i.e. the alias was not already canonical).
    count = 0
    for alias, suffix in orig_matches:
        # If the alias was not canonical, it got rewritten.
        if alias != "PLACEHOLDER_NEVER_MATCHES":  # always True for non-canonical
            count += 1
    return count


def main():
    parser = argparse.ArgumentParser(
        description="Consolidate vault wikilinks for a person to [[filename|Display Name]]"
    )
    parser.add_argument("--vault", required=True, help="Path to the vault root")
    parser.add_argument(
        "--filename", required=True, help="Canonical filename slug (without .md)"
    )
    parser.add_argument(
        "--display", required=True, help="Display name (used when no display text exists)"
    )
    parser.add_argument(
        "--aliases", nargs="+", required=True, help="All alias strings to match"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would change without writing files",
    )
    args = parser.parse_args()

    vault = Path(args.vault)
    if not vault.is_dir():
        print(f"Error: vault path does not exist: {vault}", file=sys.stderr)
        sys.exit(1)

    # Exclude the canonical filename itself from aliases to avoid matching
    # already-correct links and double-counting.
    aliases_to_match = [a for a in args.aliases if a != args.filename]
    if not aliases_to_match:
        print("Nothing to do — no aliases differ from the canonical filename.")
        return

    pattern = build_pattern(aliases_to_match)
    files = list(vault_files(vault))

    total_links_changed = 0
    changed_files: list[tuple[str, int]] = []
    errors: list[str] = []

    for f in files:
        try:
            original = f.read_text(encoding="utf-8")
        except Exception as e:
            errors.append(f"{f.relative_to(vault)}: read error — {e}")
            continue

        replacer = make_replacement(args.filename, args.display)
        modified = pattern.sub(replacer, original)

        if modified == original:
            continue

        # Count by comparing match counts before and after
        before_matches = pattern.findall(original)
        # Matches that targeted a non-canonical alias (i.e. ones we rewrote)
        n_changed = sum(1 for alias, _ in before_matches if alias != args.filename)

        if n_changed == 0:
            continue

        total_links_changed += n_changed
        changed_files.append((str(f.relative_to(vault)), n_changed))

        if not args.dry_run:
            try:
                f.write_text(modified, encoding="utf-8")
            except Exception as e:
                errors.append(f"{f.relative_to(vault)}: write error — {e}")

    # ── Report ──────────────────────────────────────────────────────────────
    mode = "[DRY RUN] " if args.dry_run else ""
    print(f"\n{mode}consolidate-on: [[{args.filename}|{args.display}]]")
    print(f"Aliases resolved: {', '.join(aliases_to_match)}")
    print(f"Files scanned:    {len(files)}")
    print(f"Links updated:    {total_links_changed}")

    if changed_files:
        print("\nChanged files:")
        for fname, count in sorted(changed_files):
            noun = "link" if count == 1 else "links"
            print(f"  {count} {noun}  →  {fname}")
    else:
        print("\nAll links already canonical — no changes needed.")

    if errors:
        print("\nErrors:")
        for e in errors:
            print(f"  {e}")


if __name__ == "__main__":
    main()
