#!/bin/bash

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root"
  exit
fi

<<<CREDENTIALS>>>

cat <<EOF > ~/.npmrc
//registry.npmjs.org/:_authToken=\${NPM_TOKEN}
EOF

cat <<EOF > /etc/rc.local
#!/bin/sh -e
#
# rc.local
#
# This script is executed at the end of each multiuser runlevel.
# Make sure that the script will "exit 0" on success or any other
# value on error.
#
# In order to enable or disable this script just change the execution
# bits.
#
# By default this script does nothing.

<<<COMMANDS>>>

export NPM_TOKEN="$NPM_TOKEN"
export CONFIG_AZURE_STORAGE_ACCOUNT="$CONFIG_AZURE_STORAGE_ACCOUNT"
export CONFIG_AZURE_STORAGE_SHARED_ACCESS_SIGNATURE="$CONFIG_AZURE_STORAGE_SHARED_ACCESS_SIGNATURE"
export WORKER_TAGS="$WORKER_TAGS"
export NODE_ENV=production

export retries=6
export wait_retry=10

for i in `seq 1 \$retries`; do
  op=\$(curl -sL "https://\$CONFIG_AZURE_STORAGE_ACCOUNT.blob.core.windows.net/scripts/worker-launch-on-ami.sh?\$CONFIG_AZURE_STORAGE_SHARED_ACCESS_SIGNATURE" | bash -)
  echo \$op
  if [ \$? -eq 0 ] || [ -n \$op ]; then
    echo "success"
    exit 0
  fi
  echo "failed, waiting to retry..."
  sleep \$wait_retry
done
poweroff

exit 0
EOF

retries=6
wait_retry=3

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
  apt-get install -y libopencv-dev libpoppler-qt5-dev libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev build-essential g++ tesseract-ocr nodejs && break
  echo "failed, waiting to retry..."
  sleep $wait_retry
done

for i in `seq 1 $retries`; do
  npm i --unsafe-perm -g pm2@latest distproxies@latest n && break
  echo "failed, waiting to retry..."
  sleep $wait_retry
done

n 8.2.1 || {
  echo "[[[WORKER-BUILD-FAILURE]]]"
  exit 1
}

echo "[[[WORKER-BUILT]]]"
halt
