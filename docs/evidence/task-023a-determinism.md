# ÜRÜN-002 — TASK-023A determinism kanıtı

Tarih: 22 Eylül 2026

Bu kayıt sentetik pilot rehearsal'ının #54 kapsamındaki kararsızlığını açıklar. Gerçek merchant/user pilotu değildir ve TASK-023B durumunu değiştirmez.

## Önceki CI raporlarının karşılaştırması

| Alan | FAIL — run 35644677443 | PASS — run 35652004235 | Beklenen |
|---|---:|---:|---:|
| Seed | 23001 | 23001 | 23001 |
| Süre | 3.754,98 sn | yaklaşık 27 sn | Süre kabul değeri değildir |
| `realMcpTransportTests` | 0 | 1 | 1 |
| `explicitSearches / searchAttempts` | 103 / 203 | 103 / 203 | 103 / 203 |
| `emptySearches` | 2 | 1 | 1 |
| `failedSearches` | 1 | 1 | 1 |
| Search taxonomy | FAIL | PASS | PASS |

FAIL koşusunda HTTP `tools/call` 200 dönmüş, fakat `result.structuredContent.products` boş kalmıştır. Bu MCP araması ikinci `empty` olayını yazdığı için bozulan beklenti `emptySearches === 1 && failedSearches === 1` olmuştur: gözlenen `empty=2, error=1`; beklenen `empty=1, error=1`.

Kaynaklar: [FAIL koşusu](https://github.com/theOguz16/ShopAI/actions/runs/35644677443), [PASS koşusu](https://github.com/theOguz16/ShopAI/actions/runs/35652004235), [issue #54](https://github.com/theOguz16/ShopAI/issues/54).

## Kök neden

Rehearsal, yeni veritabanına 10.000+ katalog satırı toplu ekledikten hemen sonra beş eşzamanlı facet sorgusu başlatıyordu. PostgreSQL auto-analyze henüz tamamlanmadığında planner varsayılan istatistiklerle çok yavaş bir plan seçebiliyordu; auto-analyze önce tamamlandığında aynı seed hızlı geçiyordu.

Yavaş koşu, katalog stoklarının 15 dakikalık tazelik penceresini aşmasına neden oldu. MCP transport probu `inStockOnly` alanını göndermediği için iç arama sözleşmesinin `true` varsayılanını aldı. Böylece transport/envelope kontrolü çalışma süresine bağlı bir stok tazeliği testine dönüştü ve hedef mağazadaki ürünler boş sonuç olarak kaydedildi.

## Düzeltme ve sınırlı regresyon

- Fixture kurulumu sonunda `ANALYZE merchants, products, variants, offers, inventory` açıkça çalıştırılır; sonuç PostgreSQL auto-analyze zamanlamasına bağlı değildir.
- Yalnız MCP transport ve response envelope'u sınayan prob `inStockOnly: false` değerini açıkça gönderir. Stok tazeliği kabulü gevşetilmemiştir; bu probun kapsamından ayrılmıştır.
- `tests/pilot-rehearsal.test.ts`, eski probun `inStockOnly=true`, düzeltilmiş probun `false` çözümlendiğini büyük pilotu çalıştırmadan doğrular.
- MCP ve taxonomy hata mesajları artık gözlenen ve beklenen değerleri yazar.
- CI aynı seed'i aynı commit üzerinde iki kez çalıştırır ve iki raporu ayrı artifact dizinlerinde saklar.

## Aynı kaynak durumunda iki temiz koşu

Yerel base commit: `6ce644a0d0103b2dbc71a984328c1da6641d5b9c`

Çalıştırılabilir görev dosyalarının ortak kaynak parmak izi: `ca2917126726920193f8371d730748099689a592cda120e5e4e4001609170945`

| Koşu | UTC başlangıç | Süre | MCP | Taxonomy | Sonuç |
|---|---|---:|---:|---|---|
| run-1 | 2026-09-22T15:49:36.517Z | 10.133 ms | 1 | PASS; `empty=1`, `error=1` | PASS |
| run-2 | 2026-09-22T15:49:56.531Z | 10.311 ms | 1 | PASS; `empty=1`, `error=1` | PASS |

İki raporda seed, ölçek, transport kapsamı, sayım metrikleri, kabul matrisi ve verdict birebir aynıdır. Zaman ve latency ölçümleri kabul karşılaştırmasına dahil değildir. Yerel raporlar `artifacts/pilot-rehearsal/run-1/` ve `run-2/` altındadır; CI, commit SHA'sına bağlı kalıcı artifact'i aynı dizin yapısıyla üretir.
