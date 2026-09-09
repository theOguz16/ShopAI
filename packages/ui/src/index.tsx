import type { CatalogItem } from '@shopai/contracts';
import { useState } from 'react';

function ProductImage({ item }: { item: CatalogItem }) {
  const [failed, setFailed] = useState(false);
  if (failed || !item.imageUrl)
    return (
      <div
        role="img"
        aria-label={`${item.title} görseli yok`}
        style={{
          height: 130,
          borderRadius: 10,
          display: 'grid',
          placeItems: 'center',
          background: '#edf1ed',
          fontSize: 54,
        }}
      >
        ♧
      </div>
    );
  return (
    <img
      src={item.imageUrl}
      alt={item.imageAlt ?? item.title}
      loading="lazy"
      onError={() => setFailed(true)}
      style={{
        height: 130,
        width: '100%',
        objectFit: 'cover',
        borderRadius: 10,
        background: '#edf1ed',
      }}
    />
  );
}

export function ProductCard({
  item,
  demo = false,
}: {
  item: CatalogItem;
  demo?: boolean;
}) {
  return (
    <article
      style={{
        border: '1px solid #d9dfda',
        borderRadius: 16,
        padding: 20,
        background: 'white',
      }}
    >
      <ProductImage item={item} />
      <p style={{ color: '#536259', fontSize: 13 }}>{item.merchantName}</p>
      <h2 style={{ fontSize: 19 }}>{item.title}</h2>
      <p>
        {item.size} beden · {item.color}
      </p>
      <strong>
        {new Intl.NumberFormat('tr-TR', {
          style: 'currency',
          currency: item.currency,
        }).format(item.priceMinor / 100)}
      </strong>
      <p>
        {demo
          ? 'Sentetik stok bilgisi'
          : item.stockStatus === 'in_stock'
            ? 'Güncel kayıtta stokta'
            : item.stockStatus === 'out_of_stock'
              ? 'Güncel kayıtta stok yok'
              : item.stockStatus === 'stale'
                ? 'Stok verisi eski; güncel stok bilinmiyor'
                : 'Stok bilinmiyor'}
      </p>
      <p style={{ fontSize: 12 }}>
        Fiyat kaynağı: {item.priceSource} · stok kaynağı: {item.stockSource}
        <br />
        Güncellik:{' '}
        {new Date(item.observedAt).toLocaleDateString('tr-TR', {
          timeZone: 'Europe/Istanbul',
        })}
      </p>
      <a href={item.checkoutUrl} target="_blank" rel="noopener noreferrer">
        {demo ? 'Örnek ürün bağlantısı ↗' : 'Mağazada kontrol et ↗'}
      </a>
    </article>
  );
}
