# PLAN: NSFW Image Generation Service

## Overview

프롬프트 + 스타일 참조 이미지 + 캐릭터 참조 이미지를 입력하면, 해당 스타일로 캐릭터의 NSFW 이미지를 생성하는 웹 서비스.

상용 이미지 모델(DALL-E, Midjourney 등)은 NSFW 콘텐츠 정책으로 사용 불가하므로, HuggingFace의 오픈소스 모델 + LoRA + 서버리스 GPU(fal.ai)를 활용한다.

## Core User Flow

```
1. 사용자가 웹 UI에 접속
2. 스타일 참조 이미지 업로드 (원하는 화풍/스타일)
3. 캐릭터 참조 이미지 업로드 (생성할 캐릭터)
4. 프롬프트 입력 (포즈, 배경, 상황 등 묘사)
5. 생성 파라미터 조정 (optional: steps, CFG scale, seed, LoRA 선택)
6. "Generate" 클릭
7. 서버가 fal.ai GPU에 추론 요청
8. 생성된 이미지를 갤러리에 표시
9. 이미지 다운로드 / 재생성 / 파라미터 미세조정
```

## Technical Architecture

### System Diagram (C4 Level 1)

```
┌─────────────────────────────────────────────────────┐
│                    User (Browser)                    │
└─────────────────┬───────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────┐
│              Next.js App (Frontend + API)            │
│  ┌────────────┐  ┌────────────┐  ┌───────────────┐  │
│  │  Upload UI  │  │ Prompt UI  │  │  Gallery UI   │  │
│  └────────────┘  └────────────┘  └───────────────┘  │
│  ┌──────────────────────────────────────────────┐   │
│  │           API Routes (/api/generate)          │   │
│  │           API Routes (/api/images)            │   │
│  │           API Routes (/api/models)            │   │
│  └──────────────────┬───────────────────────────┘   │
└─────────────────────┼───────────────────────────────┘
                      │
        ┌─────────────▼──────────────┐
        │      fal.ai Serverless GPU  │
        │  ┌───────────────────────┐  │
        │  │ SDXL / Flux Pipeline  │  │
        │  │ + IP-Adapter (style)  │  │
        │  │ + IP-Adapter Face     │  │
        │  │ + LoRA weights        │  │
        │  └───────────────────────┘  │
        └─────────────┬──────────────┘
                      │
        ┌─────────────▼──────────────┐
        │   Local Storage / output/   │
        │   (generated images)        │
        └────────────────────────────┘
```

### Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Frontend | Next.js 15 + React 19 + Tailwind CSS | 풀스택 프레임워크, API Routes 내장 |
| UI Components | shadcn/ui | 빠른 UI 구성, 다크 테마 지원 |
| GPU Inference | fal.ai Serverless | API 키 보유, 서버리스 GPU, 커스텀 모델 지원 |
| Base Model | SDXL (uncensored checkpoints) | LoRA/IP-Adapter 생태계 성숙, NSFW 가능 |
| Style Transfer | IP-Adapter | 참조 이미지 기반 스타일 전이 |
| Character Ref | IP-Adapter FaceID | 캐릭터 얼굴/특징 유지 |
| LoRA | HuggingFace Hub | 스타일/캐릭터 커스터마이징 |
| Image Storage | Local filesystem (output/) | 초기에는 로컬, 추후 S3/R2 확장 가능 |
| State | Zustand | 클라이언트 상태 관리 (생성 큐, 갤러리) |

### Key Technical Decisions

#### ADR-001: fal.ai as Primary GPU Provider

**Context**: NSFW 이미지 생성을 위해 서버리스 GPU가 필요함.

**Options considered**:
1. **fal.ai** — 이미 API 키 보유, SDXL/Flux 엔드포인트 제공, 커스텀 모델 배포 가능
2. **RunPod Serverless** — 더 유연하나 설정 복잡, 콜드 스타트 길 수 있음
3. **Replicate** — Cog 컨테이너 필요, 커스텀 모델 배포에 추가 작업
4. **OpenRouter** — LLM 중심, 이미지 생성 모델 제한적
5. **Self-hosted (로컬 GPU)** — 비용 효율적이나 항상 가동 필요

**Decision**: fal.ai를 1차 프로바이더로 사용. fal.ai의 SDXL/Flux 엔드포인트가 콘텐츠 필터링을 적용할 경우, fal.ai의 커스텀 함수(fal-serverless)를 통해 자체 파이프라인을 배포하거나 RunPod으로 폴백.

