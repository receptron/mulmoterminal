---
name: blueprint-docs-workspace
description: "Make sure chaff runs in this document folder and that the build's records have a place, before anything is read or written."
---

# The folder and chaff

This folder is where the documents live. The person may not be an engineer: say what you do in plain
words. Change nothing in the repository: nothing is written outside `.blueprint/` (and, in a git
repository, `.git/info/exclude`) until the person has approved the models.

1. `.blueprint/` already exists (the build created it). Everything this build records goes there.
2. Run chaff once through the base pack's wrapper, so its first download happens now and not in the
   middle of a later step: `sh <base pack>/checks/chaff.sh rules --json > /dev/null`. The wrapper runs the
   pinned chaff (`npx -y chaffjs@0.21`) unless `CHAFF_BIN` names another. If it fails, show the person the
   error and stop — do not work around it.
3. If the folder is a git repository, add `.blueprint/` to `.git/info/exclude`. That keeps the build's
   working files out of commits without touching `.gitignore`, which belongs to the person.
4. If a `chaff.yaml` is already here, do not edit it in this step. Tell the person it exists; a later
   step reads it.

The check runs chaff here and fails if it cannot, or if `.blueprint/` would be committed.
