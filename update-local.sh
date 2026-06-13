#! /bin/bash

ssh my-websites << EOF
  cd /root/quotes
  git pull
  systemctl restart quotes-admin.service
EOF

