FROM node:22.23.3-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY tools/multiplayer-spike/package.json tools/multiplayer-spike/package-lock.json ./tools/multiplayer-spike/
RUN npm --prefix tools/multiplayer-spike ci --ignore-scripts
COPY src ./src
COPY tools/multiplayer-spike ./tools/multiplayer-spike
USER node
EXPOSE 2577
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:2577/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "--no-opt", "--no-concurrent-recompilation", "tools/multiplayer-spike/deploy/server.js"]
