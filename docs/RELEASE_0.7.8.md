# OrbitStart 0.7.8

## Import performance

- Windows shortcut preview now uses native `.lnk` parsing with a modification-time and file-size cache.
- Shortcut icons are excluded from the preview payload and hydrated in background batches after import.
- Scanned resources and JSON backups are imported in a single SQLite transaction with explicit result counts.
- Import completion performs one foreground catalog reload; icon hydration triggers one later reload only when icons changed.
- Trip counts use grouped queries in chunks of 500 resource IDs.
- The resource workspace initially mounts 120 cards, and the import preview initially mounts 100 rows.

## Verification snapshot

- 229 shortcuts: 576 ms first native scan, 456 ms cached scan on the validation machine.
- 500 resources: 101 ms insert transaction, 104 ms update transaction using the in-memory regression fixture.
- Rust unit tests: 7 passed.
- Browser GUI regression: 9 passed, including a 250-resource progressive-rendering case.

The scan timings depend on the number and condition of local shortcut files. Damaged `.lnk` files are isolated and retained as directly launchable shortcut paths instead of failing the full scan.
