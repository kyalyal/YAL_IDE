---
name: yal-mobile-web-game
description: IDE 기기 뷰어로 확인하고 Capacitor로 Android와 iOS에 내보내는 웹 게임 규칙
---
- 게임은 브라우저 코드로 만든다. 게임 코드에서 Node API, Electron API, 파일 시스템을 사용하지 않는다.
- 개발 서버는 `npm run dev`, 웹 빌드는 `npm run build`, 출력 폴더는 `dist/`로 맞춘다. Capacitor의 webDir도 `dist`다.
- viewport 메타에 `width=device-width, initial-scale=1, viewport-fit=cover`를 설정한다. 안전 영역은 `env(safe-area-inset-*)`, 화면 높이는 `100dvh`를 고려한다.
- 세로·가로 전환 시 폭과 높이가 바뀐다. resize에 레이아웃과 캔버스를 갱신하고 진행 상태를 보존한다. 고정 픽셀 배치에 의존하지 않는다.
- Pointer Events 또는 Touch Events로 입력을 처리한다. 게임 영역의 `touch-action`을 명시하고 드래그 취소·멀티터치를 처리한다. 마우스 입력도 확인한다.
- 뷰어 프리셋의 CSS viewport와 DPR: iPhone SE 375×667 / 2, iPhone 15 393×852 / 3, Pixel 8 412×915 / 2.625, Galaxy S 360×800 / 3, iPad 768×1024 / 2. 가로는 폭·높이를 교환한다.
- 캔버스의 실제 픽셀 크기는 CSS 크기×DPR로 설정한다. DPR을 게임 좌표와 혼동하지 않는다.
- IDE 기기 뷰어에서 크기·방향·터치를 확인한다. 콘솔 오류는 IDE 콘솔에 표시되므로 오류를 해결하고 검증 결과를 보고한다.
- Android/iOS 내보내기 전에 웹 빌드를 확인한다. iOS 앱 빌드에는 macOS와 Xcode가 필요하다.
