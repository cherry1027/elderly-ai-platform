# Build only from an approved source revision. No private configuration enters
# the context or image. Runtime keys are configured through the hosting service.
FROM python:3.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    STAGING_STATE_DIR=/var/data/memy \
    STAGING_ENABLE_REAL_AI=false \
    REAL_AI_ENABLED=false

RUN groupadd --gid 10001 memy \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin memy \
    && mkdir -p /var/data/memy \
    && chown memy:memy /var/data/memy \
    && chmod 700 /var/data/memy

WORKDIR /app/backend
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY backend/scripts ./scripts
COPY deployment/start_staging.py /app/deployment/start_staging.py

EXPOSE 10000
# The short entrypoint handles a root-owned attached volume and drops to the
# dedicated user before importing or starting the application.
ENTRYPOINT ["python", "/app/deployment/start_staging.py"]
