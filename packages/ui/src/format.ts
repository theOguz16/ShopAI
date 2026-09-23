/*
 * ÜRÜN-019: paylaşılan biçimlendirme yardımcıları.
 * Bu dosyadan önce web/widget içinde 3-4 kez kopyalanıyordu
 * (colorLabels 3, para formatlayıcı 4 kopya). Yeni ekranlar buradan alır.
 */

export const colorLabels: Record<string, string> = {
  black: 'Siyah',
  white: 'Beyaz',
  navy: 'Lacivert',
  blue: 'Mavi',
  red: 'Kırmızı',
  green: 'Yeşil',
};

export function formatMoney(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency,
  }).format(amountMinor / 100);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', {
    timeZone: 'Europe/Istanbul',
  });
}
