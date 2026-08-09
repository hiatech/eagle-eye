# Fork yol haritası — çok dilli kaynak genişletmesi

> Bu dosya 2026-08-06/07 oturumlarında sohbet içinde belirlenen fazların kalıcı kaydıdır.
> Fazlar o zaman hiçbir dosyaya yazılmamıştı; bu yüzden kaybolmuştu. Durum sütunu
> 2026-08-07 itibarıyla doğrulanmıştır (git log + canlı ölçüm).

## Amaç

`koala73/worldmonitor` fork'u üzerinde, **açık kaynak/anahtarsız mantığa sadık kalarak**
uluslararası ve yerel dillerdeki haber kapsamını genişletmek. Fork **herkese açık** olacak,
dolayısıyla **AGPL-3.0-only yükümlülüğü aktiftir** (değiştirilmiş kaynağın tamamı
yayınlanmalı, lisans daraltılamaz, atıflar silinemez).

Tespit edilen kök sorun: proje 26 UI dili gönderiyor ama 625 beslemenin yalnızca 78'i
`lang` etiketli. Bir dilin arayüzü tamamen çevrilmişken haber panosunda o dilde tek satır
gazetecilik olmayabiliyor.

## Faz durumu

| Faz | Konu | Durum |
|---|---|---|
| 0 | Zemin (git, upstream, baseline, dal) | ✅ Tamam |
| 1 | Veriyi akıt, referans noktası oluştur | ✅ Tamam (2026-08-07) |
| 2 | Ölç ve önceliklendir | ✅ Tamam (+ sertleştirildi) |
| 3 | GDELT çok dilli açılım | ✅ Tamam (plandan farklı rotayla) |
| 4 | Yerel RSS kaynak genişletmesi | 🟢 4.0/4.1/4.1b/4.2 tamam |
| 5 | Yeni açık kaynak API'leri | ❌ Başlamadı |
| 6 | Altyapı sağlamlaştırma | ❌ Başlamadı |

---

## Faz 0 — Zemin ✅

Baseline `d9a65dd`, `upstream/main` ile **birebir aynı** (tree hash `cd88e9fa…`, doğrulandı).
`.gitignore`'un dışladığı ama upstream'in izlediği 24 dosya (`docs/internal/`, `docs/plans/`,
`convex/_generated/*.js`) `git add -f` ile içeri alındı — aksi halde her merge'de sahte
çakışma üretecekti. Dal: `feature/multilingual-sources`. Husky `core.hooksPath` ile aktif.

## Faz 1 — Veriyi akıt ✅

`.env` üretildi (3 zorunlu sır, `openssl rand -hex 32`, 0600, gitignore'da). Stack ayakta:
`worldmonitor` + `ais-relay` healthy, `redis` + `redis-rest` up, dashboard `:3000` → 200.

**Yol boyunca çıkan hata:** `SELF_HOSTING.md` `RELAY_SHARED_SECRET`'i zorunlu diye
belgeliyor ama `docker-compose.yml` onu hiçbir servise geçirmiyordu. Dokümanı birebir izleyen
herkeste `ais-relay` sonsuz FATAL restart döngüsüne giriyor — ve bu dışarıdan görünmüyor,
çünkü uygulama `condition: service_started` ile bağlı (restart sırasında da sağlanır), yani
pano sağlıklı görünüp 200 dönerken tüm korumalı relay yolları ölü. Düzeltildi + regresyon
testi (`tests/docker-compose-relay-secret-wiring.test.mts`).

### Referans noktası — besleme canlılığı (ilk kez ölçüldü)

`npm run test:feeds` → **728 OK · 12 bayat · 15 ölü · 20 boş · 1 atlandı**

Ölü olanlardan dil kapsamını doğrudan ilgilendirenler:

| Besleme | Hata | Etkilenen dil |
|---|---|---|
| Al Arabiya `[ar]` | HTTP 403 | **ar** — zaten tek kaynak |
| EuroNews `[pt]`, EuroNews `[ru]` | fetch failed | **pt**, **ru** |
| Tuoi Tre News | fetch failed | **vi** |
| Irrawaddy, ABC News Australia, News24, Vanguard Nigeria, Channels TV | 403 / timeout / parse | bölgesel |

Bayat olanlar arasında **Ynetnews (2024-03)**, **Corriere della Sera (2024-05)**,
**Jerusalem Post (2025-06)**, **CSIS (2016!)** var. Boş dönenler arasında `Asharq Business`,
`Primicias [es]`, `Híradó [hu]`, `Zerkalo` bulunuyor.

**Faz 4 için sonuç:** yeni kaynak eklemeden önce ölü/bayat olanların ayıklanması gerekiyor —
`ar` dilinin tek yerel kaynağı (Al Arabiya) 403 veriyor, yani `ar` kapsamı kâğıt üzerinde 1,
pratikte 0.

Boş pano bir hata değildir: okuma/yazma tamamen ayrık, edge handler'lar yalnızca Redis okur.

Kalan opsiyonel iş: ücretsiz API anahtarları (FRED, Finnhub, NASA FIRMS, ACLED, Groq) —
seeder'ların bir kısmı bunlar olmadan `FAIL` veriyor, ki bu beklenen davranış.

## Faz 2 — Ölç ve önceliklendir ✅

`npm run report:language-coverage` + CI kapısı (`tests/language-coverage-health.test.mts`).
Commit `352dfee`, düzeltme `411068c`. 2026-08-07'de düşman gözüyle inceleme sonrası
sertleştirildi: floors gerçek bir ratchet'e dönüştü (`pt: 3`), `parseSupportedLanguages`
artık iki harften uzun locale kodlarını sessizce düşürmüyor, variant haritaları arası etiket
çakışması yakalanıyor, `xloc` sütununun yanlış "çapraz-locale görünürlük" iddiası düzeltildi.

**Eksik kalan:** plandaki adım 6-7 — hedef dil başına 5-8 kaynaklık aday listesi
(açık RSS var mı / ToS uygun mu / yayıncı bağımsız mı). Bu, Faz 4'ün girdisi.

## Faz 3 — GDELT çok dilli açılım ✅ (rota düzeltildi)

**Plandaki adım 8 yanlış dosyayı hedefliyordu.** `scripts/seed-gdelt-intel.mjs` her GDELT
grep'ine çıkıyor ve üretici gibi okunuyor, ama başlığı `DEPRECATED — ROLLBACK SEAM ONLY`
diyor ve Railway'de kayıtlı değil. Gerçek üretici `scripts/seed-gdelt-bulk-materializer.mjs`.

`d9b80df` translingual bulk akışını ekledi — fakat `fetchGdeltBulkConflictEvents`'e, yani
**üretimde çalışmayan** bir yola. Akış 2026-08-07'de gerçek boru hattına taşındı: üçüncü bir
`kind` (`export-translingual`), kendi kursoru ve kohort doğrulaması, kesinlikle opsiyonel
(düşerse İngilizce feed'e degrade olur). Kapsama sınırları yalnızca İngilizce akıştan alınır —
bayat bir translingual akış 24 saatlik pencereyi geriye çekemez.

Canlı doğrulama: **58 → 136 olay** (+78, 0 GlobalEventID çakışması).

**Açık karar (adım 9):** bulk yolu olayları birleştirip tek Redis anahtarına yazıyor, cache
key'de dil boyutu yok. Sızıntı riski yok (istek parametresi değil), ama kullanıcıya "kaynak
dili" filtresi de sunulamıyor. Dil boyutu isteniyorsa olay şemasına `sourceLang` eklenmeli.

## Faz 4 — Yerel RSS kaynak genişletmesi 🟡 ~%10

`2aa8798` yalnızca **3 boşluğu** kapattı: `fa` istemci etiketi, `ar` ve `pt` sunucu aynası.
Bu bir genişletme değil, asimetri onarımıydı. Hedef dillerin bugünkü yerel kaynak sayısı:

| Dil | Şu an | Hedef |
|---|---:|---:|
| ar, fa, ja | 1 | 5-8 |
| zh, ko, th, vi | 2 | 5-8 |
| tr, pt | 3 | 5-8 |

### ⚠️ Ölçüm hatası düzeltildi — tablo baştan değişti (2026-08-07)

Denetim yerel kapsamı **sistematik olarak eksik sayıyordu.** `Feed.url` bir locale haritası
olabiliyor (`{ en, ar }`) ve `fetchFeed` UI diline uyan girdiyi seçiyor — yani `ar` okuyucusu
Al Jazeera'yı **Arapça** görüyor. Runtime boost (`getLanguageMatchedSources`) bunu zaten
sayıyordu, rapor saymıyordu. Düzeltildikten sonra:

| Dil | Önce | Sonra | | Dil | Önce | Sonra |
|---|---:|---:|---|---|---:|---:|
| ar | 1 | **4** | | fr | 5 | **9** |
| es | 8 | **11** | | de | 4 | **6** |
| uk | 5 | **7** | | ru | 3 | **5** |
| pl | 1 | **3** | | it | 3 | **4** |

**En zayıf diller artık farklı:** `bg`, `cs`, `fa`, `ja` (1'er), sonra `ko`/`th`/`vi`/`zh` (2'şer).
`ar` sanıldığı kadar kötü değil — ama bkz. aşağısı.

### ✅ Kapatıldı — panel ve brief artık aynı dilde (2026-08-07)

`validateMultiUrlDigestParity` 12 yayın organında şunu bulmuştu: panel okuyucunun dilinde,
brief İngilizce'den kuruluyor. İkisi yanlış pozitif çıktı (TVN24 ve Rzeczpospolita'nın `en` ve
`pl` anahtarları **aynı** Lehçe URL'i gösteriyor — ayrı İngilizce baskı yok, ve repo bunları
bilinçli olarak EN default-on frontline kaynağı yapmış). Kalan 10'dan 9'u kapatıldı.

**İlk denenen yaklaşım yanlıştı ve mevcut bir kapı onu yakaladı.** Ayrı isimli sunucu girdileri
(`France 24 FR` vb.) eklemeyi denedim; `tests/feeds-client-server-parity.test.mjs` reddetti:
digest `MAX_ITEMS_PER_CATEGORY`'ye kırpılıyor, **sonra** istemci `data-loader.ts`'te kendi
katalog adlarına göre filtreliyor. İstemcide karşılığı olmayan sunucu adı çekilir, sıralanır,
atılır — ve o sırada görünür olacak öğeleri dışarı iter. Yani görünür sonuç kümesini
*küçültürdü*.

**Yapılan:** `ServerFeed.url` istemcideki `Feed.url` ile aynı şekle getirildi —
`string | Record<string, string>`. `resolveServerFeedUrl` istemcinin kuralını birebir
uyguluyor (`src/services/rss.ts:242-244`: locale → en → ilk). Çözümleme `buildDigest`'te
girdiler kurulurken bir kez yapılıyor, böylece fetch/relay/telemetri ve `rss:feed:v8` cache
key'i somut URL görüyor (harita cache key'e stringify olsaydı tüm diller tek girdiye çökerdi).

