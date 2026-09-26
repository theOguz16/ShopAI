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

## Secure connection provası notu (ÜRÜN-008)

Connector target-safety katmanı localhost hedeflerini reddettiği için, bu
provanın connector tarafı `SHOPAI_WOO_REHEARSAL=1` çalışırken yalnız bu test
dosyasına özel bir allowlist fetcher'ı kullanır
(`createPublicConnectorFetch(..., { allowHosts: [storeHostname])`). Bu
mekanizma production/staging API veya worker koduna hiçbir koşulda geçmez;
ortam değişkeniyle "private host'a izin" fallback'i yoktur. ÜRÜN-008 pairing
yaşam döngüsünün provası için bkz.
[urun-008-woo-secure-connection.md](follow-ups/urun-008-woo-secure-connection.md);
gerçek mağaza üzerinde eklenti kurulum provası ÜRÜN-009 kabulü ile yapılacaktır.

## Kanıt kaydı

Her koşunun son üç satırı WordPress sürümü, WooCommerce sürümü ve ShopAI commit SHA'sını basar. Son başarılı koşu buraya eklenir; sonuç görülmeden önce beklenti tablosu değiştirilmez.

| Tarih (Europe/Istanbul) | WordPress | WooCommerce | ShopAI commit | Sonuç |
| --- | --- | --- | --- | --- |
| 2026-09-09 | 7.1 | 11.1.0 | `6560f47e63a7c2a30a5b7031aec644a83091a198` | Geçti — 3/3 gerçek REST prova testi |

Bu kayıt yalnız teknik entegrasyon provasıdır; “gerçek müşteri kabulü tamamlandı” anlamına gelmez.
