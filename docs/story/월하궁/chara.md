# 황실 전속 화가가 너무 많은 비밀을 그려버렸습니다 - 등장인물 이미지 생성 프롬프트

원본: `docs/story/월하궁/스토리.md`

기준 키 아트: `9f570a3c-5082-49f2-b3ec-23e9ae998af6.png`

목표는 조선 대체역사 궁중 로맨스 판타지의 화려한 한복 질감과 키 아트의 세로형 anime illustration 톤을 유지하면서, 각 인물이 초상화의 모델로서 뚜렷한 개성을 갖도록 만드는 것이다. 이번 스토리의 핵심은 `황실 전속 화가`, `황실어진첩`, `초상화 의뢰`, `그림에만 남는 비밀`이므로 각 prompt는 복식뿐 아니라 인물이 그림 앞에서만 드러내는 표정과 포즈를 강하게 반영했다.

키 아트 메타데이터에는 `Incoming-Slash`, `sword`, `chicken focus`가 포함되어 있지만, 이 문서는 궁중 초상화와 화실 중심의 캐릭터 프롬프트이므로 해당 액션 태그는 강무진의 변형 컷을 제외하고 기본 prompt에서 제외한다.

## 권장 생성 설정

```json
{
  "model": "comfyui/local-sdxl",
  "model_name": "oneObsession_15Noobai.safetensors",
  "num_inference_steps": 35,
  "guidance_scale": 4,
  "width": 1216,
  "height": 1824,
  "sampler_name": "euler_ancestral",
  "scheduler": "normal",
  "clip_skip": 2,
  "upscale_model_name": "remacri_original.safetensors",
  "loras": [
    { "path": "Hanbok-V2.safetensors", "scale": 0.7 }
  ]
}
```

개성 확인용 1차 테스트에서는 `Hanbok-V2.safetensors`를 `0.55-0.65`로 낮춰 얼굴과 실루엣 차이를 먼저 확인한다. 완성 컷에서는 `0.7`로 올려 한복 디테일을 강화한다.

## 공통 스타일

### 공통 Positive Prompt

```text
<lora:cfg_scale_boost:0.4>, hanbok, song style outfits, <lora:hanbokSong_v31:0.7>,
masterpiece, best quality, amazing quality, absurdres, newest, very aesthetic, highres,
solo, single character, elegant alternate Joseon romance fantasy,
imperial palace portrait model, royal art studio atmosphere,
richly detailed Korean hanbok, layered jeogori and durumagi, embroidered silk,
ornamental norigae, refined court accessories, expressive eyes,
delicate facial features, graceful hands, polished anime illustration,
cinematic palace lighting, soft depth of field, upper body portrait,
three-quarter view, clean single character composition
```

### 공통 Negative Prompt

```text
worst quality, normal quality, low quality, blurry,
anatomical nonsense, bad anatomy, bad hands, interlocked fingers,
extra fingers, missing fingers, deformed fingers, distorted face,
watermark, text, logo, signature, simple background, transparent,
face backlighting, backlighting, duplicate character, same face,
same hairstyle, same outfit, modern casual clothes, western suit,
sci-fi, cyberpunk, school uniform, child, underage,
overly revealing clothes, excessive gore, horror
```

---

## 플레이어 - 황실 전속 화가

국왕의 명으로 궁에 들어온 조선 최초의 황실 전속 화가. 왕실의 초상화와 궁중 행사를 그림으로 남기며, 누구보다 오래 사람의 얼굴을 바라보기 때문에 가장 많은 비밀을 알게 된다.

### 외형 설정

- 헤어스타일: 짙은 흑갈색 긴 머리, 낮게 묶은 low bun, 붓끝처럼 내려오는 옆머리, 작업 중 흘러내리지 않게 단정히 정리된 실루엣
- 악세사리: 먹빛 비녀, 작은 붓 모양 은장식, 물감이 묻은 손수건, 옥색 매듭 노리개, 얇은 화첩 끈
- 의상: 연한 아이보리 저고리, 먹색 치마, 옅은 청록색 배자, 소매 끝의 구름과 붓결 자수, 화실 작업에 맞춘 고급 실무형 한복
- 소품: 미완성 화첩, 세필 붓, 먹 접시, 작은 안료함
- 분위기: 조용한 관찰자, 따뜻하지만 예리한 시선, 그림 속에 비밀을 남기는 사람
- 차별점: 왕족도 궁녀도 아닌 예술가의 복식. 붓, 안료, 화첩이 반드시 보여야 한다.

