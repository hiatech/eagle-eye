# AGPL §13 uyumu — yürütme kaydı

> Bu dosya **yürütme durumudur**, plan değil. Plan ve faz tablosu
> `2026-08-07-001-feat-fork-multilingual-roadmap.md` içinde (B2 maddesi).
> Her adımdan sonra bu dosya güncellenir ve aynı commit'e girer.
>
> `docs/plans/` **gitignore'da** — commit ederken `git add -f` şart.

---

## 0. Yapılandırma

```yaml
GH_KULLANICI:   hiatech
GH_REPO:        worldmonitor
FORK_URL:       https://github.com/hiatech/worldmonitor
TELIF:          Hiatech
MARKA:          SKIP   # rebrand ertelendi — ayrı plan
MARKA_NOSPACE:  SKIP
MARKA_UPPER:    SKIP
MARKA_SLUG:     SKIP
DOMAIN:         SKIP   # worldmonitor.app olduğu gibi kalıyor
```

**Kapsam kararı (2026-08-11, sahibi onayladı): sadece AGPL §13 + §5(a). Rebrand yok.**
Ürün adı "World Monitor", domain `worldmonitor.app` değişmiyor. `origin` zaten
`hiatech/worldmonitor` olduğu için §13'ün ihtiyaç duyduğu iki değer baştan çözülmüştü;
loop'u bloke eden şey aslında yalnızca rebrand'e ait değerlerdi.

### Ön koşul — C2'den önce

`github.com/hiatech/worldmonitor` **public** olmalı ve dağıtılan kaynağı içermeli. Çalışan
bir upstream linkini 404 veren özel bir depoya çevirmek uyumu bugünkü durumdan **daha kötü**
yapar. C1 bu koşuldan bağımsız güvenli; C2–C5 değil.

---

## 1. Değişmez kurallar

**ASLA:**
- `LICENSE:2` `Copyright (C) 2024-2026 Elie Habib` satırını silme/değiştirme — **ekle**, değiştirme
- `cli/LICENSE`, `sdk/{python,ruby,go}/LICENSE` (MIT) teliflerini silme
- `server/worldmonitor/**` veya `proto/worldmonitor/**` yeniden adlandırma (605 dosya, RPC namespace)
- `sdk/go/go.mod` modül yolu, npm `worldmonitor`, PyPI `worldmonitor-sdk`, RubyGems
  `worldmonitor` — yayınlanmış registry kimlikleri
- `blog-site/**` ve `authors/elie-habib.astro` — yazılar gerçekten ona ait (hiçbir post'ta
  `author:` frontmatter yok); byline'ı değiştirmek yanlış atıf olur
- `panel-layout.ts:942-945`, `:1122`, `:1035-1038` — `@eliehabib` kredisi. §13'ün konusu değil;
  yaklaşım **toplamsal**: kredi kalır, yanına fork atfı eklenir
- Upstream issue linkleri: `src/services/user-identity.ts:26`, `server/_shared/acled-auth.ts:17`
  ve **`convex/payments/billing.ts:3703`** (ilk ikisinin birebir ikizi, ilk taslakta atlanmıştı)
  + tüm `#NNNN` tarihsel atıfları
- `make generate` (Go toolchain ister) · `npm run product:facts` **yazma modunda** (`:check` kullan)
- `git push`, deploy, release yayınlama — kullanıcı onayı ister

**HER ZAMAN:**
- Tek iterasyon = tek commit. Bitir, doğrula, commit et, bu dosyayı güncelle, dur.
- Ortak kapı: `npm run typecheck && npm run typecheck:api && npm run lint`
- Dal: `rebrand/agpl-compliance`

---

## 1.5 Yürütme prosedürü

1. **Adım seç.** Aşağıdaki tablodan durumu `TODO` olan **ilk** adımı al. Hepsi `DONE`/`SKIP`
   ise tamamlandığını bildir ve dur.
2. **Uygula.** Sadece o adımı. Tuzaklar için `CLAUDE.md` + adımın kendi notu.
3. **Doğrula.** Ortak kapı + adımın kendi doğrulama komutu. Kırmızıysa düzelt; düzeltemiyorsan
   `BLOCKED` işaretle, sebebini checkpoint'e yaz, **commit etme**.
4. **Commit + checkpoint aynı commit'te.** Durumu `DONE` yap, hash'i tabloya yaz,
   `<!-- CHECKPOINT-LOG -->` altına blok ekle. `git add -f` şart.
5. **Dur.** Sonraki iterasyonu bekle.

### Prosedür kuralları

