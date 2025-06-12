import { CircuitBreaker } from './retry.js';

// Initialize circuit breakers for critical operations
export const screenCaptureBreaker = new CircuitBreaker(3, 30000);
export const ocrBreaker = new CircuitBreaker(5, 60000);