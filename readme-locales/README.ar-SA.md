<p align="center">
  <img src="../site/icons/icon.svg" alt="AgentLimb Logo" width="64" height="64">
</p>

<h1 align="center">AgentLimb</h1>

<p align="center">
  <strong>توقف عن مشاهدة ذكاءك الاصطناعي يعيد تعلم نفس المهمة.</strong><br>
  البديل مفتوح المصدر لـ CoWork — 90% رموز أقل في مهام المتصفح المتكررة.
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof">
    <img src="https://img.shields.io/badge/Chrome_Web_Store-تثبيت_مجاني-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="التثبيت من Chrome Web Store">
  </a>
  <a href="https://agentlimb.com">
    <img src="https://img.shields.io/badge/Website-agentlimb.com-F5A623?style=for-the-badge" alt="Website">
  </a>
  <a href="https://github.com/hooosberg/AgentLimb">
    <img src="https://img.shields.io/github/stars/hooosberg/AgentLimb?style=for-the-badge&logo=github&label=Star&color=24292f" alt="GitHub Star">
  </a>
</p>

<p align="center">
  <em>إذا وجدت AgentLimb مفيدًا، يُرجى ⭐ إضافة نجمة لهذا المستودع — يساعد ذلك الآخرين في اكتشاف المشروع!</em>
</p>

<p align="center">
  <strong>
    <a href="../README.md">English</a> &nbsp;|&nbsp;
    <a href="./README.zh-CN.md">中文</a> &nbsp;|&nbsp;
    <a href="./README.ja-JP.md">日本語</a> &nbsp;|&nbsp;
    <a href="./README.ko-KR.md">한국어</a> &nbsp;|&nbsp;
    <a href="./README.es-ES.md">Español</a> &nbsp;|&nbsp;
    <a href="./README.fr-FR.md">Français</a> &nbsp;|&nbsp;
    <a href="./README.de-DE.md">Deutsch</a> &nbsp;|&nbsp;
    <a href="./README.pt-BR.md">Português</a> &nbsp;|&nbsp;
    <a href="./README.ru-RU.md">Русский</a> &nbsp;|&nbsp;
    <a href="./README.ar-SA.md">العربية</a> &nbsp;|&nbsp;
    <a href="./README.it-IT.md">Italiano</a> &nbsp;|&nbsp;
    <a href="./README.hi-IN.md">हिन्दी</a>
  </strong>
</p>

<p align="center">
  <img src="../assets/demo.gif" alt="AgentLimb Demo — AI agent controlling the browser" width="720">
</p>

---

## حول

**AgentLimb** إضافة Chrome — [متاحة الآن على Chrome Web Store](https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof) — تتيح لأي طرفية ذكاء اصطناعي — Claude Code أو Cursor أو Codex أو Trae أو Windsurf أو أي نموذج محلي — التحكم الدقيق في متصفحك. ثبّت الإضافة، انسخ موجهًا واحدًا، الصقه في أداة الذكاء الاصطناعي — إعداد تلقائي في 10 ثوانٍ.

بدون متصفحات headless. بدون إعادة تسجيل دخول. بدون عوامل تدخلية. Chrome الحقيقي، ملفات تعريف الارتباط الحقيقية، الجلسات الحقيقية — بالإضافة إلى ذاكرة عضلية تجعل المهام المتكررة أرخص تكلفة في كل مرة.

## أبرز الميزات

### 1. إعداد بموجه واحد

انسخ موجهًا واحدًا والصقه في أي أداة ذكاء اصطناعي. لا ملفات إعداد، لا أوامر طرفية، لا مفاتيح API. إذا كانت أداتك يمكنها تنفيذ الأوامر، يمكنها استخدام AgentLimb.

### 2. الذاكرة العضلية — 85% توفير في الرموز، 80–95% تقليص في وقت الانتظار

في المرة الأولى التي يزور فيها ذكاؤك الاصطناعي أحد المواقع، يستكشف بنية DOM ويتعلم المحددات وسير العمل. يكتب AgentLimb هذه المعرفة في `~/Desktop/AgentLimb-muscle/<domain>.json`. كل تشغيل لاحق على نفس الموقع يتجاوز الاستكشاف ويعيد استخدام ما تعلّمه.

بيانات انحدار حقيقية من مهمة نشر على Reddit (Codex منخفض المعامل، 2026-04-18):

| | بدء بارد (الاستكشاف الأول) | بدء ساخن (استدعاء الذاكرة) | التوفير |
|---|---|---|---|
| استدعاءات `page_snapshot` | 3 | **0** | 100% |
| إجمالي استدعاءات الأدوات | 23 | 10 | 56.5% |
| الرموز المقدرة | ~12,250 | **~1,750** | **↓ 85.7%** |
| الوقت الفعلي | 8–20 دقيقة | 30 ث–2 دقيقة | **↓ ~80–95%** |

