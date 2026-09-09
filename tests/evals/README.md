# Arama değerlendirmeleri

`search-intents.json`, Türkçe alışveriş niyetleri için 53 etiketli sorgudan oluşan deterministik kalite setidir. `search-quality.test.ts` her temel kontrolde bu veri setini çalıştırır; prompt sürümü, sağlayıcı/model adı, sorgu sayısı, sert ihlal sayısı, ortalama gecikme ve tahmini maliyeti `SEARCH_QUALITY_REPORT` olarak yazar.

Mevcut varsayılan sağlayıcı `rules` ve model etiketi `deterministic-v2`'dir; bu nedenle sonuç canlı bir LLM kalite veya maliyet ölçümü değildir. Model adaptörü testleri şemalı çıktı, timeout, maliyet tavanı, klasik parser fallback'i, olumsuz koşullar ve açık UI filtrelerinin önceliğini kapsar. Veri seti veya beklenen sonuç değişirse değişiklik ayrı incelemeli commit'te yapılmalı; başarısız sorgular silinerek baseline iyileştirilmemelidir.
