/**
 * server.js — QuantReflex API backend.
 * Clean, independent Express service for deployment on Render.
 *
 * Endpoints:
 *   GET  /api/health                  — Health check
 *   POST /api/ai/word-problems        — Generate word problems
 *   POST /api/ai/explain              — Explain a mistake
 *   POST /api/ai/insights             — AI Coach insights
 *   POST /api/ai/coach                — AI Coach insights (alias)
 *   POST /api/ai/study-plan           — Generate study plan
 *   POST /api/ai/plan                 — Generate study plan (alias)
 *   POST /api/subscriptions/create    — Create Razorpay subscription
 *   POST /api/subscriptions/verify    — Verify subscription payment
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');

const aiRoutes = require('./routes/ai');
const paymentRoutes = require('./routes/payment');

const app = express();
const PORT = process.env.PORT || 5000;

/* ------------------------------------------------------------------ */
/*  CORS — allow frontend / mobile origins                            */
/* ------------------------------------------------------------------ */

var allowedOrigins = (process.env.FRONTEND_ORIGIN || '')
  .split(',')
  .map(function (s) { return s.trim(); })
  .filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    /* Allow requests with no origin (mobile apps, curl, server-to-server) */
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

/* ------------------------------------------------------------------ */
/*  Body parsing                                                      */
/* ------------------------------------------------------------------ */

app.use(express.json({ limit: '16kb' }));

/* ------------------------------------------------------------------ */
/*  Health check                                                      */
/* ------------------------------------------------------------------ */

app.get('/api/health', function (req, res) {
  res.json({ status: 'ok', service: 'quantreflex-backend', timestamp: new Date().toISOString() });
});

/* ------------------------------------------------------------------ */
/*  Routes                                                            */
/* ------------------------------------------------------------------ */

app.use('/api/ai', aiRoutes);
app.use('/api/subscriptions', paymentRoutes);
app.use('/api/payment', paymentRoutes);  /* alias for React Native */

/* ------------------------------------------------------------------ */
/*  404 catch-all                                                     */
/* ------------------------------------------------------------------ */

app.use(function (req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.', retryable: false } });
});

/* ------------------------------------------------------------------ */
/*  Global error handler                                              */
/* ------------------------------------------------------------------ */

app.use(function (err, req, res, _next) {
  console.error('[server] Unhandled error:', err.message || err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', retryable: true } });
});

/* ------------------------------------------------------------------ */
/*  Start                                                             */
/* ------------------------------------------------------------------ */

app.listen(PORT, '0.0.0.0', function () {
  console.log('QuantReflex backend running on port ' + PORT);
});
