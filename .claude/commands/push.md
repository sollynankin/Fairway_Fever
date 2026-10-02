---
description: Commit all changes to the golf game and push them to GitHub (updates the live site)
argument-hint: [optional commit message]
allowed-tools: Bash(git status:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git diff:*), Bash(git log:*)
---

Publish the current state of the game to GitHub.

1. Run `git status --short` and `git diff --stat`. If nothing changed, say so and stop.
2. Stage everything with `git add -A`.
3. Commit. Use "$ARGUMENTS" as the message if given; otherwise write a short, plain summary of what changed
   (one line, imperative, e.g. "Add ponds and par 5 lakes"). End the message with the Co-Authored-By line from the session.
4. Run `git push origin main`.
5. Reply with one line: what was pushed, and that GitHub Pages will refresh the live site in about a minute.

Only ever push this folder's own repo (it must report its own top-level folder: golf-game), never a parent folder.
