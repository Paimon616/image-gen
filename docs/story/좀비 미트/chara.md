# 좀비 미트 - 등장인물 이미지 생성 프롬프트

원본: `docs/story/좀비 미트/story.md`

## 공용 체크포인트와 LoRA

세계관은 대형마트 식품관, 냉동고, 직원 통로, 지하주차장을 오가는 폐쇄형 좀비 생존 호러다. 캐릭터는 한국 현대극 인물로 보이되, 실사 사진보다 `semi-real anime / 2.5D survival horror key visual` 톤을 우선한다.

### 1순위 권장 리소스

```json
{
  "model": "comfyui/local-sdxl",
  "model_name": "celestrealAnimeSemi_v20.safetensors",
  "num_inference_steps": 34,
  "guidance_scale": 4.5,
  "width": 896,
  "height": 1344,
  "sampler_name": "euler_ancestral",
  "scheduler": "normal",
  "clip_skip": 2,
  "upscale_model_name": "remacri_original.safetensors",
  "loras": [
    { "path": "MuseInDark_IL-NAI-Tweak-3.0.safetensors", "scale": 0.45 },
    { "path": "lightingSlider.safetensors", "scale": -0.25 },
    { "path": "DetailerILv2-000008.safetensors", "scale": 0.25 },
    { "path": "Eye_Enhancer.safetensors", "scale": 0.2 }
  ]
}
```

- Checkpoint: `celestrealAnimeSemi_v20.safetensors`
- Style LoRA: `MuseInDark_IL-NAI-Tweak-3.0.safetensors`
- Lighting LoRA: `lightingSlider.safetensors`
- Detail LoRA: `DetailerILv2-000008.safetensors`
- Eye LoRA: `Eye_Enhancer.safetensors`
- Upscaler: `remacri_original.safetensors`

`lightingSlider.safetensors`는 어두운 마트 조명과 비상등 분위기를 위해 음수 스케일로 사용한다. 얼굴 구분이 약하면 `MuseInDark`를 0.35까지 낮추고, 좀비 직원 컷에서만 0.55까지 올린다.

## 공통 스타일

### 공통 Positive Prompt

```text
masterpiece, best quality, amazing quality, highres,
solo, single character, Korean modern zombie survival horror,
semi-real anime character portrait, 2.5D illustration,
trapped in a dark supermarket food court after the apocalypse,
flickering fluorescent lights, emergency red light, cold freezer mist,
messy shelves, scattered groceries, wet reflective floor,
tense survival drama, fearful eyes, cinematic lighting,
upper body portrait, three-quarter view, clean single character composition,
detailed face, expressive eyes, realistic fabric texture, dramatic shadows
```

### 공통 Negative Prompt

```text
worst quality, low quality, normal quality, blurry, lowres,
bad anatomy, bad hands, extra fingers, missing fingers, deformed fingers,
distorted face, asymmetrical eyes, duplicate character, same face,
text, watermark, logo, signature, cropped head, out of frame,
childlike adult, underage sexualization, glamour fashion shoot,
fantasy armor, medieval outfit, sci-fi armor, cyberpunk city,
excessive gore, dismemberment, exposed organs, zombie horde crowd,
multiple people, two characters
```

---

## 윤재

플레이어. 식량을 구하러 왔다가 식품관에 고립된 평범한 생존자. 관찰력이 좋고 빠르게 판단하지만, 감염 공포 앞에서는 냉정함이 무너진다.

### 외형 설정

- 헤어스타일: 짧은 흑갈색 머리, 땀과 먼지 때문에 앞머리가 이마에 달라붙은 실루엣
- 얼굴: 날카롭기보다 평범하고 지친 인상, 눈 밑 그늘, 입술을 다문 긴장감
- 의상: 회색 후드 집업, 낡은 검은 바람막이, 어두운 청바지, 작은 백팩
- 소품: 손전등, 찢어진 장바구니, 통조림 몇 개
- 분위기: 평범한 사람이 극한 상황에서 억지로 침착함을 유지하는 느낌

