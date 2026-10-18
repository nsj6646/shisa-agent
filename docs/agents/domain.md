# Domain Docs

## Read before exploring

This repository uses a single-context layout:

- `GLOSSARY.md` at the repository root defines domain vocabulary.
- `docs/adr/` holds architectural decisions. Read the ADRs relevant
  to the area being explored.

If these files do not exist, proceed silently. Domain modeling
creates them lazily as terms and decisions are resolved.

## Use the glossary's vocabulary

Use glossary terms in issue titles, proposals, hypotheses, and tests.
Avoid synonyms the glossary explicitly rejects.

If a needed concept is missing, reconsider whether the project uses
it or note the gap for domain modeling.

## Flag ADR conflicts

Explicitly identify any proposal that contradicts an existing ADR,
and explain why the decision may be worth reopening.
