# 2026-05-10 — Expression preview / 매핑 깨짐 fix (uploaded puppets)

사용자 보고: 에디터의 Animation 탭 [Expressions](../../components/animation/ExpressionsSection.tsx) 섹션에서 ▶ preview 를 눌러도 puppet 의 표정이 안 바뀐다. 그 결과 emotion → expression 매핑을 시각적으로 결정할 수가 없음. Geny 측 install/translate 로직 (Phase G) 은 정상 — 문제는 에디터 자체.

## 근본 원인

[`lib/upload/rewrite.ts`](../../lib/upload/rewrite.ts) 의 `rewriteLive2DManifest` 가 `FileReferences` 의 다음 필드들을 blob URL 로 rewrite 했다:

- `Moc` · `Textures[]` · `Physics` · `Pose` · `UserData` · `DisplayInfo` · `Motions[group][i].File`

그런데 `Expressions[i].File` **만 빠져 있었음**. 업로드된 Cubism puppet 은 manifest 가 blob: URL 이고, 엔진의 `setExpression(name)` 가 호출되면 그 manifest URL 에서 상대경로 (`expressions/F01.exp3.json`) 를 resolve 하려고 함. blob: URL 은 디렉토리 의미가 없어서 `new URL(rel, blobUrl)` 이 fetch 가능한 URL 을 못 만듦 → load 실패 → silent no-op.

내장 puppet (HTTP 경로의 manifest) 은 상대경로 resolve 가 정상 동작하니 이쪽 케이스에서는 표정 preview 가 정상이었음. 그래서 사용자가 본 "Ellen Joe (업로드) 만 안 됨" 증상이 정확히 매치.

## 변경

`rewriteLive2DManifest` 의 Motions 분기 바로 다음에 동일한 패턴으로 Expressions 분기 추가:

```ts
if (Array.isArray(refs.Expressions)) {
  out.Expressions = refs.Expressions.map((e: unknown, i: number) => {
    if (e && typeof e === "object" && "File" in e && typeof e.File === "string") {
      return { ...e, File: resolveOne(`expression[${i}]`, e.File) };
    }
    return e;
  });
}
```

`resolveOne` 이 bundle 안의 `.exp3.json` entry 를 lookup → `URL.createObjectURL` → manifest 안에 절대 blob URL 로 저장. 엔진의 `loadExpression()` 이 그 URL 을 직접 fetch.

## 영향 범위

- ✅ 업로드된 Cubism puppet 의 Animation 탭 preview ▶ 즉시 동작.
- ✅ emotion → expression 매핑 dropdown 이 자동 preview 도 같은 경로 → 매핑 결정이 시각적으로 가능해짐.
- 무손상: 내장 puppet (`/edit/builtin/<key>`) 은 원래 HTTP 매니페스트라 영향 X.
- 무손상: Geny install 흐름 — install 은 zip 을 풀어 정적으로 serve 하는 경로 (HTTP, 상대경로 resolve OK) 라 이번 fix 와 무관.
- 무손상: schema. 기존 v2 zip 의 `animationConfig.emotionMap` 컨트랙트 변경 X.

## 검증

- `pnpm typecheck` 통과 (tsc --noEmit)
- `pnpm lint` 통과 (본 변경 관련 에러 없음, 기존 schema 버전 mismatch info 만)
- 시각 검증 (사용자 측):
  1. `/` 에서 Cubism 번들 (Ellen Joe / Mao Pro / 등) 업로드 → editor 진입
  2. `?tab=animation` → expressions 섹션 ▶ 클릭 → puppet 표정 즉시 변화
  3. emotion (예: `joy`) dropdown → expression NAME 선택 → 자동 preview 로 표정 변화
  4. (Geny 통합 측) 매핑 채운 후 send to Geny → install → `/api/vtuber/models` 의 emotionMap 이 INDEX 로 들어와 있는지 확인

## 버전

- package.json `0.3.1` → `0.3.2`
- landing chip / git tag 는 후속 release 에서 통합 — 이 fix 단독 tag 는 안 만듦 (post-merge hook 으로 main 자동 추적이라 pin 갱신 자체가 형식적)
- Geny 측은 별도 commit 없음. 서버에서 `git pull` → post-merge hook 이 vendor/geny-avatar 를 origin/main HEAD 로 fast-forward → `docker compose ... up -d --build avatar-editor` 만 하면 fix 반영