### Positive Prompt

```text
masterpiece, best quality, amazing quality,
1boy, solo, adult Korean man, ordinary survivor protagonist,
short dark brown black hair, sweaty bangs stuck to forehead,
tired average face, shadow under eyes, tense closed lips,
gray hoodie, worn black windbreaker, dark jeans, small backpack,
holding a flashlight and torn shopping basket, canned food inside,
standing beside overturned supermarket shelves,
fearful but calculating gaze, trying to stay calm,
flickering fluorescent supermarket food court, emergency red light,
cold freezer mist in the background, wet floor reflections,
upper body portrait, three-quarter view, semi-real anime illustration
```

### Negative Prompt

```text
female, woman, child, school uniform, heroic armor, soldier uniform,
handsome idol face, perfect smile, confident hero pose, clean clothes,
large weapon, assault rifle, sword, excessive blood, zombie face,
low quality, bad anatomy, bad hands, extra fingers, text, watermark,
multiple characters, duplicate face
```

---

## 강준호

전직 소방관. 사람을 살리는 데 익숙하지만, 이곳에서는 모두를 살릴 수 없다는 사실 때문에 무너져 간다.

### 외형 설정

- 헤어스타일: 짧은 검은 머리, 옆머리를 단정히 친 실용적인 컷
- 얼굴: 각진 턱, 피로한 눈, 오래된 화상 자국이 손목 근처에 있음
- 의상: 남색 기능성 재킷, 소방 구조대 티셔츠, 튼튼한 작업 장갑
- 소품: 소형 도끼 또는 쇠지렛대, 무전기
- 분위기: 지휘하려 하지만 죄책감을 누르는 구조대원

### Positive Prompt

```text
masterpiece, best quality, amazing quality,
1boy, solo, adult Korean man, former firefighter survivor leader,
short practical black hair, clean side trim,
strong jaw, exhausted eyes, restrained grief,
navy utility jacket, old fire rescue t-shirt, heavy work gloves,
small burn scar near wrist, holding a crowbar and broken radio,
protective stance, giving a silent order,
dark supermarket employee corridor, warning signs, emergency light,
smoke haze, scattered fire extinguisher powder,
upper body portrait, three-quarter view, semi-real anime illustration
```

### Negative Prompt

```text
female, child, old man, beard, fantasy knight, full armor, helmet,
smiling brightly, relaxed pose, clean formal suit, police uniform,
huge axe, flaming background, excessive gore, zombie bite mark,
low quality, bad anatomy, bad hands, extra fingers, text, watermark,
multiple characters
```

---

## 이소연

냉정한 생존 계산을 숨기고 부드럽게 말하는 인물. 협력하는 척하지만 언제든 다른 사람을 문 밖에 남길 수 있다.

### 외형 설정

- 헤어스타일: 어깨 아래까지 오는 검은 생머리, 낮게 묶었다가 흐트러진 포니테일
- 얼굴: 단정하고 차분하지만 눈빛은 계산적임
- 의상: 베이지 트렌치코트, 검은 니트, 슬림한 팬츠, 얇은 가죽 장갑
- 소품: 작은 손거울, 접이식 칼, 숨긴 비상식량
- 분위기: 다정한 말투 뒤에 생존을 위한 배신을 감춘 사람

### Positive Prompt

```text
masterpiece, best quality, amazing quality,
1girl, solo, adult Korean woman, calculating survivor,
long straight black hair in a low messy ponytail,
neat beautiful face, calm lips, sharp calculating eyes,
beige trench coat, black knit top, slim dark pants,
thin leather gloves, small mirror, hidden snack bars in coat pocket,
one hand near a small folding knife but not showing threat openly,
soft polite smile with distrustful gaze,
supermarket cosmetics aisle connected to food court,
dim fluorescent light, red emergency glow, scattered packages,
upper body portrait, three-quarter view, semi-real anime illustration
```

### Negative Prompt

