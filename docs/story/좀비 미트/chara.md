# 좀비 미트 - 등장인물 이미지 생성 프롬프트

원본: `docs/story/좀비 미트/story.md`

## 공용 체크포인트

세계관은 대형마트 식품관, 냉동고, 직원 통로, 지하주차장을 오가는 폐쇄형 좀비 생존 호러다. 이전 프롬프트가 지나치게 캐릭터 일러스트처럼 밝게 나오는 문제가 있어, ReV Animated에서 잘 먹히는 `horror portrait`, `dramatic oil painting`, `Horror Colors`, `sharp focus`, `intricate high detail` 계열로 전체 톤을 바꾼다.

LoRA는 사용하지 않는다. 아래 prompt는 공용 prefix 없이 그대로 복사해서 사용할 수 있도록 캐릭터별로 완성형으로 작성했다.

## 권장 생성 설정

```json
{
  "model": "comfyui/local",
  "model_name": "revAnimated_v11-inpainting.safetensors",
  "num_inference_steps": 32,
  "guidance_scale": 7,
  "width": 768,
  "height": 1024,
  "sampler_name": "dpmpp_2m",
  "scheduler": "karras",
  "clip_skip": 2,
  "upscale_model_name": "remacri_original.safetensors",
  "loras": []
}
```

## 공통 스타일 기준

### 공통 Positive Style

```text
(horror:1.25), ((best quality)), ((masterpiece)), ((realistic)), (detailed),
professional majestic horror oil painting, cinematic survival horror portrait,
intricate, high detail, sharp focus, dramatic lighting,
photorealistic painting, oppressive atmosphere, deep shadows,
(Horror Colors:1.5), sickly green fluorescent light, emergency red light,
cold blue freezer mist, wet reflective floor, dark supermarket after the apocalypse
```

### 공통 Negative Prompt

```text
(bad-image-v2-39000, bad_prompt_version2, bad-hands-5, EasyNegative, NG_DeepNegative_V1_4T, bad-artist-anime:0.7),
(worst quality, low quality:1.3), (depth of field, blurry:1.2),
(greyscale, monochrome:1.1), cropped, lowres, text, jpeg artifacts,
signature, watermark, username, artist name, trademark, title,
multiple view, reference sheet, long neck, bad anatomy, bad hands,
extra fingers, missing fingers, deformed fingers, distorted face,
duplicate character, multiple people, clean bright studio, cute cheerful mood,
fantasy armor, medieval costume, sci-fi armor, cyberpunk city,
excessive gore, exposed organs, dismemberment
```

---

## 윤재

### 외형 설정

- 짧은 흑갈색 머리, 땀과 먼지로 이마에 붙은 앞머리
- 평범하고 지친 얼굴, 눈 밑 그늘, 입술을 다문 긴장감
- 회색 후드 집업, 낡은 검은 바람막이, 어두운 청바지, 작은 백팩
- 손전등, 찢어진 장바구니, 통조림 몇 개

### Positive Prompt

```text
(horror:1.25), portrait of an ordinary Korean male survivor trapped in a supermarket,
short dark brown black hair, sweaty bangs stuck to forehead,
tired average face, shadow under eyes, tense closed lips,
gray hoodie, worn black windbreaker, dark jeans, small backpack,
holding a flashlight and torn shopping basket with canned food,
standing beside overturned supermarket shelves, fearful but calculating gaze,
flickering fluorescent food court, emergency red light, cold freezer mist,
wet reflective floor, dark aisle behind him, sense of being hunted,
((best quality)), ((masterpiece)), ((realistic)), (detailed),
professional majestic horror oil painting, cinematic survival horror portrait,
intricate, high detail, sharp focus, dramatic lighting, photorealistic painting,
oppressive atmosphere, deep shadows, (Horror Colors:1.5)
```

### Negative Prompt

```text
(bad-image-v2-39000, bad_prompt_version2, bad-hands-5, EasyNegative, NG_DeepNegative_V1_4T, bad-artist-anime:0.7),
female, woman, child, handsome idol face, perfect smile, heroic pose,
clean clothes, soldier uniform, assault rifle, sword, zombie face,
(worst quality, low quality:1.3), (depth of field, blurry:1.2),
greyscale, monochrome, cropped, lowres, text, jpeg artifacts,
signature, watermark, long neck, bad anatomy, bad hands, extra fingers,
multiple people, reference sheet, excessive gore
```

