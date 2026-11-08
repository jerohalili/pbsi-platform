import { Router } from 'express';
import { getDashboardStats } from '../controllers/dashboard.controller.js';
import { getStudentDashboard } from '../controllers/dashboardStudent.controller.js';
import { getTeacherDashboard } from '../controllers/dashboardTeacher.controller.js';
import { getAdminDashboard } from '../controllers/dashboardAdmin.controller.js';
import { verifyToken } from '../middleware/verifyToken.js';
import { restrictTo } from '../middleware/restrictTo.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

router.use(verifyToken);

router.get('/stats', asyncHandler(getDashboardStats));
// One endpoint per role; each loads its sections independently.
router.get('/student', restrictTo('student'), asyncHandler(getStudentDashboard));
router.get('/teacher', restrictTo('teacher'), asyncHandler(getTeacherDashboard));
router.get('/admin', restrictTo('admin'), asyncHandler(getAdminDashboard));

export default router;
