-- The git author a run commits as.
--
-- The app now executes inside a container, where there is no developer's
-- `~/.gitconfig` to inherit: without an author, `git commit` fails at the first
-- implementing node, after the run has already been paid for.
--
-- Empty on every existing row, and that is the correct migration — an install
-- running on a developer's own machine already has a git identity, and writing
-- one over it would be worse than leaving it alone. `applyGitIdentity()` in
-- lib/execution/runner.ts writes nothing while these are blank.
ALTER TABLE "Setting" ADD COLUMN "gitUserName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Setting" ADD COLUMN "gitUserEmail" TEXT NOT NULL DEFAULT '';
