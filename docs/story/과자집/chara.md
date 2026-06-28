# 슈크레 노엘 등장인물 이미지 생성 프롬프트

기준 키 아트: `377fd8b3-7ade-4d2e-840f-51974a6d4a90.png`

키 아트의 `aMixIllustrious_aMix.safetensors` 기반 anime illustration, 따뜻한 디저트 살롱, 여성향 BL, 부드러운 미소년풍을 기준으로 한다. 공용 prompt 조합 없이, 각 캐릭터마다 그대로 복사해 사용할 수 있는 완성형 prompt와 negative prompt를 작성한다.

## 권장 생성 설정

```json
{
  "model": "comfyui/local-sdxl",
  "model_name": "aMixIllustrious_aMix.safetensors",
  "num_inference_steps": 31,
  "guidance_scale": 5,
  "width": 832,
  "height": 1216,
  "sampler_name": "euler_ancestral",
  "scheduler": "normal",
  "clip_skip": 2,
  "loras": [
    { "path": "5byue5dnijistyleE291.cNux.safetensors", "scale": 0.8 },
    { "path": "USNR STYLE_XL_lokr.safetensors", "scale": 0.6 },
    { "path": "DemonerithIllustrious.safetensors", "scale": 0.5 },
    { "path": "nnestyle.safetensors", "scale": 0.3 },
    { "path": "Pb0y.safetensors", "scale": 0.4 }
  ]
}
```

---

## 에리안

오너 쇼콜라티에. 28세. 세계 초콜릿 대회 우승자. 조용하고 다정하며 감정을 초콜릿으로 표현한다.

### 외형 설정

- 체형: 슬림하고 곧은 자세, 손끝이 섬세한 장인형
- 얼굴: 부드러운 계란형 얼굴, 낮은 긴장감, 다정한 눈매
- 머리: 짧고 단정한 다크 브라운 헤어, 앞머리는 자연스럽게 옆으로 흐름
- 눈: 따뜻한 앰버색 눈, 차분하지만 어둡지 않은 시선
- 의상: 아이보리 셔츠, 다크 초콜릿색 베스트, 골드 버튼, 브라운 쇼콜라티에 앞치마
- 소품: 봉봉 쇼콜라 박스, 초콜릿 몰드, 금색 디저트 집게

### Prompt

```text
masterpiece, best quality, absurdres,
1boy, solo, beautiful boy, pretty boy, bishounen, male focus,
young man, elegant male, refined male, gentle handsome man,
owner chocolatier, premium chocolate artisan,
soft oval face, delicate facial features, slim body, graceful posture,
short dark brown hair, neatly styled soft hair, side swept bangs,
warm amber eyes, gentle eyes, kind eyes,
soft affectionate gaze, calm warm smile, slight smile, welcoming expression,
looking at viewer,

ivory dress shirt, dark chocolate brown vest, gold buttons,
silk brown necktie, elegant chocolatier apron, small gold brooch,
clean cafe uniform, refined dessert salon outfit,

holding assorted bonbon chocolate box,
beautiful handmade chocolates, chocolate mold, small gold dessert tong,
glossy chocolate, premium confectionery details,

luxury dessert cafe, premium chocolate salon, elegant cafe, victorian cafe,
dark green walls, polished wooden counter, framed dessert paintings,
warm lighting, golden lighting, cozy atmosphere, soft glow, bokeh,

upper body, character portrait,
anime illustration, highly detailed, soft shading, beautiful lighting, depth of field
```

### Negative Prompt

```text
1girl, female, woman,
old man, middle aged man, beard, mustache,
muscular, bodybuilder, broad shoulders, thick neck,
sharp jawline, extreme jawline, gaunt face,
angry expression, frown, scowl, gloomy face, sad face, cold stare,
evil smile, arrogant smirk, emotionless face, tired eyes,
dark fantasy, horror, monster, demon, dragon, gothic horror,
battle, weapon, armor, blood,
long hair, ponytail, twin tails,
dress, skirt,
messy dirty clothes, chef hat, crown,
low quality, worst quality, blurry, bad anatomy, bad hands,
extra fingers, missing fingers, deformed fingers,
watermark, text, logo, signature
```

---

## 루카

수석 파티시에. 26세. 천재 제과사. 장난기가 많고 분위기 메이커지만 플레이어를 가장 많이 챙겨준다.

### 외형 설정

- 체형: 가볍고 날렵한 체형, 밝은 에너지가 느껴지는 포즈
- 얼굴: 소년미가 남은 귀여운 미남, 웃을 때 눈꼬리가 올라감
- 머리: 짧고 폭신한 스트로베리 블론드 헤어, 약간 흐트러진 앞머리
- 눈: 라이트 그린 눈, 장난기 있지만 친근한 시선
- 의상: 흰 파티시에 재킷, 크림색 앞치마, 딸기색 리본 포인트
- 소품: 짤주머니, 딸기 쇼트케이크, 작은 스패출러, 크림 볼

