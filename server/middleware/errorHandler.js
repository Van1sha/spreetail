/**
 * Global error handler. Catches anything that slips through route-level
 * try/catch blocks and sends a clean JSON response.
 */
export function errorHandler(err, req, res, next) {
  console.error(`[${new Date().toISOString()}] Error:`, err.message);

  // Multer file-size errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large. Maximum size is 5 MB.' });
  }

  // Validation errors we throw ourselves
  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }

  // Everything else is an internal server error
  res.status(500).json({
    error: 'Something went wrong on our end. Please try again.',
  });
}
