# Veri modeli ve senkronizasyon

## Varlıklar

İlk sürümde bir merchant bir tenant'tır. Kullanıcı birden fazla merchant üyeliğine sahip olabilir. Ortak ürün kimliğini mağazalar arasında otomatik birleştirmek ertelenir.

| Varlık | Ana alanlar / amaç |
|---|---|
| Merchant | id, name, slug, status, allowed_checkout_hosts |
| Membership | user_id, merchant_id, role: owner/editor/viewer |
| SourceConnection | merchant_id, provider, credentials_ref, status, capabilities |
| ImportRun | connection_id, status, cursor, snapshot_id, counts, error_summary |
| Product | merchant_id, title, description, category_id, brand, publication_status |
| Variant | merchant_id, product_id, sku, barcode, size, color, attributes |
| Offer | merchant_id, variant_id, connection_id, external_offer_id, price_minor, currency, checkout_url, active |
| Inventory | merchant_id, offer_id, available, quantity_nullable, observed_at |
| SourceRecord | merchant_id, connection_id, external_variant_id, variant_id, source_updated_at, content_hash, last_seen_run_id |
| AttributeEvidence | merchant_id, variant_id, name, value, origin, confidence_nullable, model_version_nullable |
| Category | id, slug, version, attribute_schema |
| RedirectClick | id, merchant_id, offer_id, search_id_nullable, channel, created_at |
| Conversion | merchant_id, external_order_id, click_id_nullable, amount_minor, currency, status, evidence_source |
| OutboxEvent | id, type, schema_version, payload, published_at_nullable |

## Veri kuralları

- Parasal tutarlar tam sayı alt birimdir: 129900 TRY = 1.299,00 TL. Farklı para birimleri dönüştürülmeden karşılaştırılmaz.
- Beden ve renk variant'a aittir; fiyat/stok aynı seçilmiş varyantın offer'ından gelir. Başka bedenin ucuz fiyatı gösterilmez.
- `quantity = null` bilinmiyor demektir; sıfırla eşit değildir. Kaynak yoksa stokta olduğu iddia edilmez.
- Saatler UTC tutulur, arayüz yerelleştirir. Kaynak güncelleme zamanı ile sistemin gözlem zamanı ayrı tutulur.
- Kaynak ve AI çıkarımı ayrı kayıtlanır. Marka, fiyat, stok ve malzeme gibi doğrulama gereken alanlar görselden kesinleştirilmez. Çıkarılan stil etiketi filtrede güven düzeyiyle kullanılabilir.
- Tenant içi ilişkiler `(merchant_id, id)` composite foreign key ile korunur. Kimliklerin global UUID olması tek başına izolasyon sağlamaz.
- `SourceRecord(connection_id, external_variant_id)` ve `Offer(connection_id, external_offer_id)` unique olmalıdır. Bağlantı sahibi merchant ayrıca doğrulanır.
- `Conversion(merchant_id, external_order_id)` unique olur; durum değişiklikleri olay sürümüyle idempotent uygulanır.
- Arama sadece aktif merchant + yayımlanmış ürün + aktif offer döndürür. Özel import verisi kamuya açık sorguya giremez.
- Mağazalar arası arama sunucu tarafında onaylı public catalog projection üzerinden yapılır; panel ve ham tablolar tenant kapsamlıdır.

## Import akışı

1. Yetkili mağaza kullanıcısı dosya yükler. Dosya boyutu, satır sayısı, MIME ve gerekli kolonlar sınırlandırılır.
2. Dosya özel depoya yazılır; ImportRun oluşturulur. DB transaction içinde outbox olayı eklenir.
3. Outbox dispatcher işi kuyruğa gönderir. Tekrar gönderim normaldir; worker idempotent çalışır.
4. Worker satırları parse eder, alanları doğrular, normalize eder. Hatalı satırlar nedenleriyle ayrılır.
5. Ürün, varyant ve offer kaynak kimliğiyle upsert edilir. Bir sayfanın yazılması ile cursor ilerlemesi aynı transaction'da olur.
6. Tamamlanan katalog önizlemeye açılır. İlk importta mağaza yayın onayı verir.
7. CSV canlı değildir: ürün kartında veri zamanı görünür. Yenileme olmadan canlı stok iddiası yapılmaz.

## Canlı connector sözleşmesi

```typescript
interface CommerceConnector {
  capabilities: {
    inventoryRefresh: boolean;
    incrementalSync: boolean;
    webhooks: boolean;
    conversionEvidence: boolean;
  };
  validateConnection(): Promise<void>;
  fetchPage(input: {
    cursor?: string;
    updatedSince?: string;
  }): Promise<{
    records: SourceVariant[];
    nextCursor?: string;
    snapshotId?: string;
  }>;
  refreshOffers?(externalIds: string[]): Promise<SourceOffer[]>;
}
```

Bu TypeScript parçası kavramsal sözleşmedir; tipler uygulamada `contracts` içinde tamamlanacaktır. Kimlik bilgileri connector factory'ye sunucuda verilir; job payload'ında yalnız connection ID taşınır.

## Hata ve güncellik politikası

- Bağlantı başına kilit/fencing token ile eşzamanlı tam senkron engellenir.
- 429 yanıtında kaynağın Retry-After bilgisi izlenir; geçici hatalarda sınırlı exponential backoff + jitter uygulanır.
- Kalıcı yetki hatasında bağlantı durdurulur; mağaza panelinde yeniden bağlantı istenir.
- Eksik veya hatalı snapshot ürünleri topluca silmez. Görülmeyen kayıtlar yalnız doğrulanmış tam ve başarılı authoritative snapshot sonunda pasifleştirilir; satır hataları varsa bu adım uygulanmaz.
- Kaynak değişiklik sırası timestamp/version ile korunur; geç gelen eski kayıt güncel veriyi ezmez.
- Polling sıklığı connector limitine göre ayarlanır. Pilot başlangıç hedefi 15 dakika olabilir; garanti değildir.
- Başlangıç stale eşiği canlı kaynakta 30 dakika, CSV'de 24 saat olarak yapılandırılır. Bunlar pilotta değiştirilecek ürün kararlarıdır.
- Stale offer satın almaya geçişte destekleniyorsa yeniden sorgulanır. Doğrulanamıyorsa kullanıcıya güncellik belirsizliği gösterilir; kesin stok iddiası kaldırılır.
- Başarısız işlerin hata kuyruğu/paneli ve elle yeniden çalıştırma yolu bulunur.
