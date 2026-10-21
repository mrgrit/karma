# Windows 원클릭 설치기

Inno Setup 6으로 전체 게임·Node/Frida·실행기를 한 EXE로 묶습니다. 기본 설치 위치는 `%LOCALAPPDATA%/Programs/KarmaLAN`이며 관리자 권한 없이 설치합니다. 실행 후 **설치** 버튼 한 번으로 완료하고 바탕화면과 시작 메뉴 바로가기를 생성합니다.

```powershell
ISCC.exe /DPayloadDir=C:\release\Karma /DReleaseOutput=C:\release installer\Karma.iss
```

PayloadDir는 깨끗한 배포 폴더여야 합니다. 개인 설정 `Launcher/*selection.json`, `central-profile.json`, `playstyle.json`, 로그·세션 파일·테스트 게임 EXE를 포함하지 마세요. 서버 인증서 개인키나 로그인 토큰은 절대 포함하지 않습니다. Runtime 전체와 원본 게임 리소스가 필요합니다.

업데이트는 같은 설치기를 다시 실행합니다. 배포 목록에 개인 설정 파일이 없으므로 기존 설정을 덮어쓰지 않으며, `%LOCALAPPDATA%/KarmaLAN/servers`의 계정 세션을 유지합니다. 제거 역시 사용자 로그인 세션을 삭제하지 않습니다. 공유 PC에서는 클라이언트의 로그아웃을 사용하세요.

설치기는 hosts, OS 인증서 신뢰, 방화벽 또는 보안 제품 설정을 변경하지 않습니다. 게임 서버는 IP와 포함된 공개 CA를 이용합니다. 거래소 웹 주소는 학과 DNS의 `exchange.ycdc.internal → 192.168.12.200` 설정이 별도로 필요합니다.

재현 검사는 공백이 있는 새 폴더에 `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /DIR=...`로 설치한 뒤 배포 파일 SHA-256을 비교하고, 개인 설정 표식을 만든 뒤 재설치하여 보존을 확인합니다. 테스트 전용 폴더만 제거합니다.