```text
male, child, school uniform, princess dress, fantasy outfit,
overly sexy outfit, cheerful idol smile, innocent cute face,
crying helpless pose, large weapon, blood splatter on face,
low quality, bad anatomy, bad hands, extra fingers, text, watermark,
multiple characters, duplicate face
```

---

## 박동식

공포를 폭력적 흥분으로 바꾸는 생존자. 좀비를 죽이는 데 능숙해질수록 산 사람들에게도 위험해진다.

### 외형 설정

- 헤어스타일: 짧게 민 검은 머리, 거칠고 둔탁한 실루엣
- 얼굴: 넓은 얼굴, 낮은 눈썹, 무표정에 가까운 낮은 시선
- 의상: 얼룩진 카키 작업복 점퍼, 검은 티셔츠, 두꺼운 장갑
- 소품: 피 묻지 않은 육절기용 큰 칼 또는 쇠파이프, 테이프로 감은 손잡이
- 분위기: 조용하지만 폭발 직전인 위험한 힘

### Positive Prompt

```text
masterpiece, best quality, amazing quality,
1boy, solo, adult Korean man, dangerous survivor,
very short black hair, rough blunt silhouette,
broad face, heavy brows, low emotionless stare,
stained khaki work jacket, black t-shirt, thick gloves,
holding a taped metal pipe at his side,
large muscular build, silent violent tension,
standing near butcher section and meat counter,
cold white freezer light, hanging plastic strips, red emergency reflection,
quiet menace, fear converted into aggression,
upper body portrait, three-quarter view, semi-real anime illustration
```

### Negative Prompt

```text
female, child, slim pretty boy, idol face, cheerful smile,
formal suit, fantasy armor, military commander, gun, sword,
excessive gore, dismemberment, exposed organs, zombie transformation,
low quality, bad anatomy, bad hands, extra fingers, text, watermark,
multiple characters
```

---

## 최유나

간호사 출신 생존자. 사람을 살리고 싶지만 감염자를 치료할 방법은 없다.

### 외형 설정

- 헤어스타일: 어깨 길이의 다크 브라운 단발, 한쪽을 핀으로 고정
- 얼굴: 부드러운 눈매, 창백한 피부, 울음을 참는 표정
- 의상: 하늘색 셔츠, 흰 카디건, 어두운 슬랙스, 임시 의료 파우치
- 소품: 붕대, 작은 소독약, 거의 빈 진통제 팩
- 분위기: 다정함과 냉정한 의학 판단 사이에서 흔들림

### Positive Prompt

```text
masterpiece, best quality, amazing quality,
1girl, solo, adult Korean woman, nurse survivor,
shoulder length dark brown bob hair, one side pinned back,
gentle eyes, pale tired face, holding back tears,
light blue shirt, white cardigan, dark slacks,
small medical pouch, bandages, tiny disinfectant bottle,
almost empty painkiller blister pack in hand,
compassionate but firm expression,
temporary treatment corner in supermarket pharmacy aisle,
flickering light, emergency red glow, scattered medicine boxes,
upper body portrait, three-quarter view, semi-real anime illustration
```

### Negative Prompt

```text
male, child, sexy nurse costume, hospital fetish outfit,
bright clean hospital, cheerful smile, fantasy healer robe,
large syringe, surgery scene, excessive blood, gore, zombie face,
low quality, bad anatomy, bad hands, extra fingers, text, watermark,
multiple characters
```

---

## 오태우

10대 고등학생. 어른들에게 짐 취급받기 싫어서 허세를 부리지만, 사실 누구보다 겁을 먹고 있다.

### 외형 설정

- 헤어스타일: 짧고 삐친 검은 머리, 땀 때문에 흐트러진 앞머리
- 얼굴: 아직 앳된 얼굴, 겁먹은 눈을 일부러 사납게 뜸
- 의상: 교복 셔츠 위에 검은 후드, 풀어진 넥타이, 운동화
- 소품: 휴대폰, 과자 봉지, 작은 커터칼
- 분위기: 빠르고 예민한 미성숙한 생존자

### Positive Prompt

