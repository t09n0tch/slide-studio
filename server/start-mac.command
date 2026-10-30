#!/bin/zsh
set -eu
cd "${0:A:h}/.."
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js 24 이상을 설치한 뒤 다시 실행해 주세요.'
  read '?Enter를 누르면 닫습니다.'
  exit 1
fi
if ! node -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)'; then
  echo '현재 Node.js 버전이 낮습니다. Node.js 24 이상을 설치해 주세요.'
  read '?Enter를 누르면 닫습니다.'
  exit 1
fi
if [[ ! -f server/.env ]]; then
  cp server/.env.example server/.env
  chmod 600 server/.env
  echo 'server/.env를 만들었습니다. API 키·모델·장수 한도를 설정한 뒤 다시 실행해 주세요.'
  open -a TextEdit server/.env
  read '?Enter를 누르면 닫습니다.'
  exit 0
fi
node --env-file=server/.env server/index.cjs
