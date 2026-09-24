import type { ReactNode } from 'react';
import { Skeleton, StateCard } from '@shopai/ui/states';

/*
 * ÜRÜN-019 referans ekran wireframe'leri (/design).
 *
 * Bu bileşenler gerçek veri çizmez; her ekranın default/loading/empty/error
 * durumunun hangi primitive ve yoğunlukla görüneceğini mini düzenlerle
 * gösterir. Kutular/bars decorative'dir ve aria-hidden ile süslenir;
 * durum metinlerini gerçek StateCard taşır. Tüm içerik "reference" niteliğinde
 * üretilmiş yer tutudur — gerçek ürün/mağaza/satış verisi temsil etmez.
 */

export type ScreenLayout = 'grid' | 'detail' | 'list' | 'stats' | 'form';
export type ScreenStateName = 'default' | 'loading' | 'empty' | 'error';

function Bar({
  tone = 'mid',
  w = '100%',
}: {
  tone?: 'strong' | 'mid';
  w?: string;
}) {
  return <div className={`wf-bar wf-bar-${tone}`} style={{ width: w }} />;
}

function MiniCard() {
  return (
    <div className="wf-card">
      <div className="wf-card-image" />
      <Bar tone="strong" w="70%" />
      <Bar w="45%" />
    </div>
  );
}

function Chip({ label }: { label: string }) {
  return <span className="wf-chip">{label}</span>;
}

function LayoutPreview({ layout }: { layout: ScreenLayout }) {
  switch (layout) {
    case 'grid':
      return (
        <>
          <div className="wf-chips">
            <Chip label="Renk" />
            <Chip label="Beden" />
            <Chip label="Marka" />
          </div>
          <div className="wf-cards">
            <MiniCard />
            <MiniCard />
          </div>
        </>
      );
    case 'detail':
      return (
        <div className="wf-detail">
          <div className="wf-media">
            <span>4:3</span>
          </div>
          <div className="wf-stack">
            <Bar tone="strong" w="62%" />
            <Bar w="34%" />
            <Bar w="82%" />
            <Bar w="48%" />
            <div className="wf-cta" />
          </div>
        </div>
      );
    case 'list':
      return (
        <div className="wf-rows">
          {[0, 1, 2].map((i) => (
            <div key={i} className="wf-row">
              <span className="wf-dot" />
              <div className="wf-row-bars">
                <Bar tone="strong" w="58%" />
                <Bar w="36%" />
              </div>
              <span className="wf-pill" />
            </div>
          ))}
        </div>
      );
    case 'stats':
      return (
        <>
          <div className="wf-tiles">
            {[0, 1, 2].map((i) => (
              <div key={i} className="wf-tile">
                <Bar w="64%" />
                <Bar tone="strong" w="42%" />
              </div>
            ))}
          </div>
          <Bar w="92%" />
          <Bar w="74%" />
        </>
      );
    case 'form':
      return (
        <div className="wf-stack">
          {[0, 1, 2].map((i) => (
            <div key={i} className="wf-field">
              <Bar w="34%" />
              <div className="wf-input" />
            </div>
          ))}
          <div className="wf-cta" />
        </div>
      );
  }
}

function Panel({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="wf-panel">
      <p className="wf-panel-name">{name}</p>
      <div className="wf-panel-body">{children}</div>
    </div>
  );
}

export function ScreenStates({
  layout,
  emptyTitle,
  errorDescription,
}: {
  layout: ScreenLayout;
  emptyTitle: string;
  errorDescription: string;
}) {
  return (
    <div className="wf-state-grid">
      <Panel name="default">
        <LayoutPreview layout={layout} />
      </Panel>
      <Panel name="loading">
        <div className="wf-stack" aria-hidden="true">
          <Skeleton style={{ height: 12, width: '46%' }} />
          <div className="wf-cards">
            <Skeleton style={{ height: 72 }} />
            <Skeleton style={{ height: 72 }} />
          </div>
          <Skeleton style={{ height: 12, width: '72%' }} />
        </div>
      </Panel>
      <Panel name="empty">
        <StateCard variant="empty" title={emptyTitle} />
      </Panel>
      <Panel name="error">
        <StateCard
          variant="error"
          title="Veri alınamadı"
          description={errorDescription}
        />
      </Panel>
    </div>
  );
}
