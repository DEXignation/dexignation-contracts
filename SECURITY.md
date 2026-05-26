# Security Policy / 보안 정책

## Supported Versions / 지원 버전

DEXignation is pre-audit and pre-mainnet. Security fixes will land on the
`main` branch and be tagged with a patch release.

DEXignation은 감사 전, 메인넷 배포 전 단계입니다. 보안 수정은 `main` 브랜치에
머지되고 패치 릴리스로 태깅됩니다.

| Version | Supported |
|---|---|
| `main` (latest) | ✅ |
| Tagged releases | ✅ |
| Forks / mirrors | ❌ |

---

## Reporting a Vulnerability / 취약점 제보

**Please do not open a public GitHub issue for security vulnerabilities.**

**보안 취약점은 공개 GitHub 이슈로 올리지 마세요.**

Instead, contact us privately at one of the following:

대신 아래 비공개 경로로 알려주세요:

- **Email**: `security@dexignation.com`
- **Website**: https://dexignation.com
- **PGP key**: fingerprint published at https://dexignation.com (footer)
- **Signal**: on request via email

We aim to acknowledge reports within **48 hours** and to issue an initial
triage within **5 business days**.

48시간 내 수신 확인, 5영업일 내 1차 분석 결과 회신을 목표로 합니다.

### What to include / 제보에 포함할 내용

- Affected contract(s) and version (commit SHA or release tag)
- Reproduction steps or proof-of-concept
- Impact assessment (funds at risk, who is affected, how)
- Your preferred attribution (handle / anonymous)

영향 받는 컨트랙트와 버전, 재현 절차 또는 PoC, 영향도, 공로 표기 선호 형태.

---

## Scope / 범위

### In scope / 범위 내

- All contracts under `contracts/registry/`, `contracts/registrar/`,
  `contracts/resolver/`, `contracts/oracle/`, `contracts/utils/`
- Deployment scripts that affect production state
- Documentation that could lead a user to lose funds (e.g. incorrect
  integration examples)

### Out of scope / 범위 외

- `contracts/mocks/` (test only)
- Front-end repositories (handled separately)
- DoS via gas-price manipulation on public RPCs
- Issues requiring social engineering or physical access
- Theoretical attacks without a feasible exploitation path

---

## Disclosure Policy / 공개 정책

We follow **coordinated disclosure**:

- Reporter and DEXignation agree on a fix and a public-disclosure date.
- DEXignation deploys the fix and verifies no funds are at risk.
- A post-mortem is published, with credit to the reporter (unless they
  prefer to remain anonymous).

**조율된 공개**를 원칙으로 합니다. 수정 후 포스트모템을 공개하며 제보자에게
공로를 표기합니다.

---

## Bug Bounty / 버그 바운티

A formal bug-bounty program will be announced after the first independent
audit. Until then, we evaluate severe findings on a case-by-case basis and
will recognise meaningful contributions.

최초 독립 감사 후 정식 바운티 프로그램을 공개합니다. 그 이전 단계에서도
중대한 발견은 개별 평가하여 의미 있는 기여로 인정합니다.

---

## Acknowledgements / 감사

Security researchers who contribute to DEXignation's safety will be listed
in our public hall of fame (with consent). Thank you for helping protect
DEXignation users.

DEXignation의 안전성에 기여한 보안 연구자분들은 공개 hall of fame에
표기됩니다(동의 시). 감사합니다.
