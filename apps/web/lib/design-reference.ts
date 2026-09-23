/*
 * ÜRÜN-019: /design tasarım sistemi referans rotasının görünürlük kuralı.
 *
 * Rota yalnız geliştirme ve staging içindir. Production compose'u web
 * servisine zaten DEPLOY_ENV=production verir (infra/production.compose.yaml);
 * burada yalnız bu mevcut değer okunur — hiçbir deployment yapılandırması
 * değiştirilmez. Production'da rota 404 döndürür.
 */
export function isDesignReferenceAllowed(
  deployEnv: string | undefined,
): boolean {
  return deployEnv !== 'production';
}