كلما أعدت استخدام موقع، أصبح أرخص وأسرع.

### 3. CDP أصلي، لا تخمين بالصور

يتحكم AgentLimb في المتصفح عبر Chrome Debugger Protocol. يتلقى الذكاء الاصطناعي قائمة دلالية منظمة للعناصر التفاعلية — لا صور. تصيب النقرات العقدة الصحيحة، تستخدم النماذج واجهات API الأصلية، تعيد عمليات التنقل الرابط الجديد فورًا.

### 4. دورة حياة مهمة صريحة

الصمت لم يعد يعني النجاح. يُعلن الذكاء الاصطناعي صراحةً `task_plan` ← `task_step_done` ← `task_complete` / `task_fail`. تُسجَّل انتهاءات المهلة وانقطاعات الجسر كإخفاقات حقيقية. يعرض اللوح الجانبي قائمة الخطوات المباشرة في الوقت الفعلي.

### 5. محلي 100% وخاص

يعمل الجسر على `127.0.0.1:7791`. بدون تحليلات، بدون تتبع، بدون سحابة. المعرفة العضلية هي JSON عادي على سطح مكتبك — يمكنك قراءته ومقارنته ومشاركته أو حذفه في أي وقت.

## كيف يعمل

```
طرفية الذكاء الاصطناعي  (Claude Code / Cursor / Codex / Trae / Windsurf / نموذج محلي)
    ↕  HTTP + SSE  (16 أداة موحدة، قابلة للاكتشاف عبر نقاط /docs)
AgentLimb Bridge  (Node.js محلي · 127.0.0.1:7791)
    ↕  رسائل chrome.runtime
AgentLimb Extension  (Chrome MV3 · لوح جانبي · تبويبات المهمة/العضلة/السجل)
    ↕  Chrome Debugger Protocol
متصفحك  (مسجّل الدخول، مع ملفات تعريف الارتباط، جلساتك الحقيقية)
    ↓  المعرفة تُحفظ
~/Desktop/AgentLimb-muscle/<domain>.json  (دائم، يمكن البشر قراءته)
```

## البداية السريعة