### Positive Prompt

```text
<lora:cfg_scale_boost:0.4>, hanbok, song style outfits, <lora:hanbokSong_v31:0.7>,
masterpiece, best quality, amazing quality, absurdres,
1girl, solo, adult woman, female focus,
first imperial court painter of alternate Joseon,
royal portrait artist, quiet observer who knows too many secrets,
gentle but sharp artistic gaze, dignified non-royal heroine,

distinct character design,
deep black brown long hair, low bun hairstyle,
soft side locks like brush strokes, neat practical hair silhouette,
dark intelligent eyes, calm oval face, subtle unreadable smile,
observant expression, warm yet piercing gaze,

ink black binyeo hairpin, tiny silver brush ornament,
paint-stained handkerchief, jade green knot norigae,
thin sketchbook cord, ivory jeogori, ink black chima,
pale teal baeja vest, cloud and brushstroke embroidery on sleeve cuffs,
elegant practical artist hanbok, refined palace workshop clothing,

holding a fine portrait brush and unfinished royal sketchbook,
small pigment box, ink dish, silk paper, wooden painting board,
imperial art studio of Dohwaseo, folding screens and portrait scrolls,
warm candlelight, quiet night atelier, soft depth of field,
upper body portrait, three-quarter view, polished anime illustration
```

### Negative Prompt

```text
court lady uniform only, maid outfit, princess crown, queen, royal robe,
warrior armor, sword, fan dancer, bridal veil, excessive jewelry,
modern painter smock, western beret, camera, male, old woman,
child, underage, aggressive expression, multiple characters,
low quality, worst quality, bad anatomy, bad hands, extra fingers,
text, watermark, logo, signature
```

---

## 이도 - 왕세자

다음 국왕이 될 인물. 사람들 앞에서는 완벽하지만, 플레이어 앞에서만 긴장을 내려놓고 진짜 표정을 보여준다.

### 외형 설정

- 헤어스타일: 윤기 있는 흑발, 단정한 상투, 왕세자용 익선관, 흐트러짐 없는 왕실 실루엣
- 악세사리: 옥잠, 금실 흉배 장식, 붉은 허리띠, 왕세자 인장 끈
- 의상: 깊은 홍색 곤룡포풍 한복, 금룡 자수, 검은 동정, 넓고 무거운 소매
- 소품: 초상화 모델용 옥좌, 반쯤 접힌 교서, 아직 쓰지 않은 왕관 받침
- 분위기: 완벽한 차기 군주와 불안한 청년이 공존. 플레이어 앞에서만 미세하게 긴장을 푼 표정
- 차별점: 가장 왕실적이며 붉은색과 금룡 자수가 중심

### Positive Prompt

```text
<lora:cfg_scale_boost:0.4>, hanbok, song style outfits, <lora:hanbokSong_v31:0.7>,
masterpiece, best quality, amazing quality, absurdres,
1boy, solo, adult man, male focus,
crown prince of a powerful alternate Joseon empire,
perfect royal heir sitting for an official portrait,
composed in public, quietly vulnerable before the painter,

distinct character design,
glossy black hair in neat sangtu topknot, small royal ikseongwan,
jade hairpin, clean noble hairline, deep warm brown eyes,
handsome calm face, restrained anxiety beneath a gentle expression,
softened gaze that only the painter can see,

deep crimson royal hanbok, crown prince gonryongpo inspired robe,
gold dragon embroidery on chest roundel, black collar trim,
wide formal sleeves, red silk belt, jade royal ornament,
layered ceremonial silk, dignified palace clothing,

seated beside a low royal portrait chair,
holding a half-folded royal decree, crown stand behind him,
imperial portrait studio, golden folding screen, palace lanterns,
warm ceremonial light, quiet tension, soft depth of field,
upper body portrait, three-quarter view, polished anime illustration
```

### Negative Prompt

```text
old king, beard, mustache, huge emperor crown, western prince suit,
full armor, helmet, sword attack pose, villain grin, arrogant smirk,
messy hair, casual clothes, childish face, female, child, underage,
multiple characters, low quality, worst quality, bad anatomy,
bad hands, extra fingers, text, watermark, logo, signature
```

---

## 강무진 - 금군 별장

왕실을 지키는 무관. 흉터가 많은 몸을 아무에게도 보여주지 않지만, 초상화를 위해서는 갑옷을 벗어야 한다.

### 외형 설정

