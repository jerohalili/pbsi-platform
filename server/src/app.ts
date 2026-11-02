import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import {
  apiLimiter,
  loginAccountLimiter,
  loginNetworkLimiter,
  refreshLimiter,
} from './middleware/rateLimiters.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requireTrustedOrigin } from './middleware/trustedOrigin.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/users.routes.js';
import studentRoutes from './routes/students.routes.js';
import courseRoutes from './routes/courses.routes.js';
import moduleRoutes from './routes/modules.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import assignmentRoutes from './routes/assignments.routes.js';
import submissionRoutes from './routes/submissions.routes.js';
import quizRoutes from './routes/quizzes.routes.js';
import quizAttemptRoutes from './routes/quizAttempts.routes.js';
import attendanceRoutes from './routes/attendance.routes.js';
import timetableRoutes from './routes/timetable.routes.js';
import gradeRoutes from './routes/grades.routes.js';
import discussionRoutes from './routes/discussions.routes.js';
import notificationRoutes from './routes/notifications.routes.js';
import auditLogRoutes from './routes/auditLogs.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import teacherRoutes from './routes/teachers.routes.js';

const app = express();

// Number of proxies between the internet and this server (1 on Render). Set TRUST_PROXY_HOPS if the
// platform puts more than one in front; a wrong value makes everyone look like one network address.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
    // Lets the browser read how long to wait after a 429.
    exposedHeaders: ['Retry-After'],
  }),
);
// Refuse state-changing requests made by other websites (see the middleware for why).
app.use('/api', requireTrustedOrigin);
// Only JSON bodies (and multipart uploads, handled by multer): the form-encoded type a cross-site
// <form> can send without a CORS preflight is deliberately not parsed.
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
// Rate limiting (see middleware/rateLimiters.ts for the rules and the numbers)
app.use('/api/auth/login', loginNetworkLimiter, loginAccountLimiter);
app.use('/api/auth/refresh', refreshLimiter);
app.use('/api', apiLimiter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/modules', moduleRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/quizzes', quizRoutes);
app.use('/api/quiz-attempts', quizAttemptRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/timetable', timetableRoutes);
app.use('/api/grades', gradeRoutes);
app.use('/api/discussions', discussionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/audit-logs', auditLogRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/teachers', teacherRoutes);

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use(errorHandler);

export default app;
