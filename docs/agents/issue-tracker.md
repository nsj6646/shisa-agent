# Issue tracker: GitHub

Issues and specs live in `nsj6646/shisa-agent`. Use the `gh` CLI.

Always specify `--repo nsj6646/shisa-agent`: this clone's default
GitHub repository is upstream, not the issue tracker.

## Conventions

- Create: `gh issue create --repo nsj6646/shisa-agent --title "..." --body "..."`
  Use a heredoc with `--body-file -` for multiline bodies.
- Read: `gh issue view <number> --repo nsj6646/shisa-agent --json number,title,body,labels,comments`
- List: `gh issue list --repo nsj6646/shisa-agent --state open --json number,title,body,labels,comments`
  Add label and state filters as needed.
- Comment: `gh issue comment <number> --repo nsj6646/shisa-agent --body "..."`
- Label: `gh issue edit <number> --repo nsj6646/shisa-agent --add-label "..."`
  Use `--remove-label` to remove one.
- Close: `gh issue close <number> --repo nsj6646/shisa-agent --comment "..."`

When a skill says “publish to the issue tracker”, create an issue.
When it says “fetch the relevant ticket”, read the issue.

## Parent issues and blockers

Use native GitHub sub-issues and dependencies when available.

- Get an issue's database ID:
  `gh api repos/nsj6646/shisa-agent/issues/<number> --jq .id`
- Attach a child:
  `gh api --method POST repos/nsj6646/shisa-agent/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`
- Add a blocker:
  `gh api --method POST repos/nsj6646/shisa-agent/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`

These API operations require database IDs, not issue numbers.

If native relationships are unavailable, put `Part of #<parent>` and
`Blocked by: #<number>` at the top of the child body, and link children
in a task list in the parent. A ticket is unblocked when all blockers
are closed.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Wayfinding operations

- Map: one issue labelled `wayfinder:map`, containing Notes,
  Decisions-so-far, and Fog.
- Child: a sub-issue labelled `wayfinder:<type>`, where type is
  `research`, `prototype`, `grilling`, or `task`.
- Frontier: open children in map order, excluding assigned tickets
  and tickets with open blockers.
- Claim: assign the ticket to `@me` before other writes.
- Resolve: comment with the answer, close the ticket, and append
  a summary plus link to the map's Decisions-so-far.