---

## 강준호

### 외형 설정

- 짧은 검은 머리, 단정한 옆머리, 각진 턱
- 피로한 눈, 손목 근처 오래된 화상 자국
- 남색 기능성 재킷, 소방 구조대 티셔츠, 튼튼한 작업 장갑
- 쇠지렛대, 죽은 무전기

### Positive Prompt

```text
(horror:1.25), portrait of a Korean former firefighter survivor leader,
short practical black hair, strong jaw, exhausted eyes, restrained grief,
navy utility jacket, old fire rescue t-shirt, heavy work gloves,
small burn scar near wrist, holding a crowbar and broken radio,
protective stance, giving a silent order in a dark supermarket employee corridor,
warning signs on walls, smoke haze, scattered fire extinguisher powder,
emergency red light, harsh fluorescent flicker, wet concrete floor,
((best quality)), ((masterpiece)), ((realistic)), (detailed),
professional majestic horror oil painting, cinematic survival horror portrait,
intricate, high detail, sharp focus, dramatic lighting, photorealistic painting,
oppressive atmosphere, deep shadows, (Horror Colors:1.5)
```

### Negative Prompt

```text
(bad-image-v2-39000, bad_prompt_version2, bad-hands-5, EasyNegative, NG_DeepNegative_V1_4T, bad-artist-anime:0.7),
female, child, old man, beard, full armor, helmet, smiling brightly,
relaxed pose, clean formal suit, police uniform, huge axe, flames,
(worst quality, low quality:1.3), (depth of field, blurry:1.2),
greyscale, monochrome, cropped, lowres, text, watermark, long neck,
bad anatomy, bad hands, extra fingers, multiple people, excessive gore
```

---

## 이소연

### 외형 설정

- 어깨 아래 검은 생머리, 흐트러진 낮은 포니테일
- 단정한 얼굴, 부드러운 미소, 계산적인 눈빛
- 베이지 트렌치코트, 검은 니트, 슬림한 팬츠, 얇은 가죽 장갑
- 작은 손거울, 숨긴 비상식량, 접이식 칼의 암시

### Positive Prompt

```text
(horror:1.25), portrait of a calm calculating Korean woman survivor,
long straight black hair in a low messy ponytail,
neat beautiful face, soft polite smile, sharp distrustful eyes,
beige trench coat, black knit top, slim dark pants, thin leather gloves,
small mirror in one hand, hidden snack bars in coat pocket,
one hand near a small folding knife, not openly threatening,
standing in a dark supermarket cosmetics aisle connected to the food court,
scattered packages, flickering fluorescent light, emergency red glow,
the smile of someone about to lock a door behind another survivor,
((best quality)), ((masterpiece)), ((realistic)), (detailed),
professional majestic horror oil painting, cinematic survival horror portrait,
intricate, high detail, sharp focus, dramatic lighting, photorealistic painting,
oppressive atmosphere, deep shadows, (Horror Colors:1.5)
```

### Negative Prompt

```text
(bad-image-v2-39000, bad_prompt_version2, bad-hands-5, EasyNegative, NG_DeepNegative_V1_4T, bad-artist-anime:0.7),
male, child, school uniform, princess dress, fantasy outfit,
overly sexy outfit, cheerful idol smile, innocent cute face,
crying helpless pose, large weapon, blood splatter on face,
(worst quality, low quality:1.3), blurry, greyscale, monochrome,
cropped, lowres, text, watermark, long neck, bad hands, multiple people
```

---

## 박동식

### 외형 설정

- 짧게 민 검은 머리, 거칠고 둔탁한 실루엣
- 넓은 얼굴, 낮은 눈썹, 무표정에 가까운 시선
- 얼룩진 카키 작업복 점퍼, 검은 티셔츠, 두꺼운 장갑
- 테이프로 감은 쇠파이프

### Positive Prompt

```text
(horror:1.35), portrait of a dangerous Korean male survivor in a supermarket butcher section,
very short black hair, rough blunt silhouette,
broad face, heavy brows, low emotionless stare,
stained khaki work jacket, black t-shirt, thick gloves,
holding a taped metal pipe at his side, large muscular build,
silent violent tension, standing near meat counter and hanging plastic strips,
cold white freezer light, red emergency reflection, dark blood colored shadows,
not a monster, a living man becoming more frightening than the dead,
((best quality)), ((masterpiece)), ((realistic)), (detailed),
professional majestic horror oil painting, cinematic survival horror portrait,
intricate, high detail, sharp focus, dramatic lighting, photorealistic painting,
oppressive atmosphere, deep shadows, (Horror Colors:1.6)
```

