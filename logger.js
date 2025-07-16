const { createLogger, transports } = require("winston");
const winston = require("winston");
const LokiTransport = require("winston-loki");

const options = {
  transports: [
      new LokiTransport({
        host: "http://100.116.216.5:3100",
        labels: { app: 'clipr-api' },
        json: true,
        format: winston.format.json(),
        replaceTimestamp: true,
        onConnectionError: (err) => console.error(err),
      })
    ]
}

const logger = createLogger(options);

module.exports = logger;