- 헤어스타일: 짧게 묶은 흑발, 높은 상투, 굵은 앞머리, 목선이 드러나는 무관 실루엣
- 악세사리: 검은 갓끈, 붉은 호패, 가죽 손목 보호대, 낡은 검집 끈
- 의상: 갑옷을 벗은 상태의 짙은 남색 철릭, 붉은 소매 안감, 단단한 가죽 허리띠, 어깨와 쇄골 근처에 보이는 희미한 흉터
- 소품: 벗어 둔 흉갑, 옆에 세워 둔 환도, 초상화용 낮은 의자
- 분위기: 과묵한 호위자, 드러내기 싫은 상처를 감추려는 긴장, 플레이어에게만 허락한 취약함
- 차별점: 전투 장면보다 갑옷을 벗은 초상화 모델의 긴장감을 강조

### Positive Prompt

```text
<lora:cfg_scale_boost:0.4>, hanbok, song style outfits, <lora:hanbokSong_v31:0.7>,
masterpiece, best quality, amazing quality, absurdres,
1boy, solo, adult man, male focus,
royal guard commander of alternate Joseon,
stoic warrior sitting for a private portrait without armor,
guarded vulnerability, disciplined protective presence,
strong athletic build,

distinct character design,
black hair tied in firm high sangtu, short rugged bangs,
exposed nape, strong jawline, sharp dark eyes,
stern calm expression, protective gaze, broad shoulders,
subtle old scars near collarbone and forearm,

black gat strings, red wooden hopae badge, leather wrist guards,
dark navy cheollik hanbok, red inner sleeve lining,
firm leather waist belt, slightly loosened collar,
armor removed, practical royal guard clothing,

removed breastplate resting beside him, sheathed hwando sword nearby,
portrait chair in a quiet military chamber, night patrol lantern,
palace stone wall and folding screen, cool moonlight and warm candlelight,
one hand gripping his sleeve, controlled tension, soft depth of field,
upper body portrait, three-quarter view, polished anime illustration
```

### Negative Prompt

```text
full plate armor, helmet covering face, giant sword, incoming slash,
blood, gore, berserker rage, monster, villain smile, crown,
scholar robe, doctor tools, painter palette, merchant fan,
thin fragile body, child, underage, female, multiple characters,
low quality, worst quality, bad anatomy, bad hands, extra fingers,
text, watermark, logo, signature
```

### Action Variant Prompt

강무진만 키 아트의 `sword` 계열 액션을 일부 활용할 수 있다.

```text
incoming attack pose, holding sword, holding weapon,
royal guard commander in dark navy cheollik hanbok,
dynamic sword practice in palace training yard,
no blood, no gore, visible face, elegant Joseon martial movement
```

---

## 윤서진 - 규장각 부제학

젊은 개혁가. 초상화보다 사람의 마음을 읽는 플레이어에게 흥미를 느끼며, 세상을 바꾸고 싶다는 속마음을 조심스럽게 드러낸다.

### 외형 설정

- 헤어스타일: 검푸른 흑발, 매끈한 옆가르마, 낮은 상투, 한 올도 흐트러지지 않은 문신형 실루엣
- 악세사리: 청옥 갓끈, 얇은 서책 끈, 작은 옥패, 붓글씨가 적힌 개혁 상소
- 의상: 청색과 백색 중심의 도포, 가는 학문 자수, 흰 동정, 반듯한 허리띠
- 소품: 규장각 서책, 접힌 상소문, 외국 문물 기록지
- 분위기: 예의 바른 천재 관료, 조용한 개혁가, 속을 알 수 없는 미소
- 차별점: 정치가의 침착함보다 학자 개혁가의 날카로운 지성을 강조

### Positive Prompt

```text
<lora:cfg_scale_boost:0.4>, hanbok, song style outfits, <lora:hanbokSong_v31:0.7>,
masterpiece, best quality, amazing quality, absurdres,
1boy, solo, adult man, male focus,
young Gyujanggak deputy scholar and reformist,
interested in the painter who reads hearts through portraits,
polite unreadable smile, calm strategic intelligence,

distinct character design,
blue black hair, sleek side parted hair, low sangtu,
perfectly tidy scholar silhouette, narrow dark eyes,
long refined face, composed expression, courteous hidden gaze,

blue jade gat strings, small jade scholar plaque,
thin book cord, folded reform memorial,
white jeogori under deep blue dopo robe,
fine crane and cloud embroidery, crisp white collar,
straight silk belt, elegant official scholar hanbok,

holding a sealed reform petition and old Gyujanggak book,
foreign documents and maps on a low table,
quiet library corridor, lacquered bookcases, bamboo blinds,
cool morning light, restrained intellectual tension,
upper body portrait, three-quarter view, polished anime illustration
```

