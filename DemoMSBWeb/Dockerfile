# syntax=docker/dockerfile:1
FROM node:22-alpine AS web-build
WORKDIR /src/apps/web
COPY apps/web/package*.json ./
COPY apps/web/vendor ./vendor
RUN npm ci --no-audit --no-fund \
    && npm install --no-save lightningcss-linux-x64-musl@1.33.0
COPY apps/web ./
RUN npm run build

FROM python:3.13-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 CONTEXT_READER_CONFIG=/app/config/context-reader.yaml DEMO_SCENARIO_CONFIG=/app/config/demo-transaction-scenarios.yaml ASSISTANT_URL=http://localhost:8090/assistant/
WORKDIR /app
COPY services/demo-banking-api ./services/demo-banking-api
RUN pip install --no-cache-dir ./services/demo-banking-api
COPY config ./config
COPY --from=web-build /src/apps/web/dist ./apps/web/dist
RUN useradd --create-home --uid 10001 demombb
USER demombb
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"]
WORKDIR /app/services/demo-banking-api
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
