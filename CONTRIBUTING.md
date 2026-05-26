# Contributing to DEXignation / DEXignation 기여 가이드

Thank you for considering a contribution. This document explains how to
report issues, propose changes, and get your pull request merged.

기여를 고려해주셔서 감사합니다. 본 문서는 이슈 신고, 변경 제안, PR 머지
절차를 설명합니다.

---

## Before you start / 시작 전

- Smart-contract changes that touch state, payment flow, or access control
  require an issue and design discussion before a PR.
- Documentation, test coverage, comments, and tooling improvements can be
  proposed directly as a PR.
- **Do not** open public issues for security vulnerabilities. See
  [`SECURITY.md`](./SECURITY.md).

state, 결제 흐름, 권한에 영향을 주는 컨트랙트 변경은 PR 전에 이슈/설계 논의
필요. 문서/테스트/주석/툴링 개선은 PR 직접 제출 가능. 보안 취약점은 공개
이슈 금지 — [`SECURITY.md`](./SECURITY.md) 참고.

---

## Development workflow / 개발 워크플로

1. **Fork** the repository and create a topic branch:
   `git checkout -b feat/<short-description>` or `fix/<short-description>`.
2. **Write tests first** for any new behaviour or bug fix.
3. **Run the full test suite locally**: `npx hardhat test`.
4. **Format & lint**: `npm run lint && npm run format`.
5. **Commit** in small, logical units. Follow Conventional Commits where
   reasonable (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`).
6. **Open a pull request** against `main`. Reference any related issue.

토픽 브랜치 → 테스트 우선 → 전체 테스트 통과 → lint/format → 작은 커밋 단위
→ `main` 대상 PR.

---

## Pull request checklist / PR 체크리스트

- [ ] Tests cover the change (positive + negative cases).
- [ ] No new compiler warnings.
- [ ] Public functions have NatSpec comments in **both English and Korean**.
- [ ] No hard-coded addresses, private keys, RPC URLs, or API keys.
- [ ] If touching ENS-derived code: header attribution still accurate.
- [ ] `THIRD-PARTY-LICENSES.md` updated if new dependencies were added.
- [ ] No breaking interface changes without a deprecation path.

테스트 커버리지, 컴파일 경고 없음, 영문/한글 NatSpec, 시크릿 하드코딩 없음,
ENS 파생 코드의 헤더 정확성, 신규 의존성 추가 시 라이선스 문서 갱신, 호환성
파괴 없음.

---

## Coding conventions / 코딩 컨벤션

### Solidity

- Solidity `^0.8.28`, MIT licensed unless explicitly stated.
- Use **custom errors** instead of `require(...)` strings.
- Prefer **immutable** for constructor-set addresses and TLD-level values.
- All external functions must be covered by at least one happy-path test
  and one revert-path test.
- Avoid storage reads in loops; cache them in local variables.
- Public state-changing functions should emit at least one event.

Solidity `^0.8.28`, MIT 라이선스, 커스텀 에러 사용, 생성자 값에 `immutable`
사용, 외부 함수는 성공/실패 케이스 모두 테스트, 루프에서 storage read 회피,
state 변경 함수는 이벤트 발생.

### Comments / 주석

We maintain **bilingual NatSpec** (English + Korean) on every public-facing
function and contract:

공개 함수와 컨트랙트에는 **이중언어 NatSpec**(영어 + 한글)을 유지합니다:

```solidity
/// @notice Register a name paid in native currency.
///         네이티브 통화로 결제하여 이름을 등록.
/// @param label The label to register / 등록할 라벨
function register(string calldata label, ...) external payable { ... }
```

Internal helpers can be commented in English only when the function name
is self-explanatory, but bilingual comments are still preferred.

내부 헬퍼는 함수명이 자명한 경우 영문만으로도 가능하지만, 이중언어를 권장.

---

## Issue reporting / 이슈 신고

When opening a non-security issue, please include:

비보안 이슈를 열 때 포함할 내용:

- Affected commit SHA or release tag
- Minimal reproduction steps
- Expected vs actual behaviour
- Hardhat / Node / network details if relevant

---

## Code of conduct / 행동 강령

Be respectful. Assume good faith. Discuss code, not people. Anyone who
makes the project less welcoming will be warned and, if the behaviour
continues, removed.

상호 존중, 선의 가정, 코드에 대해 토론, 사람에 대해 토론하지 않기.
환영받지 못하는 환경을 만드는 행위는 경고 후 지속 시 제거.

---

## License of contributions / 기여물의 라이선스

By submitting a contribution, you agree that your contribution will be
licensed under the **MIT License** (the same as the rest of the project).
You confirm that you have the right to license the contribution under
these terms.

기여를 제출함으로써, 귀하의 기여물이 프로젝트와 동일한 **MIT License** 하에
라이선스됨에 동의하며, 해당 조건으로 라이선스할 권리가 있음을 확인합니다.
