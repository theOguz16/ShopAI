# Sınırlı bellekli katalog senkronu (ÜRÜN-007)

## Amaç

Katalog senkronu katalog büyüklüğüyle doğrusal bellek tüketmez. 1.000 veya
100.000 varyant olsa da süreç tüm katalogu bellekte tutmaz:

```
fetch page → normalize/validate → DB upsert (chunk tx) → checkpoint → release → next page
```

## Eski darboğaz

`collectCatalogSnapshot` (kaldırıldı) tüm connector sayfalarını tek
`SourceRow[]` dizisinde, tüm `externalId` değerlerini bir `Set` içinde
biriktiriyordu; full-sync deaktivasyonu bu set üzerinden devasa
`NOT IN (...)` sorgusu üretiyordu. 100k varyantlı katalog = senkron boyunca
bellekte tüm katalog + id setleri.

## Yeni mimari

- **Paged source contract değişmedi:** `LiveCatalogConnector.readPage({cursor,
  modifiedAfter, mode}) → ConnectorPage` zaten cursor-paged. Provider'a özel
  rewrite yapılmadı.
- **`apps/worker/src/catalog-pages.ts`:** saf paging çekirdeği.
  `iterateCatalogPages` sayfaları tek tek yield eder (üretici doğal
  backpressure uygular; tüketici sayfayı bırakmadan sonraki fetch başlamaz).
  `MAX_CATALOG_PAGES` (10.000) sert sınırı ve cursor döngüsü tespiti buradadır;
  döngü tespiti O(maxPages) bounded set kullanır.
- **`apps/worker/src/catalog-sync-engine.ts`:** DB orkestrasyonu.
  Sayfa → `chunkCatalogRows` (≤1000, `CATALOG_IMPORT_BATCH_SIZE`,
  `CATALOG_SYNC_BATCH_SIZE` env ile ayarlanır) → her chunk kendi transaction'ı
  → checkpoint (sayfa sonu) → sayfa state'i bırakılır. Tek `Promise.all`
  yoktur; akış sayfa başına sıralıdır.
- **`packages/db/src/import-catalog.ts`:** chunk içi yazım artık toplu
  upsert'tir (chunk başına ~12 statement, satır başına 5-9 değil). Chunk
  state'i yalnızca chunk boyutuyla sınırlıdır. `finalizeRun: false` ile
  chunk'lar `import_runs` kaydını tamamlamaz; koşturucu finalizer sahiplenir.

## Checkpoint / resume

`sync_run_checkpoints` (migration `0039_sync_checkpoint`) tenant-scoped
kayıt: `(merchant_id, connection_id, sync_run_id)` PK; `cursor`, sayfa/chunk/
satır/ürün/varyant sayaçları, `attempts`, `observed_at`, watermark,
`source_complete`, status (`running|completed|failed`).

- **Cursor yalnız commit'ten sonra ilerler:** checkpoint, sayfanın tüm
  chunk'ları commit edildikten sonra ayrı transaction'da yazılır. Crash
  durumunda en fazla bir sayfa idempotent biçimde tekrar oynatılır.
- **Resume:** BullMQ aynı job retry'ında aynı `syncRunId`'yi kullanır
  (`SyncJob.syncRunId`; scheduler her zamanlanmış senkron için üretir).
  `beginSyncRun` checkpoint'i bulursa cursor+sayaçlarla kaldığı yerden devam
  eder; son sayfa commit edilmiş ama finalization yapılmamışsa (`source_complete`)
  doğrudan finalize eder.
- **Concurrency guard:** aynı connection için başka bir `running` checkpoint'i
  (30 dk heartbeat içinde) varsa yeni koşturucu skip olur
  (`concurrent-sync`). Ayrı bir distributed lock icat edilmedi; chunk
  yazımlarındaki mevcut `pg_advisory_xact_lock(hashtext(connectionId))`
  ve BullMQ 5 dakikalık bucket jobId dedupe korunur.
- **Staleness:** fresh run `observed_at = max(startedAt, lastSourceWatermarkAt)`
  ile monotonik olur; bağlantı için daha yeni `import_runs.observed_at`
  varsa koşturucu `stale-run` ile skip edilir.
- **Finalization:** tek transaction'da canlı connection kontrolü (`FOR
  UPDATE`), full-mode offer deaktivasyonu, connection watermark/başarı
  alanları, checkpoint `completed`, `import_runs` toplam satırla tamamlanır.

## Full-sync deaktivasyonu (streaming-safe)

Eski `NOT IN (tüm externalId'ler)` yerine: `offers.last_sync_run_id` kolonu
(`0039`). Her import eden run kendini damgalar; finalization'da yalnız
`last_sync_run_id <> bu run` (veya null) olan aktif offer'lar deaktive edilir.
Snapshot set'i gerektirmez, sonuç birebir aynıdır.

## Hata semantiği

- Provider sayfa hatası / malformed item / sayfa içi duplicate externalId:
  chunk fail-closed (mevcut sözleşme; item-level reject yok). Checkpoint
  cursor'ı başarısız chunk'ın arkasında kalır; sessiz veri kaybı yoktur.
  `rejected_rows` sayacı fail-closed'da 0 kalır (ileride item-level reject
  için yer tutar).
- DB chunk hatası: yalnız o chunk geri alınır; önceki chunk'lar committed
  kalır, checkpoint ilerlemez.
- Worker crash: checkpoint'ten resume veya aynı chunk idempotent tekrar.
- Boş katalog: tek boş complete sayfa → güvenli tamamlama; full-mode'da
  stale offer'lar deaktive edilir.

## Queue payload sözleşmesi

`SyncJob = { merchantId, connectionId, syncRunId? }` — strict şema; katalog
verisi ve credential taşınmaz. Connector credential yalnız worker
runtime'ında `secret://` managed-reference'tan çözülür. Checkpoint'e
credential/raw secret yazılmaz; yalnız opak cursor ve sayaçlar.

## Observability

- `sync_run_checkpoints`: run başına sayfa/chunk/satır/ürün/varyant/rejected/
  attempts sayaçları + süre (started/completed).
- `connection_sync_progress`: UI için mevcut ilerleme (found/processed/failed/
  variants); `processed+failed = found` değişmezini korur.
- Worker `sync_completed` logu `sync_run_summary` alanlarıyla: pages, chunks,
  rowsProcessed, productsProcessed, attempts, durationMs, imported.
- Raw catalog payload veya credential loglanmaz.

## Bellek kanıtı

`tests/integration/bounded-memory-sync-rehearsal.test.ts`: 50.000 ürün /
100.000 varyant, generator-paged source (fixture katalogu materialize etmez),
200 sayfa × 500 satır. Kanıtlar:

- tam içe aktarım + birebir sayım (products/variants/offers/inventory,
  distinct sayılar), duplicate yok;
- laziness: sayfa k+1 fetch'i ancak sayfa k'nın tüm chunk commit'lerinden
  sonra gelir (look-ahead yok);
- low-water (post-GC) drift < 64MB, heap bandı < 256MB (ölçülen: ~0,4MB
  drift / ~84MB band — katalog boyutundan bağımsız).

## Kabul testleri

`tests/integration/bounded-memory-sync.test.ts` çok sayfalı import, kimlik,
generic attribute/option, kaynak kategori, canonical mapping korunumu, chunk
retry idempotency, crash resume, cursor-commit sırası, partial state yokluğu,
boş katalog, concurrent-sync skip ve payload sözleşmesini doğrular.
