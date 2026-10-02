FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
# ci = exactly the lockfile, reproducible; no dev deps in the image
RUN npm ci --omit=dev && npm cache clean --force
# every module of the API; a new file never has to be added here again
COPY *.js ./
ENV NODE_ENV=production
# Runs as root on purpose: /data is a bind mount and its files (secret, mode 600) are owned by
# the host user. Docker Desktop on macOS can't map that to an unprivileged container user
# (reads fail with errno -35). On a Linux host, drop privileges from compose instead:
#   services.api.user: "1000:1000"   +   sudo chown -R 1000:1000 ./data
EXPOSE 3000
CMD ["node", "server.js"]