- Bir iterasyonda birden fazla adım yapma; oturum her an kesilebilir.
- `npm run test:data` tam suite'i bu kapsamda **çalıştırılmıyor**: temiz checkout'ta zaten
  27–34 çevresel hata veriyor ve dokunulan her dosyanın hedefli testi var. Bu yüzden orijinal
  plandaki "`before.txt` taban çizgisi" adımı da kaldırıldı.
- Üreteç zinciri (`sources:generate` → `product:facts` → `docs:stats`) bu kapsamda **ölü**:
  besleme eklenmiyor, host sayısı değişmiyor. Ölçüldü — `scripts/docs-stats.mjs` içinde
  `koala73|eliehabib|sameAs|NOTICE` için **0 eşleşme**. `product:facts:check` sadece
  *doğrulama* olarak koşulur.
- Emin olmadığını tahmin etme → `BLOCKED` yap, sebebini yaz.

---

## 2. Adım tablosu

Durum: `TODO` · `DOING` · `DONE` · `SKIP` · `BLOCKED`

| # | Adım | Durum | Commit |
|---|---|---|---|
| C0 | Yol haritası durumunu gerçeğe eşitle + bu dosyayı yeniden yaz | DONE | `daf662063` |
| C1 | `NOTICE` + `LICENSE` telif satırı + `README` fork banner | DONE | `1cb066793` |
| C2 | `panel-layout.ts:946,1131` kaynak linki + `e2e:239` | DONE | `9f48cba3a` |
| C3 | `index.html` (noscript/meta/2×sameAs) + 3 CSP dosyası + 2 test — **bölünemez** | DONE | *(bu commit)* |
| C4 | `middleware.ts:202,218` crawler stub + JSON-LD | TODO | — |
| C5 | `/pro` yüzeyleri + tam `pro-test` rebuild + `public/pro/` | TODO | — |
| C6 | `docs/license.mdx`, ISSUE_TEMPLATE, ghcr image, airline User-Agent | TODO | — |
| C7 | Roadmap'te B2'yi ✅ yap | TODO | — |

### Ertelenenler (bu plana dahil değil)

- **`scripts/railway-cli.mjs:19` `REPOSITORY`** — en tehlikeli madde. Üç script (watch-path
  audit, deploy-drift, deploy trigger) aynı production projesine bakıyor; doğru değer
  Hiatech'in Railway projesine bağlı, repoda olmayan bir gerçek. Tahmin = yanlış commit
  grafiğinden deploy kararı.
- **`api/_github-release.js:3` + `api/download.js:6`** — `/api/download` bugün upstream'in
  imzaladığı binary'leri sunuyor. Fork release yayınlamadan çevirmek endpoint'i 404 yapar.
- **Rebrand'ın tamamı** — ayrı plan.

---

## 3. Ölçülen gerçekler (2026-08-11 denetimi)

Orijinal taslak tahminlerinin düzeltilmiş hali:

