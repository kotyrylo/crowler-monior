# Railway-compatible Dockerfile for Playwright script
FROM mcr.microsoft.com/playwright:v1.43.0-jammy

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY script.js ./
COPY seen_values.json ./

CMD ["node", "script.js"]