### Prompt

```text
masterpiece, best quality, absurdres,
1boy, solo, beautiful boy, pretty boy, bishounen, male focus,
young man, cute male, lively male, charming pastry chef,
head pastry chef, genius patissier,
soft youthful face, bright facial features, slim agile body,
short fluffy strawberry blond hair, messy soft hair, airy bangs,
light green eyes, sparkling eyes, playful eyes,
bright smile, teasing but kind smile, cheerful expression, friendly expression,
looking at viewer,

white pastry chef jacket, cream colored apron, red ribbon accent,
gold buttons, rolled up sleeves, clean patissier uniform,
small decorative pin, cute elegant cafe outfit,

holding piping bag, strawberry shortcake, whipped cream,
fresh strawberries, cream bowl, small spatula,
tiny sugar decorations, delicate cake details,

luxury dessert cafe, pastry kitchen corner, cute cafe, elegant cafe,
dark green walls, wooden furniture, dessert display case,
warm lighting, golden lighting, cozy atmosphere, soft glow, bokeh,

upper body, character portrait,
anime illustration, highly detailed, soft shading, beautiful lighting, depth of field
```

### Negative Prompt

```text
1girl, female, woman,
old man, middle aged man, beard, mustache,
muscular, bodybuilder, broad shoulders, thick neck,
sharp jawline, extreme jawline, mature face,
angry expression, frown, scowl, gloomy face, sad face, cold stare,
mean smile, evil smile, arrogant smirk, emotionless face,
dark fantasy, horror, monster, demon, dragon, gothic horror,
battle, weapon, armor, blood,
long hair, ponytail, twin tails,
dress, skirt,
dirty apron, messy food stains, tall chef hat, crown,
low quality, worst quality, blurry, bad anatomy, bad hands,
extra fingers, missing fingers, deformed fingers,
watermark, text, logo, signature
```

---

## 노아

홍차 소믈리에. 30세. 손님의 기분만 보고 어울리는 차를 고르며, 모두의 고민 상담을 맡는 침착한 인물.

### 외형 설정

- 체형: 길고 단정한 실루엣, 움직임이 느리고 안정적임
- 얼굴: 지적인 미남, 온화한 상담자 같은 분위기
- 머리: 짧은 애쉬 그레이 헤어, 깔끔한 가르마
- 눈: 딥 네이비 눈, 낮고 편안한 시선
- 의상: 흰 셔츠, 네이비 베스트, 그레이 크라바트, 얇은 체인 장식
- 소품: 포셀린 찻잔, 실버 티포트, 찻잎 틴, 애프터눈 티 세트

### Prompt

```text
masterpiece, best quality, absurdres,
1boy, solo, beautiful boy, pretty boy, bishounen, male focus,
young man, elegant male, intellectual male, gentle tea sommelier,
tea sommelier, calm counselor atmosphere,
soft refined face, slender body, straight posture, graceful hands,
short ash gray hair, neatly parted hair, smooth side bangs,
deep navy eyes, serene eyes, warm gentle eyes,
peaceful smile, calm friendly smile, relaxed expression, reassuring expression,
looking at viewer,

white dress shirt, navy vest, brass buttons,
gray cravat, thin gold chain accessory, elegant cafe uniform,
clean tailored outfit, refined tea salon style,

holding porcelain teacup, silver teapot, tea leaves tin,
afternoon tea set, gentle steam from tea, delicate saucer,
small macarons beside teacup,

luxury dessert cafe, tea salon corner, victorian cafe, elegant cafe,
dark green walls, wooden table, framed dessert paintings,
warm lighting, golden lighting, cozy atmosphere, soft glow, bokeh,

upper body, character portrait,
anime illustration, highly detailed, soft shading, beautiful lighting, depth of field
```

### Negative Prompt

```text
1girl, female, woman,
old man, middle aged man, beard, mustache,
muscular, bodybuilder, broad shoulders, thick neck,
sharp jawline, extreme jawline, gaunt face,
angry expression, frown, scowl, gloomy face, sad face, cold stare,
stern expression, emotionless face, exhausted face, villain face,
dark fantasy, horror, monster, demon, dragon, gothic horror,
battle, weapon, armor, blood,
long hair, ponytail, twin tails,
dress, skirt,
doctor coat, lab coat, crown,
low quality, worst quality, blurry, bad anatomy, bad hands,
extra fingers, missing fingers, deformed fingers,
watermark, text, logo, signature
```

---

## 카엘

