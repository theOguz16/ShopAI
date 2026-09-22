# TASK-025 — gerçek-host görsel kabulü

Öncelik: P0 (TASK-011B dış kabul kapısı)

Bu görev, eski belgelerde TASK-024 diye anılan görsel kabul işinin tek kimliğidir. TASK-024 account-linking ile karıştırılamaz.

## Kapsam

- v4 widget'ın gerçek ChatGPT iframe'inde yeniden görsel koşusu.
- Kontrollü timeout davranışı.
- ShopAI-origin console/CSP kaydı.
- Ekran kaydı ve release SHA ile tekrar üretilebilir koşu kaydı.

## Bağımlılık

TASK-011B hosted staging ve yetkili gerçek ChatGPT host erişimi. Web/ChatGPT kimlik sürekliliği bu görevin parçası değildir; TASK-024'te kapanır.

## Kabul kanıtı

Tarih, release SHA, gerçek iframe sonucu, timeout sonucu, console/CSP çıktısı, ekran kaydı ve gözlenen merchant görseli aynı koşu kaydında bulunmalıdır. Sentetik hosted smoke veya demo görseli bu görevi tamamlamaz.

## Durum

Bekliyor: mevcut belgelerde sentetik görsel/origin kanıtı vardır; gerçek iframe tekrar koşusu, kalıcı console/CSP kaydı ve ekran kaydı eksiktir.
