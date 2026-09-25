-- Legacy scoped-file connector secret backfill.
-- 0035 tabloları mevcut legacy `secret://` referanslı bağlantılar için historical
-- lifecycle satırı oluşturmaz; migration/rotation/rollback bu satıra (file backend,
-- version 1) dayanır. Eksik historical satırı deterministik biçimde üretir:
-- secret value yazılmaz, mevcut satırlar/commit'ler değiştirilmez, source_connections
-- durumu (active/revoked) dokunulmaz. Idempotent: referans zaten kayıtlıysa veya
-- version 1 slotu doluysa ekleme yapmaz.
INSERT INTO connector_secrets (merchant_id, connection_id, provider, reference, version, status)
SELECT c.merchant_id, c.id, c.provider, c.credentials_ref, 1, 'active'
FROM source_connections c
WHERE
  c.credentials_ref LIKE 'secret://%'
  AND c.provider IN ('woocommerce', 'trendyol')
  AND NOT EXISTS (
    SELECT 1 FROM connector_secrets s
    WHERE s.connection_id = c.id AND s.reference = c.credentials_ref
  )
  AND NOT EXISTS (
    SELECT 1 FROM connector_secrets s
    WHERE s.connection_id = c.id AND s.version = 1
  );
