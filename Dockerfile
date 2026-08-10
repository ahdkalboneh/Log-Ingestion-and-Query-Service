FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

ENV NODE_OPTIONS="--max-old-space-size=210"

COPY . .

EXPOSE 8080

CMD ["npm", "start"]