### Negative Prompt

```text
wild messy hair, playful grin, warrior armor, sword, merchant jewelry,
doctor coat, painter tools, crown, royal robe, modern suit,
angry face, crying, old man, beard, female, child, underage,
multiple characters, low quality, worst quality, bad anatomy,
bad hands, extra fingers, text, watermark, logo, signature
```

---

## 서하진 - 내의원 의원

환자의 표정으로 병을 읽는 의원. 화가인 플레이어와 비슷하게 사람의 얼굴과 미세한 표정을 관찰한다.

### 외형 설정

- 헤어스타일: 부드러운 흑갈색 장발, 낮은 반묶음, 긴 앞머리, 깨끗한 의원 실루엣
- 악세사리: 약향 주머니, 은침 케이스, 연녹색 매듭 노리개, 얇은 손가락 장갑
- 의상: 백색과 연녹색 두루마기, 약초 잎 자수, 깨끗한 넓은 소매, 내의원 표식 허리띠
- 소품: 약재함, 백자 약그릇, 환자의 안색을 기록한 작은 수첩
- 분위기: 온화한 치료자, 표정을 읽는 사람, 다정하지만 비밀을 숨긴 미소
- 차별점: 플레이어와 닮은 관찰자 포지션을 의학적 디테일로 구분

### Positive Prompt

```text
<lora:cfg_scale_boost:0.4>, hanbok, song style outfits, <lora:hanbokSong_v31:0.7>,
masterpiece, best quality, amazing quality, absurdres,
1boy, solo, adult man, male focus,
Naeuiwon royal physician who reads illness from expressions,
gentle doctor with the same observational gaze as a portrait painter,
soft smile with hidden secrets, calm healing presence,

distinct character design,
soft black brown long hair, low half-tied hairstyle,
long side bangs, clean elegant hair silhouette,
pale green eyes, delicate calm face, warm unreadable smile,
slender graceful hands, soothing gaze,

small herbal scent pouch, silver acupuncture needle case,
pale green knot norigae, thin finger gloves,
white jeogori and pale jade green durumagi,
embroidered medicinal leaf patterns, clean wide sleeves,
Naeuiwon physician belt, refined medical court hanbok,

holding a porcelain medicine bowl and a small symptom notebook,
wooden herb drawers, dried medicinal plants, silver needle case,
quiet royal clinic room, paper windows, filtered warm light,
one hand gently offering medicine, soft depth of field,
upper body portrait, three-quarter view, polished anime illustration
```

### Negative Prompt

```text
mad scientist, horror doctor, plague mask, surgical mask covering face,
blood, gore, syringe, modern lab coat, armor, sword, crown,
evil grin, monster, old wizard beard, female, child, underage,
multiple characters, low quality, worst quality, bad anatomy,
bad hands, extra fingers, text, watermark, logo, signature
```

---

## 최연우 - 규장각 검서관

오래된 그림 속 역사와 비밀을 플레이어와 함께 조사한다. 낡은 화첩, 사라진 초상화, 기록화의 배경에 남은 단서를 찾는 인물.

### 외형 설정

- 헤어스타일: 밝은 밤색 짧은 머리, 살짝 헝클어진 앞머리, 책과 그림을 뒤지느라 정돈이 덜 된 실루엣
- 악세사리: 둥근 안경, 작은 서양식 회중시계, 책갈피 끈, 손끝의 잉크와 안료 얼룩
- 의상: 아이보리 저고리, 연갈색 도포, 소매 안쪽의 작은 기하학 자수, 실용적인 책가방
- 소품: 오래된 그림 두루마리, 돋보기, 주석이 가득한 기록지
- 분위기: 호기심 많은 젊은 학자, 비밀을 발견한 설렘, 다정한 조사 파트너
- 차별점: 서책과 그림 유물 사이를 오가는 밝은 학구성

### Positive Prompt

