FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --include=dev --legacy-peer-deps

COPY . .
RUN npm run build && ./node_modules/.bin/esbuild server.ts --bundle --platform=node --format=esm --packages=external --outfile=server.mjs

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.mjs"]
