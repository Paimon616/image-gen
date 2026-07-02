# 좀비 미트 - ReV Animated 캐릭터 프롬프트

원본: `docs/story/좀비 미트/story.md`

## 공용 체크포인트

ReV Animated 기준으로 다시 작성했다. 예시 프롬프트의 `horror`, `intense angle`, `night`, `upper body`, `dirty clothes`, `haunted`, `ultra detailed spooky environment`, `volumetric fog` 구조를 가져오되, LoRA와 원작 캐릭터 태그는 사용하지 않는다. 생존자는 괴물이 아니라 공포 상황 속 인간으로 고정하고, 마석훈만 감염체로 분리한다.

```json
{
  "model": "comfyui/local",
  "model_name": "revAnimated_v11-inpainting.safetensors",
  "num_inference_steps": 32,
  "guidance_scale": 7.5,
  "width": 768,
  "height": 1024,
  "sampler_name": "dpmpp_2m",
  "scheduler": "karras",
  "clip_skip": 2,
  "upscale_model_name": "remacri_original.safetensors",
  "loras": []
}
```

## 공통 Negative Prompt

```text
((monochrome)), (painting by bad-artist-anime:0.9), (painting by bad-artist:0.9),
watermark, text, error, blurry, jpeg artifacts, cropped,
worst quality, low quality, normal quality, signature, username, artist name,
(worst quality, low quality:1.4), bad anatomy, bad_prompt_version2,
closed eyes, EasyNegative, bad-artist-anime, bad-artist, ng_deepnegative_v1_75t,
bad hands, extra fingers, missing fingers, deformed fingers, long neck,
multiple view, reference sheet, duplicate character, two people, crowd,
clean clothes, clean bright studio, daylight, comedy mood, cute smile,
fantasy armor, medieval costume, sci-fi armor, cyberpunk city,
mask, gas mask, skull mask, hood covering face, faceless, black empty face,
demon horns, monster girl, animal ears, exposed organs, dismemberment,
same face, identical male face, handsome idol face, pretty boy face,
sharp V jaw, long sharp nose, wavy center parted black hair,
perfect straight eyebrows, model face
```

## 남성 캐릭터 얼굴 차별화 규칙

ReV Animated는 남성 캐릭터를 `black wavy center-part hair`, `sharp V jaw`, `handsome idol face`, `long sharp nose`, `thick straight eyebrows`로 수렴시키는 경향이 있다. 남자 캐릭터를 생성할 때는 각 prompt 앞쪽의 얼굴형, 눈, 코, 입, 헤어 실루엣을 유지한다.

- 윤재: 평범한 20대 후반, 부드러운 oval face, 낮은 콧대, 처진 피곤한 눈, 짧고 납작한 messy hair
- 강준호: 30대 후반, square jaw, 넓은 코, 짧은 crew cut, 굵은 목, 소방관 같은 단단한 인상
- 박동식: 40대 초반, broad round face, broken nose, very short buzz cut, 작은 deep-set eyes, 무거운 턱
- 오태우: 10대, round youthful face, 작은 코, 큰 불안한 눈, spiky schoolboy hair, 턱선 미성숙
- 한승우: 30대 중반, long narrow gaunt face, 얇은 코, 처진 눈꺼풀, 짧은 회갈색 머리, 얇은 입술
- 마석훈: 감염체, sunken cheeks, cloudy eyes, slack jaw, frost-stuck short hair, 인간 미남형 금지

---

## 윤재

### 외형 설정

- 짧은 흑갈색 머리, 땀과 먼지로 이마에 붙은 앞머리
- 평범하고 지친 한국 남성, 눈 밑 그늘, 입술을 다문 긴장감
- 회색 후드 집업은 hood down, 낡은 검은 바람막이, 어두운 청바지, 작은 백팩
- 손전등, 찢어진 장바구니, 통조림
- 배경: 식품관 진열대, 엎어진 상품, 젖은 바닥

### Positive Prompt