```text
<lora:cfg_scale_boost:0.4>, hanbok, song style outfits, <lora:hanbokSong_v31:0.7>,
masterpiece, best quality, amazing quality, absurdres,
1boy, solo, adult man, male focus,
Gyujanggak archivist investigating secrets hidden in old paintings,
book-loving scholar and friendly research partner,
bright curiosity, excited discovery mood,

distinct character design,
light chestnut short hair, slightly messy bangs,
soft scholar hair silhouette, round glasses,
clear hazel eyes, youthful adult face, eager warm smile,
ink and pigment smudge on fingertips,

round glasses, small western pocket watch, bookmark cord,
ivory jeogori, light brown dopo robe,
small geometric embroidery inside sleeve,
practical book satchel, scholar hanbok with worn details,

holding an old painting scroll and magnifying glass,
annotated record papers, stacked archives, maps, foreign books,
Gyujanggak reading room, dust motes in sunbeam,
slightly leaning forward as if revealing a clue,
soft depth of field, upper body portrait, three-quarter view,
polished anime illustration
```

### Negative Prompt

```text
crown, royal robe, military armor, sword, doctor tools,
merchant luxury fan, villain smile, cold stare, perfect slick hair,
old man, beard, female, child, underage, modern casual clothes,
school uniform, multiple characters, low quality, worst quality,
bad anatomy, bad hands, extra fingers, text, watermark, logo, signature
```

---

## 한시온 - 도화서 선배 화원

플레이어의 스승이자 라이벌. 왕실 화원으로서 실력과 자부심이 강하며, 언젠가는 플레이어를 뛰어넘고 싶어 한다.

### 외형 설정

- 헤어스타일: 먹빛 긴 머리, 느슨한 낮은 묶음, 붓끝처럼 흐르는 옆머리, 예술가다운 부드러운 실루엣
- 악세사리: 붓 모양 비녀, 작은 꽃잎 귀장식, 물감 얼룩 손수건, 연분홍 매듭
- 의상: 연분홍 저고리와 흰 두루마기, 소매의 매화 자수, 안료가 살짝 묻은 작업용 앞섶
- 소품: 붓 여러 자루, 안료 접시, 반쯤 완성한 초상화
- 분위기: 다정한 선배와 날카로운 라이벌이 공존, 예술에 대한 자존심, 감성적인 긴장
- 차별점: 기존 화공 포지션보다 `선배`, `스승`, `경쟁자`의 표정을 강조

### Positive Prompt

```text
<lora:cfg_scale_boost:0.4>, hanbok, song style outfits, <lora:hanbokSong_v31:0.7>,
masterpiece, best quality, amazing quality, absurdres,
1boy, solo, adult man, male focus,
senior Dohwaseo royal painter, mentor and rival of the protagonist,
gentle artist with competitive pride, emotional artistic tension,
determined to surpass the imperial court painter,

distinct character design,
ink black long hair tied loosely low, flowing side locks,
soft brushstroke-like hair silhouette, rose brown eyes,
delicate expressive face, tender but competitive smile,
warm gaze with hidden rivalry, elegant slender hands,

brush-shaped hairpin, small petal earring,
paint-stained handkerchief, pale pink knot ornament,
pale pink jeogori, white durumagi, plum blossom sleeve embroidery,
slightly paint-stained front panel, refined artist hanbok,

holding several fine brushes and a porcelain pigment plate,
unfinished portrait canvas behind him, mineral pigments, silk screens,
Dohwaseo studio, flower vase and paper windows,
soft spring light, graceful painting pose, romantic rivalry mood,
soft depth of field, upper body portrait, three-quarter view,
polished anime illustration
```

### Negative Prompt

```text
female, woman, child, underage, overly feminine dress, flower crown,
warrior armor, sword, crown, doctor tools, merchant gold jewelry,
dark villain face, angry rage, horror painter, blood,
modern art smock, western beret, multiple characters,
low quality, worst quality, bad anatomy, bad hands, extra fingers,
text, watermark, logo, signature
```

---

## 남도현 - 운현상단 후계자

궁을 자유롭게 드나드는 젊은 거상. 언제나 새로운 초상화를 의뢰하며, 돈보다 잃고 싶지 않은 사람이 생겼다고 웃는다.

### 외형 설정

- 헤어스타일: 짙은 갈색 머리, 반듯하지만 살짝 느슨한 상투, 앞머리 한 가닥이 내려오는 여유로운 실루엣
- 악세사리: 금전 문양 노리개, 옥 반지, 비단 부채, 상단 인장 주머니, 외국산 향낭
- 의상: 짙은 녹색 비단 도포, 금색 안감, 구름과 동전 문양 자수, 궁 출입에 어울리는 고급 상인 한복
- 소품: 새 초상화 의뢰서, 상단 장부, 비단 포장 선물
- 분위기: 여유로운 거상, 계산 빠른 미소, 그러나 특정 인물 앞에서는 진심이 새어 나오는 사람
- 차별점: 가장 부유하고 화려한 상업 디테일. 부채와 의뢰서가 핵심

