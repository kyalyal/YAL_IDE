export type Lang = 'ko' | 'en'

export type MessageKey =
  | 'gptLogTitle' | 'gptRunning' | 'gptSuccess' | 'gptFailed' | 'gptWaiting' | 'gptStalled'
  | 'gptLogEmpty' | 'gptCopy' | 'gptCollapse' | 'gptExpand' | 'gptHeight' | 'gptExitCode'
  | 'gptOrderUnknown' | 'gptLogError' | 'gptCustomized' | 'gptUpgraded' | 'gptUpgradeError'
  | 'skills' | 'skillsTitle' | 'skillsReadonly' | 'skillsContent' | 'skillsHistory' | 'skillsLog'
  | 'skillsSyncStatus' | 'skillsSyncNever' | 'skillsSyncHelp' | 'skillsSyncDetails' | 'skillsSyncFailures' | 'skillsEmpty' | 'skillsLogEmpty' | 'skillsError'
  | 'skillsSelect' | 'skillsAll' | 'skillsSkillFilter' | 'skillsActionFilter' | 'skillsApplied' | 'skillsVersion'
  | 'skillsUpdated' | 'skillsAuthor' | 'skillsCreate' | 'skillsUpdate' | 'skillsRemove' | 'skillsConflict'
  | 'skillsOpenError' | 'skillsVersionMissing' | 'skillsLogLimit' | 'skillsLogMore'
  | 'newProject' | 'existingFolder' | 'projectName' | 'create' | 'cancel' | 'creating'
  | 'projectsRoot' | 'changeFolder' | 'resetFolder' | 'openFolder' | 'projectActionError'
  | 'pinProject' | 'unpinProject' | 'projectNameInvalid' | 'projectFolderExists' | 'projectFolderKept' | 'projectRollbackFailed'
  | 'start' | 'stop' | 'stopped' | 'starting' | 'running' | 'error'
  | 'noServerUrl' | 'touchOn' | 'touchOff' | 'reload' | 'autoReload'
  | 'console' | 'errorsOnly' | 'autoScroll' | 'clear' | 'errorCount' | 'noConsoleEntries'
  | 'saveStart' | 'retry' | 'hideViewer' | 'showViewer' | 'claudeTerminal'
  | 'portrait' | 'landscape' | 'switchPortrait' | 'switchLandscape'
  | 'gameViewer' | 'viewerWidth' | 'device' | 'devCommand' | 'setDevCommand'
  | 'viewerEmpty' | 'errorHistory' | 'gameConsole' | 'consoleLog' | 'consoleInfo' | 'consoleWarn' | 'consoleDebug'
  | 'projects' | 'addProject' | 'noProjects' | 'addFolderHint' | 'working' | 'done' | 'attention'
  | 'idle' | 'noSession' | 'missingPath' | 'removeProject' | 'settingsShortcut'
  | 'settings' | 'settingsOpenError' | 'removeConfirm' | 'selectProject' | 'missingFolder'
  | 'cliUnavailable' | 'claudeSetupBefore' | 'claudeSetupAfter' | 'codexUnavailable' | 'nodeUnavailable'
  | 'close' | 'projectSetup' | 'created' | 'skipped' | 'failed' | 'provisionNoteBefore' | 'provisionNoteMiddle' | 'provisionNoteAfter'
  | 'sessionExited' | 'restart' | 'terminalInput' | 'terminalOutputLimit' | 'settingsLoadError' | 'settingsSaveError' | 'settingsLoading'
  | 'language' | 'korean' | 'english' | 'notificationSound' | 'soundEnabled' | 'soundChoice'
  | 'soundChime' | 'soundBell' | 'soundPing' | 'soundPop' | 'soundSuccess' | 'soundSoft'
  | 'previewSound' | 'volume' | 'soundAttention' | 'testSound'
  | 'exportTab' | 'exportEnvironment' | 'exportRecheck' | 'exportChecking' | 'exportAndroid'
  | 'exportAndroidBlocked' | 'exportIos' | 'exportReady' | 'exportNotReady' | 'exportNode' | 'exportNpm'
  | 'exportJava' | 'exportAndroidSdk' | 'exportAdb' | 'exportMacos' | 'exportAppName'
  | 'exportAppId' | 'exportWebDir' | 'exportBuildCommand' | 'exportBuildPlaceholder' | 'exportInvalidAppId'
  | 'exportAndroidBuild' | 'exportIosPrepare' | 'exportIosNote' | 'exportCancel' | 'exportProgress'
  | 'exportLog' | 'exportReveal' | 'exportSuccess' | 'exportCancelled' | 'exportPending'
  | 'exportComplete' | 'exportFailed' | 'exportSkipped' | 'exportInstallCapacitor' | 'exportWriteConfig'
  | 'exportBuildWeb' | 'exportAddPlatform' | 'exportSync' | 'exportAssemble' | 'exportLocateArtifact'
  | 'exportLoading' | 'exportSaving'
  | 'setupStepJava' | 'setupStepAndroidTools' | 'setupStepLicenses' | 'setupStepPackages' | 'setupStepVerify'
  | 'setupGuide' | 'setupDownload' | 'setupInstall' | 'setupInstallAll' | 'setupLicenses' | 'setupLicenseLink' | 'setupProgress' | 'setupSuccess' | 'setupCancelled' | 'setupNode1' | 'setupNode2' | 'setupJava1' | 'setupJava2' | 'setupSdk1' | 'setupSdk2' | 'setupSdk3' | 'setupAdb1' | 'setupIos1' | 'setupIos2' | 'setupIos3'

