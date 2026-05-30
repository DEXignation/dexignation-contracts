# DXRegistrar.sol 수정 사항 요약

**최종 코드 파일**: `DXRegistrar-FINAL-READY.sol`

---

## 📝 변경사항

### 1️⃣ GRACE_PERIOD를 동적 변수로 변경

**Before (기존):**
```solidity
uint256 public constant GRACE_PERIOD = 70 days;
```

**After (수정):**
```solidity
uint256 public gracePeriod = 70 days;
```

**이유**: 배포 후 필요시 owner가 유예 기간을 동적으로 조정 가능하도록 변경

---

### 2️⃣ setGracePeriod() 함수 추가

**위치**: OWNER FUNCTIONS 섹션 (setRoyaltyInfo() 다음)

```solidity
/// @notice Update the grace period (renewal window after expiry).
///         Owner-only. Must be between 7 days and 365 days.
///         유예 기간 조정. 오너 전용. 7일~365일 범위만 허용.
/// @param _newGracePeriod   New grace period in seconds.
function setGracePeriod(uint256 _newGracePeriod) external onlyOwner {
  uint256 minGrace = 7 days;
  uint256 maxGrace = 365 days;
  
  if (_newGracePeriod < minGrace || _newGracePeriod > maxGrace) {
    revert GracePeriodOutOfRange(_newGracePeriod, minGrace, maxGrace);
  }
  
  gracePeriod = _newGracePeriod;
  emit GracePeriodUpdated(_newGracePeriod);
}
```

---

### 3️⃣ Custom Error 추가

```solidity
error GracePeriodOutOfRange(uint256 requested, uint256 min, uint256 max);
```

---

### 4️⃣ Event 추가

```solidity
event GracePeriodUpdated(uint256 indexed newGracePeriod);
```

---

### 5️⃣ 코드 내 GRACE_PERIOD 참조 변경

**Before:**
```solidity
return expiries[id] + GRACE_PERIOD < block.timestamp;
```

**After:**
```solidity
return expiries[id] + gracePeriod < block.timestamp;
```

**변경 위치**:
- `available()` 함수
- `register()` 함수
- `renew()` 함수
- `burn()` 함수

---

## 🔍 사용 방법

### 1. Grace Period 조회
```solidity
uint256 currentGrace = registrar.gracePeriod();  // 70 days (초기값)
```

### 2. Grace Period 변경 (Owner만)
```solidity
// 70일로 유지
registrar.setGracePeriod(70 days);

// 90일로 변경
registrar.setGracePeriod(90 days);

// 30일로 변경
registrar.setGracePeriod(30 days);
```

### 3. 범위 밖으로 설정 시도 (Revert)
```solidity
// ❌ 실패: 3일은 최소 7일 미만
registrar.setGracePeriod(3 days);

// ❌ 실패: 400일은 최대 365일 초과
registrar.setGracePeriod(400 days);
```

---

## ✅ 확인 사항

- ✅ `gracePeriod` 초기값: 70 days
- ✅ 범위: 7 days ~ 365 days
- ✅ 권한: onlyOwner (owner만 호출 가능)
- ✅ 이벤트: GracePeriodUpdated 발생
- ✅ 모든 참조 위치 업데이트: available(), register(), renew(), burn()
- ✅ English + 한글 주석 모두 포함

---

## 📌 주의사항

1. **배포 후 바로 사용 가능**
   - 컴파일 후 배포하면 gracePeriod는 자동으로 70 days로 초기화됨

2. **변경 시 영향**
   - gracePeriod 변경 후 발행되는 도메인에 적용
   - 이미 발행된 도메인의 만료 기간은 영향 없음

3. **이벤트 로깅**
   - 모든 setGracePeriod() 호출은 GracePeriodUpdated 이벤트 발생
   - 온체인에 기록되어 감사(audit) 가능

---

## 📂 최종 파일 위치

`/mnt/user-data/outputs/DXRegistrar-FINAL-READY.sol`

이 파일을 그대로 프로젝트에 복사-붙여넣기하면 됩니다. ✅

