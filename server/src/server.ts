import app from './app.js';
import { testConnection } from './config/db.js';
import { assertAnnouncementsSchema, assertNotificationCourseSchema, assertCourseworkSchema, assertMentionsSchema, assertQuizTimerSchema, assertUploadSchema } from './config/schemaCheck.js';
import { assertServerEnv } from './config/env.js';
import { startQuizSweep } from './utils/quizSessions.js';

const PORT = Number(process.env.PORT) || 4000;

async function start() {
  try {
    assertServerEnv();
    await testConnection();
    await assertUploadSchema();
    await assertQuizTimerSchema();
    await assertCourseworkSchema();
    await assertMentionsSchema();
    await assertAnnouncementsSchema();
    await assertNotificationCourseSchema();
    app.listen(PORT, () => {
      console.log(`[SERVER] Running on http://localhost:${PORT}`);
      console.log(`[SERVER] Environment: ${process.env.NODE_ENV ?? 'development'}`);
      // Submits timed quizzes whose time ran out while the student was away.
      startQuizSweep();
    });
  } catch (err) {
    console.error('[SERVER] Failed to start:', err);
    process.exit(1);
  }
}

start();
