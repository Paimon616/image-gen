# 슈크레 노엘 등장인물 이미지 생성 프롬프트

기준 키 아트: `377fd8b3-7ade-4d2e-840f-51974a6d4a90.png`

공통 스타일은 따뜻한 프리미엄 디저트 살롱, 여성향 BL, 힐링 일상, 슬로우 로맨스 분위기를 따른다. 전체 캐릭터는 같은 작품의 스탠딩 일러스트처럼 통일하고, 과장된 다크 판타지나 전투 요소는 배제한다.

## 공통 생성 설정

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
  "seed": "character별로 변경 권장",
  "loras": [
    { "path": "5byue5dnijistyleE291.cNux.safetensors", "scale": 0.8 },
    { "path": "USNR STYLE_XL_lokr.safetensors", "scale": 0.6 },
    { "path": "DemonerithIllustrious.safetensors", "scale": 0.5 },
    { "path": "nnestyle.safetensors", "scale": 0.3 },
    { "path": "Pb0y.safetensors", "scale": 0.4 }
  ]
}
```

## 공통 Positive Prompt Prefix

```text
masterpiece, best quality, absurdres,
1boy, solo,
beautiful boy, pretty boy, bishounen, male focus,
young man, elegant male, charming male,
looking at viewer,
anime illustration, highly detailed, soft shading, beautiful lighting,
warm lighting, golden lighting, cozy atmosphere, soft glow, depth of field,
luxury dessert cafe, parfait cafe, elegant cafe, victorian cafe,
dark green walls, wooden furniture, framed dessert paintings,
upper body, character portrait
```

## 공통 Negative Prompt

```text
1girl,
female,
woman,
mature woman,
old man,
beard,
muscular,
bodybuilder,
sharp jawline,
extreme jawline,
dark fantasy,
horror,
monster,
demon,
dragon,
gothic horror,
battle,
weapon,
armor,
blood,
long hair,
ponytail,
twin tails,
dress,
skirt,
low quality,
worst quality,
blurry,
bad anatomy,
extra fingers,
watermark,
text,
logo,
signature
```

---

## 에리안

오너 쇼콜라티에. 28세. 세계 초콜릿 대회 우승자. 조용하고 다정하며 감정을 초콜릿으로 표현한다.

### Character Direction

- 키워드: 조용함, 다정함, 깊은 집중, 고급 초콜릿, 오너의 품격
- 인상: 부드럽고 어른스러운 미남, 차분한 눈빛, 절제된 미소
- 컬러: 다크 초콜릿 브라운, 아이보리, 골드
- 소품: 봉봉 쇼콜라, 초콜릿 몰드, 작은 금색 집게, 고급 초콜릿 박스

### Positive Prompt

```text
masterpiece, best quality, absurdres,
1boy, solo,
beautiful boy, pretty boy, bishounen, male focus,
young man, elegant male, refined male,
calm expression, gentle eyes, soft smile, looking at viewer,

owner chocolatier,
short dark brown hair, soft neatly styled hair,
warm amber eyes,

ivory shirt,
dark chocolate brown vest,
gold buttons,
silk necktie,
chocolatier apron,
small brooch,
elegant cafe uniform,

holding bonbon chocolate,
assorted chocolate box,
chocolate mold,
gold dessert tong,

luxury dessert cafe,
premium chocolate salon,
dark green walls,
wooden counter,
framed dessert paintings,
warm lighting,
golden lighting,
cozy atmosphere,
soft glow,

upper body,
anime illustration,
highly detailed,
soft shading,
beautiful lighting,
depth of field
```

---

## 루카

수석 파티시에. 26세. 천재 제과사. 장난기가 많고 분위기 메이커지만 플레이어를 가장 많이 챙겨준다.

### Character Direction

- 키워드: 천재성, 장난기, 밝은 에너지, 크림과 과일 디저트
- 인상: 활달하고 사랑스러운 미남, 놀리는 듯한 미소
- 컬러: 크림 화이트, 딸기 레드, 파스텔 민트
- 소품: 짤주머니, 딸기 쇼트케이크, 크림 볼, 작은 스패출러

### Positive Prompt

```text
masterpiece, best quality, absurdres,
1boy, solo,
beautiful boy, pretty boy, bishounen, male focus,
young man, cute male, lively male,
playful expression, teasing smile, bright eyes, looking at viewer,

head pastry chef,
short fluffy strawberry blond hair,
messy soft hair,
light green eyes,

white pastry chef jacket,
cream colored apron,
red ribbon accent,
gold buttons,
rolled up sleeves,

holding piping bag,
strawberry shortcake,
whipped cream,
fresh strawberries,
small spatula,

luxury dessert cafe,
pastry kitchen corner,
cute cafe,
elegant cafe,
dark green walls,
wooden furniture,
warm lighting,
golden lighting,
cozy atmosphere,
soft glow,

upper body,
anime illustration,
highly detailed,
soft shading,
beautiful lighting,
depth of field
```

---

## 노아

홍차 소믈리에. 30세. 손님의 기분만 보고 어울리는 차를 고르며, 모두의 고민 상담을 맡는 침착한 인물.

### Character Direction

- 키워드: 침착함, 상담자, 홍차 향, 성숙한 안정감
- 인상: 차분하고 지적인 미남, 낮고 부드러운 시선
- 컬러: 얼그레이 그레이, 네이비, 브라스 골드
- 소품: 찻잔, 티포트, 찻잎 틴, 애프터눈 티 세트

### Positive Prompt

```text
masterpiece, best quality, absurdres,
1boy, solo,
beautiful boy, pretty boy, bishounen, male focus,
young man, elegant male, intellectual male,
calm expression, serene eyes, gentle smile, looking at viewer,

