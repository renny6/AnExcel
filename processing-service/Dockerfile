FROM python:3.12-slim-bookworm

WORKDIR /app

# System dependencies for OpenCV headless and PDF splitting (poppler)
# Pin to bookworm to avoid package-name changes in newer Debian releases.
RUN apt-get update --fix-missing && \
    apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        poppler-utils \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
