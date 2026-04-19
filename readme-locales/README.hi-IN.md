<p align="center">
  <img src="../site/icons/icon.svg" alt="AgentLimb Logo" width="64" height="64">
</p>

<h1 align="center">AgentLimb</h1>

<p align="center">
  <strong>अपने AI को वही काम दोबारा सीखते देखना बंद करें।</strong><br>
  CoWork का ओपन-सोर्स विकल्प — बार-बार के ब्राउज़र कार्यों में 90% कम टोकन।
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof">
    <img src="https://img.shields.io/badge/Chrome_Web_Store-मुफ़्त_इंस्टॉल-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Chrome Web Store से इंस्टॉल करें">
  </a>
  <a href="https://agentlimb.com">
    <img src="https://img.shields.io/badge/Website-agentlimb.com-F5A623?style=for-the-badge" alt="Website">
  </a>
  <a href="https://github.com/hooosberg/AgentLimb">
    <img src="https://img.shields.io/github/stars/hooosberg/AgentLimb?style=for-the-badge&logo=github&label=Star&color=24292f" alt="GitHub Star">
  </a>
</p>

<p align="center">
  <em>अगर AgentLimb आपके काम आता है, तो कृपया इस repo को ⭐ स्टार दें — इससे दूसरों को प्रोजेक्ट खोजने में मदद मिलती है!</em>
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

## परिचय

**AgentLimb** एक Chrome एक्सटेंशन है — [अब Chrome Web Store पर उपलब्ध](https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof) — जो किसी भी AI टर्मिनल — Claude Code, Cursor, Codex, Trae, Windsurf, या कोई भी लोकल मॉडल — को आपके ब्राउज़र पर सटीक नियंत्रण देता है। एक्सटेंशन इंस्टॉल करें, एक प्रॉम्प्ट कॉपी करें, AI में पेस्ट करें — 10 सेकंड में ऑटो-कॉन्फ़िगर।

कोई headless ब्राउज़र नहीं। कोई दोबारा लॉगिन नहीं। कोई invasive एजेंट नहीं। आपका असली Chrome, असली कुकीज़, असली सेशन — साथ में मसल मेमोरी जो हर बार दोहराए जाने वाले कामों को और सस्ता बनाती है।

## मुख्य विशेषताएं

### 1. एक प्रॉम्प्ट सेटअप

एक प्रॉम्प्ट कॉपी करें, किसी भी AI टूल में पेस्ट करें। कोई कॉन्फ़िग फ़ाइल नहीं, कोई टर्मिनल कमांड नहीं, कोई API key नहीं। अगर आपका AI कमांड चला सकता है, तो वह AgentLimb उपयोग कर सकता है।

### 2. मसल मेमोरी — 85% कम टोकन, 80–95% कम प्रतीक्षा

जब AI पहली बार किसी साइट पर जाता है, तो DOM एक्सप्लोर करके सेलेक्टर और वर्कफ़्लो सीखता है। AgentLimb यह ज्ञान `~/Desktop/AgentLimb-muscle/<domain>.json` में लिखता है। उसी साइट पर हर अगली बार एक्सप्लोरेशन छोड़कर सीधे सीखी हुई जानकारी का उपयोग होता है।

Reddit पोस्टिंग टास्क का वास्तविक रिग्रेशन डेटा (कम-पैरामीटर Codex, 2026-04-18):

| | कोल्ड स्टार्ट (पहली बार एक्सप्लोरेशन) | हॉट स्टार्ट (मसल रिकॉल) | बचत |
|---|---|---|---|
| `page_snapshot` कॉल | 3 | **0** | 100% |
| कुल टूल कॉल | 23 | 10 | 56.5% |
| अनुमानित टोकन | ~12,250 | **~1,750** | **↓ 85.7%** |
| वास्तविक समय | 8–20 मिनट | 30 स–2 मिनट | **↓ ~80–95%** |

जितना अधिक किसी साइट का पुनः उपयोग करें, उतना सस्ता और तेज़ होता जाता है।

### 3. CDP-नेटिव, स्क्रीनशॉट अनुमान नहीं