### Negative Prompt

```text
(bad-image-v2-39000, bad_prompt_version2, bad-hands-5, EasyNegative, NG_DeepNegative_V1_4T, bad-artist-anime:0.7),
female, child, slim pretty boy, idol face, cheerful smile,
formal suit, fantasy armor, military commander, gun, sword,
exposed organs, dismemberment, full zombie transformation,
(worst quality, low quality:1.3), blurry, greyscale, monochrome,
cropped, lowres, text, watermark, long neck, bad anatomy, bad hands,
extra fingers, multiple people
```

---

## 최유나

### 외형 설정

- 어깨 길이의 다크 브라운 단발, 한쪽을 핀으로 고정
- 부드러운 눈매, 창백한 피부, 울음을 참는 표정
- 하늘색 셔츠, 흰 카디건, 어두운 슬랙스, 임시 의료 파우치
- 붕대, 작은 소독약, 거의 빈 진통제 팩

### Positive Prompt

```text
(horror:1.2), portrait of a Korean nurse survivor in a ruined supermarket pharmacy aisle,
shoulder length dark brown bob hair, one side pinned back,
gentle eyes, pale tired face, holding back tears,
light blue shirt, white cardigan, dark slacks, small medical pouch,
bandages, tiny disinfectant bottle, almost empty painkiller blister pack,
compassionate but firm expression, forced to decide who can be treated,
scattered medicine boxes, flickering fluorescent light, emergency red glow,
medical supplies arranged like a desperate triage corner,
((best quality)), ((masterpiece)), ((realistic)), (detailed),
professional majestic horror oil painting, cinematic survival horror portrait,
intricate, high detail, sharp focus, dramatic lighting, photorealistic painting,
oppressive atmosphere, deep shadows, (Horror Colors:1.5)
```

### Negative Prompt

```text
(bad-image-v2-39000, bad_prompt_version2, bad-hands-5, EasyNegative, NG_DeepNegative_V1_4T, bad-artist-anime:0.7),
male, child, sexy nurse costume, hospital fetish outfit, bright clean hospital,
cheerful smile, fantasy healer robe, large syringe, surgery scene,
excessive gore, zombie face, (worst quality, low quality:1.3),
blurry, greyscale, monochrome, cropped, lowres, text, watermark,
long neck, bad anatomy, bad hands, extra fingers, multiple people
```

---

## 오태우

### 외형 설정

- 짧고 삐친 검은 머리, 땀 때문에 흐트러진 앞머리
- 앳된 얼굴, 겁먹은 눈을 일부러 사납게 뜸
- 교복 셔츠 위 검은 후드, 풀어진 넥타이, 운동화
- 금 간 휴대폰, 과자 봉지, 작은 커터칼

### Positive Prompt

```text
(horror:1.2), portrait of a Korean teenage high school boy survivor,
short spiky black hair, sweaty messy bangs,
young anxious face, frightened eyes trying to look tough,
school shirt under black hoodie, loosened tie, sneakers,
holding a cracked phone and a small snack bag,
small utility cutter clipped to pocket, defensive posture,
standing in a dark supermarket snack aisle, fallen chips on wet floor,
flickering fluorescent light, red emergency glow, deep shadow behind shelves,
a scared kid pretending not to need help,
((best quality)), ((masterpiece)), ((realistic)), (detailed),
professional majestic horror oil painting, cinematic survival horror portrait,
intricate, high detail, sharp focus, dramatic lighting, photorealistic painting,
oppressive atmosphere, deep shadows, (Horror Colors:1.45)
```

### Negative Prompt

```text
(bad-image-v2-39000, bad_prompt_version2, bad-hands-5, EasyNegative, NG_DeepNegative_V1_4T, bad-artist-anime:0.7),
adult man, old man, female, elementary student, overly cute child,
sexy outfit, idol stage outfit, fantasy armor, large weapon,
confident hero smile, calm mature expression, gore,
(worst quality, low quality:1.3), blurry, greyscale, monochrome,
cropped, lowres, text, watermark, long neck, bad hands, extra fingers,
multiple people
```

