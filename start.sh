#! /bin/bash

pm2 stop server
npm i 
pm2 start server.js