**Consequences**: 
- fal.ai 종속성 (추상화 레이어로 교체 용이하게 설계)
- 커스텀 파이프라인 배포 시 추가 설정 필요 가능

#### ADR-002: SDXL + IP-Adapter Pipeline

**Context**: 스타일 참조 + 캐릭터 참조를 동시에 처리해야 함.

**Options considered**:
1. **SDXL + IP-Adapter** — 성숙한 생태계, IP-Adapter로 스타일+캐릭터 동시 처리
2. **Flux.1 Dev + LoRA** — 더 높은 품질, 그러나 IP-Adapter 지원 초기 단계
3. **ComfyUI Pipeline** — 가장 유연, fal.ai에서 ComfyUI 워크플로우 실행 가능

**Decision**: Phase 1에서 fal.ai의 기본 SDXL 엔드포인트 + IP-Adapter로 시작. Phase 3에서 ComfyUI 커스텀 파이프라인으로 확장하여 더 세밀한 제어 가능하게.

**Consequences**:
- 점진적 복잡도 증가
- Phase 1에서 빠르게 동작하는 MVP 확보

## Image Generation Pipeline Detail

```
Input:
  - prompt: string (사용자 입력 프롬프트)
  - negative_prompt: string (제외할 요소)
  - style_image: File (스타일 참조)
  - character_image: File (캐릭터 참조)
  - lora_weights: string[] (적용할 LoRA 목록)
  - params: { steps, cfg_scale, width, height, seed }

Pipeline:
  1. Upload style_image & character_image to fal.ai (또는 base64 전달)
  2. fal.ai 엔드포인트 호출:
     - model: SDXL base (uncensored)
     - ip_adapter_image: style_image (스타일 전이)
     - ip_adapter_face_image: character_image (캐릭터 유지)
     - loras: [{path, scale}] (추가 스타일 LoRA)
     - prompt + negative_prompt
     - generation params
  3. Polling / webhook으로 결과 수신
  4. 결과 이미지를 로컬 저장 + 메타데이터 기록

Output:
  - generated_image: File
  - metadata: { prompt, params, seed, model, loras, timestamp }
```

## Implementation Roadmap

### Phase 1: Project Setup + Core UI (design_needed=true)
> MVP: 프롬프트 입력과 기본 이미지 생성이 동작하는 최소 서비스

| # | Task | Description |
|---|------|-------------|
| 1.1 | 프로젝트 초기화 | Next.js 15 + Tailwind + shadcn/ui 셋업 |
| 1.2 | 레이아웃 구성 | 다크 테마 기본, 사이드바/메인 레이아웃 |
| 1.3 | 프롬프트 입력 UI | 프롬프트 + 네거티브 프롬프트 텍스트에어리어 |
| 1.4 | 이미지 업로드 UI | 스타일 참조 + 캐릭터 참조 드래그앤드롭 업로드 |
| 1.5 | 생성 파라미터 패널 | Steps, CFG Scale, 크기, Seed 슬라이더/입력 |
| 1.6 | 생성 결과 표시 | 생성된 이미지 표시 + 로딩 상태 |
| 1.7 | 환경변수 설정 | fal.ai API 키 등 .env 구성 |

### Phase 2: fal.ai Integration + Generation Pipeline (design_needed=false)
> 핵심: 실제 이미지 생성 파이프라인 구현

| # | Task | Description |
|---|------|-------------|
| 2.1 | fal.ai 클라이언트 설정 | @fal-ai/client 패키지 설치 + 초기화 |
| 2.2 | 생성 API 라우트 | POST /api/generate — 프롬프트+이미지 수신, fal.ai 호출 |
| 2.3 | SDXL 엔드포인트 연동 | fal.ai SDXL 엔드포인트 호출 (기본 텍스트→이미지) |
| 2.4 | IP-Adapter 스타일 적용 | style_image를 IP-Adapter로 전달하여 스타일 전이 |
| 2.5 | IP-Adapter Face 적용 | character_image를 FaceID IP-Adapter로 전달 |
| 2.6 | LoRA 적용 | HuggingFace LoRA 경로 지정하여 추가 스타일 적용 |
| 2.7 | 비동기 생성 + 폴링 | 생성 요청 후 상태 폴링, 프로그레스 표시 |
| 2.8 | 결과 저장 | 생성 이미지를 output/ 디렉토리에 저장 + 메타데이터 JSON |
| 2.9 | 에러 핸들링 | fal.ai 에러, 타임아웃, 콘텐츠 필터 대응 |

