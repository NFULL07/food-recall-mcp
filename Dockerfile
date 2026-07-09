# ---------- build stage ----------
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- run stage ----------
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
# 운영 의존성만 설치
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# 빌드 결과만 복사 (.env 는 이미지에 넣지 않는다 - 플랫폼 환경변수로 주입)
COPY --from=build /app/dist ./dist
COPY data ./data
EXPOSE 8080
# FOODSAFETYKOREA_API_KEY 는 카카오 클라우드 환경변수로 설정할 것
CMD ["node", "dist/server.js"]
