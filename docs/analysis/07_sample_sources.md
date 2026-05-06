# 07 — Sample Sources & Licensing

뼈대 자산을 어디서 받고 어떤 조건으로 쓸 수 있는가.

## 운영 컨텍스트

**우리는 1인 개발자, 사업자도 아니고 상업 배포도 없다.** 이 컨텍스트가 아래 정리의 톤을 결정한다 — 사실(EULA 텍스트)은 정리하되 "우리한테는 어떻게 적용되나"는 거의 모든 경우 통과로 결론난다. 미래에 스코프가 커지면(공유 갤러리·결제·상업화) 이 문서를 다시 읽고 시나리오를 재평가.

## Live2D 공식 샘플

[https://www.live2d.com/en/learn/sample/](https://www.live2d.com/en/learn/sample/) — Live2D Inc. 직배포.

| 모델 | 캐릭터 톤 | 비고 |
|---|---|---|
| Hiyori (Hiyori Momose) | 풀바디, 다채로운 모션 | 일러스트레이터 Kani Biimu 원작 |
| Haru | 풀바디, 단정한 의상 | |
| Mark (Mark-kun) | 남캐 풀바디 | |
| Koharu / Haruto | SD(짧은 머리, super-deformed) | 작은 시점, 가벼움 |

**EULA**: ["Terms of Use for Live2D Cubism Sample Data"](https://www.live2d.com/en/learn/sample/model-terms/) ([영문](https://www.live2d.com/eula/live2d-sample-model-terms_en.html))

핵심 — 사용자 분류:
- **General Users / Small-scale enterprises**: 동의 시 상업 이용 허용
- **Medium / Large enterprises**: 비공개 테스트만

**우리 입장**: 1인 hobby = General User. 통과.

## nizima

[nizima.com](https://nizima.com/) — Live2D Inc. 운영. 유료 마켓 + 일부 무료. 모델별 EULA가 다양하지만 hobby 사용은 거의 모든 모델이 OK.

## Spine — 공식 / 무료

- **Esoteric Software 공식 샘플**: spineboy, raptor, hero 등. ([spine-runtimes 레포](https://github.com/EsotericSoftware/spine-runtimes))의 `examples/`.
- **Spine Runtime License**: 평가용은 무료, 자체 자산을 가지고 비상업 개인 프로젝트로 쓰는 것은 evaluation 범주에 포함된다고 봐도 무리 없음 ([Esoteric runtimes license](http://esotericsoftware.com/spine-runtimes-license)). 미래에 우리가 결과물을 상업적으로 배포하기 시작할 때 Spine Editor 라이선스($69~) 검토.
- VTuber 톤 무료 Spine 자산은 Live2D만큼 풍부하지 않으나, NIKKE 등 게임 자산을 hobby로 다루는 것은 외부 배포만 안 하면 회색지대 안에서 본인 책임.

**우리 입장**: 1인 hobby = evaluation 범주로 행동하면 된다. 코드 한 줄도 안 짠 단계에서 라이선스 검증으로 시간을 쓰지 않는다.

## 게임 추출 Spine 자산 (NIKKE 등)

- [dotgg.gg/nikke/live2d](https://dotgg.gg/nikke/live2d), 데이터마이닝 커뮤니티에서 NIKKE 등의 Spine 모델이 공개되어 있다.
- 이 자산은 게임 회사의 저작권물이다. **공개 배포·홍보 영상·내장 샘플로는 쓰지 않는다.** 개인 컴퓨터 안에서 hobby로 만지는 것은 사용자(우리) 자기 책임.
- 우리 도구는 사용자가 자기 컴퓨터에서 어떤 자산을 로드하든 막지 않는다. 다만 빌드인 데모 자산에는 절대 포함하지 않는다.

## Inochi2D 샘플

- [Inochi2D 공식 docs](https://docs.inochi2d.com/), [itch.io Inochi Creator 빌드](https://kitsunebi-games.itch.io/inochi-creator)에 샘플 puppet 포함.
- BSD-2 라이선스인 도구의 산출물 자체는 작가별 라이선스. 통상 hobby 사용은 OK.
- 풀이 작아서 다양성 약함 — 다양성을 원하면 Live2D 풀 사용.

## ShiraLive2D 등 서드파티 무료 모델

- [shiralive2d.com](https://shiralive2d.com/live2d-sample-models/) 같은 사이트에 개인 작가 무료 모델이 올라와 있다.
- 통상 EULA 패턴: 비상업 OK, 상업 NG 또는 별도 협의, VTuber 라이브 OK + 크레딧 표기. **우리는 비상업이라 거의 모든 모델이 hobby 사용 OK.**
- 텍스처 변형·내부 실험은 통상 modification 조항이 명시적으로 막지 않는 한 OK. 공유·재배포는 안 한다.

## VRoid Hub — 3D, 비대상

3D VRM. 우리 스코프 밖.

## PSD Material — 직접 수급

- 일러스트 커뮤니티의 "rigging-ready PSD"는 라이선스 형태가 다양. hobby 사용은 거의 항상 OK.
- 미래에 우리가 직접 puppet을 만든다면 자체 PSD → Inochi2D → 우리 도구가 가장 깔끔.

## 우리의 자산 정책 (단순화 버전)

1. **빌드인 데모 자산**: Live2D 공식 샘플 1종(Hiyori) + Inochi2D 공식 샘플 1종. 이 두 종만 정적 호스팅.
2. **사용자 업로드**: 사용자가 자기 자산 파일을 직접 업로드. 우리 서버에 올리지 않고 브라우저 IndexedDB에만. 어떤 자산을 올리든 사용자(=우리) 책임.
3. **공유 기능**: V1에 없음. V2 이후 갤러리를 만든다면 그때 다시 라이선스 정책 정립.

## 라이선스 메타데이터 — 가벼운 버전

각 Avatar에 출처 정보를 남기되 hobby 단계에서는 **차단 흐름이 아니라 정보 표시용**. 미래에 자산을 정리하거나 다른 사람에게 공유할 때 출처를 추적할 수 있도록.

```ts
type AssetOriginNote = {
  source: 'live2d-official' | 'spine-official' | 'inochi2d-official'
        | 'community' | 'self-made' | 'unknown'
  url?: string
  notes?: string
}
```

UI에는 상태바에 작은 chip으로 출처를 보여주는 정도. **모달로 사용자에게 동의를 묻거나 export를 차단하지 않는다.**

미래 V2에서 공유 갤러리를 만든다면 그 시점에 LicenseInfo를 진짜 enforcement 데이터로 확장.

## 정리 — 결론

라이선스는 hobby 단계에서 **기술적 차단 요인이 아니다**. Phase 0에서 EULA 정독에 시간을 쓰지 않고 바로 Phase 1로 진입한다. 단, 빌드인 데모 자산은 권리가 깨끗한 것(Live2D 공식, Inochi2D 공식, 자체 제작)만 사용한다.