---

## 정미라

### 외형 설정

- 단정한 검은 단발, 흐트러진 머리를 귀 뒤로 넘김
- 날카로운 눈매, 피곤하지만 고압적인 표정
- 마트 관리자 조끼, 흰 블라우스, 검은 슬랙스, 사원증
- 열쇠 뭉치, 매장 무전기, 구겨진 매장 지도

### Positive Prompt

```text
(horror:1.25), portrait of a Korean supermarket manager survivor,
neat black bob haircut, hair tucked behind one ear,
sharp eyes, tired authoritative expression,
store manager vest, white blouse, black slacks, employee ID badge,
holding a keyring, store radio, crumpled floor map,
standing in front of a staff only door like she owns the last exit,
warning labels, dark office entrance, flickering fluorescent light,
emergency red glow, suspicion and control in her posture,
((best quality)), ((masterpiece)), ((realistic)), (detailed),
professional majestic horror oil painting, cinematic survival horror portrait,
intricate, high detail, sharp focus, dramatic lighting, photorealistic painting,
oppressive atmosphere, deep shadows, (Horror Colors:1.5)
```

### Negative Prompt

```text
(bad-image-v2-39000, bad_prompt_version2, bad-hands-5, EasyNegative, NG_DeepNegative_V1_4T, bad-artist-anime:0.7),
male, child, idol smile, princess dress, office lady glamour,
maid outfit, fantasy robe, military uniform, blood-covered clothes,
helpless crying pose, zombie face, (worst quality, low quality:1.3),
blurry, greyscale, monochrome, cropped, lowres, text, watermark,
long neck, bad anatomy, bad hands, extra fingers, multiple people
```

---

## 한승우

### 외형 설정

- 짧은 회갈색 머리, 흐트러진 앞머리
- 마른 얼굴, 떨리는 눈, 핏기 없는 입술
- 낡은 경비복, 어깨가 내려앉은 방검 조끼, 손전등 벨트
- 냉동고 열쇠, 경비봉, 구겨진 근무표

### Positive Prompt

```text
(horror:1.3), portrait of a guilty Korean supermarket security guard survivor,
short gray brown hair, messy bangs, thin tired face,
trembling eyes, pale lips, worn security uniform,
sagging protective vest, flashlight belt,
holding a freezer key and crumpled duty roster,
security baton hanging unused at his side, hunched posture,
standing near a closed freezer door with frost and scratch marks,
cold blue freezer mist, red emergency reflection, metal door dented from inside,
a man listening to the monster he locked away,
((best quality)), ((masterpiece)), ((realistic)), (detailed),
professional majestic horror oil painting, cinematic survival horror portrait,
intricate, high detail, sharp focus, dramatic lighting, photorealistic painting,
oppressive atmosphere, deep shadows, (Horror Colors:1.55)
```

### Negative Prompt

```text
(bad-image-v2-39000, bad_prompt_version2, bad-hands-5, EasyNegative, NG_DeepNegative_V1_4T, bad-artist-anime:0.7),
female, child, police officer hero, soldier, confident smile,
clean formal uniform, fantasy armor, gun, attacking pose,
zombie bite wound, excessive gore, (worst quality, low quality:1.3),
blurry, greyscale, monochrome, cropped, lowres, text, watermark,
long neck, bad anatomy, bad hands, extra fingers, multiple people
```

---

## 김보라

### 외형 설정

- 어깨 아래 갈색 머리, 급하게 묶은 낮은 포니테일
- 마른 뺨, 붉어진 눈가, 불안하게 떨리는 입술
- 아이보리 니트, 긴 카키 코트, 편한 바지
- 딸 사진이 뜬 휴대폰, 작은 머리핀, 분유통

### Positive Prompt

```text
(horror:1.2), portrait of a desperate Korean mother survivor,
shoulder length brown hair in a rushed low ponytail,
thin cheeks, reddened eyes, trembling lips,
ivory knit sweater, long khaki coat, practical pants,
holding a phone showing her daughter's photo,
small child hairpin and baby formula can in tote bag,
standing in a supermarket baby goods aisle, fallen diapers, dim shelves,
quiet panic about to break, maternal fear under emergency red light,
flickering fluorescent light, wet floor, dark aisle like a tunnel behind her,
((best quality)), ((masterpiece)), ((realistic)), (detailed),
professional majestic horror oil painting, cinematic survival horror portrait,
intricate, high detail, sharp focus, dramatic lighting, photorealistic painting,
oppressive atmosphere, deep shadows, (Horror Colors:1.5)
```