```text
horror, intense angle, night, ((solo)), ((1boy)), upper body,
ordinary Korean male survivor, normal human face, visible eyes, not a monster,
plain ordinary face, soft oval face, low nose bridge, small tired eyes,
slightly downturned eyes, natural uneven eyebrows, narrow lips, no sharp jaw,
short flat messy dark brown black hair, sweaty bangs stuck to forehead,
tired average face, shadow under eyes, tense closed lips, haunted expression,
gray zip hoodie with hood down, worn black windbreaker, dark jeans, small backpack,
((dirty clothes)), wet clothes, dust, rain stains,
holding a flashlight, torn shopping basket with canned food,
defensive survival pose, shoulders tense, looking toward a noise off screen,
dark supermarket food court, overturned shelves, visible Korean product packages,
scattered cans, broken price tags, wet reflective floor, emergency red light,
sickly green fluorescent light, cold freezer mist, ultra detailed spooky supermarket environment,
volumetric fog, dramatic shadows, realistic, detailed, ((best quality)), ((masterpiece))
```

### Negative Prompt

```text
((monochrome)), (painting by bad-artist-anime:0.9), (painting by bad-artist:0.9),
watermark, text, error, blurry, jpeg artifacts, cropped,
worst quality, low quality, normal quality, signature, username, artist name,
(worst quality, low quality:1.4), bad anatomy, bad_prompt_version2,
closed eyes, EasyNegative, bad-artist-anime, bad-artist, ng_deepnegative_v1_75t,
female, woman, child, zombie face, monster face, glowing demon eyes,
hood covering face, mask, faceless, two people, crowd, clean clothes,
heroic smile, soldier uniform, assault rifle, sword, exposed organs, dismemberment
handsome idol face, sharp V jaw, long sharp nose, wavy center parted hair,
perfect eyebrows, model face, same face
```

---

## 강준호

### 외형 설정

- 아주 짧은 검은 crew cut, 짧게 민 옆머리, 앞머리 없음, 웨이브 없음
- 넓은 이마, 넓은 광대, 사각턱, 넓고 낮은 코, 두꺼운 목
- 듬직한 소방관 체형, broad shoulders, stocky muscular build, 두꺼운 팔뚝
- 남색 기능성 소방 재킷, 낡은 소방 구조대 티셔츠, 작업 장갑
- 쇠지렛대, 죽은 무전기
- 배경: 직원 통로, 방화문, 경고 표지, 소화기 분말

### Positive Prompt

```text
horror, intense angle, night, ((solo)), ((1boy)), upper body,
Korean former firefighter survivor leader, normal human face, visible eyes, not a monster,
late 30s rugged Korean firefighter, dependable rescue worker face,
very short black crew cut, buzzed sides, no bangs, no wavy hair, no center part,
broad forehead, wide cheekbones, square jaw, broad low nose, thick neck,
stocky muscular firefighter build, broad shoulders, thick forearms, solid chest,
tired downturned eyes, slightly crooked eyebrows, firm wide mouth, restrained grief,
navy firefighter utility jacket, old fire rescue t-shirt, heavy work gloves,
small burn scar near wrist, ((dirty clothes)), ash stains, wet sleeves,
holding a crowbar and broken radio, protective stance, arms raised slightly to signal silence,
dark supermarket employee corridor, staff only door, fire door, warning signs,
scattered fire extinguisher powder, smoke haze, emergency red light,
sickly green fluorescent light, wet concrete floor, ultra detailed spooky supermarket backroom,
volumetric fog, dramatic shadows, realistic, detailed, ((best quality)), ((masterpiece))
```

### Negative Prompt

```text
((monochrome)), watermark, text, error, blurry, jpeg artifacts, cropped,
worst quality, low quality, normal quality, signature, username, artist name,
(worst quality, low quality:1.4), bad anatomy, bad_prompt_version2,
closed eyes, EasyNegative, bad-artist-anime, bad-artist, ng_deepnegative_v1_75t,
female, child, old man, beard, zombie face, monster face, glowing eyes,
hood covering face, mask, full armor, helmet, police uniform, huge axe,
two people, crowd, clean formal suit, exposed organs, dismemberment
handsome idol face, pretty boy, sharp V jaw, long sharp nose,
wavy center parted hair, fluffy wavy hair, long bangs, hair over forehead,
delicate face, slim neck, narrow shoulders, skinny body, same face
```

---

## 이소연

### 외형 설정

- 어깨 아래 검은 생머리, 흐트러진 낮은 포니테일
- 단정한 얼굴, 부드러운 미소 뒤의 계산적인 눈빛
- 베이지 트렌치코트, 검은 니트, 슬림한 팬츠, 얇은 가죽 장갑
- 작은 손거울, 숨긴 비상식량, 접이식 칼 암시
- 배경: 화장품 코너, 가격표, 깨진 거울, 흩어진 상품

### Positive Prompt

