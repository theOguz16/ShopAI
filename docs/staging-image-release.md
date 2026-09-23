# Staging imaj yayını — operatör notu

`Publish staging image` iş akışı yalnız `main` geçmişindeki tam 40 karakterlik commit SHA'sını `ghcr.io/theoguz16/shopai-staging:<SHA>` olarak `linux/amd64` mimarisinde yayımlar. Production iş akışından ve imaj paketinden ayrıdır. İmajı yayımlamak sunucuda dağıtım, migration veya gerçek kullanıcı kabulü yapmaz.

İş akışı `main` dalına merge edilmeden GitHub'da dispatch edilmez. Önce ilgili PR'ın CI kontrolleri ve merge kapısı tamamlanır. Sonra GitHub Actions içinde `Publish staging image` akışını `main` üzerinden tam commit SHA ile çalıştır ve özetindeki image etiketini doğrula. Staging web API adresi değişirse sabit `NEXT_PUBLIC_API_URL` build arg'ı da aynı PR'da güncellenmelidir.

Sunucuda `git pull` çalışan konteyneri güncellemez. Operatör, GHCR paketinin erişim yetkisi verildikten sonra imajı sunucuda `docker pull ghcr.io/theoguz16/shopai-staging:<SHA>` ile çeker; özel paket için en az `read:packages` yetkili, kısa ömürlü kimlik gerekir. Token'ı komut satırına, shell geçmişine, sohbete veya `.env.staging` dosyasına yazma. `docker login --password-stdin` kullan; Docker'ın deploy kullanıcısındaki credential saklama politikasını ayrıca kontrol et. Sunucuya otomatik SSH erişimi veya uzun ömürlü PAT bu PR'da kurulmaz.

Geçişten önce staging DB yedeğini ve mevcut image SHA'sını doğrula. `.env.staging` içindeki `SHOPAI_IMAGE` değerini `ghcr.io/theoguz16/shopai-staging` olarak değiştirmeden önce yeni imajın çekildiğini ve Compose config'in yalnız hedef tag'i gösterdiğini kontrol et. Servisleri kademeli geçir, `/health/ready` exact SHA, `/v1/auth/capabilities` ve widget readiness kontrollerini çalıştır. Yalnız teknik smoke gerçek müşteri kabulü değildir; TOTP, e-posta dönüşü, recovery ve merchant claim gerçek tarayıcıda ayrıca kabul edilir.

Disk temizliği için önce `df -h /`, `docker system df`, `docker builder du` ve mevcut image/backup envanterini kaydet. Yalnız kullanım dışı build cache'ini hedefli temizle; `docker system prune -a`, `docker volume prune`, DB veya backup silme komutlarını körlemesine çalıştırma. Eski image'ı geri dönüş kapısı kapanana kadar tut.
