FROM node:22-alpine
RUN npm install -g pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --prod
COPY . .
EXPOSE 3001
ENV PORT=3001
CMD ["node", "server.js"]