```text
horror, intense angle, night, ((solo)), ((1girl)), upper body,
calm calculating Korean woman survivor, normal human face, visible eyes, not a monster,
long straight black hair in a low messy ponytail,
neat face, soft polite smile, sharp distrustful eyes, haunted, subtle evil_smirk,
beige trench coat, black knit top, slim dark pants, thin leather gloves,
((dirty clothes)), dust on coat, wet hem, small mirror in one hand,
hidden snack bars in coat pocket, one hand near a small folding knife,
standing in a dark supermarket cosmetics aisle, visible shelves and price tags,
broken mirror, scattered packages, emergency red light, sickly green fluorescent light,
ultra detailed spooky supermarket environment, volumetric fog, dramatic shadows,
realistic, detailed, ((best quality)), ((masterpiece))
```

### Negative Prompt

```text
((monochrome)), watermark, text, error, blurry, jpeg artifacts, cropped,
worst quality, low quality, normal quality, signature, username, artist name,
(worst quality, low quality:1.4), bad anatomy, bad_prompt_version2,
closed eyes, EasyNegative, bad-artist-anime, bad-artist, ng_deepnegative_v1_75t,
male, child, zombie face, monster face, glowing demon eyes, mask, faceless,
school uniform, princess dress, fantasy outfit, sexy outfit, large breasts,
two people, crowd, clean clothes, exposed organs, dismemberment
```

---

## 박동식

### 외형 설정

- 짧게 민 검은 머리, 거칠고 둔탁한 실루엣
- 넓은 얼굴, 낮은 눈썹, 무표정에 가까운 시선
- 얼룩진 카키 작업복 점퍼, 검은 티셔츠, 두꺼운 장갑
- 테이프로 감은 쇠파이프
- 배경: 정육 코너, 고기 진열대, 비닐 커튼, 차가운 냉장 조명

### Positive Prompt

```text
horror, intense angle, night, ((solo)), ((1boy)), upper body,
dangerous Korean male survivor in a supermarket butcher section,
normal human face, visible eyes, not a monster,
early 40s rough Korean laborer, broad round face, heavy square chin,
broken nose, flattened nose bridge, small deep-set eyes, heavy eyelids,
very short black buzz cut, rough blunt silhouette, thick heavy brows,
low emotionless stare, wide pressed lips, haunted, faint evil_smirk,
stained khaki work jacket, black t-shirt, thick gloves, ((dirty clothes)),
holding a taped metal pipe, arms tense, ready to strike, zombie hunter pose,
meat counter, hanging plastic strips, cold white freezer light,
dark red reflections, scattered butcher paper, wet reflective floor,
ultra detailed spooky supermarket butcher environment, volumetric fog,
dramatic shadows, realistic, detailed, ((best quality)), ((masterpiece))
```

### Negative Prompt

```text
((monochrome)), watermark, text, error, blurry, jpeg artifacts, cropped,
worst quality, low quality, normal quality, signature, username, artist name,
(worst quality, low quality:1.4), bad anatomy, bad_prompt_version2,
closed eyes, EasyNegative, bad-artist-anime, bad-artist, ng_deepnegative_v1_75t,
female, child, pretty idol face, cheerful smile, zombie face, monster face,
mask, faceless, full armor, gun, sword, two people, crowd,
exposed organs, dismemberment
handsome idol face, pretty boy, slim face, sharp V jaw, long sharp nose,
wavy center parted hair, delicate eyebrows, same face
```

---

## 최유나

### 외형 설정

- 어깨 길이의 다크 브라운 단발, 한쪽을 핀으로 고정
- 부드러운 눈매, 창백한 피부, 울음을 참는 표정
- 하늘색 셔츠, 흰 카디건, 어두운 슬랙스, 임시 의료 파우치
- 붕대, 작은 소독약, 거의 빈 진통제 팩
- 배경: 약국 코너, 흩어진 약 상자, 임시 처치대

### Positive Prompt

```text
horror, intense angle, night, ((solo)), ((1girl)), upper body,
Korean nurse survivor in a ruined supermarket pharmacy aisle,
normal human face, visible eyes, not a monster,
shoulder length dark brown bob hair, one side pinned back,
gentle eyes, pale tired face, haunted expression, holding back tears,
light blue shirt, white cardigan, dark slacks, small medical pouch,
((dirty clothes)), bloodless dirt stains, wet cardigan cuffs,
holding bandages, tiny disinfectant bottle, almost empty painkiller blister pack,
arms raised slightly while checking supplies, desperate triage pose,
scattered medicine boxes, broken pharmacy shelf, emergency red light,
sickly green fluorescent light, ultra detailed spooky pharmacy corner,
volumetric fog, dramatic shadows, realistic, detailed, ((best quality)), ((masterpiece))
```