1. **التثبيت** — خياران:
   - **Chrome Web Store** (موصى به): [تثبيت AgentLimb](https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof) — نقرة واحدة، تحديثات تلقائية
   - **يدوي (آخر إصدار)**: [حمّل ملف zip](https://github.com/hooosberg/AgentLimb/releases/latest)، افك ضغطه، افتح `chrome://extensions`، فعّل **وضع المطور**، اضغط **تحميل غير مضغوط**
2. **النسخ** — افتح اللوح الجانبي، انقر "نسخ موجه الإعداد"
3. **اللصق** — الصقه في أي طرفية ذكاء اصطناعي. يتصل تلقائيًا، يجلب مخطط الأداة عند الطلب، ويبدأ العمل

## مجموعة الأدوات — 16 أداة

16 أداة موحدة في خمس فئات: مراقبة حالة المتصفح، التنقل والتفاعل مع عناصر الصفحة، قراءة وكتابة الذاكرة العضلية، الإعلان عن أحداث دورة حياة المهمة، والحفاظ على اتصال الجسر. توفر الوثائق الكاملة عند الطلب — يجلب الذكاء الاصطناعي المخططات فقط عند الحاجة إليها.

## لماذا لا نستخدم X فحسب؟

لكل نهج حالي لأتمتة المتصفح تكلفته الحقيقية. إليك المقارنة الصريحة:

| | Browser Use / Playwright | BrowseAI / Browserbase | Codex / Claude Computer Use | **AgentLimb** |
|---|---|---|---|---|
| **الإعداد** | كتابة سكربتات، إدارة التبعيات، التعامل مع الوضع بلا واجهة | إعداد SaaS، إعداد منفصل لكل سير عمل | Mac فقط (يحتاج بيئة سطح المكتب)، صندوق حماية مطلوب | انسخ موجّهًا واحدًا. انتهى |
| **تحديد العناصر** | CSS/XPath — أنت تكتبها وتصونها | كشف مرئي بالذكاء الاصطناعي — غير مستقر عند التحديثات | إحداثيات لقطة الشاشة — ±1 بكسل قد يخطئ الهدف | CDP يقرأ DOM المباشر — دلالي ودقيق |
| **تكلفة الرموز لكل عملية** | لا شيء (سكربت خالص) | رسوم سحابية + رموز الذكاء الاصطناعي | 1,000–3,000 رمز/لقطة شاشة × كل خطوة | ~300 رمز/خطوة، البدء الساخن: أقل بنسبة **85.7%** |
| **تكلفة المهام المتكررة** | ثابت (إعادة تشغيل السكربت) | خطي — محاسبة لكل تنفيذ | خطي — يعيد الاستكشاف في كل مرة، بلا ذاكرة | **متناقص** — الذاكرة العضلية تتراكم |
| **جلسات تسجيل الدخول** | إعداد إضافي لملفات تعريف الارتباط/الجلسات | سحابي — لا يمكنه استخدام جلساتك المحلية | على مستوى النظام، لا يدرك حالة المتصفح | Chrome الحقيقي لديك — مسجّل الدخول بالفعل |
| **عند تحديث الموقع** | المحددات تتعطل — أعد كتابة السكربتات | قد يتدهور النموذج المرئي بصمت | الاستدلال من لقطات الشاشة يتكيف، لكن بتكلفة عالية | الذكاء الاصطناعي يكتشف الاختلاف ويجد محددًا جديدًا ويصلح العضلة ذاتيًا |
| **خصوصية البيانات** | محلي ✅ | عبر خوادم طرف ثالث ❌ | محلي ✅ | 100% محلي — 127.0.0.1 فقط ✅ |
| **اختيار طرفية الذكاء الاصطناعي** | أي شيء (سكربت خالص) | يختلف حسب المنصة | مدمج مع Codex / Claude | أي ذكاء اصطناعي يفهم HTTP |
| **المعرفة المشتركة** | السكربت = مقيّد بذكاء اصطناعي واحد | سير العمل = مقيّد بالمنصة | لا ذاكرة دائمة | ملفات العضلات = مشتركة بين النماذج، قابلة للنقل، دائمة |

**الميزة الفريدة**: ملفات عضلات AgentLimb تُحفظ كـ JSON عادي في `~/Desktop/AgentLimb-muscle/`. المعرفة التي يستكشفها Claude Code اليوم يعيد Codex استخدامها غدًا — نفس الملفات، بدون إعادة استكشاف. بدّل أدوات الذكاء الاصطناعي دون خسارة أي سير عمل مُتعلَّم.

## حالات الاستخدام

- **التسويق** — النشر على وسائل التواصل الاجتماعي، إدارة الحملات عبر المنصات
- **البحث** — استخراج البيانات، مقارنة المنتجات، جمع المعلومات التنافسية
- **الأتمتة** — ملء النماذج، تقديم الطلبات، تحديث الملفات الشخصية
- **الاختبار** — اختبار جودة تطبيق الويب على متصفح حقيقي مع جلسات حقيقية

## فلسفة التصميم

- **سطح أدنى** — 16 أداة، كل منها تؤدي مهمة واحدة بشكل جيد، قابلة للتركيب عبر أي سير عمل
- **غير تدخلي** — يعمل داخل متصفحك الحقيقي، لا في بيئة معزولة
- **محلي أولًا** — الخصوصية بالتصميم المعماري، لا بالوعود
- **مستقل عن الذكاء الاصطناعي** — أي أداة يمكنها إرسال HTTP يمكنها الاتصال؛ بدون قيد بمورد

## الموارد

- **الموقع**: [agentlimb.com](https://agentlimb.com)
- **الدروس التعليمية**: [agentlimb.com/tutorials.html](https://agentlimb.com/tutorials.html)
- **دليل أدوات الذكاء الاصطناعي**: [agentlimb.com/tools.html](https://agentlimb.com/tools.html)
- **الأخبار**: [agentlimb.com/news.html](https://agentlimb.com/news.html)
- **سياسة الخصوصية**: [agentlimb.com/privacy.html](https://agentlimb.com/privacy.html)
- **شروط الخدمة**: [agentlimb.com/terms.html](https://agentlimb.com/terms.html)
- **الترخيص**: [agentlimb.com/license.html](https://agentlimb.com/license.html)

## التواصل

- **GitHub**: [hooosberg/AgentLimb](https://github.com/hooosberg/AgentLimb)
- **البريد الإلكتروني**: [zikedece@proton.me](mailto:zikedece@proton.me)

## مشاريع أخرى

<table>
  <tr>
    <td align="center">
      <a href="https://hooosberg.github.io/WitNote/">
        <b>✍️ WitNote</b><br>
        <sub>رفيق الكتابة بالذكاء الاصطناعي</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/DOMPrompter/">
        <b>🎯 DOMPrompter</b><br>
        <sub>مولّد موجهات ذكاء اصطناعي مرئي</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/GlotShot/">
        <b>📸 GlotShot</b><br>
        <sub>لقطات متجر التطبيقات</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/TrekReel/">
        <b>🏔️ TrekReel</b><br>
        <sub>قصص مسارات ثلاثية الأبعاد</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://uixskills.com/">
        <b>🎨 UIXskills</b><br>
        <sub>طبقة بروتوكول التصميم</sub>
      </a>
    </td>
  </tr>
</table>

## الترخيص

[Business Source License 1.1](../LICENSE) — مجاني للاستخدام الشخصي. الاستخدام التجاري يتطلب ترخيصًا. يتحول إلى Apache 2.0 في 2030-04-12.

Copyright © 2025 hooosberg. جميع الحقوق محفوظة.
