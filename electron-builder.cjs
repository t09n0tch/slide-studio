module.exports = {
  appId: 'com.t09n0tch.slidestudio',
  productName: 'Slide Studio',
  directories: { output: 'dist', buildResources: 'build' },
  asar: true,
  asarUnpack:['electron/audio-worker.cjs','electron/mp3-encoder.cjs'],
  npmRebuild: false,
  extraResources:[{from:`build/audio-tools/${process.platform}-\${arch}`,to:'audio-tools'},{from:'build/audio-tools/sources',to:'audio-sources'}],
  files: [
    'index.html', '*.css', 'icon.svg', 'js/**/*', 'vendor/**/*',
    'electron/**/*', 'build/icon.png', 'package.json', 'LICENSE', 'README.md'
  ],
  mac: {
    target: ['dmg'],
    category: 'public.app-category.education',
    icon: 'build/icon.icns',
    identity: '-',
    notarize: false,
    artifactName: 'SlideStudio-macOS-${arch}.${ext}'
  },
  dmg: { title: 'Slide Studio ${version}', sign: false },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.ico',
    artifactName: 'SlideStudio-Windows-${arch}-Setup.${ext}'
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false,
    shortcutName: 'Slide Studio',
    installerIcon: 'build/icon.ico',
    uninstallerIcon: 'build/icon.ico'
  }
};
