FROM node:24

ADD . /app

WORKDIR /app

RUN apt update
RUN apt install -y curl

RUN npm i

EXPOSE 3000

CMD ["node", "app.js"]