### Phase 3: Gallery + Scrap (design_needed=true)
> 생성된 이미지 관리 + 재사용

| # | Task | Description |
|---|------|-------------|
| 3.1 | 갤러리 뷰 | 생성된 이미지 그리드 표시, 라이트박스 |
| 3.2 | 이미지 메타데이터 표시 | 클릭 시 프롬프트, 파라미터, 시드 등 표시 |
| 3.3 | 파라미터 재사용 | 이전 생성의 파라미터를 복사하여 재생성 |
| 3.4 | 이미지 다운로드 | 원본 해상도 다운로드 |
| 3.5 | 이미지 삭제 | 불필요한 이미지 정리 |
| 3.6 | 검색/필터 | 프롬프트 키워드로 이미지 검색 |

### Phase 4: Advanced Features (design_needed=false)
> 파워 유저 기능

| # | Task | Description |
|---|------|-------------|
| 4.1 | LoRA 브라우저 | HuggingFace에서 LoRA 검색 + 선택 UI |
| 4.2 | 프리셋 시스템 | 자주 쓰는 파라미터 조합 저장/불러오기 |
| 4.3 | 배치 생성 | 동일 프롬프트로 여러 시드 동시 생성 |
| 4.4 | img2img 모드 | 기존 이미지를 기반으로 변형 생성 |
| 4.5 | 모델 선택 | SDXL 외 다른 체크포인트 선택 가능 |
| 4.6 | ComfyUI 파이프라인 | 고급 사용자용 ComfyUI 워크플로우 연동 |

## fal.ai Integration Strategy

### Phase 1-2: 기본 엔드포인트 활용

```typescript
// fal.ai 기본 SDXL 엔드포인트
import { fal } from "@fal-ai/client";

fal.config({ credentials: process.env.FAL_KEY });

const result = await fal.subscribe("fal-ai/ip-adapter-face-id", {
  input: {
    prompt: "...",
    negative_prompt: "...",
    face_image_url: "...",      // 캐릭터 참조
    ip_adapter_image_url: "...", // 스타일 참조  
    num_inference_steps: 30,
    guidance_scale: 7.5,
    loras: [
      { path: "huggingface-repo/lora-name", scale: 0.8 }
    ]
  }
});
```

### Fallback: 콘텐츠 필터 시

fal.ai 기본 엔드포인트가 NSFW 필터링을 적용할 경우:

1. **fal-serverless 커스텀 함수**: 자체 Diffusers 파이프라인을 fal.ai에 배포
2. **RunPod Serverless**: 완전한 제어가 가능한 GPU 엔드포인트
3. **HuggingFace Inference Endpoints**: 전용 GPU 엔드포인트 (비용 높음)

## Non-Functional Requirements

- **성능**: 1장 생성 30초 이내 (SDXL 30 steps 기준)
- **동시성**: 개인 사용 목적, 동시 1-2건 생성 충분
- **보안**: 개인 사용 서비스, 인증 불필요 (localhost)
- **저장소**: 로컬 파일시스템, 이미지당 ~2-5MB
- **비용**: fal.ai pay-per-use, 이미지당 ~$0.01-0.05

## Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| fal.ai가 NSFW 콘텐츠 필터링 | 핵심 기능 차단 | 중 | fal-serverless 커스텀 파이프라인 또는 RunPod 폴백 |
| IP-Adapter 품질이 기대 이하 | UX 저하 | 중 | ControlNet + 다른 참조 기법 조합 테스트 |
| fal.ai 콜드 스타트 지연 | 첫 생성 느림 | 낮 | 프로그레스 UI로 사용자 경험 완화 |
| LoRA 호환성 문제 | 특정 LoRA 적용 불가 | 중 | 검증된 LoRA 목록 사전 큐레이션 |
| HuggingFace 모델 접근 제한 | 모델 로드 실패 | 낮 | 여러 미러/대체 모델 목록 유지 |

## Template Foundation
- **frontend_template**: none (zero-base)
- **backend_template**: none (Next.js API Routes 사용)
- **strategy**: zero-base