export const MESSAGES: Record<Lang, Record<MessageKey, string>> = {
  ko: {
    gptLogTitle: 'GPT 작업 로그', gptRunning: '실행 중', gptSuccess: '완료', gptFailed: '실패',
    gptWaiting: '대기 중', gptStalled: '중단됨',
    gptLogEmpty: 'Claude가 scripts/gpt.sh로 GPT에게 작업을 시키면 여기에 진행 상황이 표시됩니다',
    gptCopy: '복사', gptCollapse: 'GPT 로그 접기', gptExpand: 'GPT 로그 펼치기', gptHeight: 'GPT 로그 높이',
    gptExitCode: '종료 코드 {code}', gptOrderUnknown: '지시서 없음',
    gptLogError: 'GPT 로그를 읽거나 지우거나 복사하지 못했습니다.',
    gptCustomized: 'scripts/gpt.sh가 사용자 지정되어 자동 갱신을 건너뛰었습니다. 로그를 표시하려면 YAL_GPT_LOG 기록을 지원해야 합니다.',
    gptUpgraded: 'scripts/gpt.sh를 GPT 로그 지원 버전으로 갱신했습니다.',
    gptUpgradeError: 'scripts/gpt.sh 갱신을 확인하지 못했습니다. 프로젝트 파일 권한을 확인하세요.',
    skills: '스킬', skillsTitle: '스킬 관리 (읽기 전용)', skillsReadonly: '읽기 전용 — 스킬은 Claude/GPT만 변경할 수 있습니다',
    skillsContent: '내용', skillsHistory: '버전 기록', skillsLog: '변경 로그',
    skillsSyncStatus: '마지막 동기화 {time} · 프로젝트 {applied}/{total}개에 적용됨 · 충돌 {conflicts}개',
    skillsSyncNever: '아직 동기화되지 않음', skillsSyncDetails: '동기화 상세 (최근 20개)', skillsSyncFailures: '실패',
    skillsSyncHelp: '스킬 변경은 자동으로 모든 프로젝트에 동기화되며, 앱을 다시 시작하면 전체 동기화가 한 번 더 실행됩니다.',
    skillsEmpty: '공유 스킬이 없습니다. Claude/GPT에게 스킬 생성을 요청하세요.', skillsLogEmpty: '표시할 변경 기록이 없습니다.',
    skillsError: '스킬 정보를 불러오지 못했습니다.', skillsSelect: '목록에서 스킬을 선택하세요.', skillsAll: '전체',
    skillsSkillFilter: '스킬 필터', skillsActionFilter: '작업 필터', skillsApplied: '적용 프로젝트 {count}개',
    skillsVersion: '버전', skillsUpdated: '수정 시각', skillsAuthor: '작성자',
    skillsCreate: '생성', skillsUpdate: '수정', skillsRemove: '삭제', skillsConflict: '충돌',
    skillsOpenError: '스킬 관리 창을 열지 못했습니다.', skillsVersionMissing: '이 버전의 내용을 찾을 수 없습니다.', skillsLogLimit: '최근 {count}개 표시 (전체 {total}개)',
    skillsLogMore: '이전 기록 더 보기',
    setupStepJava: 'Temurin JDK 다운로드 및 설치',
    setupStepAndroidTools: 'Android command-line tools 설치',
    setupStepLicenses: 'Android SDK 라이선스 동의',
    setupStepPackages: 'Android SDK 패키지 설치',
    setupStepVerify: 'Android SDK 라이선스 확인',

    setupGuide: '환경 설정 가이드',
    setupDownload: '다운로드 페이지 열기',
    setupInstall: '자동 설치',
    setupInstallAll: '필요한 도구 모두 설치',
    setupLicenses: 'Android SDK 라이선스에 동의하고 설치를 진행합니다.',
    setupLicenseLink: '라이선스 읽기',
    setupProgress: '도구 설치 진행',
    setupSuccess: '도구 설치 완료',
    setupCancelled: '도구 설치가 취소되었습니다.',
    setupNode1: '공식 페이지에서 운영체제에 맞는 Node.js LTS 설치 파일을 받으세요.',
    setupNode2: 'npm을 포함하여 설치한 뒤 IDE를 다시 열고 환경을 확인하세요.',
    setupJava1: '운영체제와 CPU에 맞는 Temurin JDK {major} 이상 압축 파일을 받으세요.',
    setupJava2: '홈 폴더의 .jdks에 압축을 풀고 환경을 다시 확인하세요. macOS는 Contents/Home을 자동으로 찾습니다.',
    setupSdk1: '공식 Android command-line tools를 받아 {sdk}/cmdline-tools/latest에 풀어 주세요. latest/bin/sdkmanager가 있어야 합니다.',
    setupSdk2: '라이선스를 읽고 sdkmanager --licenses로 동의하세요.',
    setupSdk3: 'JDK를 사용해 sdkmanager "platform-tools" "platforms;android-{sdk}" "build-tools;{sdk}.0.0"을 실행한 뒤 다시 확인하세요.',
    setupAdb1: 'Android SDK Manager에서 platform-tools를 설치하고 환경을 다시 확인하세요.',
    setupIos1: 'iOS 빌드는 Mac에서 진행하세요. Mac App Store에서 Xcode를 설치하고 한 번 실행해 라이선스를 승인하세요.',
    setupIos2: '터미널에서 xcode-select --install을 실행하세요.',
    setupIos3: '공식 CocoaPods 가이드(guides.cocoapods.org)를 따라 CocoaPods를 설치하세요.',

    newProject: '새 프로젝트 만들기', existingFolder: '기존 폴더 추가', projectName: '프로젝트 이름',
    create: '만들기', cancel: '취소', creating: '만드는 중…', projectsRoot: '프로젝트 기본 위치',
    changeFolder: '변경…', resetFolder: '기본값으로', openFolder: '폴더 열기', projectActionError: '프로젝트 작업에 실패했습니다.',
    pinProject: '맨 위에 고정', unpinProject: '고정 해제',
    projectNameInvalid: '이름은 1~60자로 입력하세요. 금지 문자, 제어 문자, Windows 예약 이름, 끝의 점이나 공백은 사용할 수 없습니다.',
    projectFolderExists: '이미 존재하는 폴더입니다: {path}', projectFolderKept: '폴더와 생성된 파일은 보존했습니다: {path}',
    projectRollbackFailed: '프로젝트 등록 취소 실패',
    exportTab: '앱 추출',
    exportEnvironment: '환경 확인',
    exportRecheck: '다시 확인',
    exportChecking: '환경 확인 중…',
    exportAndroid: 'Android',
    exportIos: 'iOS',
    exportAndroidBlocked: 'Android 빌드 불가 — 환경 설정 필요',
    exportReady: '준비됨',
    exportNotReady: '준비 필요',
    exportNode: 'Node.js',
    exportNpm: 'npm',
    exportJava: 'Java',
    exportAndroidSdk: 'Android SDK',
    exportAdb: 'ADB',
    exportMacos: 'macOS',
    exportAppName: '앱 이름',
    exportAppId: '패키지 ID',
    exportWebDir: '웹 출력 폴더',
    exportBuildCommand: '빌드 명령 (선택)',
    exportBuildPlaceholder: 'npm run build',
    exportInvalidAppId: '소문자와 숫자로 된 두 개 이상의 구간을 점으로 구분하세요. 각 구간은 소문자로 시작해야 합니다. 예: com.yal.mygame',
    exportAndroidBuild: 'Android APK 만들기',
    exportIosPrepare: 'iOS 프로젝트 준비',
    exportIosNote: 'iOS 앱 빌드에는 macOS + Xcode가 필요합니다. 여기서는 프로젝트 폴더만 준비합니다.',
    exportCancel: '취소',
    exportProgress: '추출 진행',
    exportLog: '추출 로그',
    exportReveal: '탐색기에서 보기',
    exportSuccess: '추출 완료',
    exportCancelled: '추출이 취소되었습니다.',
    exportPending: '대기',
    exportComplete: '완료',
    exportFailed: '실패',
    exportSkipped: '건너뜀',
    exportInstallCapacitor: 'Capacitor 설치',
    exportWriteConfig: '설정 파일 작성',
    exportBuildWeb: '웹 빌드',
    exportAddPlatform: '플랫폼 추가',
    exportSync: '동기화',
    exportAssemble: 'APK 빌드',
    exportLocateArtifact: '결과물 찾기',
    exportLoading: '추출 설정 불러오는 중…',
    exportSaving: '설정 저장 중…',
    start: '시작', stop: '중지', stopped: '중지됨', starting: '시작 중', running: '실행 중', error: '오류',
    noServerUrl: '서버 주소 없음', touchOn: '터치 켜짐', touchOff: '터치 꺼짐', reload: '새로고침', autoReload: '자동 새로고침',
    console: '콘솔', errorsOnly: '오류만 보기', autoScroll: '자동 스크롤', clear: '지우기', errorCount: '오류 {count}개', noConsoleEntries: '콘솔 항목이 없습니다',
    saveStart: '저장 후 시작', retry: '다시 시도', hideViewer: '뷰어 숨기기', showViewer: '뷰어 보기', claudeTerminal: 'Claude 터미널',
    portrait: '세로 모드 ↻', landscape: '가로 모드 ↻', switchPortrait: '눌러서 세로 모드로 전환', switchLandscape: '눌러서 가로 모드로 전환',
    gameViewer: '게임 뷰어', viewerWidth: '뷰어 너비', device: '기기', devCommand: '개발 서버 명령', setDevCommand: '개발 서버 명령을 설정하세요.',
    viewerEmpty: '개발 서버를 시작하면 게임이 여기에 표시됩니다', errorHistory: '보관된 콘솔 기록의 오류', gameConsole: '게임 콘솔',
    consoleLog: '로그', consoleInfo: '정보', consoleWarn: '경고', consoleDebug: '디버그',
    projects: '프로젝트', addProject: '프로젝트 추가', noProjects: '아직 프로젝트가 없습니다.', addFolderHint: '+ 버튼으로 폴더를 추가하세요.',
    working: '작업 중', done: '작업 끝 · 확인', attention: '입력 필요', idle: '대기 중', noSession: '세션 없음', missingPath: '경로 없음', removeProject: '목록에서 제거', settingsShortcut: '설정 (Ctrl+,)',
    settings: '설정', settingsOpenError: '설정 창을 열지 못했습니다.',
    removeConfirm: '"{name}"을(를) 목록에서 제거할까요?\n실행 중인 Claude 세션은 종료되며, 폴더와 파일은 삭제하지 않습니다.',
    selectProject: '왼쪽에서 프로젝트를 선택하세요.', missingFolder: '폴더가 이동되었거나 삭제되었습니다. 목록에서 제거한 뒤 다시 추가하세요.',
    cliUnavailable: '{name} CLI를 사용할 수 없습니다', claudeSetupBefore: 'Claude Code를 설치하고 터미널에서 ', claudeSetupAfter: '를 한 번 실행해 로그인한 뒤 앱을 다시 열어 주세요.',
    codexUnavailable: 'GPT(Codex)를 사용할 수 없습니다: {detail} (Claude 터미널은 계속 사용할 수 있습니다.)',
    nodeUnavailable: 'Node.js를 찾을 수 없어 작업 상태 표시(작업 중/작업 끝)가 꺼져 있습니다. Node.js를 설치한 뒤 앱을 다시 열어 주세요. (Claude 터미널은 계속 사용할 수 있습니다.)',
    close: '닫기', projectSetup: ' 설정:', created: '생성됨: {files}', skipped: '이미 있어 건너뜀: {files}', failed: '실패: {file} — {message}',
    provisionNoteBefore: '안내: ', provisionNoteMiddle: '는 Codex를 ', provisionNoteAfter: ' 옵션으로 실행합니다. GPT가 이 프로젝트 폴더 안에서 파일을 만들고 수정할 수 있으며, 승인 요청은 Codex가 자동 검토합니다.',
    sessionExited: 'Claude 세션이 종료되었습니다.', restart: '다시 시작', settingsLoadError: '설정을 불러오지 못했습니다.', settingsSaveError: '설정을 저장하지 못했습니다. 다시 시도해 주세요.', settingsLoading: '설정을 불러오는 중…',
    language: '언어 / Language', korean: '한국어', english: 'English', notificationSound: '알림음', soundEnabled: '알림음 사용', soundChoice: '소리 선택',
    terminalInput: '터미널 입력', terminalOutputLimit: '출력이 너무 많아 일부가 생략되었습니다. 스크롤하여 전체 출력을 확인하세요.',
    soundChime: '차임', soundBell: '종소리', soundPing: '핑', soundPop: '팝', soundSuccess: '성공', soundSoft: '부드러운 두 음',
    previewSound: '{name} 미리 듣기', volume: '음량', soundAttention: '입력이 필요할 때도 소리 내기', testSound: '테스트 재생'
  },
  en: {
    gptLogTitle: 'GPT job log', gptRunning: 'Running', gptSuccess: 'Complete', gptFailed: 'Failed',
    gptWaiting: 'Waiting', gptStalled: 'Stalled',
    gptLogEmpty: 'When Claude assigns work to GPT through scripts/gpt.sh, its progress appears here.',
    gptCopy: 'Copy', gptCollapse: 'Collapse GPT log', gptExpand: 'Expand GPT log', gptHeight: 'GPT log height',
    gptExitCode: 'Exit code {code}', gptOrderUnknown: 'No order recorded',
    gptLogError: 'Could not read, clear, or copy the GPT log.',
    gptCustomized: 'scripts/gpt.sh is customized, so its automatic upgrade was skipped. It must support YAL_GPT_LOG to show logs.',
    gptUpgraded: 'scripts/gpt.sh was upgraded to support GPT logs.',
    gptUpgradeError: 'Could not check the scripts/gpt.sh upgrade. Check project file permissions.',
    skills: 'Skills', skillsTitle: 'Skills (read-only)', skillsReadonly: 'Read-only — only Claude/GPT can change skills',
    skillsContent: 'Content', skillsHistory: 'Version history', skillsLog: 'Change log',
    skillsSyncStatus: 'Last sync {time} · Applied to {applied}/{total} projects · {conflicts} conflicts',
    skillsSyncNever: 'Not synced yet', skillsSyncDetails: 'Sync details (latest 20)', skillsSyncFailures: 'Failures',
    skillsSyncHelp: 'Skill changes sync automatically to all projects. Restarting the app runs a full sync again.',
    skillsEmpty: 'No shared skills. Ask Claude/GPT to create a skill.', skillsLogEmpty: 'No matching changes.',
    skillsError: 'Could not load skill information.', skillsSelect: 'Select a skill from the list.', skillsAll: 'All',
    skillsSkillFilter: 'Filter by skill', skillsActionFilter: 'Filter by action', skillsApplied: 'Applied to {count} projects',
    skillsVersion: 'Version', skillsUpdated: 'Updated', skillsAuthor: 'Author',
    skillsCreate: 'Created', skillsUpdate: 'Updated', skillsRemove: 'Removed', skillsConflict: 'Conflict',
    skillsOpenError: 'Could not open the skills window.', skillsVersionMissing: 'This version is unavailable.', skillsLogLimit: 'Showing latest {count} entries ({total} total)',
    skillsLogMore: 'Load older entries',
    setupStepJava: 'Download and install Temurin JDK',
    setupStepAndroidTools: 'Install Android command-line tools',
    setupStepLicenses: 'Accept Android SDK licenses',
    setupStepPackages: 'Install Android SDK packages',
    setupStepVerify: 'Verify Android SDK licenses',

    setupGuide: 'Environment setup guide',
    setupDownload: 'Open download page',
    setupInstall: 'Install automatically',
    setupInstallAll: 'Install all missing tools',
    setupLicenses: 'I accept the Android SDK licenses and agree to install.',
    setupLicenseLink: 'Read licenses',
    setupProgress: 'Tool installation progress',
    setupSuccess: 'Tool installation complete',
    setupCancelled: 'Tool installation cancelled.',
    setupNode1: 'Download the Node.js LTS installer for your operating system.',
    setupNode2: 'Install including npm, reopen the IDE, and re-check the environment.',
    setupJava1: 'Download a Temurin JDK {major} or newer archive for your OS and CPU.',
    setupJava2: 'Extract into .jdks in your home folder and re-check. On macOS, Contents/Home is detected automatically.',
    setupSdk1: 'Download official Android command-line tools and extract into {sdk}/cmdline-tools/latest, with latest/bin/sdkmanager present.',
    setupSdk2: 'Read the licenses and accept them with sdkmanager --licenses.',
    setupSdk3: 'Using the JDK, run sdkmanager "platform-tools" "platforms;android-{sdk}" "build-tools;{sdk}.0.0", then re-check.',
    setupAdb1: 'Install platform-tools in the Android SDK Manager and re-check.',
    setupIos1: 'Build iOS on a Mac. Install Xcode from the Mac App Store and open it once to accept its license.',
    setupIos2: 'Run xcode-select --install in a terminal.',
    setupIos3: 'Install CocoaPods following the official guide at guides.cocoapods.org.',

    newProject: 'Create new project', existingFolder: 'Add existing folder', projectName: 'Project name',
    create: 'Create', cancel: 'Cancel', creating: 'Creating…', projectsRoot: 'Default project location',
    changeFolder: 'Change…', resetFolder: 'Use default', openFolder: 'Open folder', projectActionError: 'The project operation failed.',
    pinProject: 'Pin to top', unpinProject: 'Unpin',
    projectNameInvalid: 'Use 1–60 characters. Forbidden characters, control characters, Windows reserved names, and trailing dots or spaces are not allowed.',
    projectFolderExists: 'The folder already exists: {path}', projectFolderKept: 'The folder and created files were kept: {path}',
    projectRollbackFailed: 'Could not roll back project registration',
    exportTab: 'App export',
    exportEnvironment: 'Environment',
    exportRecheck: 'Re-check',
    exportChecking: 'Checking environment…',
    exportAndroid: 'Android',
    exportIos: 'iOS',
    exportAndroidBlocked: 'Android build blocked — toolchain setup required',
    exportReady: 'Ready',
    exportNotReady: 'Not ready',
    exportNode: 'Node.js',
    exportNpm: 'npm',
    exportJava: 'Java',
    exportAndroidSdk: 'Android SDK',
    exportAdb: 'ADB',
    exportMacos: 'macOS',
    exportAppName: 'App name',
    exportAppId: 'Package ID',
    exportWebDir: 'Web output folder',
    exportBuildCommand: 'Build command (optional)',
    exportBuildPlaceholder: 'npm run build',
    exportInvalidAppId: 'Use two or more dot-separated segments of lowercase letters and digits. Each segment must start with a letter, e.g. com.yal.mygame.',
    exportAndroidBuild: 'Build Android APK',
    exportIosPrepare: 'Prepare iOS project',
    exportIosNote: 'Building the iOS app requires macOS + Xcode. Only the project folder is prepared here.',
    exportCancel: 'Cancel',
    exportProgress: 'Export progress',
    exportLog: 'Export log',
    exportReveal: 'Show in file explorer',
    exportSuccess: 'Export complete',
    exportCancelled: 'Export cancelled.',
    exportPending: 'Pending',
    exportComplete: 'Complete',
    exportFailed: 'Failed',
    exportSkipped: 'Skipped',
    exportInstallCapacitor: 'Install Capacitor',
    exportWriteConfig: 'Write configuration',
    exportBuildWeb: 'Build web game',
    exportAddPlatform: 'Add platform',
    exportSync: 'Sync',
    exportAssemble: 'Assemble APK',
    exportLocateArtifact: 'Locate artifact',
    exportLoading: 'Loading export settings…',
    exportSaving: 'Saving settings…',
    start: 'Start', stop: 'Stop', stopped: 'stopped', starting: 'starting', running: 'running', error: 'error',
    noServerUrl: 'No server URL', touchOn: 'Touch on', touchOff: 'Touch off', reload: 'Reload', autoReload: 'Auto-reload',
    console: 'Console', errorsOnly: 'Errors only', autoScroll: 'Auto-scroll', clear: 'Clear', errorCount: '{count} errors', noConsoleEntries: 'No console entries',
    saveStart: 'Save & start', retry: 'Retry', hideViewer: 'Hide viewer', showViewer: 'Show viewer', claudeTerminal: 'Claude terminal',
    portrait: 'Portrait ↻', landscape: 'Landscape ↻', switchPortrait: 'Click to switch to portrait', switchLandscape: 'Click to switch to landscape',
    gameViewer: 'Game viewer', viewerWidth: 'Viewer width', device: 'Device', devCommand: 'Dev server command', setDevCommand: 'Set a dev server command.',
    viewerEmpty: 'Start the dev server to display the game here', errorHistory: 'Errors in the retained console history', gameConsole: 'Game console',
    consoleLog: 'log', consoleInfo: 'info', consoleWarn: 'warn', consoleDebug: 'debug',
    projects: 'Projects', addProject: 'Add project', noProjects: 'No projects yet.', addFolderHint: 'Use the + button to add a folder.',
    working: 'Working', done: 'Done · review', attention: 'Input needed', idle: 'Idle', noSession: 'No session', missingPath: 'Path missing', removeProject: 'Remove from list', settingsShortcut: 'Settings (Ctrl+,)',
    settings: 'Settings', settingsOpenError: 'Could not open settings.',
    removeConfirm: 'Remove "{name}" from the list?\nThe running Claude session will end. The folder and files will remain.',
    selectProject: 'Select a project on the left.', missingFolder: 'The folder was moved or deleted. Remove it from the list and add it again.',
    cliUnavailable: '{name} CLI is unavailable', claudeSetupBefore: 'Install Claude Code, run ', claudeSetupAfter: ' once in a terminal to sign in, then reopen the app.',
    codexUnavailable: 'GPT (Codex) is unavailable: {detail} (You can still use the Claude terminal.)',
    nodeUnavailable: 'Node.js was not found, so work status indicators (working/done) are disabled. Install Node.js and reopen the app. (You can still use the Claude terminal.)',
    close: 'Close', projectSetup: ' setup:', created: 'Created: {files}', skipped: 'Already exists, skipped: {files}', failed: 'Failed: {file} — {message}',
    provisionNoteBefore: 'Note: ', provisionNoteMiddle: ' runs Codex with ', provisionNoteAfter: '. GPT can create and edit files in this project folder. Codex automatically reviews approval requests.',
    sessionExited: 'The Claude session has ended.', restart: 'Restart', settingsLoadError: 'Could not load settings.', settingsSaveError: 'Could not save settings. Please try again.', settingsLoading: 'Loading settings…',
    language: '언어 / Language', korean: '한국어', english: 'English', notificationSound: 'Notification sounds', soundEnabled: 'Enable notification sounds', soundChoice: 'Choose a sound',
    terminalInput: 'Terminal input', terminalOutputLimit: 'Too much output to announce. Scroll to read the full output.',
    soundChime: 'Chime', soundBell: 'Bell', soundPing: 'Ping', soundPop: 'Pop', soundSuccess: 'Success', soundSoft: 'Soft two tones',
    previewSound: 'Preview {name}', volume: 'Volume', soundAttention: 'Also play when input is needed', testSound: 'Play test sound'
  }
}

export function translate(lang: unknown, key: MessageKey, params: Record<string, string | number> = {}): string {
  const message = MESSAGES[lang === 'en' ? 'en' : 'ko'][key]
  return message.replace(/\{(\w+)\}/g, (placeholder: string, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : placeholder)
}
