# Tekrar üretilebilir sürüm baseline'ı

Son güncelleme: 9 Eylül 2026

## Kaynak ve sürüm kararı

`/Users/oguzhanuyar/Desktop/ShopAI` altında, üst dizinlerde ve masaüstündeki mevcut Git repo/worktree metadata'sında bu projeye bağlı bir Git geçmişi bulunamadı. `shopai-architecture.zip` yalnız altı ilk mimari belgesini içerir; Git metadata'sı veya uygulama kaynak kodu içermez. Bu incelemeden sonra mevcut klasör, kayıp bir worktree üzerine yazılmadan bağımsız Git deposu olarak baseline'a alınmıştır.

Tekrar üretim referansı **`release-baseline-2026-09-09` annotated tag'inin işaret ettiği commit**tir. Kesin commit ve kayıt tarihi tag nesnesinde tutulur:

```sh
git rev-parse release-baseline-2026-09-09^{commit}
git show --no-patch --format=fuller release-baseline-2026-09-09
```

Tag'in işaret ettiği commit; mevcut uygulama kaynaklarının, T01 pilot belgelerinin, kilit dosyasının ve CI commit-eşleştirme kontrolünün ilk izlenebilir revizyonudur. Öncesindeki dosya değişikliklerinin commit bazında geçmişi kurtarılamamıştır; bunlar ayrı eski revizyonlarmış gibi sunulmaz.

## Temiz checkout doğrulaması

Doğrulama, tag'den oluşturulan geçici ve temiz bir checkout'ta Node `.node-version` ve `pnpm-lock.yaml` ile yapılır:

```sh
git clone --no-local . /tmp/shopai-release-check
cd /tmp/shopai-release-check
git checkout --detach release-baseline-2026-09-09
pnpm install --frozen-lockfile
pnpm check
docker compose -f infra/compose.yaml up -d
CATALOG_MODE=postgres \
DATABASE_URL=postgresql://shopai:shopai_local@127.0.0.1:54329/shopai \
REDIS_URL=redis://127.0.0.1:63799 \
MCP_PUBLIC_ORIGIN=https://api.staging.shopai.example \
WIDGET_ORIGIN=https://widget.staging.shopai.example \
MCP_ALLOWED_ORIGINS=https://chatgpt.com,https://chat.openai.com \
WIDGET_RESOURCE_DOMAINS=https://widget.staging.shopai.example,https://images.staging.shopai.example \
REDIRECT_SIGNING_SECRET=local-only-release-check-000000000000000000000 \
CONVERSION_CALLBACK_SECRET=local-only-callback-check-000000000000000000 \
pnpm db:migrate
CATALOG_MODE=postgres \
DATABASE_URL=postgresql://shopai:shopai_local@127.0.0.1:54329/shopai \
REDIS_URL=redis://127.0.0.1:63799 \
MCP_PUBLIC_ORIGIN=https://api.staging.shopai.example \
WIDGET_ORIGIN=https://widget.staging.shopai.example \
MCP_ALLOWED_ORIGINS=https://chatgpt.com,https://chat.openai.com \
WIDGET_RESOURCE_DOMAINS=https://widget.staging.shopai.example,https://images.staging.shopai.example \
REDIRECT_SIGNING_SECRET=local-only-release-check-000000000000000000000 \
CONVERSION_CALLBACK_SECRET=local-only-callback-check-000000000000000000 \
pnpm test:integration
```

9 Eylül 2026 yerel temiz-checkout kaydı: `pnpm install --frozen-lockfile`, format/lint/typecheck, 59 temel test, production build, temiz DB migration zinciri ve 32 PostgreSQL/Redis entegrasyon testi geçti. Bu sonuç tag commit'ine aittir; staging yayını veya GitHub Actions koşusu değildir.

## CI ve yayın eşleştirmesi

CI'nin iki işi de checkout sonrasında `GITHUB_SHA == git rev-parse HEAD` koşulunu doğrular ve test edilen SHA'yı GitHub job summary'ye yazar. Repo henüz bir Git remote'una bağlanmadığı için bu baseline için GitHub Actions run URL'si yoktur ve CI geçmiş sayılmaz. Remote eklendiğinde tag commit'i push edilir; iki job'ın başarılı run URL'si ve aynı 40 karakterlik SHA yayın kaydına eklenmeden staging yayını yapılmaz.

Yayınlanan image immutable `git-<40-karakter-SHA>` etiketi taşır. Readiness yanıtındaki SHA, CI summary'deki SHA ve `git rev-parse release-baseline-2026-09-09^{commit}` birebir aynı olmalıdır. Rollback yalnız daha önce bu üçlü eşleşmesi kaydedilmiş commit'e yapılır.

## Repo hijyeni

`.gitignore`; `.env*` (yalnız `.env.example` hariç), `private/` altındaki runtime upload'ları, test/Playwright çıktıları, bağımlılıklar ve build cache'lerini dışarıda tutar. `tests/fixtures/catalog.csv` sentetik test fixture'ıdır ve bilinçli olarak sürümlenir. Commit öncesi secret imzası ve büyük dosya taraması yapılır; gerçek upload, secret veya kişisel pilot verisi eklenmez.
