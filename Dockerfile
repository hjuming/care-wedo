FROM node:22-slim AS frontend
WORKDIR /app/care-wedo-app
COPY care-wedo-app/package*.json ./
RUN npm ci
COPY care-wedo-app ./
RUN npm run build

FROM python:3.11-slim AS backend
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FLASK_CONFIG=prod \
    CARE_WEDO_FRONTEND_DIST=/app/frontend_dist

WORKDIR /app/care-wedo-bot
COPY care-wedo-bot/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY care-wedo-bot ./
COPY --from=frontend /app/care-wedo-app/dist /app/frontend_dist

EXPOSE 5000
CMD ["sh", "-c", "python boot.py && gunicorn wsgi:app --bind 0.0.0.0:${PORT:-5000} --workers 2 --timeout 120"]
