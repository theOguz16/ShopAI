# ShopAI

TypeScript + pnpm monorepo başlangıcı. Web ve MCP aynı ürün arama use case'ini kullanır.

## Hızlı başlangıç

Node 22.14+ (22.x) ve pnpm 10.30.3 ile:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Web: http://127.0.0.1:3000 · API: http://127.0.0.1:4000 · MCP: http://127.0.0.1:4000/mcp

Demo PostgreSQL, Redis veya API anahtarı gerektirmez. Katalog sentetiktir, bağlantılar example.com'a gider. Doğal dil kutusu yalnız sınırlı, kurallı Türkçe ayrıştırıcı kullanır; LLM ve semantic search henüz yok. Paylaşılan paket değişikliğinden sonra `pnpm build:packages` çalıştırın veya `pnpm dev` yeniden başlatın; ilk sürümde paketler watch modunda değildir.

## Repo

```text
apps/
  web/              Next.js keşif + panel yer tutucu
  api/              Fastify REST + stateless MCP + stdio
  worker/           BullMQ import worker ve yerel CSV CLI
  chatgpt-widget/   React/Vite yerel bileşen önizlemesi
packages/
  contracts/        Zod giriş/çıkış ve import job şemaları
  commerce/         Arama use case, repository portu, demo katalog
  db/               Drizzle şema, SQL migration, PostgreSQL adapter, import
  connectors/       CSV parser ve connector arayüzü
  ai/               Offline demo query parser
  ui/               Ortak ürün kartı
  config/           TypeScript ayarları
infra/              PostgreSQL + Redis yerel compose
tests/              CSV, arama, HTTP ve MCP regresyonları
scripts/            Paket bağımlılık sınırı kontrolü
docs/               Hedef mimari ve uygulama durumu
```

## Komutlar

| Komut | İşlem |
|---|---|
| `pnpm dev` | Demo API + web |
| `pnpm dev:widget` | Yerel widget önizlemesi, port 3001; API ayrıca çalışmalı |
| `pnpm check` | Lint, typecheck, test, build |
| `pnpm format` | Kod biçimlendirme |
| `pnpm db:generate` | Şemadan yeni SQL migration |
| `pnpm infra:up` | Yerel PostgreSQL/Redis |
| `pnpm db:migrate` | Mevcut migration'ları uygula |
| `pnpm db:seed` | Yerel sentetik demo kataloğunu yayımla |
| `pnpm dev:worker` | Kuyruk tüketicisi |
| `pnpm infra:down` | Servisleri durdur; volume'ları silmez |

## PostgreSQL modu

Docker Desktop çalışıyor olmalı. Repo kökünde:

```bash
cp .env.example .env
pnpm infra:up
pnpm db:migrate
pnpm db:seed
```

`.env` içinde `CATALOG_MODE=postgres` yapıp `pnpm dev` çalıştırın. Demo seed yalnız localhost/127.0.0.1 DB bağlantısına izin verir. CSV ürünleri taslak kalır; gerçek mağaza yayın onayı henüz uygulanmadı. Seed yalnız geliştirme verisidir.

API ve worker kök `.env` dosyasını yükler. Web API adresi varsayılan localhost'tur. Farklı adres için `apps/web/.env.local` içine `NEXT_PUBLIC_API_URL` yazın; bu değer build sırasında istemciye gömülür ve secret içeremez.

## CSV import

Önce DB migration/seed ve worker çalışmalı. Ayrı terminalde:

```bash
pnpm dev:worker
```

Ardından repo kökünde:

```bash
pnpm import:csv "$PWD/tests/fixtures/catalog.csv" 10000000-0000-4000-8000-000000000001 10000000-0000-4000-8000-000000000002
```

En fazla 2 MB / 1000 varyant. Fiyat kuruş cinsinden tam sayıdır. Boş `available` bilinmeyen stoktur. Tek hatalı satır varsa CLI işi göndermeden durur. Import bağlantının mağazaya ait olduğunu kontrol eder; transaction ve job ID ile tekrarları önler. Görülmeyen ürünleri silmez. Bu CLI güvenilir yerel operatör içindir; HTTP import endpoint'i yoktur.

## MCP

`/mcp` stateless Streamable HTTP endpoint'idir. `search_products` yapılandırılmış veri döndürür; REST ile aynı use case'i çağırır. Stdio istemcileri için build sonrası:

```bash
pnpm --filter @shopai/api mcp:stdio
```

React widget MCP Apps `ui://` kaynağı olarak kayıtlıdır ve metin fallback'i vardır. Merchant auth, üyelik/rol kontrolleri ve RLS/public DB rolleri uygulanmıştır. Buna rağmen gerçek ChatGPT host oturumu, TLS staging kabulü ve rollback provası tamamlanmadan sürüm production'a yayımlanmış kabul edilmez; güncel sınırlar `docs/06-implementation-status.md` içindedir.

## Mevcut sınırlar

- Gerçek LLM, canlı pazaryeri connector'ı, fiyat/stok garantisi yok.
- Merchant login, üyelik endpoint'leri ve yayın paneli yok; DB üyelik tablosu yalnız temel şemadır.
- Redirect imzası, click attribution ve conversion callback uygulanmadı; kartlar doğrudan ürün bağlantısı kullanır.
- RLS, outbox, dosya deposu ve snapshot silme stratejisi hedef mimaride; mevcut sınırlı CLI importunda yok.
- İlk izlenebilir baseline'ın temiz checkout, PostgreSQL/Redis ve migration doğrulama kaydı `docs/release-baseline.md` içindedir. Bu yerel kanıt staging veya production kabulü değildir.

Ayrıntı: [Uygulama durumu](docs/06-implementation-status.md), [hedef mimari](docs/README.md).
