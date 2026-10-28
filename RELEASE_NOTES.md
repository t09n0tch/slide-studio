Windows와 macOS용 Slide Studio 설치 앱입니다. 강의 영상에서 슬라이드와 필기를 추출하고, 서식 있는 강의노트와 함께 PPTX·PDF로 저장합니다.

## 다운로드

| 사용하는 컴퓨터 | 받을 파일 |
| --- | --- |
| 일반 Windows PC (x64) | `SlideStudio-Windows-x64-Setup.exe` |
| Apple Silicon Mac (M1·M2·M3·M4 등) | `SlideStudio-macOS-arm64.dmg` |
| Intel Mac | `SlideStudio-macOS-x64.dmg` |

아래 Assets에서 해당 파일을 선택하세요. `Source code` ZIP은 앱 설치 파일이 아닙니다.

## 설치와 사용

1. Windows는 Setup.exe를 실행해 설치합니다. Mac은 DMG를 열고 Slide Studio를 Applications로 드래그합니다.
2. Slide Studio를 열고 첫 화면 중앙에 영상 파일을 놓거나, 클릭해 선택합니다.
3. 자동 추출 후 오른쪽에 노트를 작성하고 PPTX·PDF로 내보냅니다. 파일은 컴퓨터의 다운로드 폴더에 저장합니다.

AI·API 키·영상 업로드 없이 사용합니다. Chrome, Node.js, Python, Codex를 별도로 설치할 필요가 없습니다.

## 이번 배포의 상태

- 정식 개발자 인증서로 서명하거나 Apple 공증을 받은 배포본은 아닙니다. 운영체제에서 첫 실행 확인이나 차단이 표시될 수 있습니다. Mac은 [Apple의 확인 방법](https://support.apple.com/ko-kr/102445)을 참고하세요.
- Windows x64와 Mac Apple Silicon·Intel에서 실제 패키지 실행 검사를 통과한 파일을 함께 게시합니다.
- 앱 자동 저장은 업데이트 후에도 같은 앱 데이터 폴더를 사용합니다. 기존 Chrome 버전의 브라우저 자동 저장 노트는 설치 앱으로 자동 이전되지 않습니다.
- `SHA256SUMS.txt`에 각 설치 파일의 SHA-256을 포함합니다.
