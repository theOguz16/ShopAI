# WooCommerce entegrasyon provası

Bu prova müşteri beklemeden, yalnız yerel Docker ortamında sentetik ürünlerle WooCommerce'in gerçek REST API davranışını sınar. **Gerçek müşteri kabulü değildir.** Canlı mağaza, kişisel veri veya gerçek API anahtarı kullanılmaz.

## Tekrar çalıştırma

Önkoşullar Docker Desktop, Node 22 ve pnpm 10'dur. Repo kökünde:

```bash
bash scripts/woocommerce-rehearsal.sh
```

Betik MariaDB, WordPress, WooCommerce ve Caddy'yi başlatır; Caddy'nin yerel CA sertifikasını geçici klasöre alır, salt-okunur anahtarla connector'ı çalıştırır ve sentetik ürünleri sonunda siler. Ortamı kapatmak için:

```bash
docker compose -f infra/woocommerce-test.compose.yaml down
```

Tamamen sıfırlamak ayrıca `down --volumes` gerektirir; bu yalnız prova verisini siler. Sabit anahtarlar ve parolalar yalnız localhost prova ortamınındır, üretim secret'ı değildir ve başka yerde kullanılmamalıdır.

## Senaryolar ve mutabakat

| Senaryo | WooCommerce kaynağı | ShopAI normalize sonucu | Beklenti |
| --- | --- | --- | --- |
| Basit ürün | Product ID, M/Siyah, 499,90 TRY, adet 4 | Aynı external ID, beden, renk, 49.990 minor, `available=true` | Eşleşir |
| Varyasyonlu ürün | İki variation ID; S ve M/Lacivert | Her variation ayrı external ID; ortak product key | Eşleşir |
| Fiyat + stok | Basit ürün 549,90 TRY ve adet 0 | 54.990 minor, `available=false` | Eşleşir |
| Varyasyon değişimi | M → L, 799,90 TRY | Aynı variation ID, L, 79.990 minor | Eşleşir |
| Ürün kaldırma | Basit ürün kalıcı silinir | Sonraki tam snapshot'ta external ID yok | Eşleşir |
| Yetki iptali | Geçersiz/revoke edilmiş secret 401 üretir | `reauthorizationRequired=true`; geçerli salt-okunur anahtarla akış toparlanır | Eşleşir |
| Eksik sayfalama | Gerçek Woo yanıtından proxy simülasyonuyla `X-WP-TotalPages` düşürülür | Snapshot `complete=false` | Toplu pasifleştirme yasak |

Eksik snapshot'ın mevcut teklifleri pasifleştirmediği worker + PostgreSQL seviyesinde `tests/integration/database.test.ts` tarafından ayrıca doğrulanır. Prova testi kaynağın değişimi ile connector okumasını aynı test adımı içinde ardışık yapar; uzak saat farkına dayanmaz.

## Kanıt kaydı

Her koşunun son üç satırı WordPress sürümü, WooCommerce sürümü ve ShopAI commit SHA'sını basar. Son başarılı koşu buraya eklenir; sonuç görülmeden önce beklenti tablosu değiştirilmez.

| Tarih (Europe/Istanbul) | WordPress | WooCommerce | ShopAI commit | Sonuç |
| --- | --- | --- | --- | --- |
| 2026-09-09 | 7.1 | 11.1.0 | `b72cb3b35df9c59ea97613edfe6e0d90331da14a` + T09 çalışma ağacı | Geçti — 3/3 gerçek REST prova testi |

Bu kayıt yalnız teknik entegrasyon provasıdır; “gerçek müşteri kabulü tamamlandı” anlamına gelmez.
