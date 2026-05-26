# PLAN: Model Selector Feature

## Overview

현재 이미지 생성 시 엔드포인트는 참조 이미지 유무에 따라 자동 결정된다 (`fast-sdxl` / `ip-adapter` / `ip-adapter-face-id`). 사용자가 직접 모델을 선택할 수 있는 UI를 추가하여 다양한 fal.ai 모델을 활용할 수 있게 한다.

## Supported Models

fal.ai에서 제공하는 주요 이미지 생성 모델:

| ID | Model | Description | 특징 |
|----|-------|-------------|------|
| `fal-ai/fast-sdxl` | SDXL | 기본 SDXL 텍스트→이미지 | 빠른 생성, LoRA 지원 |
| `fal-ai/flux/dev` | Flux Dev | 고품질 Flux 모델 | 높은 품질, 느림 |
| `fal-ai/flux/schnell` | Flux Schnell | 빠른 Flux 모델 | 4 steps로 빠른 생성 |
| `fal-ai/flux-lora` | Flux + LoRA | Flux에 LoRA 적용 | LoRA 지원 Flux |
| `fal-ai/stable-diffusion-v35-large` | SD 3.5 Large | SD 3.5 대형 모델 | 최신 아키텍처 |
| `fal-ai/ip-adapter-face-id` | IP-Adapter FaceID | 캐릭터 참조 | 캐릭터 이미지 필요 |
| `fal-ai/ip-adapter` | IP-Adapter | 스타일 참조 | 스타일 이미지 필요 |

## Changes Required

### 1. types.ts — 모델 정의 추가
- `ModelConfig` 타입: id, name, description, supports (lora, ip_adapter, face_id)
- `AVAILABLE_MODELS` 상수 배열
- `GenerationParams`에 `model` 필드 추가

### 2. generate/route.ts — 모델별 엔드포인트 분기
- 사용자가 선택한 모델을 우선 사용
- IP-Adapter/FaceID 모델은 참조 이미지가 있을 때만 유효
- 모델별 input 파라미터 형식 차이 처리

### 3. UI — 모델 셀렉터 컴포넌트
- 사이드바에 모델 선택 드롭다운/그리드 추가
- 선택한 모델의 capabilities 표시 (LoRA 지원 여부, 참조 이미지 필요 여부)
- 호환되지 않는 파라미터는 자동 비활성화

## Implementation Roadmap

### Phase 1: Model Selector (design_needed=false)

| # | Task | Description | Files |
|---|------|-------------|-------|
| 1.1 | 모델 타입 정의 | ModelConfig, AVAILABLE_MODELS 상수, GenerationParams.model 필드 | `src/lib/types.ts` |
| 1.2 | 모델 셀렉터 UI | 모델 선택 컴포넌트 (그리드/리스트), capabilities 표시 | `src/components/model-selector.tsx` |
| 1.3 | 메인 페이지 통합 | 사이드바에 모델 셀렉터 배치 | `src/app/page.tsx` |
| 1.4 | API 라우트 수정 | 모델별 엔드포인트/input 분기 로직 | `src/app/api/generate/route.ts` |
| 1.5 | 파라미터 연동 | 모델 변경 시 비호환 파라미터 자동 조정 | `src/components/generation-params.tsx` |

## Complexity: SIMPLE
- 1 Phase, 5 Tasks
- 기존 파일 수정 위주 + 1개 신규 컴포넌트
