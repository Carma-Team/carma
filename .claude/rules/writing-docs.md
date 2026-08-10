---
paths:
  - "docs/**/*.md"
  - "*.md"
---

# Writing documents

Three places, three jobs. Putting something in the wrong one is how we ended up with a scoring spec describing three different formulas and a task list nobody had opened in six weeks.

| Where | What it holds | Example |
|---|---|---|
| Markdown in `docs/` | **How the system works today.** Always current. | `scoring.md` |
| A Linear document | **Why we decided it.** The reasoning behind a choice. | *How CARMA measures phone distraction* |
| A Linear issue | **Work to be done.** Has an owner and a priority. | CAR-54 |

**A task list is never a file.** It has no owner, no priority, and nobody opens it — exactly what happened to `scoring-v2-handoff.md`.

**Never put a version number in a filename.** `scoring-algorithm-v2.md` sitting next to an archived `scoring-algorithm.md` told you nothing about which one was live, and `scoring_v2.py` was distinguishing itself from a `scoring.py` deleted weeks earlier. The version belongs in a status header inside the file; the history belongs to git.

The one exception is a **decision record** — `RFC-001`, and any ADR we add. Those are numbered on purpose because they are frozen in time. A decision record is never edited into currency; when it stops being true, a new one supersedes it.

**Deleting a stale document is correct.** Git keeps it (`git log --follow`, `git show <sha>:<path>`). A folder of retired documents duplicates version control and reads as current to anyone who does not check the date.
