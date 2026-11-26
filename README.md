# Big Cloud · AI Gateway (MCP)

سيرفر MCP داخلي بيربط كلود عند كل عضو بالفريق مع خدمات الذكاء الاصطناعي: **Higgsfield** (صور وفيديو) و**ElevenLabs** (صوت). مفاتيح الـ API بتضل على السيرفر وما حدا بالفريق بشوفها. كل عضو عنده **رابط واحد** وميزانية شهرية وحدة، والأدمن بيختار شو الخدمات المسموحة لكل عضو.

```
Claude (عضو 1) ─┐                                     ┌──►  api.higgsfield.ai
Claude (عضو 2) ─┼──►  AI gateway (هذا السيرفر)  ──────┤
Claude (عضو 3) ─┘   • رابط واحد لكل شخص               └──►  api.elevenlabs.io
                    • خدمات حسب الصلاحية • ميزانية + سقف للفريق • أرشفة المخرجات
```

## الخدمات

| الخدمة | المتغيّر | التسعير بالميزانية |
|---|---|---|
| Higgsfield | `HF_CREDENTIALS` | السعر اللي بيرجّعه Higgsfield (`/estimate`)، أو `max_usd` للموديل كأسوأ حالة |
| ElevenLabs | `ELEVENLABS_API_KEY` | تحويل النص لصوت بالحرف: 0.08$ لكل 1000 حرف (Multilingual v2 وv3)، و0.04$ (Flash وTurbo). المؤثرات الصوتية 0.12$ للدقيقة |

- الخدمة بتشتغل بس إذا متغيّرها موجود على السيرفر. الخدمة اللي ما إلها مفتاح بتطلع بالداشبورد معطّلة.
- لما توقف خدمة عن عضو بتختفي أدواتها عنده فوراً، بدون ما يتغيّر رابطه.
- الميزانية الشهرية وحدة لكل عضو وبتنحسب على كل الخدمات مع بعض، و`ORG_MONTHLY_BUDGET_USD` هو سقف الفريق كله.
- أسعار ElevenLabs موجودة بـ [src/elevenlabs.ts](src/elevenlabs.ts) ومأخوذة من elevenlabs.io/pricing/api. إذا تغيّرت الأسعار أو خطة الاشتراك، عدّلها هونيك.
- لإضافة خدمة جديدة: اكتب client بـ `src/<service>.ts`، وأدواتها بـ `src/tools/<service>.ts`، وبعدين سجّلها بـ [src/services.ts](src/services.ts) و[src/tools.ts](src/tools.ts).

## شو بيعمل

| الميزة | التفاصيل |
|---|---|
| حساب لكل شخص | كل عضو إله رابط connector خاص. بتقدر توقفه أو تغيّره بأمر واحد بدون ما تأثر على الباقي. |
| ميزانية شهرية | قبل أي توليد بنسأل Higgsfield عن السعر (`/estimate`) وبنحجز المبلغ من ميزانية الشخص. إذا ما بكفي، الطلب ما بوصل Higgsfield أصلاً. |
| سقف للفريق | `ORG_MONTHLY_BUDGET_USD` بحط حد أعلى لصرف الفريق كله بالشهر. |
| سقف لكل توليد | كل موديل إله `max_usd`، وأي توليد سعره المقدّر أعلى منه بنرفض. |
| الفشل ما بنحسب | الحالات `failed` و`nsfw` والإلغاء بترجع الحجز للميزانية، متل ما Higgsfield بيعمل بالرصيد. |
| حدود التزامن | Higgsfield بسمح بـ 20 طلب متزامن لكل مفتاح. السيرفر بوزّعهم على الفريق، مع حد لكل شخص. |
| موديلات معتمدة | الفريق بستخدم بس الموديلات اللي بـ `models.json`. الأدمن بقدر يجرّب أي path. |
| أرشفة | Higgsfield بحذف الملفات بعد 7 أيام تقريباً، فالسيرفر بنزّلها عنده وبعطي روابط موقّعة صالحة 30 يوم. |
| عزل | كل عضو بشوف بس توليداته، والأدمن بشوف الكل. |
| تقارير | `usage` بعطيك صرف كل شخص بالشهر، وفي أداة `admin_team_usage` جوا كلود. |

