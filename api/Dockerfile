FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
# ci = exactly the lockfile, reproducible; no dev deps in the image
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
ENV NODE_ENV=production
# /data is a bind mount; make sure the unprivileged user below can write it on a fresh host
RUN mkdir -p /data && chown node:node /data
# Don't run the API as root: a bug in the process then can't touch anything outside /app and /data.
# On a Linux host, make the data folder writable for uid 1000:  sudo chown -R 1000:1000 ./data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