### Positive Prompt

```text
<lora:cfg_scale_boost:0.4>, hanbok, song style outfits, <lora:hanbokSong_v31:0.7>,
masterpiece, best quality, amazing quality, absurdres,
1boy, solo, adult man, male focus,
heir of Unhyeon merchant guild, wealthy merchant freely entering the palace,
frequent commissioner of new portraits,
charming smile hiding sincere attachment,
elegant merchant prince of alternate Joseon,

distinct character design,
dark brown hair in loose neat sangtu, one relaxed front bang,
smooth confident hair silhouette, golden hazel eyes,
handsome sly face, amused smile, sharp calculating gaze,
subtle warmth beneath playful confidence,

gold coin motif norigae, jade ring, silk folding fan,
merchant guild seal pouch, foreign perfume sachet,
dark emerald silk dopo, gold inner lining,
embroidered cloud and coin patterns, luxurious merchant hanbok,

holding a new portrait commission letter and half-open silk fan,
wooden abacus, trade ledger, silk-wrapped gift box,
Unhyeon merchant reception room inside palace, foreign wares,
warm lantern light, relaxed confident posture,
soft depth of field, upper body portrait, three-quarter view,
polished anime illustration
```

### Negative Prompt

```text
royal crown, military uniform, heavy armor, sword, doctor tools,
scholar glasses, poor ragged clothes, villain monster grin,
old man, beard, female, child, underage, modern business suit,
multiple characters, low quality, worst quality, bad anatomy,
bad hands, extra fingers, text, watermark, logo, signature
```

---

## 단체 키 비주얼

### Positive Prompt

```text
<lora:cfg_scale_boost:0.4>, hanbok, song style outfits, <lora:hanbokSong_v31:0.7>,
masterpiece, best quality, amazing quality, absurdres,
otome romance fantasy key visual, alternate Joseon imperial palace,
the first imperial court painter at the center holding an unfinished portrait album,
seven adult male leads around her as portrait models,
all wearing distinct richly detailed hanbok,

vulnerable crown prince in deep crimson dragon embroidered royal robe,
stoic royal guard commander in dark navy cheollik without armor,
cool Gyujanggak reformist scholar in blue white dopo,
gentle Naeuiwon physician in white and pale jade medical hanbok,
bright archivist holding an old painting scroll and books,
senior Dohwaseo painter in pale pink artist hanbok with brushes,
wealthy merchant heir in emerald silk dopo with portrait commission letter,

different hairstyles, different silhouettes, different accessories,
imperial art studio, folding screens, palace lanterns, unfinished portraits,
pigment boxes, brushes, old scrolls, medicine bowl, trade ledger,
romantic palace intrigue, secrets hidden in paintings,
warm candlelight and moonlit palace garden beyond paper windows,
cinematic lighting, soft depth of field, polished anime illustration, no text
```

### Negative Prompt

```text
same face, identical faces, cloned characters, same hairstyle, same outfit,
children, underage, crowd, more than eight people, fewer than eight people,
modern casual clothes, western suits, sci-fi, cyberpunk,
helmet covering face, monster, demon, excessive blood, gore,
low quality, worst quality, blurry, bad anatomy, bad hands,
extra fingers, missing fingers, fused limbs, text, watermark, logo, signature
```

---

## 초상화 의뢰 공통 컷

개별 캐릭터 prompt 뒤에 붙여 쓰는 변형용 구문이다. 초상화 이벤트, 야간 화실, 후원 산책 장면을 만들 때 사용한다.

### Portrait Commission Add-on

```text
sitting as a portrait model for the imperial court painter,
quiet one-on-one conversation, unfinished portrait canvas in foreground,
brushes and pigment dishes, intimate royal atelier mood,
the character shows a private expression seen only by the painter
```

### Night Atelier Add-on

```text
late night visitor in the palace art studio,
warm candlelight, dark paper windows, secret conversation,
unspoken feelings, hidden truth reflected in the unfinished painting
```

### Secret Sketch Add-on

```text
small accidental secret sketch on silk paper,
the character notices what should not have been drawn,
tense romantic silence, delicate hand near the sketchbook
```
