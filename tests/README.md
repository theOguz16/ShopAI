# Test suite sözleşmesi

Bütün `*.test.ts` dosyaları konumuna göre otomatik ve karşılıklı dışlayan iki
suite'ten birine girer:

- `tests/integration/**/*.test.ts`: PostgreSQL ve Redis bulunan integration
  job'ında `pnpm test:integration` ile çalışır.
- Diğer `tests/**/*.test.ts` dosyaları: altyapı ortam değişkenlerini bilinçli
  olarak temizleyen `pnpm test` unit/demo suite'inde çalışır.

Integration config dosya allowlist'i kullanmaz. Bu nedenle `tests/integration/`
altına eklenen yeni bir test ayrıca listeye yazılmadan otomatik keşfedilir.
`tests/integration/setup.ts`, `DATABASE_URL` veya `REDIS_URL` yoksa suite'i test
toplanmadan açık hatayla durdurur; başarılı skip kabul edilmez.

`pnpm lint` içindeki `scripts/check-test-suites.mjs` bütün test dosyalarının bu
iki kapsamdan tam birine eşlendiğini doğrular.
