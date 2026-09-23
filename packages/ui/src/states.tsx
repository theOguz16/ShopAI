import type { CSSProperties, ReactNode } from 'react';
import { type StockStatus, stockStatusLabel } from '@shopai/contracts';

/*
 * ÜRÜN-019 ortak UI durum primitive'leri.
 *
 * Bilinçli sınır: Burada yalnızca tüm ekranların tekrar kullandığı küçük
 * parçalar var (durum kartı, iskelet, rozet, görsel placeholder). Form,
 * tablo, grafik gibi büyük bileşenler bu pakete alınmaz; ekranlar bunları
 * @shopai/ui/tokens.css token'larıyla kendi tarafında kurar.
 *
 * Erişilebilirlik kuralları:
 * - loading/empty/success/info → role="status" (aria-live polite),
 *   error → role="alert".
 * - Durum bilgisi renkle değil başlık metniyle de taşınır (yalnız renk yok).
 * - Skeleton'lar aria-hidden'dır; canlı metin alanına sahip değilken ekran
 *   okuyucuya "yükleniyor" bilgisini StateCard variant="loading" verir.
 */

export type StateVariant =
  | 'loading'
  | 'empty'
  | 'error'
  | 'warning'
  | 'success'
  | 'info'
  | 'permission';

const stateMeta: Record<
  StateVariant,
  {
    className: string;
    role: 'status' | 'alert';
    glyph: string;
    defaultTitle: string;
  }
> = {
  loading: {
    className: 'shopai-state--loading',
    role: 'status',
    glyph: '…',
    defaultTitle: 'Yükleniyor…',
  },
  empty: {
    className: 'shopai-state--empty',
    role: 'status',
    glyph: '◎',
    defaultTitle: 'Kayıt yok',
  },
  error: {
    className: 'shopai-state--error',
    role: 'alert',
    glyph: '⚠',
    defaultTitle: 'Bir sorun oluştu',
  },
  warning: {
    className: 'shopai-state--warning',
    role: 'status',
    glyph: '⚠',
    defaultTitle: 'Dikkat',
  },
  success: {
    className: 'shopai-state--success',
    role: 'status',
    glyph: '✓',
    defaultTitle: 'Tamamlandı',
  },
  info: {
    className: 'shopai-state--info',
    role: 'status',
    glyph: 'ℹ',
    defaultTitle: 'Bilgi',
  },
  permission: {
    className: 'shopai-state--warning',
    role: 'status',
    glyph: '🔒',
    defaultTitle: 'Yetkin yok',
  },
};

export function StateCard({
  variant,
  title,
  description,
  action,
  children,
}: {
  variant: StateVariant;
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const meta = stateMeta[variant];
  return (
    <div className={`shopai-state ${meta.className}`} role={meta.role}>
      <span className="shopai-state-glyph" aria-hidden="true">
        {variant === 'loading' ? (
          <span className="shopai-loading-dot" />
        ) : (
          meta.glyph
        )}
      </span>
      <div className="shopai-state-body">
        <p className="shopai-state-title">{title ?? meta.defaultTitle}</p>
        {description ? (
          <p className="shopai-state-description">{description}</p>
        ) : null}
        {children}
        {action ? <div className="shopai-state-action">{action}</div> : null}
      </div>
    </div>
  );
}

export function Skeleton({
  className = '',
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden="true"
      className={`shopai-skeleton ${className}`.trim()}
      style={style}
    />
  );
}

/** Ürün kartı boyutlu iskelet; grid içinde kart yerini tutar. */
export function ProductCardSkeleton({
  imageRatio = '4 / 3',
}: {
  imageRatio?: string;
}) {
  return (
    <div aria-hidden="true" className="shopai-card-skeleton">
      <Skeleton
        className="shopai-card-skeleton-image"
        style={{ aspectRatio: imageRatio }}
      />
      <Skeleton className="shopai-card-skeleton-line" />
      <Skeleton className="shopai-card-skeleton-line shopai-card-skeleton-line--short" />
    </div>
  );
}

/** Görseli olmayan/yüklenemeyen ürün görseli için ortak placeholder. */
export function MissingImage({ label }: { label: string }) {
  return (
    <div className="shopai-missing-image" role="img" aria-label={label}>
      <span aria-hidden="true">♧</span>
    </div>
  );
}

/** Stok durumu rozeti: nokta + etiket. Renk tek başına bilgi taşımaz. */
export function StockBadge({
  status,
  label,
}: {
  status: StockStatus;
  label?: string;
}) {
  return (
    <span className={`shopai-stock-badge shopai-stock-badge--${status}`}>
      <span className="shopai-stock-dot" aria-hidden="true" />
      {label ?? stockStatusLabel(status)}
    </span>
  );
}
