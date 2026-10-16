# Python engine: tender reading (tender_engine extraction), HiGHS sizing and 15-minute dispatch,
# behind FastAPI. Build context: the repository root.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY engine/requirements.txt engine/requirements.txt
RUN pip install -r engine/requirements.txt
COPY engine engine
RUN useradd --system --create-home app && mkdir -p /data/extraction_jobs && chown app /data/extraction_jobs
USER app
ENV EXTRACTION_JOBS_DIR=/data/extraction_jobs
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"
CMD ["python", "-m", "uvicorn", "engine.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--timeout-keep-alive", "120"]
