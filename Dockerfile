FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

RUN pip install --no-cache-dir uv

WORKDIR /app
# dependencies first so code changes don't reinstall them
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app
COPY static ./static
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN useradd --system --uid 10001 tspa \
 && mkdir /data && chown tspa /data \
 && chmod +x /usr/local/bin/docker-entrypoint.sh
USER tspa

# everything you want to keep (database, password hash, secret key) lives in /data
ENV DATABASE_URL=sqlite:////data/tspa.db \
    PASSWORD_FILE=/data/password_hash
VOLUME /data
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/login', timeout=3)"

ENTRYPOINT ["docker-entrypoint.sh"]
# one worker only: the reminder scheduler runs inside the process
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips=*"]
