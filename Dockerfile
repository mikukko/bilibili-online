FROM node:22-bookworm-slim

# Install Python and Chromium runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency definitions
COPY apps/web/package.json ./apps/web/
COPY apps/worker/requirements.txt ./apps/worker/

# Install Node.js dependencies
# Reuse system Chromium to keep image multi-arch compatible.
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN cd apps/web && npm install

# Install Python dependencies
# Using --break-system-packages as we are in a container and want to utilize the system python
RUN cd apps/worker && pip3 install --no-cache-dir -r requirements.txt --break-system-packages

# Copy the rest of the application
COPY . .

# Set environment variables
ENV NODE_ENV=production
ENV PYTHONPATH=/app/apps/worker
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Expose web port
EXPOSE 3000
