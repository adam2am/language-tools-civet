import { Logger } from '../../logger';

// A simple flag to enable/disable logging.
// In a real scenario, this might be tied to an environment variable or configuration.
const CIVET_LOGGING_ENABLED = true;

const LOG_PREFIX = `[CV${Math.floor(Math.random() * 90) + 10}]`;
const logCounters: Record<string, number> = {};
const LOG_LIMIT = 2000; // Max logs per unique location to avoid spamming the console.

/**
 * A simple conditional logger for debugging the Civet pipeline.
 * Adheres to the format: [CV##] (file:line) - message
 *
 * @param file The file where the log is being called from (e.g., 'CivetMapper.ts').
 * @param line The line number where the log is located.
 * @param message The descriptive message for the log.
 * @param data Any additional data objects to be logged.
 */
export function civetLog(file: string, line: number, message: string, ...data: any[]) {
    if (!CIVET_LOGGING_ENABLED) {
        return;
    }

    const locationKey = `${file}:${line}`;
    logCounters[locationKey] = (logCounters[locationKey] || 0) + 1;

    if (logCounters[locationKey] > LOG_LIMIT) {
        if (logCounters[locationKey] === LOG_LIMIT + 1) {
            console.log(
                `${LOG_PREFIX} (${locationKey}) - Log limit reached. Suppressing further logs for this location.`
            );
        }
        return;
    }

    // Use the official LSP logger to ensure messages appear in the output channel
    Logger.log(`${LOG_PREFIX} (${locationKey}) - ${message}`, ...data);
}