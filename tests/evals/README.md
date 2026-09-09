# Arama değerlendirmeleri

Değerlendirme üç ayrı ölçümden oluşur:

- `search-intents.json`: geliştirme regresyonu; 62 etiketli parser sorgusu.
- `search-intents-holdout.json`: kural/prompt geliştirilirken değiştirilmeyen 7 sorguluk kilitli değerlendirme bölümü. Başarısız örnek silinmez; yeni gözlem ayrı satır olarak eklenir.
- `search-user-tasks.json`: sentetik katalog üzerinde 5 sonuç görevi. Parser alanı doğruluğundan bağımsız olarak beklenen ürünün bulunmasını veya gerçekten sonuç olmamasını ölçer.

`search-quality.test.ts` üç ayrı rapor üretir. `hardViolations`, etiketli sert filtrenin yanlış/eksik çıkarılmasıdır. Sonuç görevlerindeki `hardFilterViolations`, dönen bir ürünün uygulanan kategori, renk, beden, fiyat aralığı veya stok koşulunu ihlal etmesidir. `successRate` ise beklenen ürünün sonuçlarda bulunmasıdır; “sonuç yok” görevinde yalnız boş sonuç başarıdır. Böylece alaka başarısı sert filtre güvenliğiyle karıştırılmaz.

Varsayılan sağlayıcı `rules`, model etiketi `deterministic-v2`'dir. Bu koşu canlı LLM kalite veya maliyet ölçümü değildir. Sahte model adaptörü testleri şemalı çıktı, timeout, maliyet tavanı, fallback, olumsuz koşul ve açık UI filtresi önceliğini kapsar. Gerçek model karşılaştırması yapılırsa aynı üç veri dosyası ve aynı commit kullanılmalı; model adı, prompt sürümü, maliyet ve fallback sayısı ayrıca kaydedilmelidir.

Çalıştırma:

```bash
pnpm build:packages
pnpm exec vitest run tests/evals/search-quality.test.ts
```