### Negative Prompt

```text
((monochrome)), watermark, text, error, blurry, jpeg artifacts, cropped,
worst quality, low quality, normal quality, signature, username, artist name,
(worst quality, low quality:1.4), bad anatomy, bad_prompt_version2,
closed eyes, EasyNegative, bad-artist-anime, bad-artist, ng_deepnegative_v1_75t,
male, child, sexy nurse costume, hospital fetish outfit, zombie face,
monster face, mask, faceless, bright clean hospital, two people, crowd,
large syringe, surgery room, exposed organs, dismemberment
```

---

## 오태우

### 외형 설정

- 짧고 삐친 검은 머리, 땀 때문에 흐트러진 앞머리
- 앳된 얼굴, 겁먹은 눈을 일부러 사납게 뜸
- 교복 셔츠 위 검은 후드, hood down, 풀어진 넥타이, 운동화
- 금 간 휴대폰, 과자 봉지, 작은 커터칼
- 배경: 과자 코너, 떨어진 봉지, 어두운 진열대

### Positive Prompt

```text
horror, intense angle, night, ((solo)), ((1boy)), upper body,
Korean teenage high school boy survivor, normal human face, visible eyes, not a monster,
teenage boy, round youthful face, soft cheeks, small nose,
large anxious eyes, thin nervous eyebrows, immature jawline,
short spiky black schoolboy hair, sweaty messy bangs, young anxious face,
frightened eyes trying to look tough, slightly open tense mouth, haunted, nervous expression,
school shirt under black hoodie with hood down, loosened red necktie, sneakers,
((dirty clothes)), dusty school shirt, wet sleeves,
holding a cracked phone and a small snack bag, small utility cutter clipped to pocket,
defensive pose, arms up slightly, pretending not to be scared,
dark supermarket snack aisle, visible snack packages, fallen chips on wet floor,
emergency red light, sickly green fluorescent light, ultra detailed spooky aisle,
volumetric fog, dramatic shadows, realistic, detailed, ((best quality)), ((masterpiece))
```

### Negative Prompt

```text
((monochrome)), watermark, text, error, blurry, jpeg artifacts, cropped,
worst quality, low quality, normal quality, signature, username, artist name,
(worst quality, low quality:1.4), bad anatomy, bad_prompt_version2,
closed eyes, EasyNegative, bad-artist-anime, bad-artist, ng_deepnegative_v1_75t,
adult man, old man, female, elementary student, zombie face, monster face,
mask, faceless, hood covering face, idol outfit, fantasy armor, large weapon,
two people, crowd, exposed organs, dismemberment
mature masculine face, sharp V jaw, long sharp nose, model face,
wavy center parted hair, thick adult eyebrows, same face
```

---

## 정미라

### 외형 설정

- 검은 머리를 낮게 말아 묶은 low bun, 목덜미의 단정한 chignon, 잔머리 몇 가닥, 은색 실핀
- 날카로운 눈매, 피곤하지만 고압적인 표정
- 마트 관리자 조끼, 흰 블라우스, 검은 슬랙스, 사원증
- 열쇠 뭉치, 매장 무전기, 구겨진 매장 지도
- 배경: 직원 전용 문, 사무실 입구, 경고 라벨

### Positive Prompt

```text
horror, intense angle, night, ((solo)), ((1girl)), upper body,
Korean supermarket manager survivor, normal human face, visible eyes, not a monster,
black hair tied into a low tight bun, neat chignon at the nape,
silver hairpins, a few loose strands near temples, no bob haircut,
sharp eyes, tired authoritative expression, haunted, controlled fear,
store manager vest, white blouse, black slacks, employee ID badge,
((dirty clothes)), dust on vest, wet blouse cuffs,
holding a keyring, store radio, crumpled floor map,
arms up slightly as if blocking access to the staff only door,
staff only door, dark office entrance, warning labels, broken fluorescent light,
emergency red light, ultra detailed spooky supermarket back office,
volumetric fog, dramatic shadows, realistic, detailed, ((best quality)), ((masterpiece))
```

### Negative Prompt

