const winston = require("winston");
const LokiTransport = require("winston-loki");

const options = {
  transports: [
      new winston.transports.Console({
        format: winston.format.simple()
      }),
    
      new LokiTransport({
        host: process.env.LOGS_HOST,
        labels: { app: process.env.APP_NAME },
        json: true,
        format: winston.format.json(),
        replaceTimestamp: true,
        onConnectionError: (err) => console.error(err),
        batching: true,
        interval: 5
      })
    ]
}

const logger = winston.createLogger(options);

module.exports = logger;