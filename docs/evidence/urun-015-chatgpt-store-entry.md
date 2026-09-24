# ÜRÜN-015 — Instagram bio → ChatGPT mağaza girişi: araştırma kanıtı

Tarih: 2026-09-24. Branch: `research/urun-015-chatgpt-store-entry`. İncelenen ve 2026-09-24 tarihinde yeniden fetch edilen `origin/main` commit'i: `7a4be830044d54475eb458b6b53e68f4637bfd2a`. Rebase bu commit üzerine no-op oldu. Bu kayıt platform araştırması ve kaynak kod incelemesidir; canlı ChatGPT giriş kabulü değildir. Tam senaryo listesi: [test matrisi](urun-015-entry-matrix.csv).

## Karar

**“Instagram bio linkine basınca ChatGPT içinde ShopAI doğrudan ilgili mağaza bağlamıyla açılır” teknik varsayımı kanıtlanmadı.** İncelenen resmî OpenAI belgeleri ChatGPT'de bağlantı kurma, konuşmada app/tool seçme ve çalışan widget'a tool input/output iletmeyi açıklıyor; dış web URL'sinden bir ChatGPT app'i açıp geliştirici kontrollü `store slug` veya `campaign` parametresi aktaran belgeli bir sözleşme göstermiyor. Belge yokluğunu platformun teknik olarak imkânsızlığı diye yorumlamıyoruz. Ürün vaadi olarak destekleniyor kabul etmiyoruz.

## Mevcut URL ve context mimarisi

| Yüzey | Mevcut davranış | Kanıt |
|---|---|---|
| `/stores/:slug` | Panelin “mağaza bağlantısı” olarak kopyaladığı yol. `GET /v1/stores/:slug` ile public store kimliği alınır, `surface=brand_widget`, merchant ID ve geçerli campaign ile REST discovery session oluşturulur; mağaza ID ile arar. | `apps/web/app/dashboard/page.tsx`, `apps/web/app/stores/[slug]/page.tsx`, `apps/api/src/routes/merchants.ts` |
| `/shop/:slug` | Markalı storefront. `GET /v1/storefronts/:slug` ile aktif ve public mağaza yüklenir; `surface=web`, merchant slug ve geçerli campaign ile REST discovery session oluşturulur. Mağaza kapsamlı aramadan kullanıcı açıkça “Tüm mağazalarda ara” deyince yeni, kapsamı boş session'a geçer. | `apps/web/app/shop/[slug]/page.tsx`, `apps/api/src/routes/storefronts.ts` |
| `/v1/stores/:slug`, `/v1/storefronts/:slug` | İlk yol slug şeması ve DB sorgusu kullanır; ikinci yol ayrıca `active=true`, `isPublic=true` koşullarını açıkça uygular. DB public rolü de kullanılır. Bu yollar birbirinin tam eşdeğeri değildir. | `apps/api/src/routes/merchants.ts`, `apps/api/src/routes/storefronts.ts` |
| `/discovery-session` | Same-origin korumalı public REST POST; `merchant` slug/UUID, `surface`, `campaign`, `referrer` şemadan geçer. Merchant aktif/public lookup ile çözülür; bulunamazsa 404. Session'a merchant UUID listesi, campaign, referrer ve attribution kaydedilir. | `apps/api/src/app.ts`, `packages/contracts/src/discovery.ts`, `packages/commerce/src/discovery.ts`, `packages/db/src/discovery-session-repository.ts` |
| `/v1/stores/:merchantId/search` | UUID biçimini doğrular; server context'i merchant ID ile sabitler. Session scope uyumsuzluğu reddedilir. Public katalog sorgusu yalnız aktif/public merchant ve published ürün/aktif offer görür. | `apps/api/src/app.ts`, `apps/api/src/services.ts`, `packages/commerce/src/discovery.ts`, `packages/db/src/catalog-repository.ts` |
| ChatGPT MCP + widget | `search_products` input'u isteğe bağlı `merchantIds` ve `discoverySessionId` kabul eder. Şu an external web slug/campaign alanı veya giriş handoff tool'u yok. Widget host bridge yalnız tool input, structured output ve tool çağrılarını alır; sayfa referrer'ı veya dış link parametresi almıyor. | `apps/api/src/mcp.ts`, `packages/contracts/src/search-products.ts`, `apps/chatgpt-widget/src/host-bridge.ts` |
| `/r/:token` | Ürün/checkout yönünde imzalı redirect. Campaign token'da değil; ilişkili discovery session'dan redirect click kaydına çözülür. Bu ChatGPT'ye giriş linki değildir. | `packages/commerce/src/redirects.ts`, `packages/db/src/redirect-repository.ts`, `apps/api/src/routes/redirects.ts` |

