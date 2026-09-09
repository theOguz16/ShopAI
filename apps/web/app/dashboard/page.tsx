'use client';

import { useActiveMerchant } from './merchant-context';

export default function Dashboard() {
  const { activeMerchant } = useActiveMerchant();
  return (
    <main>
      <a href="/login">Oturum değiştir</a>
      <a href="/">← Kataloğa dön</a>
      <h1>Mağaza paneli</h1>
      <p>Aktif mağaza: {activeMerchant.name}</p>
      <p>
        Kataloğunuzu yükleyebilir, taslakları inceleyip yayımlayabilir ve
        ölçülen yönlendirmeleri takip edebilirsiniz.
      </p>
      <nav aria-label="Mağaza işlemleri">
        <a href="/dashboard/imports">CSV kataloğu yükle ve durumunu izle</a>
        <a href="/dashboard/products">Taslakları incele ve yayımla</a>
        <a href="/dashboard/connections">Canlı bağlantıları yönet</a>
        <a href="/dashboard/analytics">Mağaza raporlarını görüntüle</a>
      </nav>
      <p>
        Yeni ürünler içe aktarma sonrasında taslak kalır; ayrıca yayın onayı
        gerekir.
      </p>
    </main>
  );
}
