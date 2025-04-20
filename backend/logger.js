const { createLogger, format, transports } = require('winston');

// Create and configure the logger
const logger = createLogger({
  level: 'debug',
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message, ...meta }) => {
      // Include metadata if present for debugging
      const metaString = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
      return `${timestamp} [${level.toUpperCase()}] ${message}${metaString}`;
    })
  ),
  transports: [new transports.Console()]
});

module.exports = logger; 