```text
((monochrome)), watermark, text, error, blurry, jpeg artifacts, cropped,
worst quality, low quality, normal quality, signature, username, artist name,
(worst quality, low quality:1.4), bad anatomy, bad_prompt_version2,
closed eyes, EasyNegative, bad-artist-anime, bad-artist, ng_deepnegative_v1_75t,
male, child, zombie face, monster face, mask, faceless, princess dress,
maid outfit, office glamour, military uniform, two people, crowd,
exposed organs, dismemberment,
bob haircut, short bob, loose short hair, nurse hairstyle, twin tails,
long flowing hair, ponytail, same hairstyle as nurse
```

---

## 한승우

### 외형 설정

- 40대 초중반 아저씨다운 짧은 salt and pepper hair, 관자놀이의 흰머리, 이마가 보이는 짧은 경비원 머리
- 마른 얼굴, 떨리는 눈, 핏기 없는 입술
- 낡은 경비복, 어깨가 내려앉은 방검 조끼, 손전등 벨트
- 냉동고 열쇠, 경비봉, 구겨진 근무표
- 배경: 성에 낀 냉동고 문, 긁힌 자국, 차가운 안개

### Positive Prompt

```text
horror, intense angle, night, ((solo)), ((1boy)), upper body,
guilty Korean supermarket security guard survivor, normal human face, visible eyes, not a monster,
early 40s gaunt Korean man, tired uncle-like security guard, long narrow face, hollow cheeks,
thin nose, drooping eyelids, small trembling eyes, thin uneven eyebrows,
short cropped salt and pepper hair, gray hair at temples, receding temples,
visible forehead, thin flat hair, no bangs, no wavy hair, thin tired face,
thin pale lips, weak chin, haunted expression, frightened guilt,
worn security uniform, sagging protective vest, flashlight belt,
((dirty clothes)), dust and frost stains,
holding a freezer key and crumpled duty roster, security baton hanging unused,
arms close to chest, listening to faint banging sounds, alone in frame,
closed industrial freezer door behind him, frost, scratch marks, dented metal,
no creature visible, no monster visible, only damage marks on the freezer door,
cold blue freezer mist, emergency red light, ultra detailed spooky freezer area,
volumetric fog, dramatic shadows, realistic, detailed, ((best quality)), ((masterpiece))
```

### Negative Prompt

```text
((monochrome)), watermark, text, error, blurry, jpeg artifacts, cropped,
worst quality, low quality, normal quality, signature, username, artist name,
(worst quality, low quality:1.4), bad anatomy, bad_prompt_version2,
closed eyes, EasyNegative, bad-artist-anime, bad-artist, ng_deepnegative_v1_75t,
female, child, police hero, soldier, zombie face, monster face, mask,
faceless, gun, attacking pose, two people, crowd, exposed organs, dismemberment,
monster behind him, monster in background, zombie in background,
second figure, silhouette behind him, creature, visible zombie, extra person,
handsome idol face, sharp V jaw, long sharp nose, wavy center parted hair,
strong heroic face, thick perfect eyebrows, same face,
young handsome hair, long bangs, fluffy hair, hair over forehead,
black idol hair, clean youthful face
```

---

## 김보라

### 외형 설정

- 어깨 아래 갈색 머리, 급하게 묶은 낮은 포니테일
- 마른 뺨, 붉어진 눈가, 불안하게 떨리는 입술
- 아이보리 니트, 긴 카키 코트, 편한 바지
- 딸 사진이 뜬 휴대폰, 작은 머리핀, 분유통
- 배경: 아기용품 코너, 기저귀 패키지, 떨어진 분유통

### Positive Prompt

```text
horror, intense angle, night, ((solo)), ((1girl)), upper body,
desperate Korean mother survivor, normal human face, visible eyes, not a monster,
shoulder length brown hair in a rushed low ponytail,
thin cheeks, reddened eyes, trembling lips, haunted expression, quiet panic,
ivory knit sweater, long khaki coat, practical pants,
((dirty clothes)), wet coat hem, dusty sleeves,
holding a phone showing her daughter's photo, small child hairpin,
baby formula can in tote bag, arms raised protectively around the phone,
supermarket baby goods aisle, visible diaper packages, fallen diapers, dim shelves,
emergency red light, sickly green fluorescent light, ultra detailed spooky baby aisle,
volumetric fog, dramatic shadows, realistic, detailed, ((best quality)), ((masterpiece))
```

### Negative Prompt