```text
masterpiece, best quality, amazing quality,
1boy, solo, Korean teenage high school boy survivor,
short spiky black hair, sweaty messy bangs,
young anxious face, frightened eyes trying to look tough,
school shirt under black hoodie, loosened tie, sneakers,
holding a phone with cracked screen and small snack bag,
small utility cutter clipped to pocket,
defensive posture, impulsive nervous energy,
supermarket snack aisle, fallen chips, dark shelves,
flickering fluorescent light, red emergency glow,
upper body portrait, three-quarter view, semi-real anime illustration
```

### Negative Prompt

```text
adult man, old man, female, overly cute child, elementary student,
sexy outfit, idol stage outfit, fantasy armor, large weapon,
confident hero smile, calm mature expression, blood gore,
low quality, bad anatomy, bad hands, extra fingers, text, watermark,
multiple characters
```

---

## 정미라

마트 매니저. 공간을 가장 잘 아는 필수 인물이지만, 통제권을 잃는 것을 견디지 못한다.

### 외형 설정

- 헤어스타일: 단정한 검은 단발, 흐트러진 머리를 억지로 귀 뒤에 넘김
- 얼굴: 날카로운 눈매, 피곤하지만 고압적인 표정
- 의상: 마트 관리자 조끼, 흰 블라우스, 검은 슬랙스, 사원증
- 소품: 열쇠 뭉치, 매장 무전기, 구겨진 매장 지도
- 분위기: 책임감과 권위욕이 섞인 현실적 리더

### Positive Prompt

```text
masterpiece, best quality, amazing quality,
1girl, solo, adult Korean woman, supermarket manager survivor,
neat black bob haircut, hair tucked behind one ear,
sharp eyes, tired authoritative expression,
store manager vest, white blouse, black slacks, employee ID badge,
holding a keyring, store radio, crumpled floor map,
standing in front of staff only door,
controlled posture, tense leadership conflict,
dim supermarket office entrance, warning labels, emergency light,
upper body portrait, three-quarter view, semi-real anime illustration
```

### Negative Prompt

```text
male, child, idol smile, princess dress, office lady glamour,
maid outfit, fantasy robe, military uniform, blood-covered clothes,
helpless crying pose, zombie face, low quality, bad anatomy,
bad hands, extra fingers, text, watermark, multiple characters
```

---

## 한승우

마트 경비원. 동료 마석훈을 냉동고에 가둔 죄책감 때문에 문 너머의 소리를 사람처럼 듣는다.

### 외형 설정

- 헤어스타일: 짧은 회갈색 머리, 흐트러진 앞머리
- 얼굴: 마른 얼굴, 떨리는 눈, 핏기 없는 입술
- 의상: 낡은 경비복, 어깨가 내려앉은 방검 조끼, 손전등 벨트
- 소품: 냉동고 열쇠, 경비봉, 구겨진 근무표
- 분위기: 죄책감에 짓눌린 조용한 목격자

### Positive Prompt

```text
masterpiece, best quality, amazing quality,
1boy, solo, adult Korean man, supermarket security guard survivor,
short gray brown hair, messy bangs,
thin tired face, trembling eyes, pale lips,
worn security uniform, sagging protective vest, flashlight belt,
holding freezer key and crumpled duty roster,
security baton hanging unused at his side,
guilty hunched posture, haunted witness,
standing near closed freezer door with frost and scratch marks,
cold blue freezer mist, flickering light, red emergency reflection,
upper body portrait, three-quarter view, semi-real anime illustration
```

### Negative Prompt

```text
female, child, police officer hero, soldier, confident smile,
clean formal uniform, fantasy armor, gun, attacking pose,
zombie bite wound, excessive gore, low quality, bad anatomy,
bad hands, extra fingers, text, watermark, multiple characters
```

---

## 김보라

딸에게 돌아가야 한다는 절박함 때문에 가장 빠르게 무너질 수 있는 생존자.

### 외형 설정

