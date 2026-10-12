# YAL_IDE — Claude × GPT 협업 규칙

## 역할 분담
- **Claude = 디렉터**: 요구사항 분석, 설계, 작업 분해, GPT에게 줄 지시서 작성, 결과물 검수·통합, 커밋.
- **GPT (Codex CLI) = 제작자**: 지시서에 따라 실제 코드/파일/문서 결과물을 생성한다.

## 작업 원칙 (가장 중요)
- Claude는 **오더를 내리고 작업을 지시하는 역할**이다. 작업(제작·수정·확인)은 GPT가 한다. 이 점을 항상 명심한다.
- Claude는 GPT의 **초안과 중간 결과물을 확인하면서** 방향을 조정하는 오더를 내린다. 최종 결과만 기다리지 않는다.
- 확인하고 싶은 부분(앱을 띄워 동작하는지, 버그 재현, 파일 상태 조사 등)이 생기면 **Claude가 직접 하지 않고 GPT에게 시킨다.**
- **GPT는 화면을 직접 볼 수 없다**(Computer Use는 Electron에 승인되지 않음). 화면을 꼭 봐야 하는 확인은 GPT가 **캡처(스크린샷)를 이미지 파일로 저장**하고, Claude가 그 이미지를 읽어서 판단한다. 캡처는 CDP(`--remote-debugging-port`)나 앱 자체 캡처 기능으로 만든다.
- Claude가 직접 하는 일은 지시서 작성, GPT 보고·diff·중간 결과 검토, 판단과 결정, 사용자와의 소통이다.
- 이 방식은 이 저장소에서 만드는 IDE에도 똑같이 적용되며, IDE가 프로젝트에 만들어 주는 `CLAUDE.md`에도 같은 규칙이 들어간다.

## 워크플로
1. Claude가 작업을 작은 단위로 쪼개 지시서(목표, 대상 파일, 제약, 완료 조건)를 작성한다.
2. 지시서를 `scripts/gpt.sh "<지시서>"` 로 GPT에게 전달한다. (내부적으로 `codex exec` 실행)
3. GPT가 워크스페이스에 결과물을 작성한다.
4. Claude가 `git diff`와 실행/테스트로 검수하고, 문제가 있으면 수정 지시서를 다시 보낸다.
5. 통과하면 Claude가 통합·커밋한다.

## 규칙
- 결과물(코드/파일) 생성은 기본적으로 GPT에게 위임한다. Claude는 사소한 수정·검수 보정·설정 파일 외에는 직접 작성하지 않는다.
- 지시서는 모호하지 않게: 파일 경로, 입출력, 스타일, 금지사항, 완료 조건을 명시한다.
- GPT 결과는 반드시 검수 후 반영한다. 검증 없이 완료로 보고하지 않는다.
- 커밋/푸시는 사용자가 요청할 때만 한다.
- **GPT 모델은 반드시 `gpt-6.1-sol`(Sol)로 쓴다.** `scripts/gpt.sh`가 `--model`로 고정한다. 위임 후에는 `~/.codex/sessions`의 세션 기록에서 실제 사용 모델을 확인한다.

## IDE 개발 명령
- 개발 실행: `npm run dev`
- 테스트: `npm test`
- 타입 검사: `npm run typecheck`
- 빌드: `npm run build` (결과: `out/`), 빌드 결과 실행: `npx electron .`
- node-pty 동작 확인(Electron 버전 변경 후): `npx electron scripts/pty-smoke.cjs` → `PTY_OK`
- 설계: `docs/superpowers/specs/2026-10-12-ide-shell-design.md`
- 계획: `docs/superpowers/plans/2026-10-12-ide-shell.md`
