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
| 4 | Yerel RSS kaynak genişletmesi | 🟡 ~%10 |
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
2. **Faz 4.2 — dil paketleri.** Gerçek zayıflar `bg`/`cs`/`fa`/`ja` (1'er). Tek tek değil
   **paket halinde** — `pt` paketi bunun çalıştığını canlıda kanıtladı, tek başına eklenen
   `ar` kaynağı kategori kapağında eleniyor.
3. **Faz 4.0 — ölü ayıklama** (yukarıdakilerle paralel): Al Arabiya `ar` 403,
   EuroNews `pt`/`ru` fetch failed, Tuoi Tre `vi` ölü.
4. **B2 — fork'u yayınla**, sonra linkleri çevir + `NOTICE`. Deploy'dan ÖNCE.
5. **B1 — CORS**, yalnızca embed / ayrı `api.` alt alan adı / masaüstü istemci
   gerekiyorsa. Aynı-origin Docker kurulumunda gerekmez.

Faz 5 (Wikinews / Mastodon / Bluesky) Faz 4'ten sonra gelmeli: aynı 6 dosyalık disiplin
oturmadan yeni bir kaynak sınıfı eklemek katalog borcunu ikiye katlar.
