import { Router } from 'express';
import { listExams, getExam, createExam, updateExam, deleteExam } from '../controllers/exams.controller.js';
import { verifyToken } from '../middleware/verifyToken.js';
import { restrictTo } from '../middleware/restrictTo.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { createExamSchema, updateExamSchema } from '../utils/validation.js';

const router = Router();

router.use(verifyToken);

// GET /api/exams?course_id=  (everyone; shaped per viewer, drafts only for the course's teacher / admins)
router.get('/', asyncHandler(listExams));
router.get('/:id', asyncHandler(getExam));
router.post('/', restrictTo('admin', 'teacher'), validate(createExamSchema), asyncHandler(createExam));
router.patch('/:id', restrictTo('admin', 'teacher'), validate(updateExamSchema), asyncHandler(updateExam));
router.delete('/:id', restrictTo('admin', 'teacher'), asyncHandler(deleteExam));

export default router;