AgentLimb Chrome Debugger Protocol के ज़रिए ब्राउज़र को नियंत्रित करता है। AI को इंटरैक्टिव एलिमेंट्स की संरचित सिमेंटिक सूची मिलती है — स्क्रीनशॉट नहीं। क्लिक सही नोड पर लगती है, फॉर्म नेटिव API से भरते हैं, नेविगेशन के बाद तुरंत नई URL मिलती है।

### 4. स्पष्ट टास्क जीवनचक्र

चुप्पी का मतलब अब सफलता नहीं। AI स्पष्ट रूप से `task_plan` → `task_step_done` → `task_complete` / `task_fail` घोषित करता है। टाइमआउट और Bridge डिस्कनेक्ट असली विफलताओं के रूप में दर्ज होते हैं। साइड पैनल रियल टाइम में स्टेप लिस्ट दिखाता है।

### 5. 100% लोकल और प्राइवेट

Bridge `127.0.0.1:7791` पर चलता है। कोई एनालिटिक्स नहीं, कोई ट्रैकिंग नहीं, कोई क्लाउड नहीं। मसल नॉलेज आपके डेस्कटॉप पर प्लेन JSON है — जब चाहें पढ़ें, तुलना करें, शेयर करें या डिलीट करें।

### 6. मल्टी-अकाउंट पैरेलल कंट्रोल — एक साथ कई Chrome Profile चलाएं

एक AI कमांड, हर Chrome Profile उसे एक साथ चलाता है। चाहे दो Twitter अकाउंट हों, तीन कंपनी Google अकाउंट हों, या दर्जनों टेस्ट Profile——AgentLimb एक ही टास्क में सबको चलाता है।

- **स्पष्ट पहचान** — हर साइड पैनल "यह पैनल: Profile-xxxxxx" दिखाता है; Bridge जानता है कि किस Profile ने कौन-सा नतीजा दिया
- **रोकें / ऑटो-रोकें** — पैनल बंद करें (या Suspend क्लिक करें) तो वह Profile टास्क से बाहर हो जाता है; बाकी बिना रुके चलते रहते हैं
- **task\_\* ब्रॉडकास्ट** — `task_plan`, `task_step_done`, `task_complete`, `task_fail` हर एक्टिव Profile को ब्रॉडकास्ट होते हैं; सभी साइड पैनल सिंक रहते हैं
- **विंडो लॉक** — `navigate` अपने आप सही Chrome विंडो को टारगेट करता है, भले ही एक ही Profile में कई विंडो खुली हों
- **टारगेट रूटिंग** — जब किसी एक Profile को ही ऑपरेट करना हो तो टूल कॉल में label से बताएं

## यह कैसे काम करता है

```
आपका AI टर्मिनल  (Claude Code / Cursor / Codex / Trae / Windsurf / लोकल मॉडल)
    ↕  HTTP + SSE  (16 मानकीकृत टूल, /docs एंडपॉइंट से ऑटो-डिस्कवरेबल)
AgentLimb Bridge  (लोकल Node.js · 127.0.0.1:7791)
    ↕  chrome.runtime मैसेज पासिंग
AgentLimb Extension  (Chrome MV3 · साइड पैनल UI · टास्क/मसल/लॉग टैब)
    ↕  Chrome Debugger Protocol
आपका ब्राउज़र  (लॉग-इन, कुकीज़ के साथ, असली सेशन)
    ↓  ज्ञान सेव होता है
~/Desktop/AgentLimb-muscle/<domain>.json  (स्थायी, मानव-पठनीय)
```

## क्विक स्टार्ट

