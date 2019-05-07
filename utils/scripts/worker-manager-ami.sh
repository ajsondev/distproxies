#!/bin/bash

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root"
  exit
fi

export NPM_TOKEN="yourtoken"
export CONFIG_AZURE_BLOB="yourblob"
export CONFIG_AZURE_SHARED_ACCESS_SIGNATURE="SV=yoursignature"
export NODE_ENV=production

cat <<EOF > ~/.npmrc
//registry.npmjs.org/:_authToken=\${NPM_TOKEN}
EOF

retries=6
wait_retry=10

for i in `seq 1 $retries`; do
  curl -sL https://deb.nodesource.com/setup_10.x | bash - && break
  echo "failed, waiting to retry..."
  sleep $wait_retry
done

for i in `seq 1 $retries`; do
  apt-get update && break
  echo "failed, waiting to retry..."
  sleep $wait_retry
done

for i in `seq 1 $retries`; do
  apt-get install -y libopencv-dev libpoppler-qt5-dev libcairo2-dev tesseract-ocr nodejs && break
  echo "failed, waiting to retry..."
  sleep $wait_retry
done

for i in `seq 1 $retries`; do
  npm i --unsafe-perm -g @nicomee/anonyps@latest pm2@latest n && break
  echo "failed, waiting to retry..."
  sleep $wait_retry
done

for i in `seq 1 $retries`; do
  n 7.7.1 && break
  echo "failed, waiting to retry..."
  sleep $wait_retry
done

pm2 start dist-proxy
pm2 startup
