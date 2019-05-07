#!/bin/bash

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root"
  exit 1
fi

echo "worker executing"

pm2 start -i 0 --node-args="--harmony" -o /dev/null -e /dev/null -l /dev/null --cron "0 */6 * * *" worker || {
  echo "pm2 start failure"
  poweroff
}
