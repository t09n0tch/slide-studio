# Bundled FFmpeg source

`ffmpeg-8.1.2.tar.xz` is the unmodified upstream source archive from
<https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz>.

SHA-256: `464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c`.

The source host is unreachable from some Windows build runners. Keep this exact
archive in the repository so all builds use the same verified sources without
contacting that host. Upstream copyright and license texts are inside the archive;
Slide Studio does not change or relicense these sources. `build:audio` checks the
archive hash before copying it into the installer's `audio-sources` directory.

Native decoder binaries and the other corresponding sources remain pinned in
`dev/audio-tools.json`. Build flags disable GPL, nonfree and version-3 components
in the separate FFmpeg executable. The MP3 encoder has its own LGPL-3.0 notices.
