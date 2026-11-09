# Unused standard-block deletion — Bridge 1.15.0 (PHUB-580)

`POST /tia/blocks/delete` requires a configured bearer token, including localhost.
This first bounded operation supports V21 projects with exactly one PLC. V18/V20
return a refusal. Work in a separate revision: the route operates on the currently
open project and does not create a copy. TIA must already be offline and saved.

Preview (the default) exports XML and reads native references, without compile,
save or deletion:

```json
{
  "expected_project_path": "C:\\Bench\\Project\\Project.ap21",
  "plc_name": "PLC_1",
  "blocks": [{ "name": "UnusedParser", "kind": "FB", "number": 25 }],
  "control_block": "UsedParser",
  "control_caller": "ParserManager",
  "require_code_memory_fit": true
}
```

Supply 1–10 unique FB/FC identities and a separate known-used FB/FC with an incoming
native `UsedBy / Call` from the named caller. Targets require consistent native
reference roots matching name, address and folder, with nonempty outgoing `Uses`
and no incoming, instance or unknown relation anywhere in the reference tree.
The complete inventory, including system groups, is searched for instance DBs.
System, safety and protected targets are refused. This conservative policy may
refuse an unused empty block; it does not infer absence from an empty query.
Cross-reference capture uses text fields only, never `UnderlyingObject` navigation.

Review the returned identities, fingerprints, warning and archive path. Apply:

```json
{
  "expected_project_path": "C:\\Bench\\Project\\Project.ap21",
  "plc_name": "PLC_1",
  "dry_run": false,
  "confirm_delete": true,
  "plan_id": "<value returned by preview>"
}
```

The preview lives in Bridge memory for ten minutes; only the latest preview is
retained. Restart, another preview, a used plan or changed context requires a new
preview. Apply uses the server's plan; client-supplied replacement targets or gates
cannot change it. It recompiles the baseline, rechecks references, instances and
content, then archives all XML before deletion. XML fingerprints ignore only the
top-level DocumentInfo export envelope and indentation between elements, preserving
code, attributes and literal text. A changed user-block inventory or target content
refuses deletion. TIA exclusive access and a Bridge operation gate prevent concurrent
engineer/API changes during the operation; fresh checks cover changes since preview.

After deletion, the exact survivor inventory and compile must pass before save.
`require_code_memory_fit` additionally refuses the English compiler warning containing
`required code memory`; it is not a numeric capacity measurement and is not qualified
for other TIA UI languages. Other warnings are reported and do not fail compile.
The removed code-byte total reports pre-delete block sizes, not post-compile percentage.

Deleting/reimporting an FB resets its instance DB values on a later download. This
route permits only zero-instance, unused targets and performs no PLC download, value
write or connection-state change. Safety code is never a deletion target.

Backups and evidence live under `%TEMP%\PacForge\BlockDelete\<plan_id>`. Retain them
with the job evidence before clearing temp storage. On failure, every attempted
deletion is restored where missing; every restored identity/content and the complete
inventory are verified, then recovery compiles before save. `success:false` remains a
failed cleanup even when `recovery_complete:true`. A recovery error leaves the
candidate unsaved and marked `candidate_usable:false` with `CANDIDATE-UNUSABLE.json`.
Do not download that candidate. A host/process crash can prevent automatic recovery;
the pre-delete XML remains the recovery source. This API is not an atomic transaction.

Inspect response `success`, `saved`, `compile` and recovery fields; HTTP 200 alone does
not establish success. Invalid preconditions return HTTP 409. Auth failures return
401 (configured token missing/wrong) or 403 (no token configured).

Verification: `bridge/tests/run-block-delete-tests.ps1` runs policy/recovery tests
without TIA. Optional `-BridgeDirectory <V21 build>` runs JSON checks against the
compiled Bridge; `-NativeCapture <read-only capture.json>` also checks the four
measured Freezer reference fixtures (two unused and two known-used blocks).
Live preview and apply must still be qualified against an isolated project under the
engineer's TIA account before treating the deployed operation as verified.
