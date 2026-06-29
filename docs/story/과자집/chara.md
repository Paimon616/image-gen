# 슈크레 노엘 등장인물 이미지 생성 프롬프트

기준 키 아트: `377fd8b3-7ade-4d2e-840f-51974a6d4a90.png`

목표는 같은 작품의 그림체를 유지하되, 캐릭터가 머리색만 다른 클론처럼 보이지 않게 만드는 것이다. 각 prompt는 공용 prefix 없이 그대로 복사해서 사용할 수 있도록 작성했다. LoRA가 얼굴을 비슷하게 끌고 가는 경향이 있으므로, 캐릭터를 구분하는 `hair silhouette`, `accessory`, `outfit shape`, `pose`, `mood`를 prompt 앞쪽에 강하게 배치한다.

## 권장 생성 설정

개성 확인용 1차 테스트에서는 LoRA를 낮춰 쓰는 것을 권장한다.

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
    { "path": "5byue5dnijistyleE291.cNux.safetensors", "scale": 0.55 },
    { "path": "USNR STYLE_XL_lokr.safetensors", "scale": 0.35 },
    { "path": "Pb0y.safetensors", "scale": 0.25 }
  ]
}
```

기존 키 아트 느낌을 더 강하게 유지하고 싶을 때만 `DemonerithIllustrious.safetensors`와 `nnestyle.safetensors`를 추가한다. 캐릭터 얼굴 차이를 확인할 때는 일단 제외하는 쪽이 낫다.

---

## 에리안

오너 쇼콜라티에. 28세. 세계 초콜릿 대회 우승자. 조용하고 다정하다. 감정을 초콜릿으로 표현한다.

### 외형 설정

- 헤어스타일: 짧은 다크 초콜릿 브라운, 단정한 side part, 귀가 드러나는 깔끔한 옆머리, 한쪽 앞머리만 부드럽게 내려옴
- 악세사리: 금색 카카오 열매 브로치, 얇은 브라운 가죽 장갑 한쪽, 작은 금색 체인
- 의상: 아이보리 셔츠, 다크 브라운 더블 브레스트 베스트, 초콜릿색 롱 앞치마, 소매는 정갈하게 접음
- 분위기: 조용한 장인, 따뜻한 오너, 낮은 목소리의 다정함, 고급 초콜릿 살롱
- 차별점: 가장 성숙하고 안정적인 인상, 움직임이 적고 손끝이 섬세함

### Prompt

```text
masterpiece, best quality, absurdres,
1boy, solo, male focus,
adult young man, refined chocolatier, calm owner of a luxury dessert salon,

distinct character design,
short dark chocolate brown hair, neat side part haircut, clean exposed ears,
one soft side bang, compact hair silhouette,
warm amber eyes, low gentle eyes, mature soft oval face,
calm warm smile, affectionate gaze, quiet welcoming expression,

gold cacao bean brooch, thin gold chain, one brown leather glove,
ivory dress shirt, dark brown double breasted vest,
chocolate brown long apron, gold buttons, neatly folded sleeves,
tailored chocolatier uniform, elegant but practical outfit,

holding a small gold dessert tong,
presenting an open box of glossy bonbon chocolates,
chocolate mold on the counter, premium handmade chocolate,

straight posture, graceful hands, quiet artisan mood,
luxury chocolate salon, dark green walls, polished wooden counter,
framed dessert paintings, warm golden lighting, cozy glow, soft bokeh,

upper body portrait, anime illustration, highly detailed,
soft shading, beautiful lighting, depth of field
```

### Negative Prompt

```text
1girl, female, woman,
teenage boy, child, old man, beard, mustache,
long hair, messy wolf cut, ponytail, twin tails,
round childish face, overly cute face,
angry expression, frown, scowl, gloomy face, cold stare,
evil smile, arrogant smirk, emotionless face,
crown, royal cape, military uniform, armor, weapon,
chef hat, tall hat, dirty apron,
dark fantasy, horror, monster, demon, blood,
low quality, worst quality, blurry, bad anatomy, bad hands,
extra fingers, missing fingers, deformed fingers,
watermark, text, logo, signature
```

---

## 루카

수석 파티시에. 26세. 천재 제과사. 장난기가 많고 분위기 메이커다.

### 외형 설정

- 헤어스타일: 짧고 폭신한 strawberry blond, 둥근 fluffy crop, 위쪽으로 살짝 튀는 ahoge, 흐트러진 앞머리
- 악세사리: 딸기 모양 핀, 빨간 체크 손수건, 작은 별 모양 설탕 장식 핀
- 의상: 흰 파티시에 재킷, 비대칭 단추, 짧은 크림색 waist apron, 빨간 neckerchief
- 분위기: 장난스러운 천재, 밝은 에너지, 디저트 페어의 중심
- 차별점: 가장 활동적이고 귀여운 인상, 포즈에 움직임이 있음

### Prompt

```text
masterpiece, best quality, absurdres,
1boy, solo, male focus,
playful young pastry chef, genius patissier, lively cafe mood,

