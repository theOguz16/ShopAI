# ShopAI — Monorepo mimari dosyası

Tarih: 7 Eylül 2026 · Durum: Uygulama öncesi mimari öneri · Çalışma adı: ShopAI

ShopAI, izinli mağaza kataloglarından kullanıcı ihtiyacına uygun ürünleri bulan ve mağazanın satın alma sayfasına yönlendiren alışveriş platformudur. Web ve ChatGPT aynı commerce çekirdeğini kullanır. Çok mağazalı ürün keşfi ana ürün olarak korunur; mağazaya özel görünüm aynı çekirdeğin filtrelenmiş bir sunumudur.

Bu belgeler hedef mimaridir. Monorepo başlangıcı kodlandı; mevcut kapsam ve eksikler [uygulama durumunda](06-implementation-status.md) açıklanır. Yerel başlangıç için repo kökündeki README dosyasını kullanın.

## Okuma sırası

1. [Sistem ve monorepo](01-architecture.md)
2. [Veri modeli ve katalog senkronizasyonu](02-data-and-sync.md)
3. [HTTP, MCP ve arama sözleşmeleri](03-api-and-mcp.md)
4. [Güvenlik, işletim ve doğrulama](04-operations.md)
5. [Uygulama sırası ve karar kaydı](05-roadmap-and-decisions.md)

## İlk sürüm

- Tek alt kategori: başlangıç varsayımı tişört; pilot verisine göre değişebilir.
- Bir ila üç izinli mağaza; ilk doğrulamada 100–300 ürün yeterli.
- İlk veri adaptörü CSV; ilk canlı adaptör pilot mağazanın sistemine göre seçilecek.
- Doğal dil arama, fiyat/beden/renk filtreleri, görsel ürünler, mağazaya yönlendirme.
- Minimum mağaza paneli: veri yükleme, import hataları, yayın kontrolü, tıklama raporu.
- Web test yüzeyi ve ChatGPT MCP Apps arayüzü.

Sonraki sürümler: kayıtlı kullanıcı profili, alarm, ikinci connector, Gemini/UCP, görsel arama. Ödeme, sipariş yönetimi, iade, sanal deneme ve mobil uygulama ilk kapsamda yok.

## Temel karar

TypeScript + pnpm workspaces; Next.js web; React/Vite widget; Fastify API; PostgreSQL + Drizzle; Redis/BullMQ worker. Modüler monolit: REST ve MCP aynı API dağıtımında, uzun işler ayrı worker sürecinde. Turborepo görev orkestrasyonu önerilir; başlangıçta pnpm recursive komutları da yeterli olabilir.

## Resmî kaynaklar

Platform özellikleri 7 Eylül 2026 tarihinde aşağıdaki sayfalardan kontrol edildi. Buradaki teknoloji seçimleri proje önerileridir; kaynakların zorunlu tuttuğu bir stack değildir.

- [OpenAI MCP server](https://developers.openai.com/plugins/build/mcp-server): tool şemaları ve sunucu bağlantısı.
- [OpenAI MCP Apps UI](https://developers.openai.com/plugins/build/chatgpt-ui): UI resource ve standart köprü kullanımı.
- [OpenAI commerce](https://developers.openai.com/commerce): katalog dağıtımı için ileride değerlendirilecek ayrı kanal.
- [pnpm workspaces](https://pnpm.io/workspaces): çalışma alanları ve workspace bağımlılıkları.

Turborepo dokümanına bu oturumda erişilemedi; sürüme bağlı yapılandırma bu dosyalara kopyalanmadı. Framework ve altyapı sürümleri uygulama başında resmî dokümanlardan doğrulanacak.