Web → ChatGPT otomatik context aktarımı için mevcut kodda bağlantı/handoff yok. Web'deki `discoverySessionId` REST attribution (`transport=rest`, `surface=web`/`brand_widget`) taşır; MCP araması `transport=mcp`, `surface=chatgpt` beklediğinden bu ID doğrudan yeniden kullanılamaz. Aynı UUID'yi URL'ye koymak bir mağaza yetkisi de vermez. ChatGPT içinde kullanıcı mağaza adını açıkça söyleyebilir; modelin belirli mağazaya doğru ve kalıcı scope uygulayacağına dair mevcut giriş sözleşmesi yoktur. `merchantIds` isteğe bağlı bir tool argümanıdır; doğrulanmış landing bağlamının kanıtı değildir.

Campaign `?campaign=` üzerinden iki web sayfasında aynı biçim kuralıyla normalize edilir: `[a-z0-9][a-z0-9_-]{0,127}`. API aynı kuralı tekrar doğrular. Değer `discovery_sessions.campaign` alanında tutulur; ürün redirect click'inde session'dan türetilir. ChatGPT tool input'unda campaign alanı ve web campaign'ini MCP session'a taşıyan yol yoktur. `document.referrer` de yalnız web session için istenir; Instagram in-app browser'da varlığı güvenilir kabul edilemez.

Repo belgeleri de ÜRÜN-015'i gerçek cihaz/hesap deep-link doğrulaması veya dürüst web alternatifi olarak açık bırakıyor (`docs/06-implementation-status.md`). Önceki gerçek ChatGPT host kabulü arama/widget/product detail içindir; bio → app mağaza girişi değildir (`docs/evidence/task-011b-real-chatgpt-host.md`). Web ↔ ChatGPT principal sürekliliğinin açık olduğu da orada kayıtlıdır.

## Resmî OpenAI belge kontrolü

Kontrol tarihi 2026-09-24. Kaynaklar:

- [Connect and test your plugin](https://developers.openai.com/plugins/deploy/connect-chatgpt): ChatGPT'de bağlantıyı ekleme, yeni konuşmada araç menüsünden seçme, tool argüman/sonuçlarını sınama.
- [Plugins quickstart](https://developers.openai.com/plugins/quickstart): plugin kurma ve konuşmada `@` ile seçme örneği.
- [Add UI to your MCP server](https://developers.openai.com/plugins/build/chatgpt-ui): widget'ın tool'a bağlı olarak konuşmada görünmesi, `ui/notifications/tool-input`, `ui/notifications/tool-result`, `tools/call`.
- [Plugin UI reference](https://developers.openai.com/plugins/reference): `window.openai.toolInput` çağrılan tool'un argümanlarıdır; `toolOutput` structured content'tir. `openExternal` ChatGPT widget'ından **dışarı** vetted URL açar. `_meta["openai/session"]` konuşma korelasyonu içindir; dış web merchant/campaign bağlamı değildir.

| Soru | Resmî kanıt sonucu |
|---|---|
| Dış sayfadan ChatGPT app'e deep-link | İncelenen resmî kaynaklarda geliştiriciye açık bir giriş URL sözleşmesi bulunmadı. **Kanıtlanamadı.** |
| Açılışta URL parametresi/context | `toolInput` yalnız host tarafından çağrılmış tool argümanlarıdır; dış sayfa URL query'si için aktarım sözleşmesi bulunmadı. **Kanıtlanamadı.** |
| Store slug/campaign aktarımı | Kaynaklarda bu alanlar için giriş/aktarılma garantisi yok. Mevcut ShopAI tool şeması da dış landing context'i okumuyor. **Destekleniyor varsayılmayacak.** |
| Logged-in / logged-out | Belgeler ChatGPT hesabında bağlantı ekleme ve konuşma başlatmayı tarif eder; dış linkte login öncesi/sonrası destination veya context korunumu tarif etmez. **Gerçek hesap testi gerekli.** |
| Connected / not-connected | Belgeler bağlantı kurma ve konuşmada seçme adımlarını tarif eder; dış bağlantının bağlı olmayan kullanıcıyı otomatik kurulumla mağaza scope'una götüreceği gösterilmez. **Gerçek hesap testi gerekli.** |

Bu değerlendirme belgelendiği ölçüde olumlu kanıtı ayırır: kullanıcı ChatGPT içinde bağlı app'i seçip konuşma/tool çağrısı başlatabilir; çağrılmış tool'un argümanları widget'a gelir. Instagram bio'dan parametreli tek tık mağaza girişi için resmî kanıt yoktur.

## Gerçek ortam test matrisi ve açık kapılar

CSV'de 3 tarayıcı × 2 login × 2 bağlantı × 3 merchant × 2 campaign × 2 conversation = **144 ayrı satır** vardır. `expected_result` ürünün güvenli kabul kriteridir; `observed_result` canlı gözlem değildir. Tüm satırlar `external verification required` durumundadır. A ve B, test sırasında kurulacak iki ayrı aktif/public pilot mağazadır; gerçek slug ve domain bu raporda uydurulmadı. `invalid` etkin/public olmayan veya şema dışı slug ile ayrı ayrı tekrarlanmalıdır.

Her testte açılan URL/redirect zinciri, login/connection ekranı, konuşma kimliği, tool adı ve argümanları, dönen merchant ID, campaign'in web/session/redirect kayıtları, yanlış mağaza sonucu olup olmadığı, ekran kaydı ve zaman damgası kaydedilecek. Önce browser landing doğrulanacak; ardından yalnız resmen belgeli ChatGPT açılış hedefi bulunursa onun URL'si denenecek. Belgeli hedef yoksa ChatGPT'de devam butonu kullanıcıya genel ChatGPT girişi ve açık mağaza seçimi olarak gösterilecek; otomatik scoped giriş PASS sayılmayacak.

Açık kapılar: gerçek yayınlanmış/bağlı ShopAI app, iki doğrulanmış public merchant, logged-in ve logged-out test hesapları, app connected/not-connected durumları, masaüstü ve mobil tarayıcı, gerçek Instagram in-app browser, yeni ve tekrar konuşma gözlemi. Önceki gerçek host koşusu bu matrisin yerine geçmez.

## Önerilen canonical URL ve fallback

Önerilen public/bio URL: `https://<ShopAI web origin>/shop/<validated-public-slug>?campaign=instagram_bio`. Bu **gelecek canonical kararıdır**; mevcut panel bugün `/stores/<slug>` kopyalıyor. Implementasyonda eski `/stores/:slug` bağlantıları korunup aynı doğrulanmış mağaza için `/shop/:slug`'a 308/redirect veya eşdeğer uyumluluk kuralı tanımlanmalı; query campaign allowlist'ten sonra korunmalı. Kamuya açık origin gerçek deployment yapılandırmasından gelmeli; raporda domain icat edilmedi.

Fallback: Instagram bio → `/shop/:slug` web landing → API'de aktif/public mağaza doğrulaması → mağaza adı ve web araması → “ChatGPT'de devam et” eylemi → ChatGPT tarafında kullanıcıya açık mağaza adı/slug seçimi veya confirmation → sunucuda tekrar public merchant doğrulaması → yalnız o merchant için scoped arama. ChatGPT adımı, platformun belgeli/gerçek ortamda doğrulanmış açılış yolunu kullanmalı. Bağlı olmayan kullanıcıya bağlantı kurma adımı; logged-out kullanıcıya giriş adımı gösterilir. Bu akış otomatik tek tık scoped app açılışı değildir.

URL'de secret, auth token, kullanıcı kimliği ve doğrulanmamış internal DB ID taşınmaz. Slug kampanya ile birlikte trusted scope kabul edilmez; server her kullanımda aktif/public merchant çözer. Campaign kontrollü vocabulary/allowlist ve mevcut biçim sınırıyla kabul edilir, unknown değer atılır veya 400 olur. REST discovery ID, ChatGPT yetkisi veya cross-surface identity olarak kullanılmaz. Mevcut `require(id)` session lookup'u ID sahibini kontrol etmiyor; gelecekte bir handoff token'ı tasarlanırsa ayrıca imza, süre, tek kullanımlılık, origin ve principal bağlama incelemesi gerekir. Bu araştırma o token'ı uygulamaz.

## Sonraki implementasyon taskı — net kapsam

1. `/shop/:slug` canonical kararını, dashboard kopyalama yolunu ve `/stores/:slug` uyumluluk yönlendirmesini birlikte uygula; public/active doğrulamasını iki yolda tutarlı yap.
2. Landing CTA metnini gerçek platform davranışına göre yaz. Belgeli store-context deep-link bulunmadıkça ChatGPT'ye otomatik merchant/campaign taşındığını söyleme. Gerekirse kullanıcıya mağaza adını gösterip açık seçim/confirmation yaptır.
3. ChatGPT tarafında scope gerekiyorsa ayrı, server validated merchant resolution/tool sözleşmesini tasarla; mevcut public search `merchantIds` alanını güven sınırı sayma. Campaign'in web attribution ile ChatGPT attribution'ını ayrı ölç; kanıtsız cross-surface attribution birleştirme.
4. 144 satırlık gerçek ortam matrisini iki merchant ve cihazlarla doldur; observed alanına URL zinciri, tool input, mağaza ve campaign kanıtı koy. Platform dokümanı değişirse güncel resmî URL'yi ve davranış sürümünü kaydet.
5. ÜRÜN-014 discovery genişlemesi, ÜRÜN-020 widget revizyonu, secret lifecycle, connector credential ve DB migration bu taskın dışında kalsın.

Bu aşamada production flow veya DB şeması değiştirilmedi. Mevcut repo integration testleri campaign'in yalnız web REST session/redirect zincirinde taşındığını kanıtlıyor; ChatGPT girişini kanıtlamıyor.

## Bu branch'teki doğrulama

- İlk `pnpm check` ve `pnpm build` denemeleri sırasıyla `qrcode.react` ve `@shopai/auth` modüllerini çözemedi. Her iki bağımlılık `origin/main` exact SHA `7a4be830044d54475eb458b6b53e68f4637bfd2a` manifest/lockfile'ında bulunuyordu; yerel `apps/web/node_modules/qrcode.react` ve `apps/api/node_modules/@shopai/auth` linkleri yoktu. Bu, kaynak kod regressiyonu değil, eksik yerel kurulumdu.
- `pnpm install --frozen-lockfile --offline` lockfile değiştirmeden eksik workspace/dependency linklerini tamamladı. Sonrasında **`pnpm check` PASS** (format, lint, typecheck, 147 geçen birim testi ve build dahil) ve ayrı **`pnpm build` PASS**. Lint mevcut 47 uyarı verdi; testlerde 3 mevcut skip vardı.
- `discovery-session.test.ts` ve `storefront.test.ts` integration koşusu: `DATABASE_URL` ile `REDIS_URL` bulunmadığı için test altyapısı başlamadı; PASS değildir.
- Canlı ChatGPT/Instagram giriş testi: çalıştırılmadı; 144 CSV satırının tamamı `external verification required`.