- 헤어스타일: 어깨 아래 갈색 머리, 급하게 묶은 낮은 포니테일
- 얼굴: 마른 뺨, 붉어진 눈가, 불안하게 떨리는 입술
- 의상: 아이보리 니트, 긴 카키 코트, 편한 바지
- 소품: 딸의 사진이 들어 있는 휴대폰, 작은 캐릭터 머리핀, 분유통
- 분위기: 조용하지만 딸 이야기 앞에서는 폭발하는 절박함

### Positive Prompt

```text
masterpiece, best quality, amazing quality,
1girl, solo, adult Korean mother survivor,
shoulder length brown hair in a rushed low ponytail,
thin cheeks, reddened eyes, trembling lips,
ivory knit sweater, long khaki coat, practical pants,
holding a phone showing her daughter's photo,
small child hairpin and baby formula can in tote bag,
desperate maternal fear, quiet panic about to break,
supermarket baby goods aisle, fallen diapers, dim shelves,
flickering fluorescent light, emergency red glow,
upper body portrait, three-quarter view, semi-real anime illustration
```

### Negative Prompt

```text
male, child, pregnant belly emphasis, glamour pose, sexy outfit,
cheerful smile, fantasy dress, queen, magical girl, large weapon,
excessive gore, zombie face, low quality, bad anatomy, bad hands,
extra fingers, text, watermark, multiple characters
```

---

## 마석훈

좀비가 된 식품관 직원. 냉동고 안에 갇혀 있지만 소리와 냄새를 따라 문을 두드린다. 한때 사람이었다는 흔적이 남아 있어 더 불편하다.

### 외형 설정

- 헤어스타일: 짧은 검은 머리, 얼음 결정과 땀으로 엉겨 붙은 앞머리
- 얼굴: 회색빛 피부, 초점 없는 눈, 턱 주변의 검은 핏자국은 과하지 않게
- 의상: 녹색 마트 식품관 유니폼, 흰 앞치마, 찢어진 명찰
- 소품: 냉동고 문 유리 너머의 손자국, 성에 낀 손
- 분위기: 괴물이 되었지만 아직 직원 명찰이 남아 있는 비극적 위협

### Positive Prompt

```text
masterpiece, best quality, amazing quality,
1boy, solo, adult Korean male zombie supermarket worker,
short black hair stuck with frost and sweat,
gray dead skin, unfocused cloudy eyes, slack jaw,
subtle dark blood around mouth, no excessive gore,
green supermarket food court uniform, white apron, torn name tag,
frosted hands pressed against freezer glass,
trapped inside industrial freezer, scratch marks on metal door,
cold blue freezer mist, harsh fluorescent light, horror tension,
tragic former human presence, slow aggressive movement,
upper body portrait, three-quarter view, semi-real anime illustration
```

### Negative Prompt

```text
female, child, handsome clean face, normal healthy skin,
smiling human expression, cute monster, fantasy demon, horns,
exposed organs, dismemberment, excessive gore, huge zombie horde,
bright daylight, clean background, low quality, bad anatomy,
bad hands, extra fingers, text, watermark, multiple characters
```

---

## 단체 키 비주얼 프롬프트

### Positive Prompt

```text
masterpiece, best quality, amazing quality,
Korean modern zombie survival horror key visual,
nine survivors trapped in a dark supermarket food court,
ordinary male protagonist with flashlight at center,
former firefighter leader, calculating woman in trench coat,
dangerous man with metal pipe, nurse with medical pouch,
teenage student with cracked phone, supermarket manager with keyring,
guilty security guard, desperate mother with daughter's phone,
zombie supermarket worker silhouette behind frosted freezer door,
flickering fluorescent lights, emergency red light, cold freezer mist,
scattered groceries, wet reflective floor, tense distrustful atmosphere,
semi-real anime illustration, cinematic composition, no text
```

### Negative Prompt

```text
low quality, worst quality, blurry, bad anatomy, bad hands,
same face, identical hairstyles, duplicate bodies, missing characters,
more than ten main characters, fewer than ten story figures,
fantasy armor, medieval setting, cyberpunk city, comedy mood,
excessive gore, dismemberment, exposed organs, text, logo, watermark
```
