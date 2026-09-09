# ShopAI çalışma kuralları

- Mevcut uygulama kapsamı docs/06-implementation-status.md içinde; hedef mimariyi tamamlanmış iş olarak sunma.
- Tarayıcı paketleri db/ai/connectors/commerce import edemez. İş kuralları commerce paketinde kalır.
- Satırların merchant kapsamını DB sorgusunda ve ilişkilerde koru. Auth olmadan public mutasyon endpoint'i ekleme.
- Stok, fiyat ve marka üretme; demo veri ve gerçek veriyi arayüzde ayır.
- Paylaşılan paketler dist export eder; testten önce build:packages gerekir.
- Değişiklik sonrası ilgili testleri, typecheck ve build çalıştır. pnpm check tüm temel kontrolleri kapsar.
- Secret commit etme. SQL migration'larını gözden geçir; üretim DB'sine otomatik migration uygulama.
