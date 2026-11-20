# CivicProof web app (apps/web) for Northflank.
#
# Build context: the REPOSITORY ROOT.  Dockerfile path: deploy/web/Dockerfile
#
# Vite bakes VITE_* values into the JavaScript at BUILD time, so set them as
# Northflank *build arguments*. They are public by design (they ship to every
# browser): never pass a service-role key, signing key or AI key here.

# ── 1. build ─────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY apps/web/ ./

ARG VITE_API_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_USE_MOCKS=false
ENV VITE_API_URL=$VITE_API_URL \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_USE_MOCKS=$VITE_USE_MOCKS

RUN npm run build

# ── 2. serve ─────────────────────────────────────────────────────────────────
# Unprivileged nginx: runs as a non-root user and listens on 8080.
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY deploy/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
