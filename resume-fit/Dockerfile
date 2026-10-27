# Build the React app without copying local secrets or databases.
FROM node:22-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY client ./client
COPY vite.config.js ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
COPY server/pdf/requirements.txt ./server/pdf/requirements.txt
RUN python3 -m venv /opt/pdf-venv \
    && /opt/pdf-venv/bin/pip install --no-cache-dir -r server/pdf/requirements.txt
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=frontend /app/dist ./dist
RUN mkdir -p /app/data
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=10000 \
    DATA_DIR=/app/data \
    PDF_PYTHON=/opt/pdf-venv/bin/python
EXPOSE 10000
CMD ["node", "server/index.js"]