1. **इंस्टॉल** — दो विकल्प:
   - **Chrome Web Store** (अनुशंसित): [AgentLimb इंस्टॉल करें](https://chromewebstore.google.com/detail/agentlimb/hldldfepjhljhbcneojddjkkodkjglof) — एक क्लिक, ऑटो-अपडेट
   - **मैनुअल (नवीनतम बिल्ड)**: [zip डाउनलोड करें](https://github.com/hooosberg/AgentLimb/releases/latest), अनज़िप करें, `chrome://extensions` खोलें, **Developer Mode** सक्षम करें, **Load unpacked** क्लिक करें
2. **कॉपी** — साइड पैनल खोलें, "Onboard Prompt कॉपी करें" क्लिक करें
3. **पेस्ट** — किसी भी AI टर्मिनल में पेस्ट करें। यह ऑटो-कनेक्ट होगा, टूल स्कीमा लाएगा, और काम शुरू करेगा

## टूलसेट — 16 टूल

पाँच श्रेणियों में 16 मानकीकृत टूल: ब्राउज़र स्थिति का अवलोकन, पेज एलिमेंट्स के साथ नेविगेशन और इंटरैक्शन, मसल मेमोरी पढ़ना और लिखना, टास्क जीवनचक्र घोषित करना, और Bridge कनेक्टिविटी बनाए रखना। पूरी दस्तावेज़ीकरण मांग पर उपलब्ध — AI केवल जरूरत पड़ने पर स्कीमा लाता है।

## सीधे X क्यों न इस्तेमाल करें?

ब्राउज़र ऑटोमेशन के हर मौजूदा तरीके की एक वास्तविक कीमत है। यहाँ ईमानदार तुलना है:

| | Browser Use / Playwright | BrowseAI / Browserbase | Codex / Claude Computer Use | **AgentLimb** |
|---|---|---|---|---|
| **सेटअप** | स्क्रिप्ट लिखना, डिपेंडेंसी मैनेज करना, हेडलेस मोड संभालना | SaaS कॉन्फ़िग, प्रति-वर्कफ़्लो सेटअप | केवल Mac (डेस्कटॉप वातावरण चाहिए), sandbox आवश्यक | एक प्रॉम्प्ट कॉपी करें। हो गया |
| **एलिमेंट टार्गेटिंग** | CSS/XPath——आप इन्हें लिखते और मेंटेन करते हैं | विज़ुअल AI डिटेक्शन——अपडेट पर अस्थिर | स्क्रीनशॉट कोऑर्डिनेट्स——±1px भी लक्ष्य चूक सकता है | CDP लाइव DOM पढ़ता है——सिमेंटिक, सटीक |
| **प्रति क्रिया टोकन लागत** | शून्य (सिर्फ स्क्रिप्ट) | क्लाउड शुल्क + AI टोकन | 1,000–3,000 टोकन/स्क्रीनशॉट × हर चरण | ~300 टोकन/चरण, हॉट स्टार्ट: **85.7% कम** |
| **दोहराए गए कार्य की लागत** | निश्चित (स्क्रिप्ट फिर से चलती है) | रैखिक——प्रति निष्पादन शुल्क | रैखिक——हर बार फिर से खोजता है, कोई मेमोरी नहीं | **घटती हुई**——मसल मेमोरी जुड़ती जाती है |
| **लॉगिन सत्र** | अतिरिक्त कुकी/सत्र सेटअप | क्लाउड——आपके लोकल सत्र उपयोग नहीं कर सकता | OS-स्तर, ब्राउज़र स्थिति से अनजान | आपका असली Chrome——पहले से लॉग-इन |
| **जब साइट अपडेट होती है** | सिलेक्टर टूटते हैं——स्क्रिप्ट दोबारा लिखें | विज़ुअल मॉडल चुपचाप गिर सकता है | स्क्रीनशॉट इन्फरेन्स समायोजित होता है, पर महंगा | AI बेमेल का पता लगाता है, नया सिलेक्टर खोजता है, मसल को खुद ठीक करता है |
| **डेटा गोपनीयता** | लोकल ✅ | तीसरे पक्ष के सर्वर के ज़रिए ❌ | लोकल ✅ | 100% लोकल——केवल 127.0.0.1 ✅ |
| **AI टर्मिनल विकल्प** | कोई भी (सिर्फ स्क्रिप्ट) | प्लेटफ़ॉर्म के अनुसार अलग-अलग | Codex / Claude के साथ बंडल | कोई भी AI जो HTTP बोलता हो |
| **साझा ज्ञान** | स्क्रिप्ट = एक AI से बंधी | वर्कफ़्लो = प्लेटफ़ॉर्म से बंधी | कोई स्थायी मेमोरी नहीं | मसल फाइलें = क्रॉस-AI, ट्रांसफरेबल, स्थायी |
| **मल्टी-अकाउंट पैरेलल** | मैन्युअल ऑर्केस्ट्रेशन | प्लेटफ़ॉर्म पर निर्भर | नहीं | ✅ कई Chrome Profile, एक कमांड |

**मुख्य अंतर**: AgentLimb की मसल फाइलें `~/Desktop/AgentLimb-muscle/` में सादे JSON के रूप में रहती हैं। आज Claude Code जो सीखता है, कल Codex उसे तुरंत उपयोग कर सकता है——वही फाइलें, ज़ीरो री-एक्सप्लोरेशन। AI टूल बदलें, लेकिन एक भी सीखी हुई वर्कफ़्लो न खोएँ।

## उपयोग के मामले

- **मार्केटिंग** — सोशल मीडिया पर पोस्ट करना, प्लेटफ़ॉर्म पर अभियान प्रबंधन
- **शोध** — डेटा स्क्रैप करना, उत्पादों की तुलना, प्रतिस्पर्धी जानकारी एकत्र करना
- **ऑटोमेशन** — फॉर्म भरना, आवेदन जमा करना, प्रोफ़ाइल अपडेट करना
- **टेस्टिंग** — असली ब्राउज़र और असली सेशन के साथ वेब ऐप QA

## डिज़ाइन दर्शन

- **न्यूनतम सतह** — 16 टूल, हर एक एक काम अच्छे से करता है, किसी भी वर्कफ़्लो में संयोजनीय
- **गैर-दखलंदाज़** — आपके असली ब्राउज़र के अंदर काम करता है, sandbox में नहीं
- **लोकल-फर्स्ट** — आर्किटेक्चर से गोपनीयता, वादे से नहीं
- **AI-अज्ञेयवादी** — कोई भी टूल जो HTTP भेज सकता है, कनेक्ट हो सकता है; कोई वेंडर लॉक-इन नहीं

## संसाधन

- **वेबसाइट**: [agentlimb.com](https://agentlimb.com)
- **ट्यूटोरियल**: [agentlimb.com/tutorials.html](https://agentlimb.com/tutorials.html)
- **AI टूल्स डायरेक्टरी**: [agentlimb.com/tools.html](https://agentlimb.com/tools.html)
- **समाचार**: [agentlimb.com/news.html](https://agentlimb.com/news.html)
- **गोपनीयता नीति**: [agentlimb.com/privacy.html](https://agentlimb.com/privacy.html)
- **सेवा की शर्तें**: [agentlimb.com/terms.html](https://agentlimb.com/terms.html)
- **लाइसेंस**: [agentlimb.com/license.html](https://agentlimb.com/license.html)

## संपर्क

- **GitHub**: [hooosberg/AgentLimb](https://github.com/hooosberg/AgentLimb)
- **ईमेल**: [zikedece@proton.me](mailto:zikedece@proton.me)

## अन्य प्रोजेक्ट

<table>
  <tr>
    <td align="center">
      <a href="https://hooosberg.github.io/WitNote/">
        <b>✍️ WitNote</b><br>
        <sub>AI लेखन साथी</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/DOMPrompter/">
        <b>🎯 DOMPrompter</b><br>
        <sub>विज़ुअल AI प्रॉम्प्ट जनरेटर</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/GlotShot/">
        <b>📸 GlotShot</b><br>
        <sub>App Store स्क्रीनशॉट</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://hooosberg.github.io/TrekReel/">
        <b>🏔️ TrekReel</b><br>
        <sub>3D ट्रेल कहानियां</sub>
      </a>
    </td>
    <td align="center">
      <a href="https://uixskills.com/">
        <b>🎨 UIXskills</b><br>
        <sub>डिज़ाइन प्रोटोकॉल लेयर</sub>
      </a>
    </td>
  </tr>
</table>

## लाइसेंस

[Business Source License 1.1](../LICENSE) — व्यक्तिगत उपयोग मुफ़्त। वाणिज्यिक उपयोग के लिए लाइसेंस आवश्यक। 2030-04-12 को Apache 2.0 में परिवर्तित।

Copyright © 2025 hooosberg. सर्वाधिकार सुरक्षित।