### Negative Prompt

```text
(bad-image-v2-39000, bad_prompt_version2, bad-hands-5, EasyNegative, NG_DeepNegative_V1_4T, bad-artist-anime:0.7),
male, child, pregnant belly emphasis, glamour pose, sexy outfit,
cheerful smile, fantasy dress, queen, magical girl, large weapon,
zombie face, excessive gore, (worst quality, low quality:1.3),
blurry, greyscale, monochrome, cropped, lowres, text, watermark,
long neck, bad anatomy, bad hands, extra fingers, multiple people
```

---

## 마석훈

### 외형 설정

- 짧은 검은 머리, 얼음 결정과 땀으로 엉겨 붙은 앞머리
- 회색빛 피부, 초점 없는 눈, 턱 주변의 검은 핏자국
- 녹색 마트 식품관 유니폼, 흰 앞치마, 찢어진 명찰
- 냉동고 문 유리 너머 성에 낀 손자국

### Positive Prompt

```text
(horror:1.55), portrait of an infected Korean supermarket food court worker trapped inside a freezer,
short black hair stuck with frost and sweat,
gray dead skin, unfocused cloudy eyes, slack jaw,
subtle dark blood around mouth, no excessive gore,
green supermarket food court uniform, white apron, torn name tag,
frosted hands pressed against freezer glass,
industrial freezer interior, scratch marks on metal door,
cold blue freezer mist, harsh fluorescent light, red emergency reflection,
tragic former human presence, slow aggressive movement,
his employee badge still hanging from his neck, the door about to open,
((best quality)), ((masterpiece)), ((realistic)), (detailed),
professional majestic horror oil painting, cinematic survival horror portrait,
intricate, high detail, sharp focus, dramatic lighting, photorealistic painting,
oppressive atmosphere, deep shadows, (Horror Colors:1.75)
```

### Negative Prompt

```text
(bad-image-v2-39000, bad_prompt_version2, bad-hands-5, EasyNegative, NG_DeepNegative_V1_4T, bad-artist-anime:0.7),
female, child, handsome clean face, normal healthy skin,
smiling human expression, cute monster, fantasy demon, horns,
exposed organs, dismemberment, huge zombie horde,
bright daylight, clean background, (worst quality, low quality:1.3),
blurry, greyscale, monochrome, cropped, lowres, text, watermark,
long neck, bad anatomy, bad hands, extra fingers, multiple people
```

---

## 단체 키 비주얼 프롬프트

### Positive Prompt

```text
(horror:1.35), Korean modern zombie survival horror key visual,
nine survivors trapped in a dark supermarket food court,
ordinary male protagonist with flashlight at center,
former firefighter leader, calculating woman in trench coat,
dangerous man with metal pipe, nurse with medical pouch,
teenage student with cracked phone, supermarket manager with keyring,
guilty security guard, desperate mother with daughter's phone,
infected supermarket worker silhouette behind frosted freezer door,
flickering fluorescent lights, emergency red light, cold blue freezer mist,
scattered groceries, wet reflective floor, crushed shutter, dark aisles,
everyone looking in different directions, distrust, panic, survival tension,
((best quality)), ((masterpiece)), ((realistic)), (detailed),
professional majestic horror oil painting, cinematic survival horror poster,
intricate, high detail, sharp focus, dramatic lighting, photorealistic painting,
oppressive atmosphere, deep shadows, (Horror Colors:1.65), no text
```

### Negative Prompt

```text
(bad-image-v2-39000, bad_prompt_version2, bad-hands-5, EasyNegative, NG_DeepNegative_V1_4T, bad-artist-anime:0.7),
(worst quality, low quality:1.3), (depth of field, blurry:1.2),
greyscale, monochrome, text, logo, watermark, title, reference sheet,
same face, identical hairstyles, duplicate bodies, missing characters,
more than ten main characters, fewer than ten story figures,
fantasy armor, medieval setting, cyberpunk city, comedy mood,
excessive gore, dismemberment, exposed organs, bad hands, long neck
```