distinct character design,
short fluffy strawberry blond hair, round fluffy crop haircut,
small ahoge, tousled airy bangs, bouncy hair silhouette,
light green eyes, large sparkling eyes, youthful round face,
wide cheerful smile, teasing but kind expression, bright friendly gaze,

strawberry hairpin, red check handkerchief, tiny sugar star pin,
white patissier jacket with asymmetric buttons,
short cream waist apron, red neckerchief, rolled up sleeves,
cute professional pastry uniform, light energetic outfit,

holding a piping bag in one hand,
small spatula in the other hand,
strawberry shortcake with whipped cream, fresh strawberries,
cream bowl, sugar decorations, cake display case,

slightly leaning forward, playful pose, lively hands,
luxury dessert cafe kitchen corner, dark green walls, wooden shelves,
warm golden lighting, cozy glow, soft bokeh,

upper body portrait, anime illustration, highly detailed,
soft shading, beautiful lighting, depth of field
```

### Negative Prompt

```text
1girl, female, woman,
old man, beard, mustache, mature stern man,
long straight hair, center parted long hair, ponytail,
silver hair, black hair, dark brown hair,
calm stoic pose, emotionless face, gloomy face, cold stare,
angry expression, frown, scowl,
formal suit, royal outfit, military uniform, armor, weapon,
large chef hat, dirty apron, dark horror mood,
low quality, worst quality, blurry, bad anatomy, bad hands,
extra fingers, missing fingers, deformed fingers,
watermark, text, logo, signature
```

---

## 노아

홍차 소믈리에. 30세. 손님의 기분만 보고 어울리는 차를 고른다. 모두의 고민 상담을 맡는 침착한 인물.

### 외형 설정

- 헤어스타일: 애쉬 그레이, 긴 앞머리를 7:3으로 넘긴 sleek side swept hair, 뒷머리는 목덜미를 살짝 덮는 short nape length
- 악세사리: 얇은 silver rim glasses, 찻잎 모양 타이핀, 얇은 시계줄
- 의상: 네이비 롱 베스트, 흰 셔츠, 회색 cravat, 긴 소매, 포멀한 tea sommelier uniform
- 분위기: 지적인 상담자, 고요한 안정감, 홍차 향이 느껴지는 인물
- 차별점: 가장 차분하고 성숙함, 안경과 긴 실루엣으로 구분

### Prompt

```text
masterpiece, best quality, absurdres,
1boy, solo, male focus,
adult tea sommelier, calm counselor, intelligent mature charm,

distinct character design,
ash gray hair, sleek side swept hair, long 7:3 bangs,
short nape length hair, smooth elegant hair silhouette,
thin silver rim glasses, deep navy eyes behind glasses,
long narrow face, calm mature features, gentle tired eyes,
peaceful smile, reassuring expression, relaxed warm gaze,

tea leaf tie pin, slim wristwatch, thin silver chain,
white dress shirt, navy long vest, gray cravat,
formal tea sommelier uniform, long clean sleeves,
elegant tailored outfit, quiet intellectual style,

holding a porcelain teacup near his chest,
silver teapot, tea leaves tin, afternoon tea tray,
gentle steam from black tea, macarons on saucer,

upright still posture, one hand calmly supporting saucer,
luxury tea salon corner, dark green walls, wooden table,
framed paintings, warm golden lighting, cozy glow, soft bokeh,

upper body portrait, anime illustration, highly detailed,
soft shading, beautiful lighting, depth of field
```

### Negative Prompt

```text
1girl, female, woman,
child, teenage boy, old man, beard, mustache,
fluffy crop hair, ahoge, messy wild hair, very short buzz cut,
no glasses, sunglasses, eyepatch,
wide childish grin, playful teasing face, angry expression,
frown, scowl, gloomy face, cold hostile stare,
chef jacket, apron, barista apron, royal cape, crown,
weapon, armor, dark fantasy, horror, monster, demon, blood,
low quality, worst quality, blurry, bad anatomy, bad hands,
extra fingers, missing fingers, deformed fingers,
watermark, text, logo, signature
```

---

## 카엘

플로리스트. 계절마다 카페를 꾸미고 꽃말을 좋아한다. 손님에게 꽃을 추천해 준다.

### 외형 설정

- 헤어스타일: pale sage green hair, 짧은 textured crop, 자연스럽게 헝클어진 앞머리, 귀와 목선이 드러나는 남성형 짧은 머리
- 악세사리: 말린 꽃 펜던트, 작은 brass leaf pin, 앞치마 벨트에 꽂은 꽃가위, 손목의 얇은 leather cord
- 의상: 크림색 band collar shirt, 세이지 그린 canvas florist vest, 카키색 utility apron, 꽃가위 holster, 작은 작업용 포켓
- 분위기: 맑고 섬세하지만 실무적인 플로리스트, 손님에게 꽃을 골라주는 온화한 청년
- 차별점: 짧은 머리와 작업복 실루엣으로 남성 플로리스트처럼 보이게 함, 리본과 보브컷을 쓰지 않음

### Prompt

```text
masterpiece, best quality, absurdres,
1boy, solo, male focus,
young male florist, gentle flower shop artisan, practical botanical cafe mood,