플로리스트. 계절마다 카페를 꾸미고 꽃말을 좋아한다. 손님에게 어울리는 꽃을 추천해 준다.

### 외형 설정

- 체형: 가늘고 섬세한 실루엣, 꽃다발을 조심스럽게 안는 포즈
- 얼굴: 맑고 투명한 인상, 살짝 수줍지만 밝은 미소
- 머리: 짧은 소프트 라벤더 헤어, 부드러운 웨이브
- 눈: 맑은 바이올렛 눈, 섬세하고 호의적인 시선
- 의상: 크림 셔츠, 세이지 그린 베스트, 라벤더 리본 타이, 꽃 자수 앞치마
- 소품: 계절 꽃다발, 리본, 작은 꽃가위, 꽃 장식 바구니

### Prompt

```text
masterpiece, best quality, absurdres,
1boy, solo, beautiful boy, pretty boy, bishounen, male focus,
young man, delicate male, elegant male, gentle florist,
florist, romantic flower arranger,
soft clear face, delicate facial features, slender body, graceful posture,
short soft lavender hair, slightly wavy hair, fluffy side bangs,
clear violet eyes, gentle eyes, bright kind eyes,
shy smile, tender smile, sweet expression, soft welcoming expression,
looking at viewer,

cream shirt, sage green vest, lavender ribbon tie,
floral embroidered apron, small flower brooch,
clean elegant cafe uniform, soft romantic outfit,

holding seasonal flower bouquet, pale roses, small wildflowers,
lavender flowers, satin ribbon, flower basket, tiny flower scissors,
fresh petals, delicate floral details,

luxury dessert cafe, cafe decorated with flowers, elegant cafe, victorian cafe,
dark green walls, wooden furniture, framed dessert paintings,
warm lighting, golden lighting, cozy atmosphere, soft glow, bokeh,

upper body, character portrait,
anime illustration, highly detailed, soft shading, beautiful lighting, depth of field
```

### Negative Prompt

```text
1girl, female, woman,
old man, middle aged man, beard, mustache,
muscular, bodybuilder, broad shoulders, thick neck,
sharp jawline, extreme jawline, mature face,
angry expression, frown, scowl, gloomy face, sad face, cold stare,
crying, vacant eyes, emotionless face, creepy smile,
dark fantasy, horror, monster, demon, dragon, gothic horror,
battle, weapon, armor, blood,
long hair, ponytail, twin tails,
dress, skirt,
thorn crown, crown, funeral flowers,
low quality, worst quality, blurry, bad anatomy, bad hands,
extra fingers, missing fingers, deformed fingers,
watermark, text, logo, signature
```

---

## 리온

바리스타. 커피 챔피언 출신. 무뚝뚝하지만 커피만큼은 누구보다 진심이다.

### 외형 설정

- 체형: 탄탄하지만 과하게 근육질은 아닌 슬림한 체형, 안정적인 자세
- 얼굴: 말수는 적지만 차갑지 않은 미남, 입가에 아주 옅은 미소
- 머리: 짧은 블랙 헤어, 자연스럽게 흐트러진 앞머리
- 눈: 깊은 커피 브라운 눈, 집중력 있고 신뢰감 있는 시선
- 의상: 블랙 셔츠, 에스프레소 브라운 앞치마, 구리색 버튼, 심플한 타이
- 소품: 라떼 아트 컵, 포터필터, 커피 원두, 구리색 드립포트

### Prompt

```text
masterpiece, best quality, absurdres,
1boy, solo, beautiful boy, pretty boy, bishounen, male focus,
young man, cool male, elegant male, sincere barista,
champion barista, artisan coffee maker,
handsome soft face, slim fit body, steady posture, calm presence,
short black hair, slightly tousled hair, natural bangs,
deep coffee brown eyes, focused eyes, trustworthy eyes,
subtle warm smile, quiet gentle smile, calm friendly expression,
looking at viewer,

black shirt, espresso brown apron, copper buttons,
rolled up sleeves, simple dark tie, clean barista uniform,
small copper accessory, refined coffee salon outfit,

holding latte art cup, heart shaped latte art,
portafilter, roasted coffee beans, copper drip kettle,
espresso machine in background, warm coffee steam,

luxury dessert cafe, barista counter, elegant cafe, victorian cafe,
dark green walls, polished wooden counter, framed dessert paintings,
warm lighting, golden lighting, cozy atmosphere, soft glow, bokeh,

upper body, character portrait,
anime illustration, highly detailed, soft shading, beautiful lighting, depth of field
```

### Negative Prompt

