FROM node:22-alpine AS build
WORKDIR /workspace
COPY package.json package-lock.json tsconfig.base.json ./
COPY frontend ./frontend
COPY backend ./backend
RUN npm ci
RUN npm run build --workspace @openaegis/admin-console

FROM nginx:1.27-alpine
COPY --from=build /workspace/frontend/apps/admin-console/dist /usr/share/nginx/html
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
