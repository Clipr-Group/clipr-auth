# syntax=docker/dockerfile:1
FROM node:lts-alpine

#secrets
RUN --mount=type=secret,id=NODE_ENV \
  export NODE_ENV=$(cat /run/secrets/NODE_ENV) \
  echo NODE_ENV
RUN --mount=type=secret,id=PGHOST \
  export PGHOST=$(cat /run/secrets/PGHOST)
RUN --mount=type=secret,id=PGPORT \
  export PGPORT=$(cat /run/secrets/PGPORT)
RUN --mount=type=secret,id=PGDATABASE \
  export PGDATABASE=$(cat /run/secrets/PGDATABASE)
RUN --mount=type=secret,id=PGUSER \
  export PGUSER=$(cat /run/secrets/PGUSER)
RUN --mount=type=secret,id=PGPASSWORD \
  export PGPASSWORD=$(cat /run/secrets/PGPASSWORD)
RUN --mount=type=secret,id=MAILUSER \
  export MAILUSER=$(cat /run/secrets/MAILUSER)
RUN --mount=type=secret,id=MAILPASS \
  export MAILPASS=$(cat /run/secrets/MAILPASS)
RUN --mount=type=secret,id=SECRETKEY \
  export SECRETKEY=$(cat /run/secrets/SECRETKEY)

WORKDIR /usr/app
COPY package*.json ./
RUN npm install --only=production
COPY . .
EXPOSE 4000
CMD ["npm", "run", "prod"]