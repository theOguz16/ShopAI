import { readFileSync, writeFileSync } from 'node:fs';

const testPath = 'tests/integration/auth0-flows.test.ts';
let test = readFileSync(testPath, 'utf8');
const anchor = '    expect(stale.statusCode).toBe(401);\n  });';
if (test.split(anchor).length !== 2) throw new Error('Unique positive OIDC test anchor missing');
const addition = `    expect(stale.statusCode).toBe(401);
    const issued = callback.headers['set-cookie'];
    const cookies = Array.isArray(issued) ? issued : [issued];
    const oidcCookie = cookies.find((item) => item?.startsWith('shopai_oidc_session='))?.split(';')[0];
    expect(oidcCookie).toBeTruthy();
    const active = await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { cookie: oidcCookie! } });
    expect(active.statusCode).toBe(200);
    expect(active.json().user.userId).toBe(pilotId);
    expect(active.json().user.authLevel).toBe('mfa');
    const csrf = active.json().csrfToken;
    expect(csrf).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const missingCsrf = await app.inject({ method: 'POST', url: '/v1/auth/logout-all', headers: { cookie: oidcCookie!, origin } });
    expect(missingCsrf.statusCode).toBe(403);
    const revoked = await app.inject({ method: 'POST', url: '/v1/auth/logout-all', headers: { cookie: oidcCookie!, origin, 'x-shopai-csrf': csrf } });
    expect(revoked.statusCode).toBe(200);
    const noLongerActive = await app.inject({ method: 'GET', url: '/v1/auth/session', headers: { cookie: oidcCookie! } });
    expect(noLongerActive.statusCode).toBe(401);
    const oldPilotLogin = await app.inject({ method: 'POST', url: '/v1/auth/login', headers: { origin }, payload: { email, token } });
    expect(oldPilotLogin.statusCode).toBe(403);
  });`;
test = test.replace(anchor, addition);
writeFileSync(testPath, test);

const decisionPath = 'docs/07-auth-decision.md';
let doc = readFileSync(decisionPath, 'utf8');
const introStart = doc.indexOf('> **Durum:');
const introEnd = doc.indexOf('\n\n## Geçerli pilotun davranışı', introStart);
if (introStart < 0 || introEnd < 0) throw new Error('Decision status anchor missing');
const intro = '> **Durum: ÜRÜN-003 kod düzeyinde aşamalı olarak uygulandı, gerçek Auth0/HTTPS staging kabulü BEKLİYOR.** 0031+0032 migration, iki-client OIDC giriş/callback, verified-email ve issuer+subject kimliği, kanıtlı pilot claim, şifreli tek kullanımlık PKCE/nonce, opaque session/CSRF, logout-all, owner MFA/step-up ve hesap kapatma kodları branch üzerindedir. Test sağlayıcısı gerçek imzalı Auth0 tokenı değil doğrulanmış sağlayıcı çıktısını taklit eder. Gerçek recovery e-postası, MFA cihazı, HTTPS tarayıcı ve anonimleştirilmiş gerçek veride migrasyon kabulü yapılmadı. Pilot giriş kontrollü geçiş için açık, ÜRÜN-003 KISMİ / AÇIK.';
doc = doc.slice(0, introStart) + intro + doc.slice(introEnd);
const phaseStart = doc.indexOf('## Geriye uyumlu veri geçişi ve kapılar');
if (phaseStart < 0) throw new Error('Migration section missing');
const section = [
  '## Uygulanan kod ve güvenli geçiş kapıları',
  '',
  '1. Veri temeli: 0031 ve 0032 additive migration; mevcut kullanıcı UUIDleri, üyelikler ve pilot oturumları silinmez. Kimlik anahtarı doğrulanmış issuer + subject. E-posta eşleşmesi tek başına hesap birleştirmez.',
  '2. OIDC: openid-client 6.8.4 Authorization Code + PKCE S256, state ve nonce doğrulamasına yönelik sunucu kodu; encrypted browser-bound, 5 dakika geçerli ve atomik tek kullanımlık callback. Sağlayıcı tokenları tarayıcıya aktarılmaz. Gerçek Auth0 imza/JWKS doğrulaması staging ortamında ayrıca sınanmalıdır.',
  '3. Hesap ve oturum: Pilot credential kanıtı ve doğrulanmış e-posta sonrası transaction içinde eski UUIDye link; pilot session iptali; hashlenmiş OAuth cookie, idle/mutlak süre, revocation, CSRF+origin, backend membership ve owner MFA kontrolü. Entegrasyon testleri doğrulanmış sağlayıcı çıktısını mocklar.',
  '4. Çıkış ve kapatma: logout-all session iptali; son owner için ownership transfer zorunluluğu. Auth0 SSO logout, recovery e-postası ve MFA cihazı dış ortamda ayrıca doğrulanmalıdır.',
  '5. Kontrollü cutover (YAPILMADI): Gerçek Auth0 tenant, ayrı shopper/merchant client ID ve secrets, HTTPS callback/logout allowlist, MFA Action ve e-posta sağlayıcısı; anonimleştirilmiş gerçek veride migrasyon/UUID/üyelik mutabakatı, backup-restore, gerçek tarayıcı negatif testleri gerekir. Operatör ve kullanıcı doğrulaması olmadan AUTH_PILOT_LOGIN_ENABLED kapatılmaz veya pilot credentials kaldırılmaz.',
  '',
  'Gerçek ortam kabul matrisi: [ÜRÜN-003 Auth0 staging kabulü](follow-ups/urun-003-auth0-staging-acceptance.md). ÜRÜN-016 Web/ChatGPT principal sürekliliği ve ÜRÜN-032 gerçek kullanıcı pilotu bu PR ile karşılanmış sayılmaz.',
  '',
].join('\n');
doc = doc.slice(0, phaseStart) + section;
writeFileSync(decisionPath, doc);
console.log('Wrote session regression assertions and accurate staged-auth acceptance status.');