distinct character design,
pale sage green hair, short textured crop haircut,
messy natural bangs, exposed ears, visible nape, masculine short hair silhouette,
clear violet eyes, gentle eyes, slim youthful male face,
fresh bright smile, tender expression, calm welcoming gaze,

brass leaf pin, dried flower pendant, thin leather cord bracelet,
cream band collar shirt, sage green canvas florist vest,
khaki utility apron, apron belt, pruning shears holster,
small work pockets, practical florist workwear, clean botanical uniform,

holding a hand-tied seasonal bouquet at waist level,
lavender flowers, pale roses, small wildflowers, kraft paper wrap,
twine string, flower basket on the counter, pruning shears, fresh petals,

standing upright, relaxed professional pose, one hand adjusting flower stems,
luxury dessert cafe decorated with flowers,
dark green walls, wooden furniture, window light,
warm golden lighting, cozy glow, soft bokeh,

upper body portrait, anime illustration, highly detailed,
soft shading, beautiful lighting, depth of field
```

### Negative Prompt

```text
1girl, female, woman,
old man, beard, mustache, muscular body,
long hair, bob haircut, twin braids, side braid, braided pigtails,
hair ribbon, big ribbon, flower crown, lace blouse, frilly blouse,
dress, skirt, puff sleeves, wide flowing sleeves,
black hair, silver hair, dark brown hair, slick back hair,
sharp masculine face, rugged face, stern mature face,
angry expression, frown, scowl, gloomy face, cold stare,
creepy smile, vacant eyes, crying,
crown, royal cape, military uniform, armor, weapon,
funeral flowers, thorn crown, horror mood,
dirty apron, barista apron, chef jacket,
low quality, worst quality, blurry, bad anatomy, bad hands,
extra fingers, missing fingers, deformed fingers,
watermark, text, logo, signature
```

---

## 리온

바리스타. 커피 챔피언 출신. 무뚝뚝하지만 커피만큼은 누구보다 진심이다.

### 외형 설정

- 헤어스타일: 짧은 블랙 wolf cut, 거친 레이어, 한쪽 눈썹을 살짝 가리는 앞머리, 뒷머리는 짧게 삐침
- 악세사리: 작은 copper ear cuff, 가죽 팔찌, 앞치마의 heart latte pin
- 의상: 검은 셔츠, espresso brown cross-back leather apron, 구리색 버클, 소매는 팔꿈치까지 걷음
- 분위기: 무뚝뚝하지만 믿음직함, 커피 장인의 집중력, 따뜻한 침묵
- 차별점: 가장 어둡고 직선적인 실루엣, 손과 도구가 강하게 보임

### Prompt

```text
masterpiece, best quality, absurdres,
1boy, solo, male focus,
stoic barista, champion coffee artisan, quiet sincere charm,

distinct character design,
short black wolf cut, rough layered hair,
bangs partly covering one eyebrow, short spiky nape,
sharp dark hair silhouette,
deep coffee brown eyes, low focused eyes, straight brows,
slightly angular face, calm reliable features,
subtle warm smile, quiet friendly expression, trustworthy gaze,

small copper ear cuff, leather bracelet, heart latte pin,
black shirt, espresso brown cross-back leather apron,
copper buckles, sleeves rolled to elbows,
practical barista uniform, dark coffee color palette,

holding a latte art cup with heart foam,
portafilter in the other hand, roasted coffee beans,
copper drip kettle, espresso machine, warm coffee steam,

leaning against wooden bar counter, steady working pose,
luxury dessert cafe barista counter, dark green walls,
polished wood, coffee equipment, warm golden lighting, soft bokeh,

