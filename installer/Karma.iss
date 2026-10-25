; Build with Inno Setup 6: ISCC /DPayloadDir=<sanitized Karma folder> /DReleaseOutput=<output folder> Karma.iss
#ifndef PayloadDir
  #error PayloadDir is required (sanitized release folder)
#endif
#ifndef ReleaseOutput
  #error ReleaseOutput is required
#endif
#define BuildVersion "0.7.7"
[Setup]
AppId={{F12FC742-9B07-4567-84AB-17B61AB2DDB2}
AppName=카르마 LAN
AppVersion={#BuildVersion}
AppPublisher=Karma LAN Project
AppPublisherURL=https://github.com/mrgrit/karma
AppSupportURL=https://github.com/mrgrit/karma/issues
DefaultDirName={localappdata}\Programs\KarmaLAN
DefaultGroupName=카르마 LAN
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
MinVersion=10.0
OutputDir={#ReleaseOutput}
OutputBaseFilename=Karma-LAN-Setup-v{#BuildVersion}
Compression=lzma2/normal
SolidCompression=yes
WizardStyle=modern
DisableWelcomePage=yes
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=no
ShowLanguageDialog=no
CloseApplications=yes
RestartApplications=no
UninstallDisplayIcon={app}\KarmaLauncher.exe
SetupLogging=yes
[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{autoprograms}\카르마 LAN"; Filename: "{app}\KarmaLauncher.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\카르마 LAN"; Filename: "{app}\KarmaLauncher.exe"; WorkingDir: "{app}"
[Run]
Filename: "{app}\KarmaLauncher.exe"; Description: "카르마 LAN 실행"; Flags: nowait postinstall skipifsilent
