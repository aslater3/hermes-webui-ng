# Phase 5 Git status correction

14 September 2026. The dedicated production mount test at `ed20636` failed its staged-and-unstaged assertion after native authentication, tree, preview and download had passed. This is a real implementation defect, not an assertion to relax or a fixture delay to add.

The pinned `isomorphic-git@1.42.2` WORKDIR oid path reuses an index blob when its stat comparison matches. That comparison uses whole-second mtime/ctime, inode, ownership, mode and size, so rapid same-size edits can reuse the staged oid. The new status projection uses documented `walk`, `TREE`, `WORKDIR({refresh:false})`, `STAGE`, `isIgnored` and `hashBlob` APIs, hashing actual bounded worktree contents for tracked files rather than calling WORKDIR.oid. It keeps the documented HEAD/WORKDIR/STAGE numeric encoding, restricted-path pruning, no submodule traversal and the same descriptor/filesystem/worker limits.

The deterministic regression supplies matching cached metadata while physically changing equal-size file content. It demonstrates the library shortcut returning staged-only, then requires the content-based reader to report staged plus unstaged, with the index unchanged. Existing packed/deleted/untracked/config/symlink tests remain passing. No test sleep, timestamp rewrite, index refresh or filesystem mutation is added to hide the issue.

Local typecheck/lint, 189 unit tests and 34 wire contracts pass. The unchanged production mounted-workspace acceptance must now pass in both authentication modes before final Phase 5 sign-off. The failed native run is `34852854883` and remains a failure.

Primary API references: https://isomorphic-git.org/docs/en/statusMatrix and https://isomorphic-git.org/docs/en/walk. Implementation inspection was against the exact installed lock version, not a claim of compatibility with every future parser version.
