# 촉감런 ASMR Prototype

모바일 세로 화면용 설치형 PWA 프로토타입입니다.

## 핵심 조작
- 화면 탭: 점프
- 재질 중앙에 착지: PERFECT + 체력 회복 + 콤보
- 체력이 0이 되기 전 최대한 멀리 이동
- 재질: 말랑이 / 왁스 / 뽁뽁이

## PC에서 바로 테스트
이 폴더에서 정적 웹서버를 실행하세요.

```bash
python -m http.server 8080
```

브라우저에서 `http://localhost:8080` 접속.

## 핸드폰에 설치
PWA 설치는 HTTPS 주소가 필요합니다. 이 폴더를 GitHub Pages, Netlify, Vercel 등에 올린 뒤 Android Chrome으로 접속합니다.

- Chrome 메뉴 → `홈 화면에 추가` 또는 `앱 설치`
- 또는 게임 안의 `홈 화면에 설치` 버튼 사용(지원 브라우저)

## APK로 감싸기
현재 코드는 Capacitor/Android WebView로 그대로 감쌀 수 있습니다. Android SDK가 있는 PC에서 Capacitor 프로젝트의 `www`로 복사하면 됩니다.
