FROM node:22-alpine
RUN npm install -g pnpm
WORKDIR /app/backend

# Copy only backend package.json (no pnpm-lock.yaml to avoid workspace dependency issues)
COPY backend/package.json ./

# Install backend dependencies only
RUN pnpm install --prod

# Copy backend source code
COPY backend/ .

EXPOSE 3001
ENV PORT=3001
CMD ["node", "server.js"]
