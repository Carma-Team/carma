---
paths:
  - "docs/**/*.md"
  - "*.md"
---

# Writing documents

Three places, three jobs. Putting something in the wrong one is how we ended up with a scoring spec describing three different formulas and a task list nobody had opened in six weeks.

| Where | What it holds | Example |
|---|---|---|
| Markdown in `docs/` | **The specification.** Either how the system works today, or the target it is being built to. | `i18n.md` · `scoring.md` |
| A Linear document | **Why we decided it.** The reasoning behind a choice. | *How CARMA measures phone distraction* |
| A Linear issue | **Work to be done.** Has an owner and a priority. | CAR-54 |

**A task list is never a file.** It has no owner, no priority, and nobody opens it — exactly what happened to `scoring-v2-handoff.md`.

## Current or target — say which, on the first line

A specification describes either the system we have or the system we are building. Both are legitimate. Mixing them silently is not, and neither is leaving the reader to work it out.

**Declare it before the first heading**, in these words: `Current behaviour.` or `Target architecture.` We already had four phrasings for two states — "Status: target specification", "Target architecture and product specification", "describes the mechanism as it exists today", "Status: current implementation" — which is three too many to recognise at a glance.

**A target document is written entirely in the target.** No status columns, no "not yet", no ticket ids, no list of what is missing. A sentence belongs only if it will still be true after the last gap closes. The distance between the target and today is work, and work lives in issues — put it in the document and the document needs an edit every time code lands, which is the drift you were trying to escape.

The header alone does not do it. `scoring.md` has carried "Target architecture" since it was written, and §3.1 still sent a reader looking for a metric that does not exist, because the paragraph was written in the present tense while §3.4 beside it was written as a requirement. Same file, same header, opposite outcomes. What separates them is the tense, not the label.

**A current-behaviour document is updated in the change that alters the behaviour**, not afterwards and not in a follow-up. The driving-SDK README spent a month describing an AppState gate that had been deleted, because the commit that deleted it touched the code and the tests and nothing else. A doc that trails the code by one merge is worse than no doc, because it is confidently wrong.

**Never put a version number in a filename.** `scoring-algorithm-v2.md` sitting next to an archived `scoring-algorithm.md` told you nothing about which one was live, and `scoring_v2.py` was distinguishing itself from a `scoring.py` deleted weeks earlier. The version belongs in a status header inside the file; the history belongs to git.

The one exception is a **decision record** — `RFC-001`, and any ADR we add. Those are numbered on purpose because they are frozen in time. A decision record is never edited into currency; when it stops being true, a new one supersedes it.

**Deleting a stale document is correct.** Git keeps it (`git log --follow`, `git show <sha>:<path>`). A folder of retired documents duplicates version control and reads as current to anyone who does not check the date.
