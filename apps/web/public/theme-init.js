// Tema başlatma: hydrate'ten önce çalışır, dark temada parlaklık
// sıçramasını önler. Sıra: kullanıcı seçimi (localStorage 'shopai-theme')
// → sistem tercihi → light. layout.tsx bu dosyayı <head>'den çeker.
var themeSaved = null;
var prefersDark = false;
try {
  themeSaved = localStorage.getItem('shopai-theme');
  prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
} catch (e) {}
if (themeSaved ? themeSaved === 'dark' : prefersDark) {
  document.documentElement.dataset.shopaiTheme = 'dark';
}
