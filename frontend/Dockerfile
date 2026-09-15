# Stage 1: Build the React application
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS build
WORKDIR /app
ARG VITE_OFFLINE_MODE=false
ARG VITE_ENABLED_MODELS=deepseek
ENV VITE_OFFLINE_MODE=$VITE_OFFLINE_MODE
ENV VITE_ENABLED_MODELS=$VITE_ENABLED_MODELS
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run lint
RUN npm run build

# Stage 2: Serve the application with Nginx
FROM nginx:stable-alpine@sha256:97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46
COPY --from=build /app/dist /usr/share/nginx/html
ARG NGINX_CONF=nginx.conf
COPY ${NGINX_CONF} /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
