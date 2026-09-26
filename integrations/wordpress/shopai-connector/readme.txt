=== ShopAI Connector ===
Contributors: shopai
Tags: woocommerce, shopai, pairing
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later

WooCommerce mağazasını ShopAI ile güvenli, tek kullanımlık pairing akışıyla bağlar.

== Description ==

ShopAI Connector, mağaza yöneticisinin ShopAI panelinde ürettiği kısa ömürlü
pairing kodu ile okuma yetkili bir WooCommerce REST API anahtarı üretir ve bu
anahtarı doğrudan (sunucu sunucuya) ShopAI API'sine iletir.

Güvenlik modeli:

* Pairing kodu tek kullanımlıktır ve kısa sürede geçersizleşir (ShopAI
  tarafında 15 dakika, ortam yapılandırmasına bağlıdır).
* Raw API anahtarı tarayıcıda gösterilmez, WordPress veritabanında saklanmaz,
  URL/query parametresine konmaz ve loglara yazılmaz; yalnızca pairing
  isteğinin gövdesinde ShopAI sunucusuna iletilir.
* Eşleştirme yalnızca `manage_woocommerce` yetkisine sahip yöneticiler
  tarafından, nonce korumalı form üzerinden başlatılabilir.
* Eklenti içine hiçbir ShopAI secret'ı gömülü değildir; ShopAI API adresi de
  pairing talimatıyla birlikte yönetici tarafından girilir.
* Pairing başarısız olursa üretilen API anahtarı otomatik silinir.
* Kullanıcı başına kaba kuvvet sınırı: 10 dakikada 5 deneme.

== Installation ==

1. `shopai-connector` klasörünü `/wp-content/plugins/` altına kopyalayın.
2. WooCommerce etkinken eklentiyi etkinleştirin.
3. ShopAI merchant panelinde "WooCommerce bağla" akışından pairing kodu alın.
4. WooCommerce > ShopAI Connector sayfasında ShopAI API adresini ve pairing
   kodunu girip "ShopAI ile eşleştir"e basın.

== Changelog ==

= 1.0.0 =
* İlk sürüm: tek kullanımlık pairing, otomatik okuma anahtarı üretimi,
  yeniden bağlanma ve yerel anahtar kaldırma.