### الأدوات اللي بتظهر بكلود
- **للكل:** `my_budget` · `my_history`، وللأدمن كمان `admin_team_usage`.
- **Higgsfield:** `hf_list_models` · `hf_estimate_cost` · `hf_generate` · `hf_get_status` · `hf_cancel`.
- **ElevenLabs:** `el_list_voices` · `el_text_to_speech` · `el_sound_effect`. الصوت بيرجع كرابط تحميل موقّع، فلازم يكون `ARCHIVE_DIR` و`FILES_SECRET` مضبوطين.

---

## التشغيل (حوالي 15 دقيقة)

### 1. مفتاح Higgsfield API
1. ادخل على **console.higgsfield.ai**، سجّل، واشحن رصيد بالدولار.
2. اعمل API key. المفتاح إله جزئين (ID وSecret) وبظهر **مرة وحدة بس**.
3. خزّنه بالشكل التالي: `KEY_ID:KEY_SECRET`.

> الـ API منفصل عن اشتراك higgsfield.ai، وإله رصيد خاص بالدولار.

### 2. السيرفر والدومين
بتحتاج VPS صغير (1 vCPU و1GB بكفّوا) فيه Docker، ودومين فرعي متل `hf.big-system.app` موجّه على IP السيرفر.

```bash
git clone <repo> bc-higgsfield-mcp && cd bc-higgsfield-mcp
cp .env.example .env
nano .env        # HF_CREDENTIALS, PUBLIC_BASE_URL, FILES_SECRET
openssl rand -base64 48   # انسخ الناتج لـ FILES_SECRET
nano Caddyfile   # غيّر hf.big-system.app لدومينك
docker compose up -d --build
curl https://hf.big-system.app/health     # {"ok":true,"models":3}
```

Caddy بطلع شهادة HTTPS لحاله، وما بسجّل الروابط بالـ logs لأن التوكن موجود بالرابط.

### 3. أضف الفريق
```bash
alias bc='docker compose exec hf-mcp node --no-warnings=ExperimentalWarning dist/admin.js'

bc user:add yazan --admin --budget 200
bc user:add sara  --budget 40 --concurrency 2
bc user:add omar  --budget 25
```
كل أمر بطبعلك **Connector URL** خاص بالعضو. ابعته إله **بشكل خاص**، لأنه بمثابة كلمة سر.

### 4. كل عضو بربط كلود تبعه
1. **Claude → Settings → Connectors → Add custom connector**
2. Name: `Big Cloud AI`
3. URL: الرابط اللي وصله
4. Add، وبعدين بفعّل الـ connector بالمحادثة وبكتب مثلاً: *«ولّدلي فيديو 5 ثواني 9:16 لـ…»*

> إذا الفريق على **Claude Team/Enterprise**، لازم الـ Owner يسمح بالـ custom connectors من إعدادات المنظمة. أسهل خيار إنه الـ Owner يضيفه مرة وحدة للمنظمة، بس هيك كل الأعضاء رح يستخدموا نفس الرابط. الأفضل يضل كل عضو يضيف رابطه الشخصي.

كمان بشتغل مع Claude Code وأي عميل MCP، عن طريق هيدر `Authorization: Bearer <token>` على `https://hf.big-system.app/mcp`:
```bash
claude mcp add --transport http bc-ai https://hf.big-system.app/mcp --header "Authorization: Bearer bc_xxx"
```

---

## الإدارة اليومية

