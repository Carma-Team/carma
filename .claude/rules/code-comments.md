---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.py"
---

# Comments in code

Write why, not what. There is no target ratio and there never was one — a comment earns its place only when it explains a choice the reader cannot see from the code.

Three ways to get it wrong, each of them ours:

- **Restating the ticket.** A `CAR-` id carries the whole ticket. Seven lines re-telling an exploit above a one-line fix go stale while the ticket stays current.
- **A justification that outlived the code.** A wrong comment is worse than no comment. When you change what a comment explains, the comment is part of the change.
- **A comment covering for a bad name.** If it explains *what* the line does, rename the thing instead.

Always worth keeping:

- Why this and not the obvious alternative.
- What a future reader will want to delete and must not.
- Any number nobody can re-derive — a threshold, a benchmark, an exchange rate.

**The reasoning belongs in the commit message, not beside the code.** Our commit bodies run about 14 lines and that is deliberate: git history is permanent and cannot drift out of sync with anything, while a comment sits next to code that moves. Explain the decision once, in the commit. Leave behind only the trap.