```text
1girl, female, woman,
old man, middle aged man, beard, mustache,
muscular, bodybuilder, broad shoulders, thick neck,
sharp jawline, extreme jawline, rugged face,
angry expression, frown, scowl, gloomy face, sad face, cold stare,
stern expression, intimidating face, emotionless face, hostile expression,
dark fantasy, horror, monster, demon, dragon, gothic horror,
battle, weapon, armor, blood,
long hair, ponytail, twin tails,
dress, skirt,
dirty apron, cigarette, alcohol bottle, crown,
low quality, worst quality, blurry, bad anatomy, bad hands,
extra fingers, missing fingers, deformed fingers,
watermark, text, logo, signature
```

---

## 시온

홀 매니저. 예약과 손님 응대를 담당한다. 카페의 모든 일을 파악하고 있는 해결사.

### 외형 설정

- 체형: 단정하고 균형 잡힌 실루엣, 빈틈없이 정리된 자세
- 얼굴: 깔끔하고 세련된 미남, 친절하지만 너무 차갑지 않은 눈빛
- 머리: 짧은 실버 헤어, 부드럽게 정돈된 앞머리
- 눈: 와인 레드 눈, 예리하지만 다정한 시선
- 의상: 흰 셔츠, 블랙 베스트, 와인 레드 리본 타이, 실버 버튼, 회중시계 체인
- 소품: 예약 장부, 만년필, 디저트 메뉴판, 작은 회중시계

### Prompt

```text
masterpiece, best quality, absurdres,
1boy, solo, beautiful boy, pretty boy, bishounen, male focus,
young man, elegant male, polished male, refined hall manager,
hall manager, professional dessert salon host,
clean handsome face, balanced slim body, precise graceful posture,
short silver hair, neatly styled hair, soft side bangs,
wine red eyes, sharp gentle eyes, attentive eyes,
professional warm smile, polite smile, composed friendly expression,
looking at viewer,

white dress shirt, black vest, wine red ribbon tie,
silver buttons, small pocket watch chain,
elegant cafe uniform, neat formal service outfit,

holding reservation book, fountain pen, dessert menu,
guest list, small pocket watch, polished reception desk,

luxury dessert cafe, front hall, reservation desk, elegant cafe, victorian cafe,
dark green walls, wooden furniture, framed dessert paintings,
gift box, warm lighting, golden lighting, cozy atmosphere, soft glow, bokeh,

upper body, character portrait,
anime illustration, highly detailed, soft shading, beautiful lighting, depth of field
```

### Negative Prompt

```text
1girl, female, woman,
old man, middle aged man, beard, mustache,
muscular, bodybuilder, broad shoulders, thick neck,
sharp jawline, extreme jawline, gaunt face,
angry expression, frown, scowl, gloomy face, sad face, cold stare,
evil smile, arrogant smirk, emotionless face, villain face,
dark fantasy, horror, monster, demon, dragon, gothic horror,
battle, weapon, armor, blood,
long hair, ponytail, twin tails,
dress, skirt,
crown, royal cape, military uniform,
low quality, worst quality, blurry, bad anatomy, bad hands,
extra fingers, missing fingers, deformed fingers,
watermark, text, logo, signature
```

---

## 단체 키 비주얼

### Prompt

```text
masterpiece, best quality, absurdres,
6boys, beautiful boys, pretty boys, bishounen, male focus,
premium dessert salon staff, visual novel key visual,
owner chocolatier, head pastry chef, tea sommelier, florist, barista, hall manager,

six elegant young men standing together behind dessert cafe counter,
all characters have warm smiles, friendly expressions, gentle romantic atmosphere,
soft affectionate gazes, cozy slow romance mood,

dark brown haired chocolatier holding bonbon chocolate box,
strawberry blond pastry chef holding strawberry shortcake,
ash gray haired tea sommelier holding porcelain teacup,
lavender haired florist holding seasonal bouquet,
black haired barista holding latte art cup,
silver haired hall manager holding reservation book,

luxury dessert cafe, elegant cafe, victorian cafe,
dark green walls, framed dessert paintings, wooden furniture,
dessert display case, teddy bear, gift box,
bonbon chocolates, strawberry shortcake, porcelain teacups,
seasonal flower bouquet, latte art, reservation book,
warm lighting, golden lighting, cozy atmosphere, soft glow, depth of field,

anime illustration, highly detailed, soft shading, beautiful lighting
```

### Negative Prompt

```text
1girl, female, woman,
old men, beards, muscular bodies,
angry expressions, frowns, gloomy faces, sad faces, cold stares,
evil smiles, hostile expressions, emotionless faces,
dark fantasy, horror, monsters, demons, dragons, gothic horror,
battle, weapons, armor, blood,
crowns, royal capes, military uniforms,
long hair, ponytails, twin tails, dresses, skirts,
low quality, worst quality, blurry, bad anatomy, bad hands,
extra fingers, missing fingers, deformed fingers,
watermark, text, logo, signature
```
