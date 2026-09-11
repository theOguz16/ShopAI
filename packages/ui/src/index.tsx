import { type CatalogItem, stockStatusLabel } from '@shopai/contracts';
import { useState } from 'react';

const colorLabels: Record<string, string> = {
  black: 'Siyah',
  white: 'Beyaz',
  navy: 'Lacivert',
  blue: 'Mavi',
  red: 'Kırmızı',
  green: 'Yeşil',
};
function ProductImage({ item }: { item: CatalogItem }) {
  const [failed, setFailed] = useState(false);
  if (failed || !item.imageUrl)
    return (
      <div
        className="product-image-placeholder"
        role="img"
        aria-label={`${item.title} görseli yok`}
      >
        ♧
      </div>
    );
  return (
    <img
      className="product-image"
      src={item.imageUrl}
      alt={item.imageAlt ?? item.title}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
export function ProductCard({
  item,
  demo = false,
  detailHref,
  onDetail,
}: {
  item: CatalogItem;
  demo?: boolean;
  detailHref?: string;
  onDetail?: (item: CatalogItem) => void;
}) {
  const stockText = stockStatusLabel(item.stockStatus);
  return (
    <li className="product-card">
      <ProductImage item={item} />
      <div className="product-card-body">
        {demo ? <span className="demo-badge">Demo ürün</span> : null}
        <p className="product-merchant">{item.merchantName}</p>
        <h3>{item.title}</h3>
        <p className="product-meta">
          {item.size} beden · {colorLabels[item.color] ?? item.color}
        </p>
        <strong className="product-price">
          {new Intl.NumberFormat('tr-TR', {
            style: 'currency',
            currency: item.currency,
          }).format(item.priceMinor / 100)}
        </strong>
        <p className={`stock stock-${item.stockStatus}`}>{stockText}</p>
        <p className="product-freshness">
          {demo
            ? 'Bu bilgi yalnız deneyim testi içindir.'
            : `Son kontrol: ${new Date(item.observedAt).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' })}`}
        </p>
        {detailHref ? (
          <a className="product-link" href={detailHref}>
            Ürün detayları →
          </a>
        ) : null}
        {onDetail ? (
          <button
            className="product-link"
            type="button"
            onClick={() => onDetail(item)}
          >
            Ürün detayları →
          </button>
        ) : null}
        <a
          className="product-link"
          href={item.checkoutUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {demo ? 'Örnek sayfayı incele ↗' : 'Mağazada kontrol et ↗'}
        </a>
      </div>
    </li>
  );
}
