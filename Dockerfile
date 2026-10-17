FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache postgresql-client

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
# Generation needs a schema URL, but never production credentials or a live DB.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate

COPY . .

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
