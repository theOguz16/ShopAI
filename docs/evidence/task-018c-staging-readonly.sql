\set ON_ERROR_STOP on

select id, merchant_id, provider, active, authorization_status, sync_mode,
       last_sync_started_at, last_source_watermark_at,
       last_successful_sync_at, last_fetched_at, last_sync_error, revoked_at
from source_connections
where provider = 'woocommerce'
order by active desc, last_successful_sync_at desc nulls last;

select c.id as connection_id,
       c.merchant_id,
       count(distinct p.id) as products,
       count(distinct v.id)
         filter (where v.external_id <> p.external_key) as native_woo_variations,
       count(distinct v.id) as normalized_variants,
       count(distinct o.id) filter (where o.active) as active_offers
from source_connections c
left join products p
  on p.merchant_id = c.merchant_id
 and p.connection_id = c.id
left join variants v
  on v.merchant_id = c.merchant_id
 and v.connection_id = c.id
 and v.product_id = p.id
left join offers o
  on o.merchant_id = c.merchant_id
 and o.connection_id = c.id
 and o.variant_id = v.id
where c.provider = 'woocommerce'
  and c.active = true
  and c.authorization_status = 'active'
group by c.id, c.merchant_id
order by c.id;

select p.title, p.connection_id, p.external_key,
       p.image_url, p.image_alt, p.observed_at, p.fetched_at,
       v.external_id, v.size, v.color,
       o.price_minor, o.currency, o.active,
       i.available, i.observed_at as inventory_observed_at
from products p
join source_connections c
  on c.id = p.connection_id
 and c.merchant_id = p.merchant_id
 and c.provider = 'woocommerce'
 and c.active = true
 and c.authorization_status = 'active'
join variants v
  on v.merchant_id = p.merchant_id
 and v.connection_id = p.connection_id
 and v.product_id = p.id
left join offers o
  on o.merchant_id = v.merchant_id
 and o.connection_id = v.connection_id
 and o.variant_id = v.id
left join inventory i
  on i.merchant_id = o.merchant_id
 and i.offer_id = o.id
where p.title in (
  '[SENTETIK DEMO] ShopAI Test Urunu 1',
  '[SENTETIK DEMO] ShopAI Test Urunu 78'
)
order by p.title, v.size;

select c.id as historical_connection_id, c.merchant_id,
       c.authorization_status, c.revoked_at,
       count(distinct p.id) as historical_products,
       count(distinct v.id) as historical_normalized_variants
from source_connections c
left join products p
  on p.merchant_id = c.merchant_id
 and p.connection_id = c.id
left join variants v
  on v.merchant_id = c.merchant_id
 and v.connection_id = c.id
 and v.product_id = p.id
where c.provider = 'woocommerce'
  and (c.active = false or c.authorization_status = 'revoked')
group by c.id, c.merchant_id, c.authorization_status, c.revoked_at
order by c.revoked_at desc nulls last;
