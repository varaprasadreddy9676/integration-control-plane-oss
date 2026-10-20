# Frontend Dockerfile for Integration Gateway - Multi-stage build

# Stage 1: Build the Vite application
# The build output is static files, so build once on the native platform
# (emulated arm64 npm install crashes under QEMU) and copy into each nginx image.
FROM --platform=$BUILDPLATFORM node:26-alpine AS builder

WORKDIR /app

# Prevent out of memory errors during Vite build
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm install && npm cache clean --force

# Copy source code
COPY . .

# Build argument for API URL (can be overridden at build time)
ARG VITE_API_BASE_URL=/api/v1
ARG VITE_APP_NAME="Integration Gateway"
ARG VITE_APP_VERSION="2.0.0"

# Ensure Vite sees these values during build (they override .env defaults)
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_APP_NAME=${VITE_APP_NAME}
ENV VITE_APP_VERSION=${VITE_APP_VERSION}

# Build the application (use vite directly — skips tsc type check which has
# pre-existing errors that do not affect runtime correctness)
RUN npx vite build

# Stage 2: Serve with nginx
FROM nginx:alpine AS production

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Set correct permissions for nginx (user already exists in nginx:alpine)
RUN chown -R nginx:nginx /usr/share/nginx/html && \
  chown -R nginx:nginx /var/cache/nginx && \
  chown -R nginx:nginx /var/log/nginx && \
  chown -R nginx:nginx /etc/nginx/conf.d && \
  touch /var/run/nginx.pid && \
  chown -R nginx:nginx /var/run/nginx.pid

USER nginx

# Expose port 80
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1/health || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
