// Demo tests must never inherit a developer's personal infrastructure settings.
process.env.CATALOG_MODE = 'demo';
delete process.env.DATABASE_URL;
delete process.env.REDIS_URL;
