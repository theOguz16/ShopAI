import { buildMerchantAnalyticsMetrics } from '@shopai/commerce/merchant-analytics';
import type { Surface } from '@shopai/contracts';
import {
  connections,
  conversionOrders,
  productViewEvents,
  redirectClicks,
  searchEvents,
  setTenantContext,
} from '@shopai/db';
import { and, eq, gte, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ApiEnv } from '../env.js';
import { requireRole } from '../plugins/auth.js';

const DAY_MS = 86_400_000;
const MAX_RANGE_MS = 93 * DAY_MS;
const userSearchIntents = ['explicit_search', 'refinement'] as const;

const validZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat('tr-TR', { timeZone: zone }).format();
    return true;
  } catch {
    return false;
  }
};

export async function registerAnalyticsRoutes(
  app: FastifyInstance,
  env: ApiEnv,
) {
  app.get(
    '/v1/merchants/:merchantId/analytics',
    {
      preHandler: requireRole('owner', 'editor', 'viewer'),
    },
    async (request, reply) => {
      const { merchantId } = request.params as { merchantId: string };
      const query = request.query as {
        from?: string;
        to?: string;
        timezone?: string;
      };
      const timezone = query.timezone ?? 'Europe/Istanbul';
      const to = query.to ? new Date(query.to) : new Date();
      const from = query.from
        ? new Date(query.from)
        : new Date(to.getTime() - 30 * DAY_MS);
      if (
        !validZone(timezone) ||
        !Number.isFinite(from.getTime()) ||
        !Number.isFinite(to.getTime()) ||
        from >= to ||
        to.getTime() - from.getTime() > MAX_RANGE_MS
      )
        return reply.code(400).send({ code: 'INVALID_RANGE' });

      const db = app.authApi.db;
      if (!db) return reply.code(503).send({ code: 'ANALYTICS_UNAVAILABLE' });

      return db.transaction(async (tx) => {
        await setTenantContext(tx, merchantId);

        const clickRange = and(
          eq(redirectClicks.merchantId, merchantId),
          gte(redirectClicks.occurredAt, from),
          lt(redirectClicks.occurredAt, to),
        );
        const [clicks] = await tx
          .select({
            human: sql<number>`count(*) filter (where ${redirectClicks.classification} = 'human')::int`,
            bots: sql<number>`count(*) filter (where ${redirectClicks.classification} = 'bot')::int`,
          })
          .from(redirectClicks)
          .where(clickRange);
        const bySurface = await tx
          .select({
            surface: redirectClicks.surface,
            count: sql<number>`count(*)::int`,
          })
          .from(redirectClicks)
          .where(and(clickRange, eq(redirectClicks.classification, 'human')))
          .groupBy(redirectClicks.surface);
        const byCampaign = await tx
          .select({
            campaign: redirectClicks.campaign,
            count: sql<number>`count(*)::int`,
          })
          .from(redirectClicks)
          .where(
            and(
              clickRange,
              eq(redirectClicks.classification, 'human'),
              isNotNull(redirectClicks.campaign),
            ),
          )
          .groupBy(redirectClicks.campaign);

        const searchRange = and(
          eq(searchEvents.merchantId, merchantId),
          gte(searchEvents.occurredAt, from),
          lt(searchEvents.occurredAt, to),
        );
        const userSearchRange = and(
          searchRange,
          inArray(searchEvents.intent, [...userSearchIntents]),
        );
        const [searches] = await tx
          .select({
            attempts: sql<number>`count(*) filter (where ${searchEvents.intent} in ('explicit_search','refinement'))::int`,
            successful: sql<number>`count(*) filter (where ${searchEvents.intent} in ('explicit_search','refinement') and ${searchEvents.outcome} <> 'error')::int`,
            empty: sql<number>`count(*) filter (where ${searchEvents.intent} in ('explicit_search','refinement') and ${searchEvents.outcome} = 'empty')::int`,
            failed: sql<number>`count(*) filter (where ${searchEvents.intent} in ('explicit_search','refinement') and ${searchEvents.outcome} = 'error')::int`,
            catalogLoads: sql<number>`count(*) filter (where ${searchEvents.intent} = 'catalog_load')::int`,
            explicitSearches: sql<number>`count(*) filter (where ${searchEvents.intent} = 'explicit_search')::int`,
            refinements: sql<number>`count(*) filter (where ${searchEvents.intent} = 'refinement')::int`,
            pagination: sql<number>`count(*) filter (where ${searchEvents.intent} = 'pagination')::int`,
          })
          .from(searchEvents)
          .where(searchRange);
        const searchesBySurface = await tx
          .select({
            surface: searchEvents.surface,
            count: sql<number>`count(*)::int`,
          })
          .from(searchEvents)
          .where(userSearchRange)
          .groupBy(searchEvents.surface);
        const catalogLoadsBySurface = await tx
          .select({
            surface: searchEvents.surface,
            count: sql<number>`count(*)::int`,
          })
          .from(searchEvents)
          .where(and(searchRange, eq(searchEvents.intent, 'catalog_load')))
          .groupBy(searchEvents.surface);

        const [views] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(productViewEvents)
          .where(
            and(
              eq(productViewEvents.merchantId, merchantId),
              gte(productViewEvents.occurredAt, from),
              lt(productViewEvents.occurredAt, to),
            ),
          );

        const attributedOrder = and(
          isNotNull(conversionOrders.searchId),
          isNotNull(conversionOrders.offerId),
          ne(conversionOrders.status, 'cancelled'),
        );
        const [sales] = await tx
          .select({
            count: sql<number>`count(*)::int`,
            grossMinor: sql<number>`coalesce(sum(${conversionOrders.grossMinor}), 0)::bigint`,
            netMinor: sql<number>`coalesce(sum(${conversionOrders.grossMinor} - ${conversionOrders.refundedMinor}), 0)::bigint`,
          })
          .from(conversionOrders)
          .where(
            and(
              eq(conversionOrders.merchantId, merchantId),
              gte(conversionOrders.occurredAt, from),
              lt(conversionOrders.occurredAt, to),
              attributedOrder,
            ),
          );
        const [capability] = await tx
          .select({
            enabled: sql<boolean>`bool_or(${connections.conversionTrackingEnabled})`,
          })
          .from(connections)
          .where(
            and(
              eq(connections.merchantId, merchantId),
              eq(connections.active, true),
            ),
          );

        const searchSurfaceCounts = Object.fromEntries(
          searchesBySurface.map((row) => [row.surface, row.count]),
        );
        const catalogLoadSurfaceCounts = Object.fromEntries(
          catalogLoadsBySurface.map((row) => [row.surface, row.count]),
        );
        const redirectSurfaceCounts = Object.fromEntries(
          bySurface.map((row) => [row.surface, row.count]),
        ) as Partial<Record<Surface, number>>;
        const redirectCampaignCounts = Object.fromEntries(
          byCampaign.flatMap((row) =>
            row.campaign ? ([[row.campaign, row.count]] as const) : [],
          ),
        );
        const measured = Boolean(
          env.CONVERSION_CALLBACK_SECRET && capability?.enabled,
        );
        const valueMetrics = buildMerchantAnalyticsMetrics({
          aiSearches: searches?.attempts ?? 0,
          productViews: views?.count ?? 0,
          checkoutClicks: clicks?.human ?? 0,
          orders: sales?.count ?? 0,
          attributedGmvMinor: Number(sales?.grossMinor ?? 0),
          netRevenueMinor: Number(sales?.netMinor ?? 0),
          measured,
          checkoutClicksBySurface: redirectSurfaceCounts,
        });

        return {
          range: {
            from: from.toISOString(),
            to: to.toISOString(),
            timezone,
            semantics: '[from,to)',
          },
          metrics: {
            ...valueMetrics,
            searchAttempts: searches?.attempts ?? 0,
            successfulSearches: searches?.successful ?? 0,
            emptySearches: searches?.empty ?? 0,
            failedSearches: searches?.failed ?? 0,
            catalogLoads: searches?.catalogLoads ?? 0,
            explicitSearches: searches?.explicitSearches ?? 0,
            refinements: searches?.refinements ?? 0,
            paginationRequests: searches?.pagination ?? 0,
            noResultRate:
              (searches?.successful ?? 0) > 0
                ? (searches?.empty ?? 0) / (searches?.successful ?? 0)
                : null,
            searchErrorRate:
              (searches?.attempts ?? 0) > 0
                ? (searches?.failed ?? 0) / (searches?.attempts ?? 0)
                : null,
            searchesBySurface: searchSurfaceCounts,
            searchesByChannel: searchSurfaceCounts,
            catalogLoadsBySurface: catalogLoadSurfaceCounts,
            productInteractions: valueMetrics.productViews,
            humanRedirects: valueMetrics.checkoutClicks,
            botPreviews: clicks?.bots ?? 0,
            redirectsBySurface: redirectSurfaceCounts,
            redirectsByChannel: redirectSurfaceCounts,
            redirectsByCampaign: redirectCampaignCounts,
            attributedSales: valueMetrics.orders,
            conversionRate: valueMetrics.checkoutToOrderRate,
            incrementalSales: null,
            currency: 'TRY',
          },
          measurement: measured ? 'measured' : 'not_configured',
          definitions: {
            aiSearches:
              'Kullanıcının başlattığı explicit_search + refinement eventleridir; catalog_load ve pagination dahil değildir.',
            productViews:
              'Başarıyla açılan ürün detaylarının product_view_events kayıtlarıdır.',
            checkoutClicks:
              'Bot/preview olmayan, insan olarak sınıflandırılmış checkout yönlendirmeleridir.',
            orders:
              'Search ve offer attribution taşıyan, iptal edilmemiş doğrulanmış conversion siparişleridir.',
            attributedGmvMinor:
              'Atfedilen ve iptal edilmemiş siparişlerin iadeden önceki brüt toplamıdır.',
            searchToCheckoutRate:
              'İnsan checkout yönlendirmeleri / kullanıcı tarafından başlatılan aramalar.',
            checkoutToOrderRate:
              'Atfedilen siparişler / insan checkout yönlendirmeleri.',
            surfaceBreakdown:
              'İnsan checkout yönlendirmelerinin yüzey dağılımıdır. Other = gemini + brand_widget.',
            searchAttempts:
              'explicit_search + refinement eventleridir. Mağaza açılışındaki catalog_load ve sayfalama dahil değildir.',
            catalogLoads:
              'Kullanıcı araması olmadan katalog görünürlüğü sağlamak için yapılan ilk yüklemelerdir; search KPI paydasına girmez.',
            explicitSearches:
              'Bir discovery session içindeki kullanıcı tarafından başlatılan ilk aramadır.',
            refinements:
              'İlk kullanıcı aramasından sonra sorgu veya filtrelerle yapılan yeni kullanıcı aramalarıdır.',
            paginationRequests:
              'Mevcut sonuç kümesinin cursor ile devam sayfası istekleridir; search attempt sayılmaz.',
            noResultRate:
              'Boş sonuçlanan başarılı kullanıcı aramaları / başarılı kullanıcı aramaları.',
            searchErrorRate:
              'Hatalı kullanıcı aramaları / tüm kullanıcı arama denemeleri.',
            surfaceScope:
              'web, chatgpt, gemini ve brand_widget kullanıcı yüzeyleridir; REST, MCP ve UCP transport olarak ayrı tutulur. Ham sorgu metni kaydedilmez.',
            channelScope:
              'Geriye dönük API uyumluluğu için tutulan alias; değerleri artık surface kırılımını temsil eder.',
            campaignScope:
              'Discovery session kampanya etiketi insan checkout yönlendirmelerine taşınır; örneğin instagram_bio.',
            productInteractions:
              'Geriye dönük alias; artık gerçek ürün detay görüntüleme event sayısını temsil eder.',
            conversionRate:
              'Geriye dönük alias; checkoutToOrderRate ile aynıdır.',
            attributedSales: 'Geriye dönük alias; orders ile aynıdır.',
            incrementalSales:
              'Kontrol grubu olmadığından ölçülmüyor; atfedilen satışla aynı değildir.',
          },
        };
      });
    },
  );
}
