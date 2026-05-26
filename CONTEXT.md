# Domain Context

## Language

| Term | Definition (한국어) | Avoid |
|------|-------------------|-------|
| IP-Adapter | 참조 이미지의 특징을 생성 이미지에 전이하는 어댑터 모듈 | "이미지 복사", "스타일 필터" |
| FaceID | IP-Adapter의 얼굴 특화 변형, 캐릭터의 얼굴 특징을 유지 | "얼굴 인식", "face detection" |
| LoRA | Low-Rank Adaptation, 모델의 스타일/특성을 조정하는 경량 가중치 | "모델 전체 파인튜닝", "full fine-tune" |
| CFG Scale | Classifier-Free Guidance, 프롬프트 충실도 강도 조절 | "해상도", "품질" |
| Negative Prompt | 생성에서 제외할 요소를 기술하는 프롬프트 | "안 되는 것", "금지어" |
| Inference Steps | 이미지 생성의 디노이징 반복 횟수, 많을수록 정교 | "렌더링 시간", "품질 단계" |
| Checkpoint | Stable Diffusion 전체 모델 가중치 파일 | "LoRA", "어댑터" |
| SDXL | Stable Diffusion XL, 1024x1024 기본 해상도의 고품질 모델 | "SD 1.5", "이전 버전" |
| img2img | 기존 이미지를 기반으로 변형/수정 생성하는 모드 | "편집", "포토샵" |
| Seed | 생성 결과의 재현성을 보장하는 난수 시드값 | "비밀번호", "키" |
| fal-serverless | fal.ai의 커스텀 함수 배포 기능, 자체 파이프라인 실행 | "서버", "VM" |

## Relationships

- LoRA는 Checkpoint 위에 추가로 적용되는 가중치이며, 독립 실행 불가
- IP-Adapter와 FaceID는 동시 적용 가능 (스타일 + 캐릭터)
- CFG Scale과 Inference Steps는 독립적인 파라미터이며, 둘 다 생성 품질에 영향

## Flagged Ambiguities

- "모델": Checkpoint vs LoRA vs IP-Adapter 중 어느 것을 지칭하는지 문맥 확인 필요
- "스타일": IP-Adapter 스타일 vs LoRA 스타일 — 전자는 이미지 참조, 후자는 학습된 가중치
