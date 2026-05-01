FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer caching)
COPY app/package.json ./
RUN npm install --production

# Copy application source
COPY app/ ./

EXPOSE 3000

CMD ["node", "server.js"]
