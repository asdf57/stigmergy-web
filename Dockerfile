FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
ARG VITE_FILE_REGISTRY_URL=https://copyparty.ryuugu.dev/
ENV VITE_FILE_REGISTRY_URL=${VITE_FILE_REGISTRY_URL}
RUN npm run build

FROM nginx:1.29-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 4173

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:4173/ || exit 1