### لوحة الإدارة (الأسهل)
افتح `https://<الدومين>/admin` وادخل بكلمة السر `ADMIN_PASSWORD` (16 حرف أو أكتر، بتنحط بمتغيرات السيرفر) أو بتوكن أي عضو أدمن. من اللوحة بتقدر:
- تضيف عضو وتاخد رابط الـ connector تبعه مباشرة
- تعدّل الميزانية والتزامن، وتعطي أو تشيل صلاحية الأدمن
- توقف عضو أو ترجّع تفعّله، وتعمل رابط جديد (القديم بيوقف فوراً)
- تشوف صرف كل عضو وصرف الفريق بالشهر الحالي

بعد 10 محاولات دخول غلط من نفس الـ IP، الدخول بيتسكّر لمدة 10 دقائق.

### من سطر الأوامر

```bash
bc user:list                      # الأعضاء والميزانيات والصرف
bc usage                          # تقرير الشهر الحالي
bc usage --month 2026-11
bc user:budget sara 60            # تعديل الميزانية
bc user:concurrency sara 3
bc user:disable omar              # إيقاف فوري
bc user:rotate sara               # رابط جديد، والقديم بوقف يشتغل
bc user:role sara admin
bc user:services sara higgsfield,elevenlabs   # الخدمات المسموحة
```

### إضافة موديلات
افتح صفحة الموديل بـ console.higgsfield.ai وانسخ الـ path اللي بيجي بعد `https://api.higgsfield.ai/`:
```bash
bc models:add --id kling-3-i2v \
  --path "<path من صفحة الموديل>" \
  --kind video --label "Kling 3.0 image-to-video" --max-usd 1.5 \
  --example '{"prompt":"slow dolly in","image_url":"https://...","duration":5}'
bc models:list
bc models:disable kling-3-i2v
```
بتقدر تعدّل `models.json` (الموجود بالـ volume `/data/models.json`) مباشرة، والسيرفر بقرأ التعديل بدون restart.

> **الموديلات المضافة مبدئياً:** `bytedance/seedance-2.0/text-to-video` مأخوذ من مثال Higgsfield الرسمي، و`flux-pro/kontext/max/text-to-image` من SDK الرسمي، و`higgsfield-ai/soul/v2/standard` من توثيق الـ estimate. تأكد إنهم مفعّلين بحسابك بالكونسول قبل الاستخدام.

---

## الأمان
- `HF_CREDENTIALS` موجود بـ `.env` على السيرفر بس، وما بطلع بأي رد ولا بأي log.
- التوكنات بتنخزن كـ SHA-256، وما بنقدر نرجّعها. إذا عضو ضيّع رابطه، اعمله `user:rotate`.
- الرابط فيه التوكن، فتعامل معه متل كلمة السر. إذا عضو ترك الفريق: `user:disable`.
- في rate limit بحدود 120 طلب بالدقيقة لكل عضو، عشان يحمي من agent خرب وعلق بحلقة.
- روابط الأرشيف موقّعة بـ HMAC ولها تاريخ انتهاء.
- لازم HTTPS دائماً. لا تفتح البورت 8787 للعموم.

## ملاحظات مهمة
- **التكلفة بالتقارير مبنية على تقدير Higgsfield (`/estimate`).** راجع الفاتورة الفعلية بالكونسول كل شهر. إذا الموديل ما إله estimate، بنحجز `max_usd` كأسوأ حالة.
- **أول تشغيل:** اعمل توليد صورة رخيص من حساب الأدمن، وتأكد إنه وصل `completed` وإن الأرشيف نزل. السيرفر مجرّب على mock مبني على عقد الـ API الرسمي (من SDK `@higgsfield/client` v2)، بس لسا ما تجرّب على حسابك الحقيقي.
- قاعدة البيانات SQLite موجودة بالـ volume `hf-data`. خذ نسخة احتياطية من `/data` بشكل دوري.
- راجع شروط Higgsfield الخاصة بالـ API (Developer Access) قبل ما تعتمد على السيرفر بالإنتاج.

## التطوير
```bash
npm install
npm test           # 33 اختبار end-to-end: mock upstream + السيرفر + MCP client رسمي
npm run dev
npm run admin:dev -- user:list
```