tea sommelier,
short ash gray hair,
neatly parted hair,
deep navy eyes,

white shirt,
navy vest,
brass buttons,
gray cravat,
elegant cafe uniform,
thin chain accessory,

holding porcelain teacup,
silver teapot,
tea leaves tin,
afternoon tea set,
steam from tea,

luxury dessert cafe,
victorian cafe,
tea salon atmosphere,
dark green walls,
wooden table,
framed dessert paintings,
warm lighting,
golden lighting,
cozy atmosphere,
soft glow,

upper body,
anime illustration,
highly detailed,
soft shading,
beautiful lighting,
depth of field
```

---

## 카엘

플로리스트. 계절마다 카페를 꾸미고 꽃말을 좋아한다. 손님에게 어울리는 꽃을 추천해 준다.

### Character Direction

- 키워드: 계절감, 꽃말, 섬세함, 부드러운 낭만
- 인상: 맑고 섬세한 미남, 살짝 수줍은 미소
- 컬러: 세이지 그린, 라벤더, 크림
- 소품: 계절 꽃다발, 리본, 작은 꽃가위, 꽃 장식 바구니

### Positive Prompt

```text
masterpiece, best quality, absurdres,
1boy, solo,
beautiful boy, pretty boy, bishounen, male focus,
young man, elegant male, delicate male,
soft expression, gentle eyes, shy smile, looking at viewer,

florist,
short soft lavender hair,
slightly wavy hair,
clear violet eyes,

cream shirt,
sage green vest,
floral embroidered apron,
lavender ribbon tie,
small flower brooch,

holding seasonal flower bouquet,
roses,
small wildflowers,
ribbon,
flower basket,
tiny flower scissors,

luxury dessert cafe,
elegant cafe,
cafe decorated with flowers,
dark green walls,
wooden furniture,
framed dessert paintings,
warm lighting,
golden lighting,
cozy atmosphere,
soft glow,

upper body,
anime illustration,
highly detailed,
soft shading,
beautiful lighting,
depth of field
```

---

## 리온

바리스타. 커피 챔피언 출신. 무뚝뚝하지만 커피만큼은 누구보다 진심이다.

### Character Direction

- 키워드: 무뚝뚝함, 장인정신, 커피 향, 깊은 집중
- 인상: 말수는 적지만 신뢰감 있는 미남, 진지한 눈빛
- 컬러: 에스프레소 브라운, 블랙, 구리색
- 소품: 라떼 아트 컵, 포터필터, 커피 원두, 구리색 드립포트

### Positive Prompt

```text
masterpiece, best quality, absurdres,
1boy, solo,
beautiful boy, pretty boy, bishounen, male focus,
young man, cool male, elegant male,
stoic expression, serious eyes, subtle smile, looking at viewer,

barista,
short black hair,
slightly tousled hair,
dark coffee brown eyes,

black shirt,
espresso brown apron,
copper buttons,
rolled up sleeves,
simple tie,

holding latte art cup,
portafilter,
coffee beans,
copper drip kettle,
espresso machine,

luxury dessert cafe,
barista counter,
elegant cafe,
dark green walls,
wooden counter,
framed dessert paintings,
warm lighting,
golden lighting,
cozy atmosphere,
soft glow,

upper body,
anime illustration,
highly detailed,
soft shading,
beautiful lighting,
depth of field
```

---

## 시온

홀 매니저. 예약과 손님 응대를 담당한다. 카페의 모든 일을 파악하고 있는 해결사.

### Character Direction

- 키워드: 유능함, 정돈됨, 해결사, 세련된 접객
- 인상: 깔끔하고 빈틈없는 미남, 친절하지만 예리한 눈빛
- 컬러: 와인 레드, 블랙, 화이트, 실버
- 소품: 예약 장부, 만년필, 메뉴판, 작은 회중시계

### Positive Prompt

```text
masterpiece, best quality, absurdres,
1boy, solo,
beautiful boy, pretty boy, bishounen, male focus,
young man, elegant male, polished male,
composed expression, sharp gentle eyes, professional smile, looking at viewer,

hall manager,
short silver hair,
neatly styled hair,
wine red eyes,

white shirt,
black vest,
wine red ribbon tie,
silver buttons,
elegant cafe uniform,
small pocket watch chain,

holding reservation book,
fountain pen,
dessert menu,
guest list,

luxury dessert cafe,
front hall,
reservation desk,
elegant cafe,
victorian cafe,
dark green walls,
wooden furniture,
framed dessert paintings,
warm lighting,
golden lighting,
cozy atmosphere,
soft glow,

upper body,
anime illustration,
highly detailed,
soft shading,
beautiful lighting,
depth of field
```

---

## 단체 키 비주얼용 Prompt

```text
masterpiece, best quality, absurdres,
6boys,
beautiful boys, pretty boys, bishounen, male focus,
elegant male characters,

premium dessert salon staff,
owner chocolatier, head pastry chef, tea sommelier, florist, barista, hall manager,

standing together behind dessert cafe counter,
warm smiles,
gentle romantic atmosphere,
slow romance visual novel key visual,

bonbon chocolates,
strawberry shortcake,
porcelain teacups,
seasonal flower bouquet,
latte art,
reservation book,

luxury dessert cafe,
parfait cafe,
elegant cafe,
victorian cafe,
dark green walls,
framed dessert paintings,
wooden furniture,
teddy bear,
gift box,
warm lighting,
golden lighting,
cozy atmosphere,
soft glow,
depth of field,

anime illustration,
highly detailed,
soft shading,
beautiful lighting
```
