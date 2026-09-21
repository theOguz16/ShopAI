const requiredServices = ['DATABASE_URL', 'REDIS_URL'] as const;
const missingServices = requiredServices.filter((name) => !process.env[name]);

if (missingServices.length > 0) {
  throw new Error(
    `Integration test altyapısı eksik: ${missingServices.join(', ')} gerekli. ` +
      'DB/Redis gerektiren testler skip edilmez.',
  );
}

process.env.CATALOG_MODE = 'postgres';