upper body portrait, anime illustration, highly detailed,
soft shading, beautiful lighting, depth of field
```

### Negative Prompt

```text
1girl, female, woman,
child, old man, beard, mustache,
fluffy blond hair, pastel hair, silver hair, long elegant hair,
round cute face, overly delicate floral look,
wide cheerful grin, playful pose, shy flower pose,
angry expression, frown, scowl, gloomy face, hostile stare,
formal suit, navy long vest, chef jacket, royal cape, crown,
weapon, armor, cigarette, alcohol bottle, blood,
dark fantasy, horror, monster, demon,
low quality, worst quality, blurry, bad anatomy, bad hands,
extra fingers, missing fingers, deformed fingers,
watermark, text, logo, signature
```

---

## 시온

홀 매니저. 예약과 손님 응대를 담당한다. 카페의 모든 일을 파악하고 있는 해결사.

### 외형 설정

- 헤어스타일: platinum silver hair, 깔끔한 short undercut, 앞머리는 사선으로 정리, 전체 실루엣은 가장 정돈됨
- 악세사리: silver monocle chain이 아니라 얇은 rectangular glasses, 회중시계 체인, 예약용 만년필
- 의상: 검은 fitted vest, 와인 레드 ribbon tie, 흰 셔츠, silver cufflinks, 짧은 black waist apron
- 분위기: 유능한 매니저, 빠르고 정확한 접객, 친절하지만 빈틈없는 해결사
- 차별점: 가장 세련되고 날카로운 인상, 왕족이 아니라 서비스 전문가처럼 보이게 함

### Prompt

```text
masterpiece, best quality, absurdres,
1boy, solo, male focus,
polished hall manager, professional dessert salon host, precise elegant service,

distinct character design,
platinum silver hair, neat short undercut,
diagonal side bangs, clean sharp hair silhouette,
thin rectangular glasses, wine red eyes, attentive sharp eyes,
balanced slim face, polished handsome features,
professional warm smile, polite composed expression, alert friendly gaze,

thin rectangular glasses, silver cufflinks, pocket watch chain,
white dress shirt, fitted black vest, wine red ribbon tie,
short black waist apron, silver buttons,
neat formal cafe service uniform, clean modern victorian style,

holding an open reservation book,
fountain pen between fingers, dessert menu tucked under arm,
small pocket watch, reception desk, guest list,

straight precise posture, one hand gesturing politely,
luxury dessert cafe front hall, reservation desk,
dark green walls, framed dessert paintings, wooden furniture,
gift boxes, warm golden lighting, cozy glow, soft bokeh,

upper body portrait, anime illustration, highly detailed,
soft shading, beautiful lighting, depth of field
```

### Negative Prompt

```text
1girl, female, woman,
old man, beard, mustache, child,
long silver hair, messy long hair, fluffy blond hair,
soft childish face, overly cute round face,
angry expression, frown, scowl, gloomy face, cold stare,
evil smile, arrogant smirk, villain face,
crown, tiara, royal cape, prince outfit, emperor outfit,
military uniform, epaulettes, armor, weapon,
tea sommelier cravat, barista leather apron, chef jacket,
dark fantasy, horror, monster, demon, blood,
low quality, worst quality, blurry, bad anatomy, bad hands,
extra fingers, missing fingers, deformed fingers,
watermark, text, logo, signature
```

---

## 단체 키 비주얼

### Prompt

```text
masterpiece, best quality, absurdres,
6boys, male focus, visual novel key visual,
six distinct male cafe staff members, each character has a different silhouette,

calm dark brown side-parted chocolatier with gold cacao brooch,
playful strawberry blond fluffy pastry chef with red neckerchief,
mature ash gray tea sommelier with silver rim glasses and navy long vest,
young sage green short-haired male florist with canvas vest and pruning shears,
stoic black wolf-cut barista with copper ear cuff and leather apron,
polished platinum silver undercut hall manager with rectangular glasses and reservation book,

standing together behind a luxury dessert cafe counter,
different hairstyles, different accessories, different uniforms, different poses,
warm smiles, friendly expressions, gentle romantic atmosphere,

bonbon chocolate box, strawberry shortcake, porcelain teacup,
seasonal bouquet, latte art cup, reservation book,
dark green walls, framed dessert paintings, wooden furniture,
dessert display case, teddy bear, gift box,
warm golden lighting, cozy glow, soft bokeh,

anime illustration, highly detailed, soft shading, beautiful lighting
```

### Negative Prompt

```text
same face, identical faces, same hairstyle, same outfit,
cloned characters, indistinguishable characters,
1girl, female, woman,
old men, beards, muscular bodies,
angry expressions, frowns, gloomy faces, cold stares,
evil smiles, hostile expressions, emotionless faces,
crowns, royal capes, prince outfits, military uniforms,
armor, weapons, blood, dark fantasy, horror, monsters, demons,
low quality, worst quality, blurry, bad anatomy, bad hands,
extra fingers, missing fingers, deformed fingers,
watermark, text, logo, signature
```
