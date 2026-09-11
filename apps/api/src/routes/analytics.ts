import {
  connections,
  conversionOrders,
  redirectClicks,
  searchEvents,
  setTenantContext,
} from '@shopai/db';
import { and, eq, gte, isNotNull, lt, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ApiEnv } from '../env.js';
import { requireRole } from '../plugins/auth.js';

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
        : new Date(to.getTime() - 30 * 86400_000);
      if (
        !validZone(timezone) ||
        !Number.isFinite(from.getTime()) ||
        !Number.isFinite(to.getTime()) ||
        from >= to ||
        to.getTime() - from.getTime() > 93 * 86400_000
      )
        return reply.code(400).send({ code: 'INVALID_RANGE' });
      const db = app.authApi.db;
      if (!db) return reply.code(503).send({ code: 'ANALYTICS_UNAVAILABLE' });
      return db.transaction(async (tx) => {
        await setTenantContext(tx, merchantId);
        const range = and(
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
          .where(range);
        const bySurface = await tx
          .select({
            surface: redirectClicks.surface,
            count: sql<number>`count(*)::int`,
          })
          .from(redirectClicks)
          .where(and(range, eq(redirectClicks.classification, 'human')))
          .groupBy(redirectClicks.surface);
        const byCampaign = await tx
          .select({
            campaign: redirectClicks.campaign,
            count: sql<number>`count(*)::int`,
          })
          .from(redirectClicks)
          .where(
            and(
              range,
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
        const [searches] = await tx
          .select({
            attempts: sql<number>`count(*) filter (where ${searchEvents.requestKind} = 'initial')::int`,
            successful: sql<number>`count(*) filter (where ${searchEvents.requestKind} = 'initial' and ${searchEvents.outcome} <> 'error')::int`,
            empty: sql<number>`count(*) filter (where ${searchEvents.requestKind} = 'initial' and ${searchEvents.outcome} = 'empty')::int`,
            failed: sql<number>`count(*) filter (where ${searchEvents.requestKind} = 'initial' and ${searchEvents.outcome} = 'error')::int`,
            pagination: sql<number>`count(*) filter (where ${searchEvents.requestKind} = 'pagination')::int`,
          })
          .from(searchEvents)
          .where(searchRange);
        const searchesBySurface = await tx
          .select({
            surface: searchEvents.surface,
            count: sql<number>`count(*)::int`,
          })
          .from(searchEvents)
          .where(and(searchRange, eq(searchEvents.requestKind, 'initial')))
          .groupBy(searchEvents.surface);
        const attributedOrder = and(
          isNotNull(conversionOrders.searchId),
          isNotNull(conversionOrders.offerId),
          ne(conversionOrders.status, 'cancelled'),
        );
        const [sales] = await tx
          .select({
            count: sql<number>`count(*)::int`,
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
        const humanClicks = clicks?.human ?? 0;
        const measured = Boolean(
          env.CONVERSION_CALLBACK_SECRET && capability?.enabled,
        );
        const attributedSales = measured ? (sales?.count ?? 0) : null;
        const conversionRate =
          measured && humanClicks > 0
            ? (sales?.count ?? 0) / humanClicks
            : null;
        const searchSurfaceCounts = Object.fromEntries(
          searchesBySurface.map((row) => [row.surface, row.count]),
        );
        const redirectSurfaceCounts = Object.fromEntries(
          bySurface.map((row) => [row.surface, row.count]),
        );
        const redirectCampaignCounts = Object.fromEntries(
          byCampaign.flatMap((row) =>
            row.campaign ? ([[row.campaign, row.count]] as const) : [],
          ),
        );
        return {
          range: {
            from: from.toISOString(),
            to: to.toISOString(),
            timezone,
            semantics: '[from,to)',
          },
          metrics: {
            searchAttempts: searches?.attempts ?? 0,
            successfulSearches: searches?.successful ?? 0,
            emptySearches: searches?.empty ?? 0,
            failedSearches: searches?.failed ?? 0,
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
            productInteractions: humanClicks,
            humanRedirects: humanClicks,
            botPreviews: clicks?.bots ?? 0,
            redirectsBySurface: redirectSurfaceCounts,
            redirectsByChannel: redirectSurfaceCounts,
            redirectsByCampaign: redirectCampaignCounts,
            attributedSales,
            netRevenueMinor: measured ? Number(sales?.netMinor ?? 0) : null,
            conversionRate,
            incrementalSales: null,
            currency: 'TRY',
          },
          measurement: measured ? 'measured' : 'not_configured',
          definitions: {
            searchAttempts:
              'İlk sayfa arama çağrılarıdır. Sayfalama ayrı sayılır; ayırt edilemeyen istemci veya tool tekrarları yeni deneme sayılır.',
            noResultRate:
              'Boş sonuçlanan başarılı ilk aramalar / başarılı ilk aramalar.',
            searchErrorRate: 'Hatalı ilk aramalar / tüm ilk arama denemeleri.',
            surfaceScope:
              'web, chatgpt, gemini ve brand_widget kullanıcı yüzeyleridir; REST, MCP ve UCP transport olarak ayrı tutulur. Ham sorgu metni kaydedilmez.',
            channelScope:
              'Geriye dönük API uyumluluğu için tutulan alias; değerleri artık surface kırılımını temsil eder.',
            campaignScope:
              'Discovery session kampanya etiketi insan checkout yönlendirmelerine taşınır; örneğin instagram_bio.',
            productInteractions:
              'İnsan olarak sınıflandırılmış ürün yönlendirmesi.',
            conversionRate:
              'Atfedilen satış / insan yönlendirmesi. Payda sıfırsa null.',
            attributedSales:
              'Geçerli searchId ve offerId taşıyan, iptal edilmemiş imzalı sipariş.',
            incrementalSales:
              'Kontrol grubu olmadığından ölçülmüyor; atfedilen satışla aynı değildir.',
          },
        };
      });
    },
  );
}