| Taslağın iddiası | Ölçülen |
|---|---|
| `koala73` 23 dosyada | ~190 dosyada ~400 kez |
| Marka değişimi 148 dosya | 5.760 domain + 2.968 "World Monitor" + 3.086 "WorldMonitor" (927'si HTTP başlığı) |
| Adım 2b "8 dosya, shipped kod" | §13 için gereken shipped yüzey 6 dosya |
| Adım 6.1 üreteç zinciri gerekli | Gereksiz — `docs-stats.mjs`'de 0 atıf dizesi |

**C3'ün bölünemez olmasının sebebi:** `index.html`'in JSON-LD blokları nonce'suz inline
script; `tests/deploy-config.test.mjs:137-145` regex'i (`<script\b(?![^>]*\bsrc=)`) onları da
hash'liyor. 8 hash'in 6'sı `index.html`'den geliyor ve `sameAs` düzenlemesi bunların 2'sini
değiştiriyor → `vercel.json:261`, `docker/nginx.conf:131`,
`docker/nginx-security-headers.conf:14` aynı commit'te güncellenmezse test kırmızı.

**C5'in pahalı olmasının sebebi:** `.github/workflows/pro-bundle-freshness.yml`,
`pro-test/**` değişen her PR'da tam pro build yapıp `git diff --exit-code` uyguluyor.

---

## 4. Checkpoint kaydı

<!-- CHECKPOINT-LOG -->

### 2026-08-11 · C0 · yol haritası durumu gerçeğe eşitlendi

**Ne yapıldı.** İki plan dosyasının durum kayıtları bayattı ve birbiriyle çelişiyordu.
Roadmap'in özet tablosu Faz 6'yı "❌ Başlamadı" gösteriyordu ama 6.1–6.5 aynı dosyada ✅
kayıtlıydı; satır 106 başlığı "Faz 4 🟡 ~%10" derken satır 543 fazı kapalı ilan ediyordu.
Ayrıca bu yürütme dosyasının §0 config'i tamamen `<...>` doluydu ve loop'u bloke ediyordu —
oysa bloke eden değerlerin çoğu (marka, domain) §13 için hiç gerekli değil, gereken ikisi
(`GH_KULLANICI`/`GH_REPO`) ise `git remote`'ta zaten yazılıydı.

**Dokunulan dosyalar.**
- `docs/plans/2026-08-07-001-feat-fork-multilingual-roadmap.md` — özet tablo (Faz 4 ✅,
  Faz 6 🟡 + B2 açık), başlık L106 (🟡 ~%10 → ✅ Kapandı, tarihsel not eklendi), başlık L274
  (❌ → 🟡), iki "Önerilen sıradaki adım" bloğu tarihlendirildi (aşıldı), sona 2026-08-11
  güncel durum bölümü eklendi.
- `docs/plans/2026-08-11-001-rebrand-agpl-execution.md` — §0 config dolduruldu, kapsam
  §13+§5(a) olarak daraltıldı, adım tablosu C0–C7 olarak yeniden yazıldı, ASLA listesine
  denetimde bulunan yeni maddeler eklendi (`billing.ts:3703`, registry kimlikleri, blog
  yazar sayfası, `@eliehabib` kredisi), `before.txt` adımı ve üreteç zinciri adımı kaldırıldı.

**Doğrulama.** Yalnızca doküman; kod yolu yok, test yok, CI guard yok. Bu iki dosyaya hiçbir
test veya script referans vermiyor (grep: 0 eşleşme). Yine de ortak kapı koşuldu.

**Sıradaki.** C1 — `NOTICE` + `LICENSE` telif satırı + `README` fork banner.

---

### 2026-08-11 · C1 · fork'un değişiklik bildirimi ve kaynak teklifi kaydedildi

**Ne yapıldı.** AGPL §5(a) "değiştirdim + tarih" bildirimi hiçbir yerde yoktu ve kök dizinde
`NOTICE` yoktu. Üçü de eklendi — hepsi **toplamsal**, hiçbir mevcut telif silinmedi.

**Dokunulan dosyalar.**
- `NOTICE` (yeni) — upstream telifi + AGPL-3.0-only, fork telifi (Hiatech), fork noktası
  (`d9a65dd`) ve neyin değiştiği, §13 Corresponding Source adresi
  (`https://github.com/hiatech/worldmonitor`), 4 MIT alt-lisansa işaret, veri kaynaklarının
  kendi lisanslarına yönlendirme.
- `LICENSE` — 2. satırın altına `Copyright (C) 2026 Hiatech (modifications — see NOTICE)`.
  Diff saf ekleme; `Copyright (C) 2024-2026 Elie Habib` satırı context olarak geçti,
  byte-identical.
- `README.md` — H1'in altına fork banner'ı (upstream'e link, "not endorsed by", NOTICE'a
  yönlendirme), telif bölümüne Hiatech satırı eklendi.

**Doğrulama.** Ortak kapı yeşil. `npm run docs:check` → *150 doc claims match code* (README
`docs-stats` iddia hedefi; banner sayısal regex'leri bozmadı). `markdownlint README.md` →
0 hata. `npm run lint:public-docs` → geçti (README `docs/plans/`'a link vermiyor).

**Not.** `NOTICE` hiçbir yerde paketlenmiyor, Docker'a kopyalanmıyor ve hiçbir test onu
asserte etmiyor — denetimde doğrulandı. Yani dosya bugün yalnızca depoda duruyor; deploy
edilen imajda görünmesi isteniyorsa ayrıca `Dockerfile`'a `COPY` gerekir. §13 yükümlülüğünü
karşılayan şey zaten arayüzdeki kaynak linki (C2–C5), `NOTICE` değil.

**Sıradaki.** C2 — `panel-layout.ts:946,1131` kaynak linki + `e2e:239`.
**Hatırlatma:** C2 ön koşulu — `github.com/hiatech/worldmonitor` public olmalı.

---

### 2026-08-11 · C2 · dashboard'un kaynak teklifi fork'u gösteriyor

**Ön koşul.** Kullanıcı `hiatech/worldmonitor`'ın public olduğunu onayladı (2026-08-11).
Depo görünürlüğü dış servise istek gerektirdiği için ASLA listesi gereği doğrulama
kullanıcıya soruldu, tahmin edilmedi.

**Ne yapıldı.** §13'ün asıl karşılandığı yer burası: JS çalıştıran her kullanıcının gördüğü
iki kaynak linki artık çalıştırılan sürümün deposunu gösteriyor.
- `src/app/panel-layout.ts:946` — header GitHub ikonu → `hiatech/worldmonitor`
- `src/app/panel-layout.ts:1131` — site footer nav "GitHub" → `hiatech/worldmonitor`
- `src/app/panel-layout.ts:1122` — footer alt satırına "modified fork by Hiatech" atfı
  eklendi. `@eliehabib` kredisi **korundu** — §13'ün konusu değil ve §5/§7(b) atfı
  korumaya işaret ediyor. Yaklaşım toplamsal.
- `e2e/prehydration-shell.spec.ts:239` — footer href listesi aynı commit'te güncellendi.

**Doğrulama.** Ortak kapı yeşil. Footer'ın tek üretildiği yer `panel-layout.ts:1117`
olduğu doğrulandı (`index.html`'de statik kopya yok) — yani C2 ile C3 arasında kuplaj yok.
Eklenen atıf linki `.site-footer-sub` içinde, `nav` dışında; e2e'nin `toHaveCount(1)`
sayımını bozmuyor. `github-link`/`viewOnGitHub` için tests/ ve e2e/ içinde başka assert yok.

**Kapsam dışı bırakılanlar (bilinçli).** `src/app/desktop-updater.ts:103` ve
`src/services/preferences-content.ts:33` hâlâ upstream release'lerini gösteriyor. Bunlar
kaynak teklifi değil binary indirme yolu; fork release yayınlamadan çevirmek indirmeyi
kırar. Ertelenenler listesinde.

**Sıradaki.** C3 — `index.html` + 3 CSP dosyası (bölünemez commit).

---

### 2026-08-11 · C3 · no-JS ve yapısal veri yüzeyleri + CSP hash zinciri

**Ne yapıldı.**
- `index.html:438` — `<noscript>` nav GitHub linki → `hiatech/worldmonitor`
- `index.html:13` — `meta author` → `Elie Habib, Hiatech` (toplamsal)
- `index.html:137` (WebApplication `sameAs[0]`) ve `:163` (Organization `sameAs[0]`) →
  `hiatech/worldmonitor`. İkisi birebir aynı dizeydi, `replace_all` ile değiştirildi;
  `:112` ve `:160`'taki `github.com/koala73` **kişisel profil** (author/founder Person)
  olduğu için dokunulmadı.
- `tests/indexable-content-visibility.test.mjs:96`, `e2e/prehydration-shell.spec.ts:498`

**CSP hash zinciri.** Öngörü doğrulandı: `sameAs` düzenlemesi tam **2** token değiştirdi.
- WebApplication: `13YxW7lX…` → `qtf+8ujC…`
- Organization: `qFSeUweak…` → `7XVNmDdl…`

Diğer 6 token (WebSite ld+json, iki prepaint, bare inline, settings/live-channels, offline)
değişmedi — `meta author` ve noscript düzenlemelerinin script gövdesi dışında olduğu
doğrulanmış oldu. Üç dosya (`vercel.json`, `docker/nginx.conf`,
`docker/nginx-security-headers.conf`) tek işlemde güncellendi; base64 token'larda `/` ve `+`
olduğu için sed yerine tam-dize değişimi kullanıldı.

**Doğrulama.** `deploy-config` + `variant-inline-bootstrap` + `indexable-content-visibility`
→ **174/174 geçti, 0 hata**. Ortak kapı yeşil. `product:facts:check` → OK (JSON-LD girinti
bütünlüğü korundu; `rewriteApplicationJsonLd` blokları yeniden serileştirdiği için bu
kontrol şart). `docs:check` → 150 iddia eşleşti.

**Not.** `index.html:105-116` (author Person) ve `:156-161` (founder Person) bilinçli olarak
değiştirilmedi. Bunlar §13'ün konusu değil ve değiştirilmiş sürümün yazarını Hiatech ilan
etmek mevcut durumdan daha yanlış olurdu. Aynı hash'li bloklarda oldukları için ileride
değiştirilirlerse **bu commit'in yaptığı gibi** CSP güncellemesiyle aynı commit'te olmalı.

**Sıradaki.** C4 — `middleware.ts:202,218` crawler stub + JSON-LD.
