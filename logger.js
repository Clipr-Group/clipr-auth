const winston = require("winston");
const LokiTransport = require("winston-loki");

const options = {
  transports: [
      new winston.transports.Console({
        format: winston.format.simple()
      }),
    
      new LokiTransport({
        host: "http://clipr-tools.follow-ruffe.ts.net:3100",
        labels: { app: 'clipr-auth' },
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