```text
((monochrome)), watermark, text, error, blurry, jpeg artifacts, cropped,
worst quality, low quality, normal quality, signature, username, artist name,
(worst quality, low quality:1.4), bad anatomy, bad_prompt_version2,
closed eyes, EasyNegative, bad-artist-anime, bad-artist, ng_deepnegative_v1_75t,
male, child, pregnant belly emphasis, zombie face, monster face, mask,
faceless, glamour pose, sexy outfit, queen, magical girl, two people, crowd,
exposed organs, dismemberment
```

---

## 마석훈

### 외형 설정

- 40대 후반 아저씨형 짧은 스포츠머리, receding hairline, 넓은 이마, thinning hair, 웨이브 앞머리 없음
- 회색빛 피부, 초점 없는 눈, 턱 주변의 검은 핏자국
- 녹색 마트 식품관 유니폼, 흰 앞치마, 찢어진 명찰
- 냉동고 문 유리 너머 성에 낀 손자국
- 배경: 산업용 냉동고 내부, 긁힌 철문, 차가운 안개

### Positive Prompt

```text
horror, intense angle, night, ((solo)), ((1boy)), upper body,
infected Korean supermarket food court worker, zombie pose, arms up,
middle-aged Korean man, late 40s, uncle-like face, not handsome,
short cropped black hair, old man sport haircut, receding hairline,
wide forehead, thinning hair on top, sparse flat hair, buzzed sides,
no bangs, no wavy hair, no center part, frost stuck to short hair,
sunken cheeks, asymmetrical face, gray dead skin, cloudy unfocused eyes,
collapsed nose bridge, slack jaw, torn dry lips, haunted, dead expression,
subtle dark blood around mouth, no excessive gore,
green supermarket food court uniform, white apron, torn name tag, employee badge,
((dirty clothes)), frost covered uniform, wet apron,
frosted hands pressed against freezer glass, trapped inside industrial freezer,
scratch marks on metal door, cold blue freezer mist, emergency red light,
ultra detailed spooky freezer environment, volumetric fog,
dramatic shadows, realistic, detailed, ((best quality)), ((masterpiece))
```

### Negative Prompt

```text
((monochrome)), watermark, text, error, blurry, jpeg artifacts, cropped,
worst quality, low quality, normal quality, signature, username, artist name,
(worst quality, low quality:1.4), bad anatomy, bad_prompt_version2,
closed eyes, EasyNegative, bad-artist-anime, bad-artist, ng_deepnegative_v1_75t,
female, child, handsome clean face, normal healthy skin, cute monster,
fantasy demon, horns, huge zombie horde, two people, crowd,
exposed organs, dismemberment, bright daylight, clean background
handsome idol face, symmetrical clean face, sharp V jaw, healthy skin,
wavy center parted hair, wavy bangs, long bangs, fluffy hair,
hair over forehead, young handsome hair, perfect eyebrows, same face
```

---

## 단체 키 비주얼 프롬프트

### Positive Prompt

```text
horror, intense angle, night, upper body group poster,
Korean modern zombie survival horror, nine human survivors trapped in a supermarket food court,
one infected supermarket worker silhouette behind a frosted freezer door,
ordinary male survivor with flashlight, former firefighter with crowbar,
calculating woman in beige trench coat, dangerous man with metal pipe,
nurse with medical pouch, teenage boy in school shirt and black hoodie hood down,
supermarket manager with keyring and map, guilty security guard with freezer key,
desperate mother holding phone with daughter's photo,
((dirty clothes)), haunted faces, fear, distrust, panic,
crushed shutter, visible Korean product packages, scattered groceries,
wet reflective floor, emergency red light, sickly green fluorescent light,
cold blue freezer mist, ultra detailed spooky supermarket environment,
volumetric fog, dramatic shadows, realistic, detailed, ((best quality)), ((masterpiece))
```

### Negative Prompt

```text
((monochrome)), watermark, text, error, blurry, jpeg artifacts, cropped,
worst quality, low quality, normal quality, signature, username, artist name,
(worst quality, low quality:1.4), bad anatomy, bad_prompt_version2,
closed eyes, EasyNegative, bad-artist-anime, bad-artist, ng_deepnegative_v1_75t,
same face, identical hairstyles, duplicate bodies, missing characters,
more than ten main characters, fewer than ten story figures,
fantasy armor, medieval setting, cyberpunk city, comedy mood,
exposed organs, dismemberment, bright daylight, clean background
```
