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

İki yerel raporda seed, ölçek, transport kapsamı, sayım metrikleri, kabul matrisi ve verdict birebir aynıdır. Zaman ve latency ölçümleri kabul karşılaştırmasına dahil değildir. Yerel raporlar `artifacts/pilot-rehearsal/run-1/` ve `run-2/` altındadır; GitHub CI artifact'lerinin gerçek erişimi, SHA'sı ve saklama süresi aşağıda ayrıca doğrulanmıştır.

## GitHub CI — aynı SHA üzerinde iki bağımsız başarılı workflow

Ürün düzeltmesinin **kod/test/CI commit'i** [`8b9064bf420cddcc9eb0fc9f78210bb180b456e2`](https://github.com/theOguz16/ShopAI/commit/8b9064bf420cddcc9eb0fc9f78210bb180b456e2) zaten `main` dalına işlenmişti. Aşağıdaki iki bağımsız CI workflow'unun **aynı exact head SHA'sı** `9f860195b62755fa135bcaf2bc349d3791bdf293` olup bu kodun üzerine yalnız ÜRÜN-001 Markdown değişiklikleri içerir; iki workflow için farklı kod veya timeout ayarı kullanılmadı. Bu ÜRÜN-002 kapanış PR'ı mevcut kodu tekrarlamaz, yalnız gerçek GitHub kanıtını kaydeder.

| CI workflow | Tetikleyici | `check` / `integration` | Artifact adı ve ID | İndirilen ZIP içeriği |
|---|---|---|---|---|
| [35752266315](https://github.com/theOguz16/ShopAI/actions/runs/35752266315) | `push` | PASS / PASS | [`pilot-rehearsal-35752266315` · `10707315302`](https://github.com/theOguz16/ShopAI/actions/runs/35752266315/artifacts/10707315302) | `run-1/report.json`, `run-1/summary.txt`, `run-2/report.json`, `run-2/summary.txt` |
| [35752362301](https://github.com/theOguz16/ShopAI/actions/runs/35752362301) | `pull_request` | PASS / PASS | [`pilot-rehearsal-35752362301` · `10706910629`](https://github.com/theOguz16/ShopAI/actions/runs/35752362301/artifacts/10706910629) | `run-1/report.json`, `run-1/summary.txt`, `run-2/report.json`, `run-2/summary.txt` |

İki artifact GitHub API'de `expired=false` idi ve **iki ayrı ZIP olarak indirildi**, dört `report.json` dosyası JSON olarak okundu. Her artifact içindeki run-1/run-2 ayrı dosyalardır. 30 günlük saklama süresiyle ikisi de **22 Ekim 2026** tarihinde sona erer; süresiz arşiv iddiası yoktur. Artifact SHA-256 ZIP digest'leri sırasıyla `577161380d7d2056265f4b52ee36d6a7d8c82f1878ce99d9d7b6b3959db45ded` ve `4837bc09a88759dc120cd3a8fa2ddb9c5692d0004ea1c2235eb6aa71b55dd173` (farklı ZIP dosyalarıdır; rapor kabulü için hash eşitliği beklenmez).

### Dört gerçek CI raporunun kabul karşılaştırması

| Rapor | Süre (ms) | MCP `tools/call` → `search_products` | Arama: giriş/explicit/başarılı | Empty / error | Kabul matrisi / senaryolar / karar |
|---|---:|---|---|---|---|
| 35752266315 / run-1 | 30.023 | 1 başarılı, 3 ürün | 203 / 103 / 202 | 1 / 1 | 10/10 true; 22/22 pass; PASS |
| 35752266315 / run-2 | 30.748 | 1 başarılı, 3 ürün | 203 / 103 / 202 | 1 / 1 | 10/10 true; 22/22 pass; PASS |
| 35752362301 / run-1 | 28.045 | 1 başarılı, 3 ürün | 203 / 103 / 202 | 1 / 1 | 10/10 true; 22/22 pass; PASS |
| 35752362301 / run-2 | 28.085 | 1 başarılı, 3 ürün | 203 / 103 / 202 | 1 / 1 | 10/10 true; 22/22 pass; PASS |

Dört raporun hepsinde seed `23001`, 5 sentetik merchant, 10.083 katalog ürünü, 100 journey (50 Web/REST + 50 ChatGPT-attributed), 646 istek, 645 başarılı istek, kontrollü 1 hata ve sıfır tenant izolasyonu ihlali eşleşir. `search-taxonomy` senaryosu ayrıca `catalogLoads=100`, `refinements=100`, `paginationRequests=100`, `emptySearches=1`, `failedSearches=1` ile PASS. On kabul alanının tümü `true` ve rapor `verdict=PASS` dört kez doğrulandı. Süre/latency kabul matrisiyle karıştırılmamalıdır.

**Kalan gözlem — raporlar bütünüyle birebir aynı değildir:** `merchant-analytics` senaryosunun `attributedSales` değeri koşuya göre **1 veya 2**, `attributedGmvMinor` **20.000 veya 30.800**, `netRevenueMinor` **15.000 veya 25.800** çıkmıştır. Bu senaryonun statüsü yine PASS ve üst seviye metrikler (`attributedOrders=13`, `attributedGmvMinor=146600`, `netRevenueMinor=141600`) ile arama/MCP/kabul matrisi dört koşuda aynıdır. Bu farklılık sessizce normalleştirilmedi; merchant-analytics alt detaylarının tam deterministik olduğu **iddia edilmez**. #54'ün arama/MCP invariant'ının çözülmesi, merchant analytics alt sayılarının ayrıca incelenmesi ihtiyacını ortadan kaldırmaz.

**Kapanış sınırı:** ÜRÜN-002'nin *istenen iki exact-SHA CI workflow + iki erişilebilir artifact + aynı MCP/arama/empty/error/kabul* ölçütleri karşılandı. #54'ün nihai kapatılması için bu kanıt ve merchant-analytics gözlemi birlikte değerlendirilmelidir. TASK-023B / ÜRÜN-032 gerçek kullanıcı/merchant pilotu **BEKLİYOR**; CI'daki sentetik satışlar gerçek ciro değildir. `main` merge'i yalnız kullanıcının yeni açık onayıyla yapılabilir.
