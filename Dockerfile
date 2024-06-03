FROM node:lts-alpine
WORKDIR /usr/app
COPY package*.json ./
RUN npm install --only=production
RUN npm install -g pm2
COPY . .
EXPOSE 4000
CMD ["npm", "run", "prod"]