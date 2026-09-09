# Pilot E2E testleri

Bu testler sentetik local testi değildir; izinli staging pilot kataloğunu değiştirir. `pnpm test:e2e:pilot` öncesinde `docs/pilot-checklist.md` içindeki erişim ve veri izinleri tamamlanmalıdır. Gerekli `PILOT_*` değerlerinden biri eksikse test paketi bilinçli olarak başlamaz.

Playwright Chromium kurulumu bir kez `pnpm exec playwright install chromium` ile yapılır. Trace, video ve ekran görüntüsü yalnız başarısız testte `test-results/` altında tutulur; bu artefaktlar pilot verisi içerebildiğinden checklist'teki erişim ve silme politikasına tabidir.