Yeni besleme adı yok → dışarı itme yok, `docs/data-sources.mdx` envanteri değişmedi (66 satır
aynı), provenance/attribution dokunulmadı.

| Dil | Native digest kaynağı: önce → sonra |
|---|---|
| fr | 4 → **8** |
| es | 4 → **7** |
| uk | 5 → **7** |
| pt | 3 → **4** |
| ar, de, ru | 1 → **3** |
| it | 1 → **2** |

Yan etki: `DW News` `KNOWN_DRIFTS`'ten çıktı — oradaki not zaten *"probably: server should fall
back to gn() for the same es query"* diyordu, tam olarak bu yapıldı.

**Açık kalan tek madde:** `Al Arabiya`'nın `ar` URL'i **403** veriyor
(`multiUrlDigestAllowlist`'te belgeli). Çalışan bir Arapça URL bulunduğunda haritaya eklenip
satır silinecek.

### ✅ Faz 4.1b — istemcide olup sunucuda hiç olmayan yerel kaynaklar (2026-08-08)

4.1 çok-URL'li beslemeleri hizaladı. Aynı sınıftan ikinci bir boşluk kaldı ve onu ayrı bir
ölçüm buldu: **istemci kataloğunda `lang` etiketli olup sunucu digest kataloğunda adı bile
geçmeyen** kaynaklar. Panelde okuyucunun dilinde görünüyor, AI brief'ine hiç girmiyor. 12
dilde 25 kaynak. `validateMultiUrlDigestParity` bunları göremez — o yalnızca locale haritalı
beslemeleri karşılaştırır, buradaki besleme sunucuda *hiç yok*.

23'ü aynalandı. Aynalama, uydurma sunucu adı eklemek değil — isim istemcide zaten var, o
yüzden `data-loader.ts`'in ad filtresi elemez ve 4.1'de reddedilen dışarı-itme sınıfına
girmez.

| Dil | Digest kaynağı: önce → sonra | Eklenenler |
|---|---|---|
| el | 1 → **5** | Naftemporiki, in.gr, iefimerida, Proto Thema |
| es | 7 → **11** | El País, El Mundo, BBC Mundo, El Tiempo |
| de | 3 → **6** | Bild, Der Spiegel, Die Zeit |
| it | 2 → **4** | Corriere della Sera, Repubblica |
| ru | 3 → **5** | BBC Russian, Novaya Gazeta Europe |
| sv | 1 → **3** | Dagens Nyheter, Svenska Dagbladet |
| tr | 1 → **3** | BBC Turkce, DW Turkish |
| ko | 1 → **2** | Chosun Ilbo |
| th | 1 → **2** | Thai PBS |
| nl | 1 → **2** | De Telegraaf |
| fr | 8 → **9** | BBC Afrique |

`el`, `sv` ve `tr` bu satırların en önemlisi: üçünün de brief'i fiilen İngilizce'ydi.

**İki kaynak bilinçli olarak aynalanmadı.** `NRC` (nl) 20s ve 40s yoklamada da yanıt vermedi;
yanıtsız besleme `OVERALL_DEADLINE_MS` içindeki yerini yine de tutar, dolayısıyla eklediği tek
kaynaktan pahalıya gelir. `Tuoi Tre News` (vi) TLS el sıkışmasında başarısız — planın zaten
ölü diye kaydettiği besleme, doğrulandı. İkisinin de istemci girdisi duruyor.

Kontrol listesi: 21 domain'in tamamı `rss-allowed-domains.json`'da zaten kayıtlıydı (kaynaklar
istemcide mevcut olduğu için), yeni domain yok. `source-attribution-manifest.json` yeniden
üretildi — host kümesi değişmedi, yalnızca `_feeds.ts` referansları eklendi — ve
`scripts/shared/`'a aynalandı. `docs/data-sources.mdx`'te 4 envanter satırı güncellendi;
satır sayısı 66 sabit kaldı çünkü o sayı besleme değil **kategori** sayıyor.

### Faz 4.0 — ölü ayıklama: listenin yarısı artık geçersiz (2026-08-08)

Yeniden yoklandı:

| Besleme | Plandaki not | Bugün |
|---|---|---|
| EuroNews `[pt]` | fetch failed | ✅ HTTP 200, 50 öğe — **düzelmiş** |
| EuroNews `[ru]` | fetch failed | ✅ HTTP 200, 50 öğe — **düzelmiş** |
| Al Arabiya `[ar]` | 403 (bulut IP'lerinden) | ⚠️ 403 — konut IP'sinden de. Not düzeltildi: bulut IP'sine özgü değil |
| Tuoi Tre News `[vi]` | fetch failed | ❌ TLS el sıkışması başarısız — gerçekten ölü |
| NRC `[nl]` | *listede yoktu* | ❌ 20s ve 40s timeout — yeni bulgu |

Ölü ikisinin istemci girdisini silmek kapsamı daraltır ve tek bir ağ noktasından yapılan
ölçüm buna tek başına yetmez; `npm run test:feeds` deponun kendi erişilebilirlik kapısı ve
karar sahibinindir. Şimdilik sunucuya aynalanmadılar, istemcide duruyorlar.

### Canlı digest ölçümü — tek kaynak eklemek yetmiyor (2026-08-07)

Ayakta duran stack'te `/api/news/v1/list-feed-digest` dile göre ölçüldü:

| Dil | Kaynak | Haber | Yerel kaynakların katkısı |
|---|---:|---:|---|
| pt | 99 | 281 | O Globo 5 · Folha 5 · Brasil Paralelo 5 = **15** ✅ |
| ar | 96 | 275 | Asharq News = **0** |
| en | 96 | 275 | — |
| tr | 57 | 175 | Daily Sabah 1 · Hurriyet 0 |

`ar` ve `en`'in birebir aynı çıkması cache sızıntısı değil — anahtar
`news:digest:v1:${variant}:${lang}` (doğrulandı). Sebep `MAX_ITEMS_PER_CATEGORY = 20`:
`middleeast` kategorisinde tek Arapça kaynak ~14 İngilizce kaynakla yarışıyor ve sıralamada
eleniyor. Yani **kaynak katalogda var, digest'e giriyor, çıktıda görünmüyor.**

Bunun Faz 4 için sonucu: 3'lü Brezilya paketi görünürken tek başına eklenen `ar`/`fa`
kaynağı görünmüyor. Dil başına 5-8 hedefi bir kapsam sayısı değil, **görünürlük eşiği** —
kategori kapağını aşabilmek için gereken kütle. Tek tek eklemek ölçülebilir sonuç vermez;
dil paketi halinde eklemek verir.

Her yeni besleme için **6 dosyalık kontrol listesi** (atlanırsa sessizce çalışmaz):

| # | Dosya | Ne yapılır |
|---|---|---|
| a | `src/config/feeds.ts` | `{ name, url: rss(...), lang: 'tr' }` |
| b | `server/worldmonitor/news/v1/_feeds.ts` | **aynısını aynala** — yoksa AI özetine girmez |
| c | `shared/rss-allowed-domains.json` | domain ekle, yoksa proxy 403 |
| d | `shared/source-provenance-declarations.ts` | `SOURCE_TYPES` + propaganda riski beyanı |
| e | `shared/source-attribution-manifest.json` | `npm run sources:generate` |
| f | Doğrulama | `npm run test:feeds && npm run test:data && npm run typecheck` |

`2aa8798` yeni domain getirmediği için (c)(d)(e) tetiklenmedi; gerçek genişlemede tetiklenecek.
Devlet medyası eklenirse `stateAffiliated` + `propagandaRisk` beyanı zorunlu.
Stratejik kaynaklara `strategicDefault: true` — dil filtresini aşar, her locale'de görünür.

**Dikkat:** `lang` bir *dışlama* mekanizmasıdır. Etiketlemek kaynağı genişletmez, daraltır.
İngilizce yayın yapan bir kaynağa `lang: 'en'` vermek onu diğer tüm locale'lerden gizler
(The Hindu bu yüzden etiketten arındırıldı).

## Faz 5 — Yeni açık kaynak API'leri ❌

Wikinews (30+ dil, CC-BY, anahtarsız) · Mastodon (federe, yerel dil toplulukları) ·
Bluesky/AT Protocol (ücretsiz firehose). Her biri: `scripts/seed-*.mjs` + `runSeed()` +
cache key + handler.

## Faz 6 — Altyapı ❌ — **canlıya çıkışın gerçek blokerleri burada**

Aşağıdaki ilk iki madde bilgi eksikliğinden bekliyor: **fork'un herkese açık repo adresi** ve
**deploy edilecek domain**. İkisi bilinmeden doğru yapılamaz, tahminle yapılırsa yanlış olur.

**Karar (2026-08-07):** deploy hedefi **kendi sunucu + Docker**; fork henüz yayınlanmadı.

### B1 — CORS 🟡 bloker değil (Docker self-host'ta)

Ayakta duran stack'te doğrulandı: pano ve API aynı origin'den (`:3000`) servis ediliyor, o
yüzden normal kullanımda CORS devreye girmiyor — `/api/seismology/...` aynı origin'den 200.
Yabancı origin'li bir istek ise beklendiği gibi reddediliyor (`access-control-allow-origin`
istekle eşleşmiyor). CORS ancak şu üç durumda gerekli olur: başka siteye **embed** widget,
**ayrı `api.` alt alan adı**, veya **Tauri masaüstü** istemcisi. Hiçbiri yayına çıkmak için
zorunlu değil.

Yine de domain belli olunca düzeltilmeli — mevcut hali upstream'in altyapısını gösteriyor:

`api/_cors.js:1-16` sabit kodlu:

```js
/^https:\/\/(.*\.)?worldmonitor\.app$/,
/^https:\/\/worldmonitor-[a-z0-9-]+-eliewm\.vercel\.app$/,   // upstream'in Vercel takımı
```

Kendi domain'inde yayına alındığında tarayıcı istekleri engellenir ve izin verilmeyen
origin'ler için dönen değer `https://worldmonitor.app` olur. `NODE_ENV=production` altında
localhost da düşer. Domain bilinince tek dosyada çözülür.

Ölçek notu: `worldmonitor.app` 218 dosyada geçiyor (53 `scripts/`, 32 `api/`, 27
`src/locales/`), ama işlevsel merkez `src/config/web-origin.ts:15` (`WEB_APP_ORIGIN`, 10
tüketici). Marka sökme işi bundan çok daha büyük ve **canlıya çıkmak için zorunlu değil.**

### B2 — AGPL §13: kaynak kodu linki upstream'i gösteriyor 🔴

Arayüzdeki tüm kaynak linkleri `koala73/worldmonitor`'a gidiyor:
`src/app/panel-layout.ts:946` ve `:1131`, `index.html:137/163/438`,
`src/services/preferences-content.ts:33`, `src/app/desktop-updater.ts:103`.

AGPL-3.0 §13, ağ üzerinden **değiştirilmiş** bir sürümü sunduğunda kullanıcılara **o
değiştirilmiş sürümün** Corresponding Source'unu sunmayı şart koşar. Upstream'e link vermek
bunu karşılamaz — orada çalıştırdığın kod yok. Ayrıca `NOTICE` dosyası yok.

Yapılacak (fork URL'i belli olunca): yukarıdaki linkleri fork'a çevir, `NOTICE` ekle
(atıf + değişiklik bildirimi), `LICENSE` (AGPL-3.0-only) olduğu gibi kalsın, telif
başlıklarını silme.

**Bugün ihlal yok:** yükümlülük ancak değiştirilmiş sürüm *ağ üzerinden başkalarına*
sunulduğunda doğar. Şu an yalnızca yerelde çalışıyor, dolayısıyla linklerin upstream'i
göstermesi bugün doğru. Sıralama şu: önce fork'u yayınla → sonra linkleri çevir → sonra
deploy et. Bu sırayı bozmak (önce deploy) ihlal olur.

### B3 — Self-host zorunlu sırları ✅ çözüldü (2026-08-07)

İki tanesi eksikti ve ikisi de sessizce ölümcüldü: `RELAY_SHARED_SECRET` compose'a hiç
geçirilmiyordu (relay FATAL restart döngüsü, dışarıdan görünmüyor çünkü uygulama
`service_started` ile bağlı), `WM_SESSION_SECRET` ise ne compose'da ne `SELF_HOSTING.md`
tablosundaydı — `POST /api/wm-session` 503 dönüyor, hiçbir tarayıcı oturum jetonu alamıyor
ve digest dahil oturum korumalı her uç 401 veriyordu. İkisi de düzeltildi, belgelendi ve
regresyon testine bağlandı (`tests/docker-compose-relay-secret-wiring.test.mts`).

### Kalan (bloker değil)

`vite.config.ts` dev proxy'lerine `dns.setDefaultResultOrder('ipv4first')` ·
demo/fixture modu (`npm run sandbox:fixtures` altyapısı hazır) · `vite.config.ts`
(1674 satır) bölme.

---

## Plan dışı yapılanlar (2026-08-07 inceleme oturumu)

Düşman gözüyle inceleme 10 kusur çıkardı, hepsi düzeltildi. Fazlarla ilgili olmayan ama
üretimi etkileyen ikisi:

- **RSS charset:** `Response.text()` XML prolog'unu okumuyordu. Folha de S.Paulo
  `ISO-8859-1` gönderiyor, `Content-Type`'ta charset yok → fetch başına **951 bozuk karakter**
  `pt` AI özetinin LLM girdisine giriyordu. `decodeRssBody` ile düzeltildi (951 → 0).
- **Bütçe invariantı:** `seed-gdelt-bulk-materializer` `lockTtlMs` ayarlamıyor (120s varsayılan)
  ve hiçbir test bütçesini bağlamıyordu. Dördüncü bir akış eklenirse sessizce aşacaktı.

## Önerilen sıradaki adım

Faz 1 kapandı, referans noktası var, self-host blokerleri (B3) çözüldü. Canlıya çıkışın
önünde artık **tek** iş kaldı ve o da sizin elinizde: fork'u yayınlamak (B2).

Sıra:

1. ~~**Faz 4.1 — locale URL'lerini sunucuya aynala.**~~ ✅ Yapıldı (yukarı bak).
2. ~~**Faz 4.2 — dil paketleri.**~~ ✅ Yapıldı (aşağı bak).
3. ~~**Faz 4.0 — ölü ayıklama.**~~ ✅ Yeniden ölçüldü, listenin yarısı geçersiz çıktı.
4. **B2 — fork'u yayınla**, sonra linkleri çevir + `NOTICE`. Deploy'dan ÖNCE.
5. **B1 — CORS**, yalnızca embed / ayrı `api.` alt alan adı / masaüstü istemci
   gerekiyorsa. Aynı-origin Docker kurulumunda gerekmez.

### ✅ Faz 4.2 — dört zayıf dilin paketleri (2026-08-08)

`bg`, `cs`, `fa`, `ja` 1'er native kaynakla duruyordu. Canlı ölçüm tek kaynağın
`MAX_ITEMS_PER_CATEGORY = 20` kapağında elendiğini göstermişti, o yüzden dördü de **paket
halinde** eklendi. Toplam 21 yeni kaynak, her biri iki katalogda birden.

| Dil | Önce | Sonra | Paket |
|---|---|---|---|
| cs | 1 | **7** | ČT24, iRozhlas, Novinky.cz, iDNES, Aktuálně.cz, Deník N |
| bg | 1 | **6** | Capital, Mediapool, Sega, 24 Chasa, Vesti.bg |
| fa | 1 | **6** | DW Persian, Euronews Persian, Iran International Persian, IRNA Persian, ISNA |
| ja | 1 | **6** | NHK, Kyodo News, Jiji Press, Mainichi Shimbun, Toyo Keizai |

Adaylar önce yoklandı; yalnızca 200 + öğe döndürenler alındı. Elenenler: BTA, Mediapool'un
ilk URL'i, OFFNews (403), bTV (403), Trud (403), Fakti, BNT, Nova, Blitz, Yomiuri, Sankei,
Nikkei, Kyodo'nun nordot URL'i, Tokyo Shimbun, Chunichi, Nishinippon, Radio Farda ve VOA
Farsi'nin API uçları (200 ama 0 öğe).

**`fa` paketi bilinçli olarak karışık.** Üç yabancı/diaspora yayıncısı + iki Tahran ajansı.
Yalnızca sürgün medyasına dayanan bir Farsça brief, yalnızca devlet ajanslarına dayanan
kadar tek yanlı olur. `IRNA Persian` ve `ISNA` `shared/source-provenance.ts`'te
`stateAffiliated: 'Iran'` + `risk: 'high'` olarak beyan edildi — İngilizce ikizleri `IRNA` ve
`Mehr News` zaten öyleydi. `Iran International Persian` de karşı yönde `Gulf-funded` olarak
etiketlendi.

`ja` için NHK'nın `cat6` (uluslararası masa) beslemesi seçildi, `cat0` (yurt içi manşetler)
değil — burası bir dünya monitörü.

**Üretilen dosya zinciri, kontrol listesinin yazmadığı kısım.** 20 yeni host allowlist'e
girdi ve bu üç kopyayı birden tetikledi: `shared/`, `scripts/shared/` ve
`api/_rss-allowed-domains.js` (Edge Function import edemediği için diziyi literal tutuyor —
üçüncü kopyanın varlığı yalnızca test kırılınca ortaya çıkıyor). Host sayacı 530 → 550
olunca 11 dosyadaki `"530+ observed upstream hosts"` iddiası da bayatladı; bunların
`index.html` ve welcome sayfaları **üreteç sahipli** (`npm run product:facts`), kalan 10'u
elle bakımlı. Elle düzenlemek üreteci bozuyor, üretece bırakmak elle bakımlıları
düzeltmiyor — ikisi ayrı ayrı yapılmalı. Son olarak üreteç `index.html`'deki inline
script'i değiştirdiği için CSP sha256 hash'i `vercel.json`, `docker/nginx.conf` ve
`docker/nginx-security-headers.conf`'ta güncellendi.

**Yeni en zayıflar:** `ko`, `th`, `vi`, `zh` (2'şer). `vi`'nin ikinci kaynağı Tuoi Tre News
ve o ölü (bkz. Faz 4.0), yani `vi` fiilen 1.

### ✅ Faz 4.2b — Doğu Asya paketleri (2026-08-08)

Aynı yöntemle `ko`, `th`, `vi`, `zh`. 19 yeni kaynak.

| Dil | Önce | Sonra | Paket |
|---|---|---|---|
| ko | 2 | **7** | Donga Ilbo, Hankyoreh, Kyunghyang, Pressian, No Cut News |
| vi | 2 | **7** | Tuoi Tre, Thanh Nien, Dan Tri, Tien Phong, Nhan Dan |
| zh | 2 | **7** | BBC Chinese, DW Chinese, RFA Chinese, Ming Pao, Xinhua Chinese |
| th | 2 | **6** | Khaosod, Matichon, Prachatai, The Standard |

**`zh`'de bulunan şey sayının söylediğinden kötüydü.** İki mevcut "native" kaynak MIIT ve
MOFCOM, yani ikisi de bakanlık duyuru akışı. Katalogda Çince yazılmış **tek satır
gazetecilik yoktu**; sayaç 2 gösteriyordu çünkü sayaç `lang` etiketi sayıyor, tür saymıyor.

**`vi` sayacı da yanıltıcıymış.** İkinci kaynak ölü `Tuoi Tre News` (İngilizce
tuoitrenews.vn). Asıl Vietnamca `Tuoi Tre` (tuoitre.vn) ayrı bir besleme ve canlı — eklendi.
`vi` native 7, digest 6; aradaki fark hâlâ o ölü İngilizce besleme.

**Beyanlar.** `vi`'de basının tamamı Parti ya da kitle örgütü lisanslı, o yüzden hiçbiri
Batılı anlamda bağımsız değil; ayrım Partiye ne kadar doğrudan bağlı olduklarında. Nhan Dan
(Parti merkez organı) `high`, Tuoi Tre/Thanh Nien/Tien Phong/Dan Tri `medium`, hepsi
`stateAffiliated: 'Vietnam'`. `zh`'de Xinhua Chinese `high`/China, RFA Chinese
`medium`/USA (USAGM fonlu), DW Chinese `medium`/Germany, Ming Pao Ulusal Güvenlik Yasası
baskısıyla `medium`, BBC Chinese `low`. `ko` paketi bilinçli olarak siyasi yelpazeye
yayıldı — Donga Ilbo merkez sağ, Hankyoreh ve Kyunghyang ilerici, Pressian ve No Cut News
bağımsız — çünkü keskin kutuplaşmış bir basında tek taraftan kurulan brief taraflı olur.

**Üretilen dosya zincirinin son halkası.** 4.2'de öğrenilen üç adıma bir dördüncüsü eklendi:
`docs/generated/stats.json` `npm run docs:stats` ile ayrıca yenilenmeli. `docs:check` bunu
okumaz, ama `tests/public-product-facts.test.mjs` `shared/product-facts.generated.json` ile
karşılaştırır — atlanırsa iki test kırılır. Tam sıra artık şu:

```
generate-source-provenance-declarations → sources:generate → cp scripts/shared/
  → product:facts → docs:stats → elle bakımlı 10 doc iddiası → CSP sha256 ×3
```

**Kalan tek ölü besleme:** `Tuoi Tre News`. Artık yerine canlı `Tuoi Tre` var, yani silmek
kapsam kaybettirmiyor — ama silme kararı sahibinin. Silinirse `src/config/feeds.ts`,
`shared/source-tiers.json` ve `scripts/shared/` aynası birlikte gitmeli, yoksa
feed-catalog-drift sarkan ad hatası verir.

**Yeni en zayıflar:** `hr`, `nl`, `pl`, `sv`, `tr` (3'er). Artık hiçbir UI dili 3'ün altında
değil.

## 🔴 Canlı ölçüm — paketler katalogda var, brief'te yok (2026-08-08)

Faz 4.1b/4.2/4.2b ile 8 dile 40 kaynak eklendi ve **hiçbiri canlı stack'te doğrulanmamıştı.**
İmaj yeni katalogla yeniden kuruldu, `/api/news/v1/list-feed-digest` sekiz dil için ölçüldü:

| Dil | Kaynak | Haber | Paketten görünen kaynak | Paketten gelen haber |
|---|---:|---:|---|---:|
| bg, cs, ja, th, vi, zh | 91 | 269 | **0** | **0** |
| fa | 91 | 269 | 1/6 (BBC Persian) | 2 |
| ko | 91 | 269 | 1/7 (Yonhap News) | 1 |

Sekiz dilin sekizi de **birebir aynı** 91 kaynak / 269 haber döndürüyor. Görünen iki kaynak
zaten paket öncesinden vardı; `Yonhap News` ayrıca `strategicDefault`.

**Ölçümün taze olduğu kesin:** `feedStatuses`'ta `ČT24` var, o da ancak bu commit'lerle
katalogda. Yani digest yeni katalogla hesaplandı.

**Sebep çekememe değil, kapak.** `feedStatuses` yalnızca sorunlu beslemeleri bildiriyor ve
`iRozhlas`, `Novinky.cz`, `iDNES`, `Aktuálně.cz`, `Deník N` orada **yok** — yani başarıyla
çekildiler, öğeleri sıralandı ve `MAX_ITEMS_PER_CATEGORY = 20` kesiminin altında kaldı:

```
cs / europe: 20 haber, 13 kaynak — hepsi İngilizce havuzundan
             EuroNews, Ukrinform, Daily Sabah, Ukrainska Pravda EN, Meduza,
             OC Media, Hromadske EN, France 24, DW News, NV EN,
             Kyiv Independent, JAMnews, Le Monde
```

**Belirleyici değişken kategori doygunluğu.** Aynı katalog değişikliği zıt sonuç veriyor:

| | Kategorideki kaynak sayısı | Paketin aldığı slot |
|---|---:|---|
| `pt` / latam | ~11 | **15/20** — O Globo 5, Folha 5, Brasil Paralelo 5 |
| `es` / latam | ~11 | **15/20** |
| `cs` / europe | ~90 | **0/20** |
| `ja`..`zh` / asia | ~61 | **0/20** |

Faz 4'ün dayandığı "`pt` paketi çalıştı, demek ki paket yaklaşımı doğru" çıkarımı **eksikmiş**:
`pt` paketi latam kategorisi seyrek olduğu için çalıştı. `europe` ve `asia`'da paket ne kadar
büyük olursa olsun görünmüyor.

**Sonuç: sorun katalogda değil, sıralamada.** Kaynak eklemek doygun kategorilerde ölçülebilir
sonuç vermiyor ve vermeyecek. Faz 4'ün geri kalanı (`hr`/`nl`/`pl`/`sv`/`tr` paketleri) bu
düzeltilmeden yapılırsa aynı sonuca varır — katalog büyür, brief değişmez.

Düzeltme `buildDigest`'te kırpma noktasında (`list-feed-digest.ts`, `slicedByCategory`):
UI dili evrensel havuz dili değilse, her kategorinin 20 slotunun bir kısmı o dilde etiketli
kaynaklara ayrılmalı, kalanı normal sıralamadan doldurulmalı. `en` etkilenmez.

**Bu bir ürün davranışı değişikliği** — her İngilizce olmayan okuyucunun brief'inin nasıl
kurulduğunu değiştirir, ayrılan pay kadar küresel haber dışarı çıkar. Karar sahibinin.

### ✅ Kota uygulandı ve canlıda doğrulandı (2026-08-08)

Sahibin kararı: 20 slotun 8'i yerel kaynaklara ayrılsın. `sliceCategoryWithNativeReserve`
(`list-feed-digest.ts`) kırpma anında devreye giriyor. Aynı stack, aynı ölçüm:

| Dil | Önce | Sonra | Brief'te görünen yerel kaynaklar |
|---|---:|---:|---|
| bg | 0 | **8** | 24 Chasa, Dnevnik, Vesti.bg |
| cs | 0 | **8** | Novinky.cz, Seznam Zprávy |
| fa | 2 | **8** | BBC Persian, IRNA Persian, ISNA |
| ja | 0 | **8** | Asahi Shimbun, Jiji Press, Kyodo News, Mainichi Shimbun |
| ko | 1 | **8** | Chosun Ilbo, Yonhap News |
| th | 0 | **8** | Bangkok Post, Khaosod, Matichon |
| vi | 0 | **8** | Thanh Nien, VnExpress |
| zh | 0 | **8** | DW Chinese, MIIT (China), Ming Pao |
| en | 0 | **0** | — (kota evrensel havuz dilinde kapalı) |

Diller artık birbirinin kopyası değil: kaynak sayıları 89-93 arasında ayrışıyor, önce
sekizi de tam 91'di.

**Tasarım notları.** Kota tavan değil taban: `pt`/latam'da yerel kaynaklar kotanın üstünde
liyakatle 15 slot almaya devam ediyor. Boş kalan kota normal sıralamaya geri dönüyor, yani
iki kaynaklı bir dil kategoriye altı slot maliyeti çıkarmıyor. `strategicDefault`
beslemeleri kotaya sayılmıyor — onlar zaten her locale'e ulaşıyor, sayılsalardı aynı kaynak
26 dilde kotayı yerdi. `en` için küme boş, çünkü etiketsiz havuz zaten o dil.

8 slotun 2-4 farklı kaynaktan gelmesi normal: `ITEMS_PER_FEED = 5`, yani iki besleme kotayı
doldurmaya yetiyor.

Kapı: `tests/digest-native-language-reserve.test.mts` (7 test) — doygun kategoride kotanın
dolduğunu, boş kotanın geri verildiğini, `en`'de kapalı olduğunu ve liyakat üstünlüğünün
korunduğunu bağlıyor.

## Önerilen sıradaki adım (güncel)

Faz 4 artık gerçekten kapalı: katalog **ve** onu görünür kılan sıralama. Kalanlar:

1. ~~**`hr`/`nl`/`pl`/`sv`/`tr` paketleri.**~~ ✅ Yapıldı — ama aşağıdaki uyarıyla.
2. **B2 — fork'u yayınla**, sonra linkleri çevir + `NOTICE`. Deploy'dan ÖNCE. Sahibinde.
3. **Faz 5** (Wikinews / Mastodon / Bluesky).

### ⚠️ Faz 4.2c — son beş paket, ve azalan getirinin nerede başladığı (2026-08-08)

`hr`, `nl`, `pl`, `sv`, `tr` 3'er kaynaktan çıkarıldı. 22 kaynak:

| Dil | Önce | Sonra | Paket |
|---|---:|---:|---|
| pl | 3 | **8** | Onet, Wirtualna Polska, Gazeta Wyborcza, Interia, RMF24 |
| tr | 3 | **8** | Cumhuriyet, Gazete Duvar, Habertürk, Sabah, Anadolu Ajansı |
| hr | 3 | **7** | Večernji list, 24sata, tportal, Telegram.hr |
| nl | 3 | **7** | NU.nl, Volkskrant, AD, Trouw |
| sv | 3 | **7** | Sveriges Radio, Aftonbladet, Expressen, Göteborgs-Posten |

**Ama canlı ölçüm bu paketlerin bugün neredeyse hiçbir şey değiştirmediğini gösteriyor.**
13 dilin hepsi kotayı dolduruyor (8/8), fakat kotayı dolduran kaynaklara bakınca:

| Dil | Kotayı dolduranlar | Bu paketten gelen |
|---|---|---:|
| hr | Index.hr, Jutarnji list, N1 Croatia | **0** |
| nl | De Telegraaf, NOS Nieuws | **0** |
| sv | Dagens Nyheter, Svenska Dagbladet | **0** |
| tr | BBC Turkce, DW Turkish, Hurriyet | **0** |
| pl | Polsat News, **Wirtualna Polska** | 1 |

Sebep basit: `ITEMS_PER_FEED = 5`, kota 8. **Üç kaynak zaten 15 öğe üretiyor**, yani kotayı
doldurmaya iki kaynak yetiyor. Bu beş dil kota geldiği anda zaten düzelmişti; paketler
kotanın *dolup dolmadığını* değil, *kimin doldurduğunu* değiştiriyor.

**Doğru okuma:** 3 kaynağın altındaki diller için paket zorunluydu (bg/cs/fa/ja 1'er,
ko/th/vi/zh 2'şerdi — kotayı dolduramazlardı). 3 ve üstü için paketin getirisi farklı ve
daha küçük: dayanıklılık (bir besleme susarsa kota yine dolar) ve editoryal çeşitlilik
(kota, siyasi olarak yayılmış bir havuzdan seçiyor — `tr`'de muhalefetten devlet ajansına).
İkisi de gerçek ama ölçümde bugün görünmüyor.

**Sonuç — kalan diller için:** `ar`, `hi`, `it`, `pt`, `ro` 4'er kaynakta ve aynı hesapla
kotayı zaten dolduruyorlar. Onlara paket eklemek katalog büyütür, brief'i bugün
değiştirmez. Faz 4'ün kaynak-ekleme kısmı burada bitmeli; sıradaki kazanç kaynak sayısında
değil, `ITEMS_PER_FEED`/kota ayarında ya da Faz 5'in yeni kaynak sınıflarında.

> **Bu bölümün sonucu 4.2d ile geçersiz kaldı.** Ölçüm doğruydu ama teşhis eksikti:
> paketlerin katkısız görünmesinin sebebi "yeterince yer yok" değil, **kotanın seçim
> biçimiydi**. Düzeltilebilir bir sınırmış. Aşağı bak.

### ✅ Faz 4.2d — kotayı kaynaklara yay (2026-08-08)

4.2c'de kota doluyordu (8/8) ama **iki kaynaktan**: `ITEMS_PER_FEED = 5`, kota 8, ve düz
`slice` sıralamanın tepesindeki iki beslemeye kotanın tamamını veriyordu. `tr` okuyucusu 8
Türkçe kaynağın değil 3'ünün haberini görüyordu; Cumhuriyet, Sabah, Anadolu Ajansı, Gazete
Duvar ve Habertürk sorunsuz çekiliyor ama hiç görünmüyordu.

`pickAcrossSources` kotayı doldururken kaynaklar arasında round-robin yapıyor: her turda her
kaynaktan bir öğe, kaynak sırası o kaynağın en iyi öğesine göre. Kaynak içinde sıralama
aynen korunuyor, yani güçlü bir kaynak zayıfına yer açmıyor — sadece kotanın tamamını
almıyor.

**Kontrollü ölçüm.** Aynı stack, aynı soğuk Redis cache, tek fark round-robin:

| Dil | Kotayı dolduran kaynak: önce → sonra | | Dil | önce → sonra |
|---|---|---|---|---|
| tr | 3 → **8** | | hr | 3 → **6** |
| cs | 2 → **6** | | nl | 2 → **6** |
| bg | 3 → **6** | | pl | 2 → **5** |
| sv | 2 → **5** | | fa | 3 → **5** |
| th | 3 → **5** | | ja | 4 → **5** |
| ko | 2 → **4** | | vi | 2 → **3** |
| zh | 3 → 3 | | en | 0 → 0 |

`tr` 8/8: brief artık Cumhuriyet'ten Anadolu Ajansı'na kadar kutuplaşmış basının tamamından
besleniyor — paketin amacı buydu ve ancak şimdi işliyor.

**Ölçüm yöntemine dair uyarı — bu oturumda iki kez yanılttı.** Digest `news:digest:v1:full:<lang>`
anahtarıyla Redis'te ~10 dk cache'leniyor. Konteyneri yeniden başlatmak bunu **temizlemiyor**.
Ayrıca Redis parola istiyor: `redis-cli` parolasız çalıştırıldığında `NOAUTH` verip sessizce
hiçbir şey silmiyor. Doğru sıra:

```bash
docker compose build worldmonitor && docker compose up -d worldmonitor
PW=$(grep -oE '^REDIS_PASSWORD=.*' .env | cut -d= -f2-)
docker compose exec -T redis redis-cli -a "$PW" --no-auth-warning \
  EVAL "local k=redis.call('KEYS','news:digest:*') for i=1,#k do redis.call('DEL',k[i]) end return #k" 0
```

Teyit: 13 dilin hepsi aynı saniyede yanıtlanıyorsa ve konteyner logunda `[digest]` satırı
yoksa, ölçtüğün şey cache'tir.

**4.2c'nin "kaynak eklemeyi durdur" sonucu bu yüzden erken verilmişti.** Ölçüm doğruydu,
ama sınır katalogda değil dilimleyicideydi. `ar`/`hi`/`it`/`pt`/`ro` (4'er kaynak) için soru
yeniden açık: round-robin ile 4 kaynağın dördü de kotaya giriyor, yani paket eklemek artık
ölçülebilir fark yaratabilir. Önce ölçülmeli, sonra eklenmeli.

### ✅ Faz 4.2e — kota locale haritalı beslemeleri görmüyordu (2026-08-08)

21 dilin tamamı soğuk cache'te ölçüldü. `ar` tek istisnaydı: kotasını **dolduramıyordu**
(8 yerine 5 haber, 1/3 kaynak). Sebep kaynak eksikliği değil, kotanın "yerel" tanımıydı.

`nativeSourceNames` yalnızca `feed.lang === lang` eşleşmesine bakıyordu. Ama Al Jazeera ve
France 24 Arapçayı `lang` etiketiyle değil **locale haritalı `url`** ile sunuyor —
`resolveServerFeedUrl` zaten Arapça baskıyı çekiyor, yani o besleme o okuyucu için yerel
gazetecilik. Kota bunu göremeyince `ar`'da yalnızca Asharq News kalıyor, tek besleme de
`ITEMS_PER_FEED = 5`'te kapanıyor. 8 slotun 5'i doluyordu.

Bu, projenin baştan beri kovaladığı hata sınıfının aynısı: **denetim ile çalışma zamanının
"yerel" kelimesinden farklı şey anlaması.** `scripts/language-coverage-health.mjs` `ar`'a 3
digest kaynağı sayıyordu, kota 1 görüyordu. Ölçüt artık ikisinde de aynı:

```ts
feed.lang === lang || (typeof feed.url === 'object' && lang in feed.url)
```

`strategicDefault` hâlâ nitelik saymıyor — o besleme her locale'e ulaşıyor çünkü çoğuna
yerel *değil*.

| Dil | Kotayı dolduran kaynak | Haber |
|---|---|---|
| ar | 1 → **2** | 5 → **10** |
| pt | 3 → **4** | 8 → **13** |
| ru | 3 → **4** | 8 |
| de | 2 → **3** | 8 |

`ar` ve `pt`'nin kotanın üstüne çıkması doğru davranış: kota taban, kalan slotlar liyakatle
kazanılıyor.

### ⚠️ Aşağıdaki "bozuk besleme" listesi geçersiz — `feedStatuses` sağlık ölçüsü değil

Liste `feedStatuses`'tan çıkarılmıştı. Sonraki araştırma bunun yanlış bir gösterge olduğunu
gösterdi; doğrusu 4.2f'de. Liste kayıt için duruyor, **eyleme geçirilmemeli.**

### 📋 Bulunan bozuk beslemeler — ayrı bir iş kalemi

22 dilin `feedStatuses` çıktısı toplandı: **45 besleme sorunlu.** İkiye ayrılıyor.

**20'si tüm 22 dilde bozuk**, yani evrensel havuzda ve İngilizce okuyucuyu da etkiliyor —
bu çalışmayla ilgisi yok, önceden vardı:

`PBS NewsHour`, `ABC News`, `The Hill`, `Civil.ge`, `Zerkalo`, `Asharq Business`,
`ArXiv AI`, `VentureBeat AI`, `Financial Times`, `CISA`, `News24`, `Channels TV`,
`ThisDay`, `The Reporter Ethiopia`, `Japan Today`, `Irrawaddy`, `Atlantic Council`,
`DFRLab` (hepsi `empty`), `CrisisWatch` ve `IAEA` (`all-undated`).

**Kalanı dile özgü:** `Al Jazeera [ar]`, `EuroNews` (3 dil), `Tagesschau`, `Bild`
(`all-undated`), `HotNews`, `G4Media`, `SVT Nyheter`, `Interia`, `BBC Hindi` (kısmî) ve bu
oturumda eklenenlerden `BBC Chinese`, `RFA Chinese`, `Xinhua Chinese`, `Tuoi Tre`,
`Tien Phong`, `Nhan Dan`, `Pressian`, `Hankyoreh`, `No Cut News`.

**Dikkat:** son gruptakiler host makineden yoklandığında 200 + öğe dönüyordu, konteynerden
`empty`. Yani sorun beslemede değil **konteynerin çıkış yolunda** olabilir (DNS, IP
coğrafyası, relay). Ayrıca ayıklamadan önce bu araştırılmalı — yoksa çalışan beslemeler
yanlışlıkla silinir.

Kotanın bunu tolere ettiğini de not etmek gerek: `zh`'de üç yeni kaynak boş dönmesine rağmen
kota 8/8 doluyor, çünkü paketin diğer üyeleri devralıyor. 4.2c'de "dayanıklılık" diye
yazılan soyut fayda burada somut olarak ölçüldü.


Faz 5 (Wikinews / Mastodon / Bluesky) Faz 4'ten sonra gelmeli: aynı 6 dosyalık disiplin
oturmadan yeni bir kaynak sınıfı eklemek katalog borcunu ikiye katlar.

### 🔬 Faz 4.2f — `feedStatuses` besleme sağlığını ölçmez (2026-08-08)

4.2e'deki "45 bozuk besleme" listesi yanlış temelde kurulmuştu. Araştırma üç ayrı şey çıkardı.

**1. Digest sıcak `rss:feed` cache'ine bağımlı, ve soğukken haberin yarısını veriyor.**
Hem `news:digest:*` hem `rss:feed:*` silindikten sonra art arda istek:

| Tur | Sorunlu besleme | Dağılım | Haber |
|---|---:|---|---:|
| 1 (tam soğuk) | 112 | 99 `timeout`, 13 `empty` | **124** |
| 2 | 42 | 37 `empty`, 3 `timeout` | 266 |
| 3-4 (kararlı) | **39** | 37 `empty`, 2 `all-undated` | **267** |

Üretimde seeder/cron cache'i sıcak tutuyor, ama **taze deploy ya da cache temizliğinden
sonraki ilk okuyucular yarım digest alıyor.** Bu başlı başına bir Faz 6 kalemi.

Bunun yan sonucu: 4.2e'nin "45 bozuk" sayımı yarı-sıcak bir anda alınmıştı — bazı beslemeler
1 saatlik sağlıklı cache'ten geliyor, bazıları gelmiyordu. Kararlı sayı 39.

**2. Ama kararlı 39 da sağlık ölçüsü değil.** Kalan `empty`'lerden beşi (`ABC News`,
`Hacker News`, `The Hill`, `Bellingcat`, `Japan Today`) uygulamanın **birebir aynı
başlıklarıyla, konteynerin içinden** çalıştırıldığında HTTP 200 ve dolu dönüyor:

```
ABC News       HTTP 200  44751 bayt  25 item
Hacker News    HTTP 200  15527 bayt  20 item
The Hill       HTTP 200  20139 bayt  15 item
Bellingcat     HTTP 200 437869 bayt  10 item
Japan Today    HTTP 200  21037 bayt  30 item
```

Sebep `fetchRssText`'in iptal davranışı: genel deadline'a yaklaşıldığında in-flight fetch'ler
abort ediliyor, çağıran taraf `.catch(() => null)` ile bunu yutuyor, relay de düşünce sonuç
`empty` olarak damgalanıyor. Yani **`empty` iki farklı durumu birleştiriyor** — "kaynak ölü"
ve "bu koşuda yetişemedik". `CACHE_TTL_EMPTY_S = 300` bunu kendi kendini besleyen bir hâle
sokuyor: boş sonuç 5 dk cache'leniyor, yeniden denemesi de deadline baskısı altındaki bir
koşuya denk gelirse boş kalmaya devam ediyor.

Gerçekten ölü olanlar da var — `PBS NewsHour` HTTP **202 ve 0 bayt** dönüyor, klasik bot
challenge. Onun `empty` damgası doğru. Ayrım `feedStatuses`'tan yapılamıyor, mesele bu.

**3. Konteyner çıkış yolu suçsuz.** İlk hipotez buydu; `wget` ve `fetch` ile konteynerin
içinden yapılan testler beslemelerin eriştiğini gösterdi. Tek gerçek istisna
`Hankyoreh` (hani.co.kr, 51 bayt).

**Sonuç:** besleme sağlığı **`npm run test:feeds`** ile ölçülmeli — deponun bu iş için
ayırdığı kapı zaten o. `feedStatuses` bir koşunun ne kadarını yetiştirebildiğini gösterir,
neyin canlı olduğunu değil. Hiçbir besleme bu listeye dayanarak silinmemeli.

**Açılan iş kalemleri** (ikisi de Faz 6, kaynak eklemekten daha yüksek getirili):
1. Soğuk-cache digest'i yarım çıktı veriyor — deadline bütçesi / ısıtma stratejisi.
2. `empty` sınıflandırması iptal ile ölü kaynağı ayırmıyor; ayrıldığında `CACHE_TTL_EMPTY_S`
   yalnızca gerçekten boş dönenlere uygulanabilir.

### ✅ Faz 6.1 — iptal edilen fetch artık "boş besleme" diye cache'lenmiyor (2026-08-08)

4.2f'nin açtığı iki kalemden ilki. Sıra bilinçli: soğuk-cache bütçesini, neyin neden düştüğünü
ayırt edemeden düzeltmeye çalışmak körlemesine olurdu.

**Hata.** `fetchAndParseRss` her başarısızlığı tek yola sokuyordu:

```ts
if (!text) {
  const empty = { items: [], parsedTotal: 0, droppedUndated: 0 };
  await setCachedJson(cacheKey, empty, CACHE_TTL_EMPTY_S);   // ← iptal de buraya
```

Deadline yaklaşınca abort edilen bir fetch, çağıran tarafta `.catch(() => null)` ile
yutuluyor, sonra besleme **5 dakikalığına "boş" damgasıyla cache'e yazılıyordu.** Yeniden
denemesi de baskı altındaki başka bir build'e denk gelirse damga tazeleniyor — sağlıklı bir
besleme süresiz "boş" kalabiliyordu.

**Ayrım.** Diğer bütün başarısızlık sebepleri upstream hakkında bir *hüküm*: cevap verdi ve
verdiği kullanılamazdı. `cancelled` bizim hakkımızda bir hüküm: sormayı bıraktık. Artık
`FetchFailureReason` dört sebebi ayırıyor (`http-error`, `not-rss`, `network`, `cancelled`)
ve **yalnızca `cancelled` cache'lenmiyor.** Diğerleri kısa cache'i throttle olarak kullanmaya
devam ediyor — yoksa bozuk bir host her build'de dövülür.

`FeedOutcome` bilinçli olarak `ParseResult`'ın dışında: `ParseResult` cache'lenen yapı, bu ise
denemeyi anlatıyor. İçine konsaydı hem prefix bump gerekirdi hem de cache'ten gelen bir satır
eski bir isteğin sonucunu bugünün sonucu gibi iddia ederdi.

`feedStatuses` da artık sonuçtan türüyor: `cancelled`, `not-rss`, `unreachable`, `empty`.
`timeout` ile `cancelled` farklı şeyler ve ikisi de kalıyor — `timeout` "sırası hiç gelmedi"
(çözüm: verim), `cancelled` "başladı, kesildi" (çözüm: per-feed timeout). Harita hâlâ yalnızca
sorunları taşıyor (`tests/digest-no-reclassify.test.mjs` kısıtı).

**Canlı ölçüm — tam soğuk başlangıç, `en` digesti:**

| | Tur 1 (tam soğuk) | Kararlı hâl |
|---|---|---|
| Öncesi | 112 sorun, 124 haber | **39 sorun**, 267 haber |
| Sonrası | 109 sorun, 129 haber | **27 sorun**, **272 haber** |

Kararlı hâlde **12 besleme kurtuldu, 0 yeni sorun**:

`Arms Control Assn`, `Bellingcat`, `Breaking Defense`, `Bulletin of Atomic Scientists`,
`EuroNews`, `FAO News`, `Hacker News`, `Task & Purpose`, `The National`, `The Sentry`,
`The War Zone`, `gCaptain`

Listede `Bellingcat` ve `Hacker News` olması teşhisi doğruluyor — 4.2f'de elle "aslında
sağlıklı" diye tespit ettiğim beş beslemeden ikisi bunlar. `EuroNews`'in kurtulması ayrıca
dil çalışmasını doğrudan ilgilendiriyor: `de`/`it`/`pt`/`ru` için kayıp olan kaynak oydu.

Kapı: `tests/news-feed-digest-cancellation-vs-empty.test.mts` (13 test) — dört sebebin
ayrıldığını, iptalin cache yazımından **önce** döndüğünü, diğer sebeplerin cache'lenmeye devam
ettiğini ve haritanın sağlıklı beslemeyi kaydetmediğini bağlıyor.

**Kalan:** tur 1 hâlâ 129 haber (kararlı 272'ye karşı) ve 99 `timeout`. Bu artık ayrı ve net
bir sorun — beslemelerin sırası hiç gelmiyor, yani verim meselesi. 4.2f'nin ikinci kalemi.

### ✅ Faz 6.2 — besleme çekimi parti bariyerinden işçi havuzuna (2026-08-08)

4.2f'nin ikinci kalemi. 6.1 sınıflandırmayı düzelttikten sonra geriye net bir sorun kalmıştı:
soğuk başlangıçta 99 besleme `timeout`, yani **sırası hiç gelmiyor.**

**Kusur bariyerdi.** Döngü partiler hâlinde ilerliyor ve her partide
`await Promise.allSettled(batch)` yapıyordu, yani **her parti en yavaş üyesi kadar
sürüyordu.** `FEED_TIMEOUT_MS = 8s`, `OVERALL_DEADLINE_MS = 10s` — tek takılan besleme
build'in bütçesinin %80'ini yiyor, partideki diğer 19 slot boşta bekliyor, arkadaki ~440
besleme hiç başlamıyordu.

**Yapılan:** sabit sayıda işçi ortak bir kuyruktan besleme çekiyor. Yavaş besleme yirmi slotu
değil bir işçiyi meşgul ediyor. Maliyet "parti maksimumlarının toplamı" değil "toplam iş /
işçi sayısı" oluyor. `BATCH_CONCURRENCY` → `FEED_FETCH_CONCURRENCY` (artık parti yok).

**Eşzamanlılık bilerek 20'de bırakıldı.** Ölçümün tek değişkeni bariyerin kendisi olsun diye.
Artırmak ayrı bir düğme ve kendi riskleri var.

**Canlı ölçüm, `en` digesti, tam soğuk başlangıç:**

| | Tur 1 (tam soğuk) | Kararlı hâl |
|---|---|---|
| Orijinal (bariyer) | 112 sorun, **124** haber | 39 sorun, 267 |
| + 6.1 iptal düzeltmesi | 109 sorun, **129** haber | 27 sorun, 272 |
| + 6.2 işçi havuzu | 66→23 sorun, **207–272** haber | 23 sorun, 272 |

**Soğuk tur varyansı yüksek** — havuzla iki ayrı koşuda 207 ve 272 haber çıktı, bariyerle
124 ve 129. Kazanç kesin, büyüklüğü ağ koşullarına bağlı. Kararlı hâl her üç sürümde de 272,
beklendiği gibi: her şey cache'liyken verim sorunu yok.

**Yanlış alarm ve nasıl elendiği.** Ara ölçümlerde 13 Asya beslemesi (`VnExpress`,
`Yonhap News`, `Taipei Times`, `Jakarta Post`…) `empty` göründü ve havuzun yüklediği
eşzamanlılığın kurbanı sanıldı. Konteynerden tek tek çekildiklerinde 200 + öğe dönüyorlardı.
Cache incelendi: girdiler taze ve boştu, yani digest onları yeniden çekip boş almıştı. Ama
`rss:feed:*` de dahil **tam** flush yapılıp koşulduğunda hepsi sorunsuz geldi. Yani geçici
hatalar kısa cache tarafından büyütülüyor — havuza özgü değil, 6.1'in ayıkladığı mekanizmanın
kalan hâli. Kısmî flush (`news:digest:*` ama `rss:feed:*` değil) ölçümü bu yüzden yanıltıyor.

Kapı: `tests/news-feed-digest-cancellation-vs-empty.test.mts` 17 teste çıktı — bariyerin
geri gelmediğini, işçilerin ortak imleç kullandığını, tek beslemenin işçisini düşürmediğini
ve deadline'ın işçiler arasında kontrol edildiğini bağlıyor.

**Kalan (Faz 6):** kararlı hâldeki 23 sorunlu besleme artık gerçek bir liste sayılabilir —
ama yine de `npm run test:feeds` ile doğrulanmalı, `feedStatuses` ile değil (bkz. 4.2f).

### 📊 `npm run test:feeds` ile doğrulama — 4.2f'nin kuralı uygulandı (2026-08-08)

4.2f "besleme sağlığı `feedStatuses` ile değil `test:feeds` ile ölçülmeli" diyordu. 6.1 ve 6.2
sonrası kararlı hâlde kalan 23 sorunlu besleme bu kurala göre doğrulandı.

**Genel durum:** `785 OK · 14 bayat · 13 ölü · 24 boş · 1 atlandı`
(Faz 1 temeli: `728 OK · 12 · 15 · 20 · 1` — eklenen kaynaklarla +57 OK, ölü 15→13.)

**Digest'in 23 sorunlusundan 10'u doğrulandı:**

| Verdict | Besleme |
|---|---|
| ÖLÜ | `CISA` (403), `Channels TV` (parse), `Irrawaddy` (403), `News24` (403) |
| BOŞ | `PBS NewsHour`, `ArXiv AI`, `Asharq Business`, `CrisisWatch`, `IAEA`, `Zerkalo` |

**13'ü hâlâ yanlış pozitif** — `test:feeds` sağlıklı diyor, digest `empty` diyor:

`ABC News`, `Atlantic Council`, `Civil.ge`, `Correctiv`, `DFRLab`, `Financial Times`,
`Japan Today`, `The Hill`, `The Reporter Ethiopia`, `The Sentry`, `ThisDay`, `VSquare`,
`VentureBeat AI`

Yani 6.1 ve 6.2 sayıyı 39'dan 23'e indirdi ama **yanlış pozitif tamamen bitmedi.** Kalan 13
için mekanizma henüz bilinmiyor; `test:feeds` 15s timeout kullanıyor, digest 8s
(`FEED_TIMEOUT_MS`) — ilk bakılacak yer burası. Bu beslemeler ayıklanmamalı.

### ⚠️ Eklediğim kaynakların 7'si çalışmıyor

Dürüst kayıt: bu oturumda iki katalog birden eklenen **62 kaynaktan 55'i sağlıklı, 7'si
değil.** Katalog sayıları paketlerin gerçek gücünü olduğundan yüksek gösteriyor.

| Verdict | Besleme | Dil | Not |
|---|---|---|---|
| ÖLÜ | `Euronews Persian` | fa | **HTTP 406** — değiştirilmeli |
| BOŞ | `Sega` | bg | |
| BOŞ | `Xinhua Chinese` | zh | |
| BOŞ | `Hankyoreh`, `Kyunghyang`, `Pressian`, `No Cut News` | ko | **paketin 5'inden 4'ü** |

`ko` en kötüsü: paketten yalnızca `Donga Ilbo` sağlam. Ama dikkat — canlı digest ölçümünde
`Kyunghyang` kotayı dolduranlar arasındaydı, yani `test:feeds` ile digest bu beslemede
çelişiyor (muhtemelen tarih ayrıştırma ya da geçici durum). Silmeden önce ayrıca bakılmalı;
4.2f'nin dersi tam olarak buydu.

**Yapılacak:** `Euronews Persian` için çalışan bir Farsça URL, `ko` paketi için yeniden
aday araması. İkisi de ölçülmüş, gerekçeli iş kalemleri.
