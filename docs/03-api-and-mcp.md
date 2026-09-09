# HTTP, MCP ve arama sözleşmeleri

## Ortak arama modeli

```json
{
  "query": "Siyah, hafif bol, M beden tişört; 1500 TL altında",
  "filters": {
    "category": "tshirt",
    "sizes": ["M"],
    "colors": ["black"],
    "maxPriceMinor": 150000,
    "currency": "TRY",
    "inStockOnly": true
  },
  "merchantIds": [],
  "limit": 12,
  "cursor": null
}
```

Boş merchant listesi yalnız yayımlanmış public merchant'lar anlamına gelir. Mağazaya özel görünümde sunucu görünümün kapsamını uygular; istemci listesi kapsamı genişletemez. Limit en fazla 50; query uzunluğu ve filtre dizileri sınırlandırılır.

Yanıt: `schemaVersion`, `searchId`, `items`, `facets`, `nextCursor`, `warnings`. Her item: `productId`, `variantId`, `offerId`, `merchant`, `title`, `imageUrl`, `priceMinor`, `currency`, `size`, `color`, `availability`, `observedAt`, `matchReasons`, `redirectPath`. DTO'da secret, maliyet, ham kaynak kaydı veya özel müşteri verisi bulunmaz.

Arama fiyatı yalnız aynı offer ve varyantın stok bilgisiyle eşleştirilir. Sonuç yoksa filtreler gizlice gevşetilmez; hangi koşulun değiştirilmesi gerektiği önerilir.

## Arama hattı

1. Şema doğrulama, rate limit ve sunucu kapsamını uygula.
2. Web serbest metni varsa parser ile yapılandır; ChatGPT zaten geçerli yapılandırılmış filtre verdiyse ikinci LLM çağrısı yapma.
3. UI'da açık seçilmiş filtreler çıkarımdan önceliklidir. Belirsiz istekler için uyarı/açıklama döndür.
4. Yayımlanma, merchant kapsamı, fiyat, stok ve beden sert filtrelerini uygula.
5. Metin eşleşmesi, kategori eş anlamlıları ve etiketlerle sırala. İleride semantic retrieval aynı sert filtreler altında eklenebilir.
6. Sonuçların kaynak alanlarına dayanarak kısa eşleşme gerekçeleri üret; LLM gerekmez.
7. Parser timeout/hatasında açık filtrelerle klasik aramaya düş; kullanıcıya kısıtlı yorumlamayı bildir.

## HTTP uçları — önerilen v1

| Metot / yol | Yetki | İşlem |
|---|---|---|
| POST /v1/search | Public + rate limit | Yayımlanmış katalog arama |
| GET /v1/products/:id | Public | Yayımlanmış ürün ve varyantlar |
| GET /v1/categories/:slug/facets | Public | Kategoriye uygun filtreler |
| GET /v1/merchants | Public | Aktif public mağazalar |
| POST /v1/merchants/:id/imports | Owner/editor | Dosya import işi, 202 + runId |
| GET /v1/merchants/:id/imports/:runId | Üye | Durum ve satır hataları |
| POST /v1/merchants/:id/connections | Owner | Kaynak bağlantısı |
| POST /v1/merchants/:id/syncs | Owner/editor | Tekrar senkron, 202 |
| PATCH /v1/merchants/:id/products/:productId | Owner/editor | Yayın durumu; kaynak fiyatını değiştirmez |
| GET /v1/merchants/:id/analytics | Üye | Yalnız kendi metriği |
| GET /r/:signedToken | Public + abuse control | Tıklama kaydı ve 302 yönlendirme |
| POST /v1/conversions/:connectionId | İmzalı server webhook | Doğrulanmış sipariş olayı |
| /mcp | MCP transport | Public katalog tool'ları |
| GET /health/live, /health/ready | İşletim | Süreç ve bağımlılık durumu |

