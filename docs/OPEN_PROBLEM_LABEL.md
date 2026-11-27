# open-problem label

The bet board counts GitHub issues with the label `open-problem`. It does not count every open issue, and it does not copy the "16 live" number from the public gaps page. That page is a reading list. This label is the scoreboard.

The machine list is [`open-problem-issues.json`](./open-problem-issues.json). `.github/workflows/open-problem-label.yml` creates the label and applies it to the `apply` list when that file lands on `main`, or when you run the workflow by hand.

## Apply

- **#6** `t_s` speed-farming. Adversarial-path issue, still open.
- **#40** Gap 15, density. The priesthood framing is scratched. The issue still names open questions (thin graphs, coverage, untested N).

## Not applied

Left off on purpose. Reasons are in the JSON file. Short version: chores, old v3.1 feature tickets, and the legacy 63-gap doc pass are not the bet.

Pull requests are not labeled.

There is no GitHub issue yet whose only subject is contested confirmations and late burns. The README calls that the current build priority. This pass does not open that issue and does not pretend it exists. Mesh receipts say contested confirmations are not finished.

## Your hands

The workflow has to run on `main` with permission to edit issues. Until that run succeeds, the label is not on #6 or #40. If branch protection or Actions permissions block it, open Actions, run "Open-problem label", and check the two issues.