Panel kimliği güvenilir auth sağlayıcısının oturumundan alınır; URL'deki merchant ID üyelikle kontrol edilir. Kimlik sağlayıcısı başlangıçta seçilecek. Mutasyonlarda CSRF/origin koruması auth yöntemine göre uygulanır.

Hatalar: `INVALID_INPUT`, `NOT_FOUND`, `FORBIDDEN`, `RATE_LIMITED`, `SOURCE_UNAVAILABLE`, `STALE_DATA`, `IMPORT_INVALID`. Yanıtlar request ID taşır; ham exception ve sağlayıcı yanıtı dışarı verilmez.

## MCP araçları

| Tool | İş kuralı | Yan etki |
|---|---|---|
| search_products | SearchProducts | Salt okunur |
| get_product | GetPublishedProduct | Salt okunur |
| get_facets | GetCategoryFacets | Salt okunur |
| get_merchants | ListPublishedMerchants | Salt okunur |
| check_availability | RefreshOrReadAvailability | Cache yenileyebilir; ödeme/sipariş oluşturmaz |
| get_checkout_url | BuildSignedRedirect | URL üretir; tıklama veya sipariş kaydetmez |

Tool giriş ve çıkış şemaları `contracts` kaynaklıdır. Annotations gerçek yan etkilere göre seçilir; envanter yenileme koşulsuz salt okunur diye etiketlenmez. Merchant yönetim araçları public MCP yüzeyine eklenmez.

OpenAI dokümantasyonu tool'ları önce UI olmadan çalışır hâle getirmeyi öneriyor. Widget, yapılandırılmış çıktıyı ürün kartlarına dönüştürür; UI yüklenmezse ürün bilgisi ve bağlantılar metin olarak kullanılabilir. Sunucu UI resource'u `_meta.ui.resourceUri` ile ilişkilendirir. Yeni widget ortak MCP Apps köprüsünü kullanır; `window.openai` uzantıları yalnız gerekli yetenekler için feature detection ile eklenir. Kaynak: [MCP server](https://developers.openai.com/plugins/build/mcp-server), [UI](https://developers.openai.com/plugins/build/chatgpt-ui).

Widget asset sürümü ve tool DTO sürümü birlikte uyumlu tutulur. Platform incelemesi, gerçek hesap erişimi, domain/CSP yapılandırması ve dağıtım testi ayrı yayın kapılarıdır; genel ChatGPT görünürlüğü veya trafik garanti edilmez. Memory erişimi, bildirim ve native checkout ilk sürüm bağımlılığı değildir.

## Yönlendirme ve satış ölçümü

`get_checkout_url` offer ID, kanal ve süre içeren imzalı token üretir. Gerçek GET geldiğinde redirect servisi offer/merchant durumunu yeniden doğrular, Click kaydeder ve DB'deki onaylı HTTPS hedefine yönlendirir. Token üretimi tıklama sayılmaz. Link önizlemeleri ve botlar gerçek kullanıcı sayısını şişirebileceği için ham redirect istekleri ile tahmini insan tıklamaları ayrı raporlanır.

İstemciden serbest hedef URL kabul edilmez. İzinli hostname ve gerekiyorsa path şablonu sunucuda kontrol edilir. Token query'sinde kişisel veri bulunmaz. Kaynak stok değişmişse uygun durum mesajı gösterilir.

Conversion webhook'unda imza, zaman toleransı ve tekrar koruması gerekir. İptal/iade durumu önceki kaydı günceller. `click_id` mevcut değilse sipariş ShopAI'ye atfedilmez. Hedef sistem click ID'yi korumuyorsa veya güvenilir satış kanıtı sağlamıyorsa yalnız tıklama ölçülür. Pazaryeri sipariş API'sinin bulunması tek başına attribution kanıtı değildir.

Dashboard: arama, sonuçsuz arama, ürün tıklaması, doğrulanmış sipariş ve net atfedilen tutar ayrı metriklerdir. Atfedilen satış, kontrol grubuyla ölçülen ek satışla eş anlamlı değildir.
